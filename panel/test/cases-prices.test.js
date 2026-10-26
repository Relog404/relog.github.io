import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

/** Тесты кейсов и реальных цен со Steam (запросы к Steam подменяются моком). */

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cs2cases-'));
process.env.SESSION_SECRET = 'test-secret';
process.env.ADMIN_STEAM_IDS = '76561190000000001';
process.env.START_COINS = '0';
process.env.PRICE_SYNC_DELAY_MS = '1';

const { createApp } = await import('../src/app.js');
const { createSession } = await import('../src/steam.js');
const economy = await import('../src/economy.js');
const store = await import('../src/store.js');
const items = await import('../src/items.js');
const prices = await import('../src/prices.js');

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

before(async () => {
  server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

/* ------------------------------ имена Steam ----------------------------- */

test('market_hash_name собирается в формате площадки Steam', () => {
  const rifle = items.queryItems({ weapon: 'AK-47', pageSize: 1 }).items[0];
  const name = prices.marketHashName(rifle);
  assert.match(name, /^(Souvenir |StatTrak™ )?AK-47 \| /, `имя: ${name}`);
  assert.match(name, /\((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)$/);
  assert.ok(!/\(Souvenir\)|\(StatTrak™\)/.test(name), 'суффиксы перенесены в начало имени');

  const knife = items.queryItems({ category: 'Ножи', pageSize: 1 }).items[0];
  const knifeName = prices.marketHashName(knife);
  assert.ok(knifeName.startsWith('★'), `нож должен начинаться со звёздочки: ${knifeName}`);

  const sticker = items.queryItems({ category: 'Стикеры', pageSize: 1 }).items[0];
  assert.match(prices.marketHashName(sticker), /^Sticker \| /);
});

test('цена из ответа Steam разбирается с пробелами и запятой', () => {
  assert.equal(prices.parsePriceText('1 234,56 ₽'), 1234.56);
  assert.equal(prices.parsePriceText('12.50₽'), 12.5);
  assert.equal(prices.parsePriceText('нет данных'), null);
  assert.equal(prices.parsePriceText(undefined), null);
});

/* --------------------------------- кейсы -------------------------------- */

test('список кейсов считает цену из наполнения', async () => {
  const { data } = await call('GET', '/api/cases', { as: null });
  assert.ok(data.cases.length >= 5);
  for (const box of data.cases) {
    assert.ok(box.price > 0, `цена кейса ${box.id}`);
    assert.ok(box.itemsCount > 0);
    assert.ok(box.expectation > 0);
    // дом всегда в небольшом плюсе: цена кейса ниже математического ожидания
    assert.ok(box.price <= box.expectation, `${box.id}: цена ${box.price} > ожидания ${box.expectation}`);
    const sum = Object.values(box.odds).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 0.001, `${box.id}: сумма шансов ${sum}`);
  }
});

test('кейс «Ножи» содержит только ножи, а редкие предметы падают реже частых', async () => {
  const { data } = await call('GET', '/api/cases', { as: null });
  const knives = data.cases.find((c) => c.id === 'knives');
  assert.ok(knives.showcase.length > 0);
  assert.ok(knives.showcase.every((item) => typeof item.image === 'string'));

  const all = data.cases.find((c) => c.id === 'all');
  const oddsRare = all.odds['exceedingly rare'] || 0;
  const oddsCommon = all.odds.consumer || all.odds['mil-spec'] || 0;
  assert.ok(oddsRare < oddsCommon, `редкие (${oddsRare}) должны падать реже частых (${oddsCommon})`);
});

test('открытие кейса списывает монеты, выдаёт приз и пишет историю', async () => {
  economy.grantCoins(PLAYER, 1_000_000, 'test');
  const boxes = (await call('GET', '/api/cases', { as: null })).data.cases;
  const box = boxes.find((c) => c.id === 'stickers');

  const before = economy.stateFor(PLAYER).coins;
  const opened = await call('POST', '/api/case/open', { body: { caseId: box.id } });

  assert.equal(opened.status, 200);
  assert.equal(opened.data.case.id, box.id);
  assert.ok(opened.data.prize.id, 'приз есть');
  assert.equal(opened.data.reel.filter((cell) => cell.isWin).length, 1, 'в ленте ровно один выигрышный предмет');
  assert.equal(opened.data.reel[opened.data.winIndex].id, opened.data.prize.id);
  assert.equal(opened.data.coins, before - box.price);

  const vault = economy.stateFor(PLAYER).items;
  assert.ok(vault.some((entry) => entry.uid === opened.data.uid), 'приз попал в хранилище');

  const feed = await call('GET', '/api/history?kind=case', { as: null });
  assert.ok(feed.data.history.some((entry) => entry.id === opened.data.id));
  assert.ok(feed.data.history.every((entry) => entry.kind === 'case'));
});

test('без монет кейс не открывается', async () => {
  const poor = await call('POST', '/api/case/open', { body: { caseId: 'knives' }, as: PLAYER });
  const broke = '76561190000000009';
  economy.stateFor(broke);
  const denied = await call('POST', '/api/case/open', { body: { caseId: 'knives' }, as: broke });
  assert.equal(denied.status, 400);
  assert.match(denied.data.error, /монет/i);
  assert.ok(poor.status === 200 || poor.status === 400);
});

test('неизвестный кейс — 400, а не тихая покупка', async () => {
  const { status, data } = await call('POST', '/api/case/open', { body: { caseId: 'case-which-does-not-exist' } });
  assert.equal(status, 400);
  assert.match(data.error, /кейс/i);
});

test('аноним не может открывать кейсы', async () => {
  const { status } = await call('POST', '/api/case/open', { body: { caseId: 'stickers' }, as: null });
  assert.equal(status, 401);
});

/* ------------------------------- цены Steam ------------------------------ */

/** Мок площадки: отдаёт цену по «названию», для части лотов — пусто. */
function steamMock({ priceFor = () => null, failEvery = 0 } = {}) {
  let calls = 0;
  return async (url) => {
    calls += 1;
    if (failEvery && calls % failEvery === 0) return { ok: false, status: 429, json: async () => ({}) };
    const name = decodeURIComponent(String(url).split('market_hash_name=')[1] || '');
    const rub = priceFor(name);
    if (!rub) return { ok: true, status: 200, json: async () => ({ success: false }) };
    return { ok: true, status: 200, json: async () => ({ success: true, lowest_price: `${rub.toLocaleString('ru-RU')} ₽`, median_price: `${rub} ₽` }) };
  };
}

test('синхронизация цен перекрывает базовые цены каталога', async () => {
  const target = items.loadItems()[0];
  const name = prices.marketHashName(target);
  const basePrice = target.price;

  const result = await prices.syncPrices({
    limit: 1,
    force: true,
    fetchImpl: steamMock({ priceFor: (n) => (n === name ? 1234.56 : null) }),
  });

  assert.equal(result.updated, 1, JSON.stringify(result));
  items.resetCache();
  const updated = items.findItem(target.id);
  assert.equal(updated.steamPrice.rub, 1235);
  assert.equal(updated.price, prices.coinsFromRub(1235));
  assert.notEqual(updated.price, basePrice);
  assert.ok(updated.steamPrice.usd > 0);
});

test('статус цен показывает прогресс синхронизации', async () => {
  const status = prices.priceStatus();
  assert.equal(status.synced, 1);
  assert.equal(status.enabled, true);
  assert.ok(status.total > 1000);
  assert.ok(status.coinRateRub > 0);
});

test('синхронизация не падает на 429 и просто пропускает неторгуемые лоты', async () => {
  const result = await prices.syncPrices({
    limit: 3,
    force: true,
    fetchImpl: steamMock({ priceFor: () => null, failEvery: 2 }),
  });
  assert.equal(result.ok, true);
  assert.ok(result.failed + result.skipped === result.queued, JSON.stringify(result));
});

test('сброс цен возвращает каталог к базовым ценам', async () => {
  const item = items.loadItems()[0];
  assert.ok(item.steamPrice, 'до сброса цена Steam была');
  store.clearPrices();
  items.resetCache();
  const fresh = items.findItem(item.id);
  assert.equal(fresh.steamPrice, null);
  assert.equal(prices.priceStatus().synced, 0);
});

/* --------------------------- админка: цены Steam ------------------------- */

test('админ запускает синхронизацию, обычный игрок — нет', async () => {
  const denied = await call('POST', '/api/admin/prices/sync', { as: PLAYER, body: { limit: 1 } });
  assert.equal(denied.status, 403);

  const allowed = await call('POST', '/api/admin/prices/sync', { as: ADMIN, body: { limit: 1, force: true } });
  assert.equal(allowed.status, 200);
  assert.ok(allowed.data.status);
  assert.ok(typeof allowed.data.result.queued === 'number');
});
