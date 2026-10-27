import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config, defaultServerFromEnv } from './config.js';

const STORE_FILE = () => path.join(config.dataDir, 'store.json');

const emptyStore = () => ({
  servers: [],
  loadouts: {}, // { [steamId]: [ {id, name, public, entries, createdAt, updatedAt} ] }
  profiles: {}, // { [steamId]: { name, avatar, updatedAt } } — кэш Steam-профилей
  economy: {}, // { [steamId]: { coins, items, seeds, stats, ... } } — виртуальные монеты и хранилище
  history: [], // последние розыгрыши апгрейда
  settings: null, // настройки сайта (шансы апгрейда и т.п.), заполняются лениво
  customItems: [], // предметы, добавленные админом через админку
  catalogOverrides: {}, // { [itemId]: { price?, hidden? } }
  prices: { items: {}, meta: null }, // реальные цены с торговой площадки Steam
});

let cache = null;
let writeQueue = Promise.resolve();

function seed() {
  const store = emptyStore();
  const fromEnv = defaultServerFromEnv();
  if (fromEnv) {
    store.servers.push(fromEnv);
  } else {
    // Ничего не настроено — показываем демо-сервер, чтобы панель была сразу живой.
    store.servers.push({
      id: 'demo',
      pluginKey: crypto.randomBytes(16).toString('hex'),
      name: 'Демо-сервер (нет подключения)',
      host: '127.0.0.1',
      gamePort: 27015,
      rconPort: 27015,
      password: '',
      demo: true,
      readonly: true,
    });
  }
  return store;
}

export function load() {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(STORE_FILE(), 'utf8');
    const parsed = JSON.parse(raw);
    cache = { ...emptyStore(), ...parsed };
    if (!Array.isArray(cache.servers) || cache.servers.length === 0) {
      const seeded = seed();
      cache.servers = seeded.servers;
    }
  } catch {
    cache = seed();
    persist(cache);
  }
  return cache;
}

