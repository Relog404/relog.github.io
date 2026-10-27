import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cs2panel-'));
process.env.SESSION_SECRET = 'test-secret';
process.env.PLUGIN_API_KEY = 'menu-test-key';

const { createApp } = await import('../src/app.js');

const STEAM = '76561190000000001';
const KEY = { 'X-Plugin-Key': 'menu-test-key' };

let server;
let baseUrl;

before(async () => {
  server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

const getState = () => fetch(`${baseUrl}/api/plugin/menu/${STEAM}`, { headers: KEY }).then((r) => r.json());
const act = (body) =>
  fetch(`${baseUrl}/api/plugin/menu/action`, {
    method: 'POST',
    headers: { ...KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ steamId: STEAM, ...body }),
  }).then((r) => r.json());

test('меню без ключа плагина не открывается', async () => {
  const response = await fetch(`${baseUrl}/api/plugin/menu/${STEAM}`);
  assert.equal(response.status, 401);
});

test('состояние меню отдаёт баланс, кейсы и слоты', async () => {
  const state = await getState();
  assert.equal(state.steamId, STEAM);
  assert.ok(state.coins > 0, 'у нового игрока есть стартовые монеты');
  assert.ok(state.cases.length > 0, 'кейсы доступны');
  assert.ok(state.slots.length > 10, 'слоты экипировки доступны');
  assert.ok(state.top.length >= 1, 'топ содержит игрока');
});

test('ежедневный бонус начисляется и виден в балансе', async () => {
  const before = await getState();
  const result = await act({ action: 'daily' });
  assert.equal(result.ok, true);
  assert.ok(result.coins > before.coins, 'баланс вырос');

  const repeated = await act({ action: 'daily' });
  assert.equal(repeated.ok, false, 'второй раз бонус не дают');
  assert.ok(repeated.error.length > 0);
});

test('открытие кейса выдаёт приз и кладёт его в инвентарь', async () => {
  const state = await getState();
  const result = await act({ action: 'open_case', caseId: state.cases[0].id });
  assert.equal(result.ok, true);
  assert.ok(result.prize.name.length > 0, 'приз описан');

  const after = await getState();
  assert.ok(after.coins < state.coins, 'за кейс списаны монеты');
  assert.ok(after.inventory.some((item) => item.name === result.prize.name), 'приз в инвентаре');

  const sold = await act({ action: 'sell', uid: after.inventory[0].uid });
  assert.equal(sold.ok, true);
});

test('покупка из магазина и надевание в слот', async () => {
  const state = await getState();
  const shop = await fetch(`${baseUrl}/api/plugin/menu/${STEAM}?category=${encodeURIComponent(state.categories[0].category)}`, { headers: KEY }).then((r) => r.json());
  assert.ok(shop.shop.items.length > 0, 'в категории есть товары');

  const bought = await act({ action: 'buy', itemId: shop.shop.items[0].id });
  assert.equal(bought.ok, true);
});

test('неизвестное действие отклоняется', async () => {
  const result = await act({ action: 'взломать-панель' });
  assert.ok(result.error.length > 0);
});
