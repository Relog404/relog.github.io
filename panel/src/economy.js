import crypto from 'node:crypto';
import { config } from './config.js';
import * as store from './store.js';
import * as items from './items.js';
const { findItem, findSlot, itemFitsSlot, slotIndex } = items;

/**
 * Внутренняя экономика панели.
 *
 * ВАЖНО: монеты виртуальные. Они не покупаются за реальные деньги, не пополняются
 * реальными предметами из инвентаря Steam и не выводятся обратно наружу.
 * Никаких депозитов, ставок реальными вещами и кэшаута здесь нет и не планируется.
 */

const START_COINS = Number(process.env.START_COINS || 1000);
const DAILY_COINS = Number(process.env.DAILY_COINS || 250);
const DAILY_COOLDOWN_MS = Number(process.env.DAILY_COOLDOWN_HOURS || 20) * 3600 * 1000;
/** Доля «в пользу дома» по умолчанию: шанс = ставка / цена цели * edge. */
const DEFAULT_EDGE = config.upgradeEdge;

/**
 * Коэффициент для конкретного множителя (во сколько цель дороже ставки).
 * Даёт админу крутить «базовые шансы»: x2 — щедрее, x50 — скромнее.
 */
function edgeForMultiplier(multiplier) {
  const settings = store.getUpgradeSettings();
  if (!Number.isFinite(multiplier) || multiplier <= 1) return settings.globalEdge ?? DEFAULT_EDGE;
  const bucket = [...settings.multipliers].sort((a, b) => b - a).find((m) => multiplier >= m);
  const value = bucket !== undefined ? settings.edgeByMultiplier[String(bucket)] : undefined;
  return Number.isFinite(value) ? value : (settings.globalEdge ?? DEFAULT_EDGE);
}

/** Множитель цели: во сколько раз цель дороже ставки. */
export function targetMultiplier(stake, targetPrice) {
  if (!stake || !targetPrice) return 0;
  return Number((targetPrice / stake).toFixed(3));
}
const MIN_CHANCE = 0.01;
const MAX_CHANCE = 0.95;
/** Сколько монет возвращается при продаже предмета обратно в магазин. */
const SELL_RATE = Math.min(Math.max(Number(process.env.SELL_RATE || 0.85), 0.1), 1);
const REEL_CELLS = 40;

const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const hmac = (key, value) => crypto.createHmac('sha256', String(key)).update(String(value)).digest('hex');

/** HMAC-SHA256 → число [0, 1). Один и тот же результат при одинаковых seed'ах. */
function fairRoll(serverSeed, clientSeed, nonce) {
  const hex = hmac(serverSeed, `${clientSeed}:${nonce}`).slice(0, 8);
  return parseInt(hex, 16) / 0x100000000;
}

function newSeeds() {
  const serverSeed = crypto.randomBytes(16).toString('hex');
  return { serverSeed, serverSeedHash: sha256(serverSeed), clientSeed: crypto.randomBytes(6).toString('hex'), nonce: 0 };
}

/** Публичные настройки экономики — их видит и фронтенд. */
export function settings() {
  const upgrade = store.getUpgradeSettings();
  return {
    realMoney: false,          // депозитов и вывода реальных вещей нет и не будет
    startCoins: START_COINS,
    dailyCoins: DAILY_COINS,
    edge: upgrade.globalEdge ?? DEFAULT_EDGE,
    sellRate: SELL_RATE,
    reelCells: REEL_CELLS,
    // Апгрейд работает и без привязанного игрового сервера: сервер нужен
    // только для синхронизации скинов в саму игру.
    serverRequired: false,
    multipliers: upgrade.multipliers,
    chances: upgrade.multipliers.map((multiplier) => ({
      multiplier,
      edge: edgeForMultiplier(multiplier),
      chance: Math.min(MAX_CHANCE, Math.max(MIN_CHANCE, (1 / multiplier) * edgeForMultiplier(multiplier))),
    })),
  };
}

/** Настройки отображения цен: валюта и курсы. */
export function siteSettings() {
  return store.getSiteSettings();
}

/** Подбор целей под множитель: цена цели ≈ ставка × multiplier. */
export function suggestTargets(stake, multiplier, limit = 12) {
  const target = Math.max(1, Number(stake) || 0) * Math.max(1, Number(multiplier) || 2);
  const pool = items
    .loadItems()
    .filter((item) => item.price >= target * 0.7 && item.price <= target * 1.3)
    .sort((a, b) => Math.abs(a.price - target) - Math.abs(b.price - target));
  const list = pool.length ? pool : items.loadItems().filter((i) => i.price >= target * 0.5).sort((a, b) => a.price - b.price);
  return list.slice(0, limit);
}

