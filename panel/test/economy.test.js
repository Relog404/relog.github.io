import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cs2econ-'));
process.env.SESSION_SECRET = 'test-secret';
process.env.ADMIN_STEAM_IDS = '76561190000000001';
process.env.START_COINS = '1000';
process.env.UPGRADE_EDGE = '1'; // для предсказуемых проверок шанса
process.env.DAILY_COINS = '100';
process.env.SELL_RATE = '0.85';

const { createApp } = await import('../src/app.js');
const { createSession } = await import('../src/steam.js');
const economy = await import('../src/economy.js');
const store = await import('../src/store.js');
const items = await import('../src/items.js');

const PLAYER = '76561190000000002';
const ADMIN = '76561190000000001';

let server;
let baseUrl;

const call = async (method, path, { body, as = PLAYER } = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: `cs2panel_session=${createSession(as)}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, data: await response.json() };
};

before(async () => {
  server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

test('новый игрок получает стартовые монеты и может забрать ежедневный бонус', async () => {
  const state = economy.publicState(PLAYER);
  assert.equal(state.coins, 1000);
  assert.equal(state.items.length, 0);
  assert.equal(state.daily.available, true);

  const first = await call('POST', '/api/economy/daily');
  assert.equal(first.status, 200);
  assert.equal(first.data.coins, 1100);

  const second = await call('POST', '/api/economy/daily');
  assert.equal(second.status, 429);
  assert.equal(second.data.code, 'daily_cooldown');
});

test('покупка и продажа: монеты списываются и возвращаются по курсу', async () => {
  const item = items.findItem('glock-water-elemental');
  const before = economy.publicState(PLAYER).coins;

  const bought = await call('POST', '/api/economy/buy', { body: { itemId: item.id } });
  assert.equal(bought.status, 200);
  assert.equal(bought.data.coins, before - item.price);

  const sold = await call('POST', '/api/economy/sell', { body: { uid: bought.data.uid } });
  assert.equal(sold.status, 200);
  assert.equal(sold.data.refund, Math.max(1, Math.round(item.price * 0.85)));
  assert.equal(sold.data.coins, before - item.price + sold.data.refund);
});

test('нельзя купить то, чего не хватает по деньгам', async () => {
  const expensive = items.queryItems({ sort: 'price-desc', pageSize: 1 }).items[0];
  const response = await call('POST', '/api/economy/buy', { body: { itemId: expensive.id } });
  assert.equal(response.status, 400);
  assert.equal(response.data.code, 'no_coins');
});

test('предпросмотр апгрейда считает шанс как ставка / цена цели', async () => {
  const cheap = items.queryItems({ sort: 'price-asc', pageSize: 2 }).items;
  const target = items.findItem('ak47-redline');

  for (const item of cheap) await call('POST', '/api/economy/buy', { body: { itemId: item.id } });
  const state = economy.publicState(PLAYER);
  const uids = state.items.filter((i) => cheap.some((c) => c.id === i.itemId)).map((i) => i.uid);
  const stake = cheap.reduce((sum, i) => sum + i.price, 0);

  const preview = await call('POST', '/api/upgrade/preview', { body: { uids, targetItemId: target.id } });
  assert.equal(preview.status, 200);
  assert.equal(preview.data.stake, stake);
  assert.equal(preview.data.chance, Math.min(0.95, Math.max(0.01, stake / target.price)));
});

test('розыгрыш детерминирован: один и тот же roll при тех же seed-ах', async () => {
  const econ = store.getEconomy(PLAYER);
  econ.serverSeed = 'fixed-server-seed';
  econ.clientSeed = 'fixed-client-seed';
  econ.nonce = 0;
  store.saveEconomy(PLAYER, econ);

  const target = items.findItem('nova-antique');
  const state = economy.publicState(PLAYER);
  const uids = [state.items[0].uid];
  const expected = economy.verifyRoll({ serverSeed: 'fixed-server-seed', clientSeed: 'fixed-client-seed', nonce: 0 });

  const played = await call('POST', '/api/upgrade/play', { body: { uids, targetItemId: target.id } });
  assert.equal(played.status, 200);
  assert.equal(played.data.roll, expected.roll);
  assert.equal(played.data.win, expected.roll < played.data.chance);
  assert.equal(played.data.reel.length, played.data.reelCells);
  assert.ok(played.data.reel[played.data.winIndex].isWin);
  assert.ok(played.data.reel.filter((c) => c.isWin).length === 1);

  // повторно тот же roll можно пересчитать открытым способом
  const verified = await (await fetch(`${baseUrl}/api/upgrade/verify?serverSeed=fixed-server-seed&clientSeed=fixed-client-seed&nonce=0`)).json();
  assert.equal(verified.roll, played.data.roll);
});

test('история розыгрышей пишется и доступна всем', async () => {
  const { history } = await (await fetch(`${baseUrl}/api/upgrade/history`)).json();
  assert.ok(history.length >= 1);
  assert.ok(history[0].target.pattern.length > 0);
  assert.equal(typeof history[0].win, 'boolean');
});

test('апгрейд недоступен без входа', async () => {
  const response = await fetch(`${baseUrl}/api/upgrade/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uids: [], targetItemId: 'ak47-redline' }),
  });
  assert.equal(response.status, 401);
});

test('админка: статистика, начисление монет, бан и правки каталога', async () => {
  const stats = await call('GET', '/api/admin/stats', { as: ADMIN });
  assert.equal(stats.status, 200);
  assert.ok(stats.data.users >= 1);
  assert.equal(stats.data.edge, 1);

  const granted = await call('POST', '/api/admin/coins', { as: ADMIN, body: { steamId: PLAYER, amount: 500 } });
  assert.equal(granted.status, 200);
  assert.equal(economy.publicState(PLAYER).coins, granted.data.coins);

  const banned = await call('POST', '/api/admin/ban', { as: ADMIN, body: { steamId: PLAYER, banned: true } });
  assert.equal(banned.data.banned, true);
  const blocked = await call('POST', '/api/economy/buy', { body: { itemId: 'case-kilowatt' } });
  assert.equal(blocked.status, 403);
  await call('POST', '/api/admin/ban', { as: ADMIN, body: { steamId: PLAYER, banned: false } });

  const created = await call('POST', '/api/admin/items', {
    as: ADMIN,
    body: { id: 'test-item', weapon: 'Медаль', pattern: 'Test Medal', category: 'Медали', rarity: 'covert', price: 777 },
  });
  assert.equal(created.status, 201);
  items.resetCache();
  assert.equal(items.findItem('test-item').price, 777);

  await call('PATCH', '/api/admin/items/test-item', { as: ADMIN, body: { price: 1234 } });
  items.resetCache();
  assert.equal(items.findItem('test-item').price, 1234);

  await call('DELETE', '/api/admin/items/test-item', { as: ADMIN });
  items.resetCache();
  assert.equal(items.findItem('test-item'), null);
});

test('обычный игрок не имеет доступа к админке', async () => {
  const stats = await call('GET', '/api/admin/stats');
  assert.equal(stats.status, 403);
});