function persist(next) {
  writeQueue = writeQueue.then(async () => {
    await fsp.mkdir(config.dataDir, { recursive: true });
    const tmp = `${STORE_FILE()}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(next, null, 2), 'utf8');
    await fsp.rename(tmp, STORE_FILE());
  });
  return writeQueue;
}

function save() {
  return persist(cache);
}

/* ------------------------------- серверы -------------------------------- */

export function listServers() {
  return load().servers.map(({ password, ...rest }) => ({ ...rest, hasPassword: Boolean(password) }));
}

export function getServer(id) {
  const server = load().servers.find((s) => s.id === id);
  if (!server) return null;
  const { password, ...rest } = server;
  return { ...rest, password: password || '', hasPassword: Boolean(password) };
}

export function getDefaultServer() {
  const servers = load().servers;
  return servers.find((s) => s.id === 'env') || servers[0] || null;
}

export function addServer({ name, host, gamePort, rconPort, password }) {
  const store = load();
  const server = {
    id: crypto.randomUUID(),
    pluginKey: crypto.randomBytes(16).toString('hex'),
    name: String(name || 'CS2 server').slice(0, 60),
    host: String(host || '127.0.0.1').slice(0, 120),
    gamePort: Number(gamePort) || 27015,
    rconPort: Number(rconPort) || Number(gamePort) || 27015,
    password: String(password || ''),
    demo: false,
    readonly: false,
  };
  store.servers.push(server);
  save();
  const { password: _p, ...safe } = server;
  return { ...safe, hasPassword: Boolean(server.password) };
}

export function updateServer(id, patch) {
  const store = load();
  const server = store.servers.find((s) => s.id === id);
  if (!server) return null;
  if (server.readonly) return null;
  for (const key of ['name', 'host', 'gamePort', 'rconPort', 'password']) {
    if (patch[key] !== undefined) server[key] = patch[key];
  }
  save();
  const { password, ...safe } = server;
  return { ...safe, hasPassword: Boolean(password) };
}

/** Новый ключ для игрового плагина (старый перестаёт работать). */
export function regeneratePluginKey(id) {
  const store = load();
  const server = store.servers.find((s) => s.id === id);
  if (!server) return null;
  server.pluginKey = crypto.randomBytes(16).toString('hex');
  save();
  return server.pluginKey;
}

/** Проверяет ключ плагина: глобальный из env или ключ конкретного сервера. */
export function isValidPluginKey(key) {
  if (!key) return false;
  return load().servers.some((s) => s.pluginKey && s.pluginKey === key);
}

export function removeServer(id) {
  const store = load();
  const index = store.servers.findIndex((s) => s.id === id);
  if (index === -1) return false;
  if (store.servers[index].readonly) return false;
  store.servers.splice(index, 1);
  save();
  return true;
}

/* ------------------------------- сборки --------------------------------- */

export function listLoadouts(steamId) {
  return load().loadouts[String(steamId)] || [];
}

export function saveLoadout(steamId, { id, name, entries, isPublic }) {
  const store = load();
  const key = String(steamId);
  const list = store.loadouts[key] || (store.loadouts[key] = []);
  const now = new Date().toISOString();

  let loadout = id ? list.find((l) => l.id === id) : null;
  if (loadout && id) {
    loadout.name = String(name || loadout.name).slice(0, 80);
    loadout.entries = normalizeEntries(entries);
    loadout.public = Boolean(isPublic);
    loadout.updatedAt = now;
  } else {
    loadout = {
      id: crypto.randomUUID(),
      name: String(name || 'Моя сборка').slice(0, 80),
      entries: normalizeEntries(entries),
      public: Boolean(isPublic),
      createdAt: now,
      updatedAt: now,
    };
    list.push(loadout);
  }
  save();
  return loadout;
}

function normalizeEntries(entries) {
  if (!Array.isArray(entries)) return [];
  return entries
    .filter((e) => e && e.skinId)
    .slice(0, 100)
    .map((e) => ({
      skinId: String(e.skinId).slice(0, 80),
      weapon: String(e.weapon || '').slice(0, 40),
      pattern: String(e.pattern || '').slice(0, 80),
      float: e.float === undefined || e.float === null || e.float === '' ? null : Number(e.float),
      statTrak: Boolean(e.statTrak),
      note: String(e.note || '').slice(0, 120),
    }));
}

export function deleteLoadout(steamId, id) {
  const store = load();
  const key = String(steamId);
  const list = store.loadouts[key] || [];
  const index = list.findIndex((l) => l.id === id);
  if (index === -1) return false;
  list.splice(index, 1);
  save();
  return true;
}

export function listPublicLoadouts(limit = 20) {
  const store = load();
  const out = [];
  for (const [steamId, list] of Object.entries(store.loadouts)) {
    for (const l of list) {
      if (l.public) out.push({ ...l, steamId });
    }
  }
  return out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, limit);
}

/* ------------------------------ профили --------------------------------- */

export function rememberProfile(steamId, { name, avatar }) {
  const store = load();
  store.profiles[String(steamId)] = { name: name || '', avatar: avatar || '', updatedAt: new Date().toISOString() };
  save();
}

export function getProfile(steamId) {
  return load().profiles[String(steamId)] || null;
}

/* ------------------------ экономика (виртуальные монеты) --------------- */

export function getEconomy(steamId) {
  const store = load();
  store.economy = store.economy || {};
  const key = String(steamId);
  if (!store.economy[key]) store.economy[key] = {};
  return store.economy[key];
}

export function saveEconomy(steamId, patch) {
  const store = load();
  store.economy = store.economy || {};
  store.economy[String(steamId)] = patch;
  save();
}

export function allEconomy() {
  return load().economy || {};
}

/* --------------------- витрина: правки админки ------------------------- */

export function getCustomItems() {
  return load().customItems || [];
}

export function getCatalogOverrides() {
  return load().catalogOverrides || {};
}

export function upsertCustomItem(item) {
  const store = load();
  const list = store.customItems || (store.customItems = []);
  const index = list.findIndex((i) => i.id === item.id);
  if (index >= 0) list[index] = { ...list[index], ...item };
  else list.push(item);
  save();
  return list[index >= 0 ? index : list.length - 1];
}

export function setCatalogOverride(id, patch) {
  const store = load();
  store.catalogOverrides = store.catalogOverrides || {};
  store.catalogOverrides[id] = { ...(store.catalogOverrides[id] || {}), ...patch };
  save();
  return store.catalogOverrides[id];
}

export function removeCustomItem(id) {
  const store = load();
  store.customItems = (store.customItems || []).filter((i) => i.id !== id);
  delete (store.catalogOverrides || {})[id];
  save();
  return true;
}

/* ------------------------- история розыгрышей -------------------------- */

export function pushHistory(entry, limit = 200) {
  const store = load();
  store.history = store.history || [];
  store.history.unshift(entry);
  store.history = store.history.slice(0, limit);
  save();
}

export function getHistory(limit = 20) {
  return (load().history || []).slice(0, limit);
}


/* --------------------------- настройки сайта ---------------------------- */

/**
 * Множители апгрейда и «базовые шансы» для каждого из них.
 * multiplier = во сколько раз цель дороже ставки.
 * edge = доля от честного шанса: chance = (ставка / цена цели) * edge.
 */
const clamp01 = (value) => Math.min(1, Math.max(0.1, Number(value) || 0.95));

export function defaultUpgradeSettings() {
  return {
    multipliers: [2, 4, 8, 10, 25, 50],
    /**
     * Шанс для каждого множителя (в долях): ×2 → 50%, ×8 → 35% и т.д.
     * Меняется из админки; верхний предел — maxChance (80%).
     */
    chanceByMultiplier: { 2: 0.5, 4: 0.45, 8: 0.35, 10: 0.3, 25: 0.2, 50: 0.15 },
    /** Максимальный шанс апгрейда — выше него шанс не поднимается никогда. */
    maxChance: Number(process.env.MAX_CHANCE || 0.8),
    minChance: 0.01,
    // оставлено для совместимости: старые настройки и отчёты
    globalEdge: clamp01(config.upgradeEdge),
    edgeByMultiplier: {},
  };
}

export function getUpgradeSettings() {
  const store = load();
  if (!store.settings) store.settings = {};
  if (!store.settings.upgrade) {
    store.settings.upgrade = defaultUpgradeSettings();
    save();
  }
  const upgrade = store.settings.upgrade;
  const defaults = defaultUpgradeSettings();
  return {
    ...defaults,
    ...upgrade,
    multipliers: (upgrade.multipliers || defaults.multipliers).map(Number).sort((a, b) => a - b),
    chanceByMultiplier: { ...defaults.chanceByMultiplier, ...(upgrade.chanceByMultiplier || {}) },
    maxChance: Math.min(Math.max(Number(upgrade.maxChance ?? defaults.maxChance), 0.01), 1),
  };
}

export function patchUpgradeSettings(patch) {
  const store = load();
  store.settings = store.settings || {};
  const current = getUpgradeSettings();

  const next = { ...current };
  if (Array.isArray(patch.multipliers)) {
    next.multipliers = [...new Set(patch.multipliers.map((m) => Math.max(1, Math.round(Number(m) || 1))))]
      .sort((a, b) => a - b)
      .slice(0, 20);
  }
  if (patch.chanceByMultiplier && typeof patch.chanceByMultiplier === 'object') {
    const chances = { ...next.chanceByMultiplier };
    for (const [key, value] of Object.entries(patch.chanceByMultiplier)) {
      const numeric = Number(value);
      // шанс — доля от 0 до maxChance; проценты из админки уже переведены в доли
      if (Number.isFinite(numeric) && numeric >= 0 && numeric <= next.maxChance) chances[String(key)] = numeric;
    }
    next.chanceByMultiplier = chances;
  }
  if (patch.maxChance !== undefined) {
    const numeric = Number(patch.maxChance);
    if (Number.isFinite(numeric) && numeric > 0 && numeric <= 1) next.maxChance = numeric;
  }

  store.settings.upgrade = next;
  save();
  return next;
}


/* --------------------- отображение цен (валюта сайта) ------------------- */

/**
 * Монеты виртуальные, но показывать их можно в любой валюте — это только
 * отображение: rates говорит, сколько «монета» стоит в рублях и долларах.
 */
export function defaultSiteSettings() {
  return {
    currency: config.currency,           // coins | rub | usd
    rates: { rub: config.rateRub, usd: config.rateUsd, usdRub: config.priceSync.usdRub },
    coinRateRub: config.coinRateRub,     // сколько рублей в одной виртуальной монете
  };
}

export function getSiteSettings() {
  const store = load();
  if (!store.settings) store.settings = {};
  if (!store.settings.site) {
    store.settings.site = defaultSiteSettings();
    save();
  }
  const site = store.settings.site;
  const defaults = defaultSiteSettings();
  const rate = Number(site.coinRateRub);
  return {
    currency: ['coins', 'rub', 'usd'].includes(site.currency) ? site.currency : 'coins',
    rates: { ...defaults.rates, ...(site.rates || {}) },
    usdRub: Number(site.rates?.usdRub) > 0 ? Number(site.rates.usdRub) : defaults.rates.usdRub,
    coinRateRub: Number.isFinite(rate) && rate > 0 ? rate : defaults.coinRateRub,
  };
}

export function patchSiteSettings(patch) {
  const store = load();
  store.settings = store.settings || {};
  const next = getSiteSettings();
  if (patch.currency && ['coins', 'rub', 'usd'].includes(String(patch.currency))) next.currency = String(patch.currency);
  if (patch.rates && typeof patch.rates === 'object') {
    for (const key of ['rub', 'usd']) {
      const value = Number(patch.rates[key]);
      if (Number.isFinite(value) && value > 0 && value < 1_000_000) next.rates[key] = value;
    }
  }
  const rate = Number(patch.coinRateRub);
  if (Number.isFinite(rate) && rate > 0 && rate < 1_000_000) next.coinRateRub = rate;
  const usdRub = Number(patch.rates?.usdRub);
  if (Number.isFinite(usdRub) && usdRub > 0 && usdRub < 1000) next.rates.usdRub = usdRub;
  store.settings.site = next;
  save();
  return next;
}


/* ------------------- реальные цены с площадки Steam -------------------- */

/** { [itemId]: { rub, usd, name, updatedAt } } */
export function getPrices() {
  const store = load();
  if (!store.prices || typeof store.prices !== 'object') store.prices = { items: {}, meta: null };
  return store.prices.items || {};
}

/** Сводка по последней синхронизации цен. */
export function getPricesMeta() {
  const store = load();
  const meta = (store.prices && store.prices.meta) || {};
  return {
    synced: Object.keys(getPrices()).length,
    lastSyncAt: meta.lastSyncAt || null,
    lastError: meta.lastError || null,
    lastRun: meta.lastRun || null,
    running: Boolean(meta.running),
  };
}

export function setPrice(id, data) {
  const store = load();
  store.prices = store.prices || { items: {}, meta: null };
  store.prices.items = store.prices.items || {};
  if (data === null) delete store.prices.items[id];
  else store.prices.items[id] = data;
  save(store);
}

export function setPricesMeta(patch) {
  const store = load();
  store.prices = store.prices || { items: {}, meta: null };
  store.prices.meta = { ...(store.prices.meta || {}), ...patch };
  save(store);
  return store.prices.meta;
}

/** Очистить кэш цен — каталог вернётся к базовым ценам из data/catalog.json. */
export function clearPrices() {
  const store = load();
  store.prices = { items: {}, meta: { clearedAt: new Date().toISOString() } };
  save(store);
}
