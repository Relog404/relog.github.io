import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import { config, isAdmin, ROOT } from './config.js';
import * as store from './store.js';
import * as skins from './skins.js';
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
    res.json({ ok: true, skins: skins.loadSkins().length, servers: store.listServers().length, uptime: process.uptime() });
  });

  app.get('/api/config', (_req, res) => {
    res.json({
      demoMode: config.demoMode,
      steamApiKey: Boolean(config.steamApiKey),
      adminConfigured: config.adminSteamIds.length > 0,
      admins: config.adminSteamIds,
      allowServerManagement: config.allowServerManagement,
      baseUrl: config.baseUrl,
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

  /* -------------------------------- скины ------------------------------ */

  app.get('/api/skins', (req, res) => {
    res.json(skins.querySkins(req.query));
  });

  app.get('/api/skins/weapons', (_req, res) => {
    res.json({ weapons: skins.weaponsIndex() });
  });

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
