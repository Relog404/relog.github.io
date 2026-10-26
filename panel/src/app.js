import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import { config, isAdmin, ROOT } from './config.js';
import * as store from './store.js';
import * as items from './items.js';
import * as economy from './economy.js';
import { execRcon, parseStatus, demoStatus, RconError } from './rcon.js';
import { steamLoginUrl, verifySteamLogin, getPlayerSummaries, createSession, readSession } from './steam.js';

const COOKIE = 'cs2panel_session';

/** Команды, которые останавливают сервер или меняют его настройки — требуется явное подтверждение. */
const DESTRUCTIVE = [/^\s*rcon_password\s/i, /^\s*(quit|exit|_restart)\s*$/i, /^\s*(sv_shutdown|sv_kick_players_on_shutdown)\s/i];

export function createApp() {
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());
  app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));

  /* ------------------------------ сессии ------------------------------- */

  app.use((req, _res, next) => {
    const session = readSession(req.cookies?.[COOKIE]);
    req.user = session
      ? { steamId: session.steamId, isAdmin: isAdmin(session.steamId) }
      : config.demoAdmin
        ? { steamId: config.demoAdminSteamId, isAdmin: true, demo: true }
        : null;
    next();
  });

  const requireAuth = (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Нужно войти через Steam' });
    next();
  };

  const requireAdmin = (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Нужно войти через Steam' });
    if (!req.user.isAdmin) return res.status(403).json({ error: 'Нет прав администратора панели' });
    next();
  };

  const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  /* -------------------------------- API -------------------------------- */

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, skins: items.loadItems().length, servers: store.listServers().length, uptime: process.uptime() });
  });

  app.get('/api/config', (_req, res) => {
    res.json({
      demoMode: config.demoMode,
      steamApiKey: Boolean(config.steamApiKey),
      adminConfigured: config.adminSteamIds.length > 0,
      admins: config.adminSteamIds,
      allowServerManagement: config.allowServerManagement,
      baseUrl: config.baseUrl,
      economy: economy.settings(),
      // Игровой сервер не обязателен: сайт, магазин и апгрейд работают без него.
      serverBound: store.listServers().some((s) => !s.demo && s.hasPassword),
    });
  });

  app.get('/api/session', asyncRoute(async (req, res) => {
    if (!req.user) return res.json({ user: null });
    if (req.user.demo) {
      return res.json({
        user: { steamId: req.user.steamId, name: 'Демо-админ', avatar: '', isAdmin: true, demo: true },
      });
    }
    const summaries = await getPlayerSummaries([req.user.steamId]);
    const cached = store.getProfile(req.user.steamId);
    const fresh = summaries[req.user.steamId];
    if (fresh) store.rememberProfile(req.user.steamId, fresh);
    const profile = fresh || cached || {};
    res.json({
      user: {
        steamId: req.user.steamId,
        name: profile.name || '',
        avatar: profile.avatar || '',
        isAdmin: req.user.isAdmin,
      },
    });
  }));

  /* --------------------------- вход через Steam ------------------------- */

  app.get('/auth/steam', (req, res) => {
    const returnTo = new URL('/auth/steam/return', config.baseUrl).toString();
    res.redirect(steamLoginUrl(returnTo));
  });

  app.get('/auth/steam/return', asyncRoute(async (req, res) => {
    const steamId = await verifySteamLogin(req.query);
    if (!steamId) return res.status(400).send('Не удалось подтвердить вход через Steam. Попробуйте снова.');
    const summaries = await getPlayerSummaries([steamId]);
    if (summaries[steamId]) store.rememberProfile(steamId, summaries[steamId]);
    res.cookie(COOKIE, createSession(steamId), {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.baseUrl.startsWith('https://'),
      maxAge: config.sessionTtlDays * 24 * 60 * 60 * 1000,
    });
    res.redirect('/');
  }));

  app.post('/api/logout', (req, res) => {
    res.clearCookie(COOKIE);
    res.json({ ok: true });
  });

  /* ------------------------------- серверы ------------------------------ */

  app.get('/api/servers', requireAdmin, (req, res) => {
    res.json({ servers: store.listServers() });
  });

  app.post('/api/servers', requireAdmin, (req, res) => {
    if (!config.allowServerManagement) return res.status(403).json({ error: 'Управление серверами отключено (ALLOW_SERVER_MANAGEMENT=0)' });
    const { name, host, gamePort, rconPort, password } = req.body || {};
    if (!host || !password) return res.status(400).json({ error: 'Нужны host и RCON-пароль' });
    res.status(201).json({ server: store.addServer({ name, host, gamePort, rconPort, password }) });
  });

  app.patch('/api/servers/:id', requireAdmin, (req, res) => {
    if (!config.allowServerManagement) return res.status(403).json({ error: 'Управление серверами отключено' });
    const updated = store.updateServer(req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ error: 'Сервер не найден или доступен только для чтения' });
    res.json({ server: updated });
  });

  app.delete('/api/servers/:id', requireAdmin, (req, res) => {
    if (!config.allowServerManagement) return res.status(403).json({ error: 'Управление серверами отключено' });
    res.json({ ok: store.removeServer(req.params.id) });
  });

  /** Статус сервера: карта, игроки, пинг. */
  app.get('/api/status', requireAdmin, asyncRoute(async (req, res) => {
    const server = req.query.serverId ? store.getServer(req.query.serverId) : store.getDefaultServer();
    if (!server) return res.status(404).json({ error: 'Сервер не найден' });

    if (config.demoMode || server.demo || !server.password) {
      const demo = demoStatus();
      const summaries = await getPlayerSummaries(demo.players.map((p) => p.steamId64));
      return res.json({
        online: true,
        demo: true,
        server: { id: server.id, name: server.name, host: server.host, gamePort: server.gamePort },
        info: demo.info,
        players: demo.players.map((p) => ({ ...p, profile: summaries[p.steamId64] || null })),
      });
    }

    try {
      const output = await execRcon({
        host: server.host,
        port: server.rconPort,
        password: server.password,
        command: 'status',
      });
      const { info, players } = parseStatus(output);
      const summaries = await getPlayerSummaries(players.map((p) => p.steamId64));
      res.json({
        online: true,
        demo: false,
        server: { id: server.id, name: server.name, host: server.host, gamePort: server.gamePort },
        info,
        players: players.map((p) => ({ ...p, profile: summaries[p.steamId64] || null })),
      });
    } catch (error) {
      res.status(502).json({
        online: false,
        error: error instanceof RconError ? error.message : 'Сервер не отвечает',
        code: error instanceof RconError ? error.code : 'unknown',
      });
    }
  }));

  /** Произвольная команда в RCON-консоль. */
  app.post('/api/console', requireAdmin, asyncRoute(async (req, res) => {
    const { serverId, command, confirm } = req.body || {};
    if (!command || typeof command !== 'string') return res.status(400).json({ error: 'Пустая команда' });
    const trimmed = command.trim();
    if (trimmed.length > 512) return res.status(400).json({ error: 'Команда слишком длинная' });
    if (DESTRUCTIVE.some((re) => re.test(trimmed)) && confirm !== true) {
      return res.status(409).json({ error: 'Команда может остановить сервер. Подтвердите действие.', needConfirm: true });
    }

    const server = serverId ? store.getServer(serverId) : store.getDefaultServer();
    if (!server) return res.status(404).json({ error: 'Сервер не найден' });
    if (config.demoMode || server.demo || !server.password) {
      return res.json({ output: `[демо] команда не отправлена: ${trimmed}`, demo: true });
    }

    try {
      const output = await execRcon({
        host: server.host,
        port: server.rconPort,
        password: server.password,
        command: trimmed,
      });
      res.json({ output, demo: false });
    } catch (error) {
      res.status(502).json({
        error: error instanceof RconError ? error.message : 'Сервер не отвечает',
        code: error instanceof RconError ? error.code : 'unknown',
      });
    }
  }));

  /** Готовые действия одной кнопкой. */
  app.post('/api/action', requireAdmin, asyncRoute(async (req, res) => {
    const { serverId, action, payload = {} } = req.body || {};
    const server = serverId ? store.getServer(serverId) : store.getDefaultServer();
    if (!server) return res.status(404).json({ error: 'Сервер не найден' });

    const commands = {
      restart: () => 'mp_restartgame 1',
      halftime: () => 'mp_halftime_duration 15; mp_restartgame 1',
      pausematch: () => 'mp_pause_match',
      unpausematch: () => 'mp_unpause_match',
      map: () => `changelevel ${String(payload.map || '').replace(/[^\w\-]/g, '')}`,
      workshop: () => `ds_workshop_changelevel ${String(payload.map || '').replace(/[^\w\-\d]/g, '')}`,
      say: () => `say ${String(payload.message || '').replace(/[";\n\r]/g, ' ').slice(0, 200)}`,
      kick: () => `kickid ${String(payload.name || '').replace(/[^\w\d_\-\[\]:]/g, '').slice(0, 64)}`,
      bots: () => (Number(payload.count) > 0 ? `bot_quota ${Math.min(Number(payload.count) || 0, 10)}` : 'bot_quota 0'),
      password: () => `sv_password ${String(payload.password || '').replace(/\s/g, '')}`,
      settings: () => `exec ${String(payload.cfg || '').replace(/[^\w\-\.]/g, '')}`,
    };

    const build = commands[action];
    if (!build) return res.status(400).json({ error: 'Неизвестное действие' });
    const command = build();

    if (config.demoMode || server.demo || !server.password) {
      return res.json({ command, output: `[демо] было бы отправлено: ${command}`, demo: true });
    }

    try {
      const output = await execRcon({ host: server.host, port: server.rconPort, password: server.password, command });
      res.json({ command, output, demo: false });
    } catch (error) {
      res.status(502).json({
        command,
        error: error instanceof RconError ? error.message : 'Сервер не отвечает',
        code: error instanceof RconError ? error.code : 'unknown',
      });
    }
  }));

  /* ------------------------------ витрина ------------------------------ */

  // /api/skins и /api/catalog — один и тот же каталог, /api/skins оставлен для совместимости.
  const catalogQuery = (req, res) => res.json(items.queryItems(req.query));

  app.get('/api/skins', catalogQuery);
  app.get('/api/catalog', catalogQuery);
  app.get('/api/skins/weapons', (_req, res) => res.json({ weapons: items.weaponsIndex() }));
  app.get('/api/catalog/categories', (_req, res) => res.json({ categories: items.categoryIndex() }));

  /* ------------------------------- сборки ------------------------------- */

  app.get('/api/loadout', requireAuth, (req, res) => {
    res.json({ loadouts: store.listLoadouts(req.user.steamId) });
  });

  app.post('/api/loadout', requireAuth, (req, res) => {
    const { id, name, entries, isPublic } = req.body || {};
    if (!Array.isArray(entries)) return res.status(400).json({ error: 'Нужен массив entries' });
    const loadout = store.saveLoadout(req.user.steamId, { id, name, entries, isPublic });
    res.json({ loadout });
  });

  app.delete('/api/loadout/:id', requireAuth, (req, res) => {
    res.json({ ok: store.deleteLoadout(req.user.steamId, req.params.id) });
  });

  app.get('/api/loadout/public', (_req, res) => {
    res.json({ loadouts: store.listPublicLoadouts(24) });
  });

  /* --------------------- монеты, хранилище, магазин --------------------- */

  // Экономика полностью виртуальная: монеты нельзя купить за деньги, пополнить
  // реальными предметами из Steam или вывести наружу. См. economy.js.
  const economyRoute = (fn) =>
    asyncRoute(async (req, res) => {
      try {
        await fn(req, res);
      } catch (error) {
        const status = { no_coins: 400, no_item: 404, bad_items: 400, banned: 403, daily_cooldown: 429 }[error.code] || 400;
        res.status(status).json({ error: error.message, code: error.code });
      }
    });

  app.get('/api/economy/state', requireAuth, economyRoute((req, res) => {
    res.json(economy.publicState(req.user.steamId));
  }));

  app.post('/api/economy/daily', requireAuth, economyRoute((req, res) => {
    res.json({ coins: economy.claimDaily(req.user.steamId) });
  }));

  app.post('/api/economy/buy', requireAuth, economyRoute((req, res) => {
    res.json(economy.buyItem(req.user.steamId, req.body?.itemId));
  }));

  app.post('/api/economy/sell', requireAuth, economyRoute((req, res) => {
    res.json(economy.sellItem(req.user.steamId, req.body?.uid));
  }));

  app.post('/api/economy/seed', requireAuth, economyRoute((req, res) => {
    res.json(economy.rotateSeed(req.user.steamId));
  }));

  /** Публичные настройки апгрейда: множители и шансы. */
  app.get('/api/upgrade/settings', (_req, res) => {
    res.json(economy.settings());
  });

  /** Подобрать цель под множитель: ?stake=1000&multiplier=10 */
  app.get('/api/upgrade/suggestions', (req, res) => {
    const stake = Number(req.query.stake) || 0;
    const multiplier = Number(req.query.multiplier) || 2;
    if (stake <= 0) return res.json({ items: [], target: 0 });
    res.json({ stake, multiplier, target: Math.round(stake * multiplier), items: economy.suggestTargets(stake, multiplier) });
  });

  app.post('/api/upgrade/preview', requireAuth, economyRoute((req, res) => {
    res.json(economy.previewUpgrade(req.user.steamId, req.body?.uids || [], req.body?.targetItemId));
  }));

  app.post('/api/upgrade/play', requireAuth, economyRoute((req, res) => {
    res.json(economy.playUpgrade(req.user.steamId, req.body?.uids || [], req.body?.targetItemId));
  }));

  app.get('/api/upgrade/history', (_req, res) => {
    res.json({ history: store.getHistory(20) });
  });

  /** Проверка честности розыгрыша: тот же roll при тех же seed'ах. */
  app.get('/api/upgrade/verify', (req, res) => {
    const { serverSeed, clientSeed, nonce } = req.query;
    if (!serverSeed || !clientSeed || nonce === undefined) {
      return res.status(400).json({ error: 'Нужны serverSeed, clientSeed и nonce' });
    }
    res.json(economy.verifyRoll({ serverSeed, clientSeed, nonce: Number(nonce) }));
  });

  /* --------------------- экипировка и API плагина ------------------------ */

  // Слоты + что надето + из чего можно выбрать.
  app.get('/api/equip', requireAuth, (_req, res) => {
    res.json({ slots: economy.equippedState(_req.user.steamId) });
  });

  app.post('/api/equip', requireAuth, economyRoute((req, res) => {
    const { slot, uid, wear, seed, statTrak, kills } = req.body || {};
    if (!slot || !uid) return res.status(400).json({ error: 'Нужны slot и uid' });
    res.json({ equipped: economy.equipItem(req.user.steamId, slot, uid, { wear, seed, statTrak, kills }) });
  }));

  app.delete('/api/equip/:slot', requireAuth, (_req, res) => {
    res.json({ ok: economy.unequipSlot(_req.user.steamId, _req.params.slot) });
  });

  /** Чужая экипировка — для профилей, без списка доступных предметов. */
  app.get('/api/equip/:steamId', (req, res) => {
    if (!/^\d{5,20}$/.test(req.params.steamId)) return res.status(400).json({ error: 'Некорректный SteamID' });
    const econ = store.getEconomy(req.params.steamId);
    if (!econ?.equipped) return res.json({ steamId: req.params.steamId, equipped: [] });
    res.json({
      steamId: req.params.steamId,
      equipped: Object.values(econ.equipped).map((e) => ({
        ...e,
        item: items.findItem(e.itemId),
        slot: items.findSlot(e.slot),
      })),
    });
  });

  /**
   * То, что забирает игровой плагин (CounterStrikeSharp) перед выдачей оружия.
   * Авторизация: заголовок X-Plugin-Key (ключ сервера из панели или PLUGIN_API_KEY).
   */
  app.get('/api/plugin/loadout/:steamId', (req, res) => {
    const key = req.get('X-Plugin-Key') || req.query.key;
    const allowed = (config.pluginApiKey && key === config.pluginApiKey) || store.isValidPluginKey(key);
    if (!allowed) return res.status(401).json({ error: 'Нужен ключ плагина' });
    if (!/^\d{5,20}$/.test(req.params.steamId)) return res.status(400).json({ error: 'Некорректный SteamID' });
    res.json(economy.pluginLoadout(req.params.steamId));
  });

  app.post('/api/servers/:id/plugin-key', requireAdmin, (req, res) => {
    const key = store.regeneratePluginKey(req.params.id);
    if (!key) return res.status(404).json({ error: 'Сервер не найден' });
    res.json({ pluginKey: key });
  });

  /* ------------------------------ админка ------------------------------- */

  app.get('/api/admin/stats', requireAdmin, (_req, res) => {
    res.json(economy.globalStats());
  });

  app.get('/api/admin/users', requireAdmin, (req, res) => {
    const users = economy.listUsers().map((user) => ({
      ...user,
      profile: store.getProfile(user.steamId) || null,
    }));
    res.json({ users: users.sort((a, b) => b.wagered - a.wagered).slice(0, 100) });
  });

  app.post('/api/admin/coins', requireAdmin, (req, res) => {
    const { steamId, amount } = req.body || {};
    if (!/^\d{5,20}$/.test(String(steamId || ''))) return res.status(400).json({ error: 'Некорректный SteamID' });
    const delta = Number(amount);
    if (!Number.isFinite(delta) || delta === 0) return res.status(400).json({ error: 'Некорректная сумма' });
    res.json({ steamId, coins: economy.grantCoins(steamId, delta) });
  });

  app.post('/api/admin/ban', requireAdmin, (req, res) => {
    const { steamId, banned } = req.body || {};
    if (!/^\d{5,20}$/.test(String(steamId || ''))) return res.status(400).json({ error: 'Некорректный SteamID' });
    res.json({ steamId, banned: economy.setBan(steamId, banned !== false) });
  });

  app.get('/api/admin/history', requireAdmin, (_req, res) => {
    res.json({ history: store.getHistory(50) });
  });

  app.patch('/api/admin/upgrade/settings', requireAdmin, (req, res) => {
    res.json({ upgrade: store.patchUpgradeSettings(req.body || {}) });
  });

  app.get('/api/admin/items', requireAdmin, (_req, res) => {
    res.json({ custom: store.getCustomItems(), overrides: store.getCatalogOverrides() });
  });

  app.post('/api/admin/items', requireAdmin, (req, res) => {
    const { id, weapon, pattern, category, rarity, price } = req.body || {};
    if (!id || !weapon || !pattern) return res.status(400).json({ error: 'Нужны id, weapon и pattern' });
    if (!/^[\w\-. ]{2,80}$/.test(String(id))) return res.status(400).json({ error: 'id: только буквы, цифры, -, _ и .' });
    const item = store.upsertCustomItem({
      id: String(id),
      weapon: String(weapon).slice(0, 60),
      pattern: String(pattern).slice(0, 80),
      category: String(category || 'Прочее').slice(0, 40),
      rarity: String(rarity || 'mil-spec').slice(0, 40),
      price: Math.max(1, Math.round(Number(price) || 1)),
    });
    items.resetCache();
    res.status(201).json({ item });
  });

  app.patch('/api/admin/items/:id', requireAdmin, (req, res) => {
    const { price, hidden } = req.body || {};
    const patch = {};
    if (price !== undefined) patch.price = Math.max(1, Math.round(Number(price) || 1));
    if (hidden !== undefined) patch.hidden = Boolean(hidden);
    const override = store.setCatalogOverride(req.params.id, patch);
    items.resetCache();
    res.json({ id: req.params.id, override });
  });

  app.delete('/api/admin/items/:id', requireAdmin, (req, res) => {
    const custom = store.getCustomItems().some((i) => i.id === req.params.id);
    if (custom) store.removeCustomItem(req.params.id);
    else store.setCatalogOverride(req.params.id, { hidden: true });
    items.resetCache();
    res.json({ ok: true });
  });

  app.get('/api/profile/:steamId', asyncRoute(async (req, res) => {
    const { steamId } = req.params;
    if (!/^\d{17}$/.test(steamId)) return res.status(400).json({ error: 'Некорректный SteamID64' });
    const summaries = await getPlayerSummaries([steamId]);
    const profile = summaries[steamId] || store.getProfile(steamId) || null;
    res.json({ steamId, profile });
  }));

  /* ------------------------------ ошибки -------------------------------- */

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Метод не найден' }));

  // eslint-disable-next-line no-unused-vars
  app.use((error, _req, res, _next) => {
    console.error('[panel]', error);
    res.status(500).json({ error: 'Внутренняя ошибка панели' });
  });

  return app;
}
