import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

/** Тесты: выбор валюты (рубли/доллары/монеты) и получение предмета каталога по id.
 *  Второй пункт — это как раз баг «Предмет не найден» при выборе цели апгрейда. */

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cs2site-'));
process.env.SESSION_SECRET = 'test-secret';
process.env.ADMIN_STEAM_IDS = '76561190000000001';
process.env.START_COINS = '0';

const { createApp } = await import('../src/app.js');
const { createSession } = await import('../src/steam.js');
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

before(async () => {
  server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

test('предмет каталога находится по id (именно так его ищет выбор цели апгрейда)', async () => {
  const any = items.queryItems({ pageSize: 1 }).items[0];
  assert.ok(any, 'каталог не пустой');

  const { status, data } = await call('GET', `/api/catalog/${encodeURIComponent(any.id)}`, { as: null });
  assert.equal(status, 200);
  assert.equal(data.item.id, any.id);
  assert.equal(data.item.weapon, any.weapon);
  assert.equal(data.item.pattern, any.pattern);
});

test('несуществующий id отдаёт 404, а не тихую пустоту', async () => {
  const { status, data } = await call('GET', '/api/catalog/skin-definitely-missing', { as: null });
  assert.equal(status, 404);
  assert.match(data.error, /не найден/i);
});

test('публичные настройки сайта содержат валюту и курсы', async () => {
  const { status, data } = await call('GET', '/api/settings', { as: null });
  assert.equal(status, 200);
  assert.equal(data.currency, 'coins');
  assert.ok(data.rates.rub > 0 && data.rates.usd > 0);
});

test('админ переключает валюту на рубли и меняет курс', async () => {
  const patched = await call('PATCH', '/api/admin/settings', {
    as: ADMIN,
    body: { currency: 'rub', rates: { rub: 2.5, usd: 0.02 } },
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.data.currency, 'rub');
  assert.equal(patched.data.rates.rub, 2.5);

  const publicSettings = await call('GET', '/api/settings', { as: null });
  assert.equal(publicSettings.data.currency, 'rub');
  assert.equal(publicSettings.data.rates.usd, 0.02);

  const config = await call('GET', '/api/config', { as: null });
  assert.equal(config.data.currency.currency, 'rub');
});

test('мусорные значения валюты и курса отбрасываются', async () => {
  const bad = await call('PATCH', '/api/admin/settings', {
    as: ADMIN,
    body: { currency: 'bitcoin', rates: { rub: -5, usd: 'много' } },
  });
  assert.equal(bad.status, 200);
  assert.equal(bad.data.currency, 'rub', 'неизвестная валюта не применяется');
  assert.equal(bad.data.rates.rub, 2.5, 'отрицательный курс не применяется');
  assert.equal(bad.data.rates.usd, 0.02);
});

test('не-админ не может менять настройки сайта', async () => {
  const { status } = await call('PATCH', '/api/admin/settings', { as: PLAYER, body: { currency: 'usd' } });
  assert.equal(status, 403);
});
