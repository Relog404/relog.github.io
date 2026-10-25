import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cs2equip-'));
process.env.SESSION_SECRET = 'test-secret';
process.env.ADMIN_STEAM_IDS = '76561190000000001';
process.env.START_COINS = '0';

const { createApp } = await import('../src/app.js');
const { createSession } = await import('../src/steam.js');
const economy = await import('../src/economy.js');
const store = await import('../src/store.js');
const items = await import('../src/items.js');

const PLAYER = '76561190000000002';
const ADMIN = '76561190000000001';

let server;
let baseUrl;

const call = async (method, pathname, { body, as = PLAYER, key } = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  if (as) headers.Cookie = `cs2panel_session=${createSession(as)}`;
  if (key) headers['X-Plugin-Key'] = key;
  const response = await fetch(`${baseUrl}${pathname}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, data: await response.json() };
};

const skin = (weapon, pattern) => items.queryItems({ weapon, query: pattern, pageSize: 1 }).items[0];

let ownedKnife = null; // заполняется в тесте «нельзя надеть предмет не в свой слот»

/** Дать игроку монет и купить предмет, вернуть uid из хранилища. */
async function buy(steamId, item) {
  economy.grantCoins(steamId, item.price * 2);
  const bought = await call('POST', '/api/economy/buy', { body: { itemId: item.id }, as: steamId });
  assert.equal(bought.status, 200);
  return bought.data.uid;
}

before(async () => {
  server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

test('слоты экипировки содержат нож, перчатки и оружие', async () => {
  const slots = items.slotIndex();
  const keys = slots.map((s) => s.key);
  assert.ok(keys.includes('knife'));
  assert.ok(keys.includes('gloves'));
  assert.ok(keys.includes('w-ak-47'));
  assert.ok(slots.find((s) => s.key === 'w-ak-47').def === 7);
});

test('предмет можно надеть только если он есть в хранилище', async () => {
  const ak = skin('AK-47', 'Redline');
  const denied = await call('POST', '/api/equip', { body: { slot: 'w-ak-47', uid: 'нет-такого-uid' } });
  assert.equal(denied.status, 404);
  assert.equal(denied.data.code, 'no_item');

  const uid = await buy(PLAYER, ak);
  const ok = await call('POST', '/api/equip', { body: { slot: 'w-ak-47', uid, wear: 0.15, seed: 661 } });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.equipped.def, ak.def);
  assert.equal(ok.data.equipped.paint, ak.paint);
  assert.equal(ok.data.equipped.wear, 0.15);
  assert.equal(ok.data.equipped.seed, 661);
});

test('нельзя надеть предмет не в свой слот', async () => {
  const knife = items.queryItems({ category: 'Ножи', sort: 'price-asc', pageSize: 1 }).items[0];
  ownedKnife = knife;
  const uid = await buy(PLAYER, knife);

  const wrong = await call('POST', '/api/equip', { body: { slot: 'w-ak-47', uid } });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.data.code, 'bad_slot');

  const right = await call('POST', '/api/equip', { body: { slot: 'knife', uid } });
  assert.equal(right.status, 200);
  assert.equal(right.data.equipped.def, knife.def);
});

test('износ обрезается под допустимый диапазон скина', async () => {
  const ak = skin('AK-47', 'Redline'); // float 0.10–0.70
  const uid = await buy(PLAYER, ak);
  const equipped = await call('POST', '/api/equip', { body: { slot: 'w-ak-47', uid, wear: 0.99 } });
  assert.equal(equipped.status, 200);
  assert.ok(equipped.data.equipped.wear <= 0.7);
});

test('плагин получает ровно то, что надел игрок', async () => {
  const pluginKey = store.listServers()[0].pluginKey;
  assert.ok(pluginKey);

  const noKey = await fetch(`${baseUrl}/api/plugin/loadout/${PLAYER}`);
  assert.equal(noKey.status, 401);

  const loadout = await call('GET', `/api/plugin/loadout/${PLAYER}`, { as: null, key: pluginKey });
  assert.equal(loadout.status, 200);
  assert.equal(loadout.data.steamId, PLAYER);

  const ak = loadout.data.weapons.find((w) => w.weapon === 'AK-47');
  assert.ok(ak, 'в наборе должен быть AK-47');
  assert.equal(ak.def, 7);
  assert.equal(typeof ak.paint, 'number');
  assert.ok(ak.wear >= 0 && ak.wear <= 1);
  assert.ok(loadout.data.knife, 'нож должен быть в наборе');
  assert.equal(loadout.data.knife.def, ownedKnife.def);
  assert.equal(loadout.data.knife.paint, ownedKnife.paint);
});

test('снятие предмета убирает его из набора плагина', async () => {
  const pluginKey = store.listServers()[0].pluginKey;
  const removed = await call('DELETE', '/api/equip/knife');
  assert.equal(removed.data.ok, true);

  const loadout = await call('GET', `/api/plugin/loadout/${PLAYER}`, { as: null, key: pluginKey });
  assert.equal(loadout.data.knife, null);
});

test('админ может перевыпустить ключ плагина, старый перестаёт работать', async () => {
  const servers = store.listServers();
  const oldKey = servers[0].pluginKey;

  const response = await call('POST', `/api/servers/${servers[0].id}/plugin-key`, { as: ADMIN });
  assert.equal(response.status, 200);
  assert.notEqual(response.data.pluginKey, oldKey);

  const stale = await call('GET', `/api/plugin/loadout/${PLAYER}`, { as: null, key: oldKey });
  assert.equal(stale.status, 401);
});

test('экипировку игрока видно публично по SteamID', async () => {
  const response = await fetch(`${baseUrl}/api/equip/${PLAYER}`);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.ok(Array.isArray(data.equipped));
  assert.ok(data.equipped.length >= 1);
});
