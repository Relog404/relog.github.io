import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cs2upgrade-'));
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

const call = async (method, pathname, { body, as = PLAYER } = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  if (as) headers.Cookie = `cs2panel_session=${createSession(as)}`;
  const response = await fetch(`${baseUrl}${pathname}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, data: await response.json() };
};

const skin = (weapon, pattern) => items.queryItems({ weapon, query: pattern, pageSize: 1 }).items[0];

before(async () => {
  server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

test('апгрейд работает без привязанного игрового сервера', async () => {
  const config = await (await fetch(`${baseUrl}/api/config`)).json();
  assert.equal(config.economy.serverRequired, false);
  assert.equal(config.serverBound, false, 'в тесте нет реального сервера — рулетка должна работать и так');

  const settings = await (await fetch(`${baseUrl}/api/upgrade/settings`)).json();
  assert.equal(settings.serverRequired, false);
  assert.ok(settings.multipliers.length >= 4);
});

test('пресеты: чем больше множитель, тем ниже шанс', async () => {
  const { chances } = await (await fetch(`${baseUrl}/api/upgrade/settings`)).json();
  const byMult = Object.fromEntries(chances.map((c) => [c.multiplier, c.chance]));

  assert.ok(byMult[2] > byMult[8]);
  assert.ok(byMult[8] > byMult[50]);
  // шанс x2 примерно половина «честной» (edge 0.98)
  assert.ok(byMult[2] > 0.45 && byMult[2] <= 0.49);
  // шанс x50 — около 1.6%
  assert.ok(byMult[50] > 0.01 && byMult[50] < 0.02);
});

test('коэффициент подставляется по множителю цели', async () => {
  const cheap = items.queryItems({ category: 'Пистолеты', sort: 'price-asc', pageSize: 1 }).items[0];
  economy.grantCoins(PLAYER, cheap.price * 400);

  // цель в ~2 раза дороже ставки
  for (let i = 0; i < 2; i += 1) await call('POST', '/api/economy/buy', { body: { itemId: cheap.id } });
  const state = economy.publicState(PLAYER);
  const uids = state.items.filter((i) => i.itemId === cheap.id).map((i) => i.uid);
  const stake = state.items.filter((i) => uids.includes(i.uid)).reduce((sum, i) => sum + i.price, 0);

  const near2 = items.loadItems().filter((i) => i.price >= stake * 2 && i.price <= stake * 2.4)[0];
  const near50 = items.loadItems().filter((i) => i.price > stake * 40 && i.price < stake * 60)[0];
  assert.ok(near2 && near50, 'нужны цели под x2 и x50');

  const settings = await (await fetch(`${baseUrl}/api/upgrade/settings`)).json();
  const edges = Object.fromEntries(settings.chances.map((c) => [c.multiplier, c.edge]));

  const small = await call('POST', '/api/upgrade/preview', { body: { uids, targetItemId: near2.id } });
  assert.equal(small.status, 200);
  assert.equal(small.data.edge, edges[2], 'для x2 берётся коэффициент пресета 2');
  assert.ok(small.data.multiplier >= 2 && small.data.multiplier <= 2.4);

  const big = await call('POST', '/api/upgrade/preview', { body: { uids, targetItemId: near50.id } });
  assert.equal(big.status, 200);
  assert.equal(big.data.edge, edges[50], 'для x50 берётся коэффициент пресета 50');
  assert.ok(Math.abs(big.data.chance - (stake / near50.price) * edges[50]) < 1e-9);
});

test('подбор цели под множитель', async () => {
  const data = await (await fetch(`${baseUrl}/api/upgrade/suggestions?stake=1000&multiplier=10`)).json();
  assert.equal(data.target, 10000);
  assert.ok(data.items.length > 0);
  assert.ok(data.items.every((i) => i.price >= 7000 && i.price <= 13000));

  const empty = await (await fetch(`${baseUrl}/api/upgrade/suggestions?stake=0&multiplier=10`)).json();
  assert.equal(empty.items.length, 0);
});

test('админ меняет базовые шансы, и они применяются', async () => {
  const before = await (await fetch(`${baseUrl}/api/upgrade/settings`)).json();
  assert.ok(before.chances.length > 0);

  const patched = await call('PATCH', '/api/admin/upgrade/settings', {
    as: ADMIN,
    body: { edgeByMultiplier: { 2: 0.5, 50: 0.99 }, globalEdge: 0.9 },
  });
  assert.equal(patched.data.upgrade.edgeByMultiplier['2'], 0.5);
  assert.equal(patched.status, 200);

  const after = await (await fetch(`${baseUrl}/api/upgrade/settings`)).json();
  const byMult = Object.fromEntries(after.chances.map((c) => [c.multiplier, c.chance]));
  const beforeByMult = Object.fromEntries(before.chances.map((c) => [c.multiplier, c.chance]));

  assert.ok(byMult[2] < beforeByMult[2], 'x2 стал строже');
  assert.ok(byMult[50] > beforeByMult[50], 'x50 стал щедрее');
  assert.equal(after.edge, 0.9);

  // мусорные значения администратора игнорируются
  const junk = await call('PATCH', '/api/admin/upgrade/settings', {
    as: ADMIN,
    body: { edgeByMultiplier: { 2: 5 }, globalEdge: -1 },
  });
  assert.equal(junk.status, 200);
  assert.equal(junk.data.upgrade.edgeByMultiplier['2'], 0.5);
  assert.equal(junk.data.upgrade.globalEdge, 0.9);
});

test('обычный игрок не может менять шансы', async () => {
  const response = await call('PATCH', '/api/admin/upgrade/settings', { body: { globalEdge: 0.5 } });
  assert.equal(response.status, 403);
});

test('история розыгрышей содержит картинку цели и множитель', async () => {
  const cheap = items.queryItems({ category: 'Пистолеты', sort: 'price-asc', pageSize: 1 }).items[0];
  const state = economy.publicState(PLAYER);
  const uids = state.items.filter((i) => i.itemId === cheap.id).map((i) => i.uid);
  const target = skin('Glock-18', 'Water Elemental');

  const played = await call('POST', '/api/upgrade/play', { body: { uids: uids.slice(0, 1), targetItemId: target.id } });
  assert.equal(played.status, 200);

  const { history } = await (await fetch(`${baseUrl}/api/upgrade/history`)).json();
  const last = history[0];
  assert.equal(typeof last.multiplier, 'number');
  assert.equal(typeof last.edge, 'number');
  assert.ok('image' in last.target);
});
