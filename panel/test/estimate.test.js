import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

/** Оценка цен: должно быть похоже на настоящие цены, а не «перчатки за 3 тысячи». */

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cs2est-'));
process.env.SESSION_SECRET = 'test-secret';
process.env.COIN_RATE_RUB = '10';

const { estimateRub } = await import('../src/estimate.js');
const items = await import('../src/items.js');
const store = await import('../src/store.js');
const catalog = items.loadItems();

const group = (category) => catalog.filter((item) => item.category === category);
const median = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];

test('цены похожи на настоящие: порядок величин по категориям', () => {
  const gloves = group('Перчатки').map((i) => i.marketRub);
  const knives = group('Ножи').map((i) => i.marketRub);
  const rifles = group('Винтовки').map((i) => i.marketRub);

  assert.ok(Math.min(...gloves) > 8_000, `дешёвые перчатки: ${Math.min(...gloves)} ₽`);
  assert.ok(Math.max(...gloves) > 150_000, `топовые перчатки: ${Math.max(...gloves)} ₽`);
  assert.ok(Math.min(...knives) > 8_000, `дешёвые ножи: ${Math.min(...knives)} ₽`);
  assert.ok(Math.max(...knives) > 150_000, `топовые ножи: ${Math.max(...knives)} ₽`);
  assert.ok(median(rifles) < 60_000, `медианная винтовка: ${median(rifles)} ₽`);
  assert.ok(Math.min(...rifles) < 500, `самая дешёвая винтовка: ${Math.min(...rifles)} ₽`);

  // музка, брелоки и патчи — мелочь, а не тысячи долларов
  for (const category of ['Музыка', 'Брелоки', 'Патчи']) {
    const prices = group(category).map((i) => i.marketRub);
    assert.ok(median(prices) < 3_000, `${category}: медиана ${median(prices)} ₽`);
  }
});

test('редкость и StatTrak повышают цену, износ — понижает', () => {
  const base = { id: 'x-1', weapon: 'AK-47', pattern: 'Redline', category: 'Винтовки', rarity: 'restricted', float: [0.1, 0.2] };
  const consumer = estimateRub({ ...base, rarity: 'consumer' });
  const covert = estimateRub({ ...base, rarity: 'covert' });
  const statTrak = estimateRub({ ...base, pattern: 'Redline (StatTrak™)' });
  const battleScarred = estimateRub({ ...base, float: [0.5, 0.7] });

  assert.ok(covert > consumer * 5, `covert ${covert} против consumer ${consumer}`);
  assert.ok(statTrak > estimateRub(base), 'StatTrak дороже обычного');
  assert.ok(battleScarred < estimateRub(base), '«Закалённое в боях» дешевле');
});

test('цена устойчивая: один и тот же предмет — одна и та же сумма', () => {
  const item = catalog[10];
  assert.equal(estimateRub(item), estimateRub(item));
  assert.equal(item.marketRub, estimateRub(item));
  assert.equal(item.price, Math.round(item.marketRub / 10), 'монеты = рубли / курс');
});

test('реальная цена Steam перекрывает оценку, ручная правка — обе', () => {
  const item = catalog[20];
  const estimated = item.marketRub;

  store.setPrice(item.id, { rub: 12_345, usd: 130, name: 'x', updatedAt: new Date().toISOString() });
  items.resetCache();
  const withSteam = items.findItem(item.id);
  assert.equal(withSteam.marketSource, 'steam');
  assert.equal(withSteam.marketRub, 12_345);
  assert.notEqual(withSteam.marketRub, estimated);
  assert.ok(withSteam.steamPrice?.rub === 12_345, 'для карточки осталась метка Steam');

  store.setCatalogOverride(item.id, { price: 777 });
  items.resetCache();
  const manual = items.findItem(item.id);
  assert.equal(manual.marketSource, 'manual');
  assert.equal(manual.price, 777);
  assert.equal(manual.marketRub, 7_770, 'оценка в рублях = цена × курс монеты');
});