export function stateFor(steamId) {
  const econ = store.getEconomy(steamId);
  if (!econ.createdAt) {
    Object.assign(econ, {
      coins: START_COINS,
      items: [],
      stats: { wagered: 0, won: 0, upgrades: 0, wins: 0, bestWin: 0, bought: 0, sold: 0 },
      banned: false,
      createdAt: new Date().toISOString(),
      ...newSeeds(),
    });
    store.saveEconomy(steamId, econ);
  }
  return econ;
}

/** То, что видно самому пользователю. */
export function publicState(steamId) {
  const econ = stateFor(steamId);
  const catalog = items.loadItems();
  const byId = new Map(catalog.map((i) => [i.id, i]));
  return {
    coins: econ.coins,
    items: econ.items.map((entry) => {
      const item = byId.get(entry.itemId);
      return {
        uid: entry.uid,
        itemId: entry.itemId,
        acquiredAt: entry.acquiredAt,
        price: entry.price,
        item: item ? { ...item } : { id: entry.itemId, weapon: '—', pattern: 'предмет удалён из каталога', category: 'Прочее', rarity: 'consumer', price: entry.price },
      };
    }),
    stats: econ.stats,
    banned: Boolean(econ.banned),
    daily: {
      available: Date.now() - Date.parse(econ.dailyAt || 0) > DAILY_COOLDOWN_MS,
      amount: DAILY_COINS,
      nextAt: Date.parse(econ.dailyAt || 0) + DAILY_COOLDOWN_MS,
    },
    fair: { serverSeedHash: econ.serverSeedHash, clientSeed: econ.clientSeed, nonce: econ.nonce },
  };
}

export function grantCoins(steamId, amount, reason = 'admin') {
  const econ = stateFor(steamId);
  econ.coins = Math.max(0, Math.round(econ.coins + Number(amount)));
  store.saveEconomy(steamId, econ);
  return econ.coins;
}

export function claimDaily(steamId) {
  const econ = stateFor(steamId);
  if (Date.now() - Date.parse(econ.dailyAt || 0) <= DAILY_COOLDOWN_MS) {
    const error = new Error('Бонус уже получен, приходите позже');
    error.code = 'daily_cooldown';
    throw error;
  }
  econ.dailyAt = new Date().toISOString();
  econ.coins += DAILY_COINS;
  store.saveEconomy(steamId, econ);
  return econ.coins;
}

/** Смена клиентского seed'а: старый серверный seed раскрывается, берётся новый. */
export function rotateSeed(steamId) {
  const econ = stateFor(steamId);
  const revealed = econ.serverSeed;
  const seeds = newSeeds();
  Object.assign(econ, seeds, { previousServerSeed: revealed });
  store.saveEconomy(steamId, econ);
  return { revealedServerSeed: revealed, fair: { serverSeedHash: econ.serverSeedHash, clientSeed: econ.clientSeed, nonce: econ.nonce } };
}

export function buyItem(steamId, itemId) {
  const item = items.findItem(itemId);
  if (!item) throw Object.assign(new Error('Предмет не найден в каталоге'), { code: 'no_item' });
  const econ = stateFor(steamId);
  if (econ.banned) throw Object.assign(new Error('Аккаунт заблокирован'), { code: 'banned' });
  if (econ.coins < item.price) throw Object.assign(new Error('Недостаточно монет'), { code: 'no_coins' });

  econ.coins -= item.price;
  econ.items.push({ uid: crypto.randomUUID(), itemId: item.id, price: item.price, acquiredAt: new Date().toISOString() });
  econ.stats.bought += 1;
  store.saveEconomy(steamId, econ);
  return { coins: econ.coins, uid: econ.items.at(-1).uid, item };
}

export function sellItem(steamId, uid) {
  const econ = stateFor(steamId);
  const index = econ.items.findIndex((i) => i.uid === uid);
  if (index === -1) throw Object.assign(new Error('Предмет не найден в хранилище'), { code: 'no_item' });
  const [entry] = econ.items.splice(index, 1);
  const refund = Math.max(1, Math.round(entry.price * SELL_RATE));
  econ.coins += refund;
  econ.stats.sold += 1;
  store.saveEconomy(steamId, econ);
  return { coins: econ.coins, refund };
}

