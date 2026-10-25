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
  customItems: [], // предметы, добавленные админом через админку
  catalogOverrides: {}, // { [itemId]: { price?, hidden? } }
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
