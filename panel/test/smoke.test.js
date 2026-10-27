import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cs2panel-'));
process.env.SESSION_SECRET = 'test-secret';
process.env.ADMIN_STEAM_IDS = '76561190000000001';
process.env.DEMO_MODE = '1';

const { createApp } = await import('../src/app.js');
const { createSession } = await import('../src/steam.js');
const { parseStatus, steamId3To64, steamIdLegacyTo64, DEMO_STATUS } = await import('../src/rcon.js');

let server;
let baseUrl;

before(async () => {
  server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

const get = (path, cookie) =>
  fetch(`${baseUrl}${path}`, cookie ? { headers: { Cookie: cookie } } : {}).then((r) => r);

test('health отдаёт счётчики', async () => {
  const response = await get('/api/health');
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.ok, true);
  assert.ok(data.skins > 0);
  assert.ok(data.servers >= 1);
});

test('каталог скинов отдаёт страницу с пагинацией', async () => {
  const response = await get('/api/skins?page=1&pageSize=5');
  const data = await response.json();
  assert.equal(data.items.length, 5);
  assert.equal(data.page, 1);
  assert.ok(data.pages > 1);
});

test('фильтр по оружию работает', async () => {
  const response = await get('/api/skins?weapon=AWP');
  const data = await response.json();
  assert.ok(data.items.length > 0);
  assert.ok(data.items.every((s) => s.weapon === 'AWP'));
});

test('RCON-статус без авторизации недоступен', async () => {
  const response = await get('/api/status');
  assert.equal(response.status, 401);
});

test('админ видит демо-статус', async () => {
  const cookie = `cs2panel_session=${createSession('76561190000000001')}`;
  const response = await get('/api/status', cookie);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.online, true);
  assert.equal(data.info.map, 'de_mirage');
  assert.ok(data.players.length >= 3);
  assert.ok(data.players.every((p) => !p.steamId64 || /^\d{17}$/.test(p.steamId64)));
});

test('обычный игрок не имеет доступа к управлению', async () => {
  const cookie = `cs2panel_session=${createSession('76561190000000002')}`;
  const response = await get('/api/status', cookie);
  assert.equal(response.status, 403);
});

test('сборки сохраняются по SteamID', async () => {
  const cookie = `cs2panel_session=${createSession('76561190000000002')}`;
  const save = await fetch(`${baseUrl}/api/loadout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ name: 'Тест', entries: [{ skinId: 'ak47-redline', weapon: 'AK-47', pattern: 'Redline' }], isPublic: true }),
  });
  assert.equal(save.status, 200);
  const { loadout } = await save.json();
  assert.equal(loadout.name, 'Тест');

  const list = await get('/api/loadout', cookie);
  const data = await list.json();
  assert.equal(data.loadouts.length, 1);

  const del = await fetch(`${baseUrl}/api/loadout/${loadout.id}`, { method: 'DELETE', headers: { Cookie: cookie } });
  assert.equal(del.status, 200);
});

test('консоль в демо-режиме не отправляет команды на сервер', async () => {
  const cookie = `cs2panel_session=${createSession('76561190000000001')}`;
  const response = await fetch(`${baseUrl}/api/console`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ command: 'mp_restartgame 1' }),
  });
  const data = await response.json();
  assert.equal(data.demo, true);
});

test('парсер status понимает оба формата SteamID', () => {
  const { players } = parseStatus(`# 2 1 "Relog" [U:1:123456789] 01:23 24 0 active
# 3 2 "Old" STEAM_0:1:42 00:47 55 0 active`);
  assert.equal(players[0].steamId64, steamId3To64('123456789'));
  assert.equal(players[1].steamId64, steamIdLegacyTo64('STEAM_0:1:42'));
  assert.equal(players[0].name, 'Relog');
  assert.equal(players[0].ping, 24);
});

test('боты в status парсятся как боты', () => {
  const { players } = parseStatus(DEMO_STATUS);
  const bots = players.filter((p) => p.isBot);
  assert.equal(bots.length, 2);
  assert.ok(bots.every((b) => b.name.startsWith('BOT')));
});