/** Расчёт шанса без списания — чтобы клиент показал его до нажатия «Крутить». */
export function previewUpgrade(steamId, uids, targetItemId) {
  const econ = stateFor(steamId);
  const target = items.findItem(targetItemId);
  if (!target) throw Object.assign(new Error('Цель не найдена в каталоге'), { code: 'no_item' });

  const chosen = econ.items.filter((i) => uids.includes(i.uid));
  if (chosen.length !== uids.length || chosen.length === 0) {
    throw Object.assign(new Error('Выберите предметы из хранилища'), { code: 'bad_items' });
  }

  const stake = chosen.reduce((sum, i) => sum + i.price, 0);
  const multiplier = targetMultiplier(stake, target.price);
  const edge = edgeForMultiplier(multiplier);
  const rawChance = (stake / target.price) * edge;
  const chance = Math.min(MAX_CHANCE, Math.max(MIN_CHANCE, rawChance));
  return {
    stake,
    target,
    multiplier,
    edge,
    chance,
    payout: target.price,
    profit: target.price - stake,
  };
}

export function playUpgrade(steamId, uids, targetItemId) {
  const preview = previewUpgrade(steamId, uids, targetItemId);
  const econ = stateFor(steamId);
  if (econ.banned) throw Object.assign(new Error('Аккаунт заблокирован'), { code: 'banned' });

  const chosenUids = new Set(uids);
  const consumed = econ.items.filter((i) => chosenUids.has(i.uid));
  econ.items = econ.items.filter((i) => !chosenUids.has(i.uid));

  const roll = fairRoll(econ.serverSeed, econ.clientSeed, econ.nonce);
  const nonce = econ.nonce;
  econ.nonce += 1;
  const win = roll < preview.chance;

  econ.stats.upgrades += 1;
  econ.stats.wagered += preview.stake;

  let uid = null;
  if (win) {
    uid = crypto.randomUUID();
    econ.items.push({ uid, itemId: preview.target.id, price: preview.target.price, acquiredAt: new Date().toISOString() });
    econ.stats.wins += 1;
    econ.stats.won += preview.target.price;
    econ.stats.bestWin = Math.max(econ.stats.bestWin || 0, preview.target.price);
  }
  store.saveEconomy(steamId, econ);

  const winIndex = Math.floor(roll * REEL_CELLS);
  const reel = buildReel(preview.stake, preview.target, winIndex);

  const entry = {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    steamId: String(steamId),
    stake: preview.stake,
    payout: preview.target.price,
    chance: preview.chance,
    roll,
    win,
    target: {
      id: preview.target.id,
      weapon: preview.target.weapon,
      pattern: preview.target.pattern,
      category: preview.target.category,
      rarity: preview.target.rarity,
      image: preview.target.image || '',
    },
    multiplier: preview.multiplier,
    edge: preview.edge,
    consumed: consumed.length,
    fair: { serverSeedHash: econ.serverSeedHash, clientSeed: econ.clientSeed, nonce },
  };
  store.pushHistory(entry);

  return { ...entry, winIndex, reelCells: REEL_CELLS, reel, coins: econ.coins, uid };
}

/** Лента рулетки: победная ячейка — цель, остальные — предметы сопоставимой цены. */
function buildReel(stake, target, winIndex) {
  const catalog = items.loadItems();
  const pool = catalog.filter((i) => i.price >= stake * 0.5 && i.price <= Math.max(stake * 2, target.price));
  const source = pool.length > 5 ? pool : catalog;
  const cells = [];
  for (let i = 0; i < REEL_CELLS; i += 1) {
    if (i === winIndex) {
      cells.push({ ...target, isWin: true });
    } else {
      const pick = source[Math.floor(Math.random() * source.length)] || target;
      cells.push({ ...pick, isWin: false });
    }
  }
  return cells;
}

/* ------------------------------ статистика ------------------------------ */

export function globalStats() {
  const economy = store.allEconomy();
  const users = Object.entries(economy);
  const history = store.getHistory(500);
  const wagered = history.reduce((sum, h) => sum + h.stake, 0);
  const paid = history.reduce((sum, h) => sum + (h.win ? h.payout : 0), 0);
  return {
    users: users.length,
    coinsInCirculation: users.reduce((sum, [, e]) => sum + (e.coins || 0), 0),
    itemsInVaults: users.reduce((sum, [, e]) => sum + (e.items?.length || 0), 0),
    upgrades: history.length,
    wins: history.filter((h) => h.win).length,
    wagered,
    paid,
    rtp: wagered > 0 ? Number((paid / wagered).toFixed(3)) : 0,
    edge: store.getUpgradeSettings().globalEdge ?? DEFAULT_EDGE,
    startCoins: START_COINS,
    dailyCoins: DAILY_COINS,
    sellRate: SELL_RATE,
  };
}

export function listUsers() {
  return Object.entries(store.allEconomy()).map(([steamId, econ]) => ({
    steamId,
    coins: econ.coins || 0,
    items: econ.items?.length || 0,
    upgrades: econ.stats?.upgrades || 0,
    wins: econ.stats?.wins || 0,
    wagered: econ.stats?.wagered || 0,
    banned: Boolean(econ.banned),
    createdAt: econ.createdAt,
  }));
}

export function setBan(steamId, banned) {
  const econ = stateFor(steamId);
  econ.banned = Boolean(banned);
  store.saveEconomy(steamId, econ);
  return econ.banned;
}

export function verifyRoll({ serverSeed, clientSeed, nonce }) {
  return { roll: fairRoll(serverSeed, clientSeed, nonce), serverSeedHash: sha256(serverSeed) };
}


/* --------------------- экипировка (что наденет сервер) ------------------ */

function fail(message, code) {
  return Object.assign(new Error(message), { code });
}

/**
 * Надевает предмет из хранилища в слот. Предмет остаётся в хранилище —
 * это просто выбранный скин, который серверный плагин применит игроку.
 */
export function equipItem(steamId, slotKey, uid, { wear, seed, statTrak, kills } = {}) {
  const slot = findSlot(slotKey);
  if (!slot) throw fail('Нет такого слота', 'no_slot');

  const econ = stateFor(steamId);
  const entry = econ.items.find((i) => i.uid === uid);
  if (!entry) throw fail('Предмета нет в вашем хранилище', 'no_item');

  const item = findItem(entry.itemId);
  if (!item) throw fail('Предмет пропал из каталога', 'no_item');
  if (!itemFitsSlot(item, slot)) throw fail(`«${item.pattern}» не подходит для слота «${slot.label}»`, 'bad_slot');

  const [min, max] = item.float || [0, 1];
  const targetWear = Number.isFinite(Number(wear)) ? Number(wear) : min;

  econ.equipped = econ.equipped || {};
  econ.equipped[slot.key] = {
    uid,
    itemId: item.id,
    def: item.def,
    paint: item.paint,
    slot: slot.key,
    wear: Number(Math.min(max, Math.max(min, targetWear)).toFixed(4)),
    seed: Math.max(0, Math.min(1000, Math.round(Number(seed) || 0))),
    statTrak: Boolean(statTrak),
    kills: Math.max(0, Math.min(999999, Math.round(Number(kills) || 0))),
    updatedAt: new Date().toISOString(),
  };
  store.saveEconomy(steamId, econ);
  return econ.equipped[slot.key];
}

export function unequipSlot(steamId, slotKey) {
  const econ = stateFor(steamId);
  econ.equipped = econ.equipped || {};
  const removed = Boolean(econ.equipped[slotKey]);
  delete econ.equipped[slotKey];
  store.saveEconomy(steamId, econ);
  return removed;
}

/** Экипировка игрока вместе со списком подходящих предметов для каждого слота. */
export function equippedState(steamId) {
  const econ = stateFor(steamId);
  const equipped = econ.equipped || {};
  const owned = econ.items.map((entry) => ({ entry, item: findItem(entry.itemId) })).filter((o) => o.item);

  return slotIndex().map((slot) => {
    const active = equipped[slot.key] || null;
    return {
      ...slot,
      equipped: active
        ? { ...active, item: owned.find((o) => o.entry.uid === active.uid)?.item || findItem(active.itemId) }
        : null,
      options: owned
        .filter((o) => itemFitsSlot(o.item, slot))
        .map((o) => ({ uid: o.entry.uid, item: o.item })),
    };
  });
}

/** Компактный ответ для игрового плагина: что надеть игроку. */
export function pluginLoadout(steamId) {
  const econ = stateFor(steamId);
  const equipped = econ.equipped || {};
  const out = { steamId: String(steamId), weapons: [], knife: null, gloves: null, agentCt: null, agentT: null, music: null };

  const pack = (entry) => {
    if (!entry) return null;
    return { def: entry.def, paint: entry.paint, wear: entry.wear, seed: entry.seed, statTrak: entry.statTrak, kills: entry.kills };
  };

  for (const [key, entry] of Object.entries(equipped)) {
    const slot = findSlot(key);
    if (!slot || !entry) continue;
    if (slot.kind === 'weapon') out.weapons.push({ ...pack(entry), weapon: slot.weapon });
    else if (slot.kind === 'knife') out.knife = pack(entry);
    else if (slot.kind === 'gloves') out.gloves = pack(entry);
    else if (slot.key === 'agent_ct') out.agentCt = pack(entry);
    else if (slot.key === 'agent_t') out.agentT = pack(entry);
    else if (slot.kind === 'music') out.music = pack(entry);
  }

  out.updatedAt = new Date().toISOString();
  return out;
}
