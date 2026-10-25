import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';
import * as store from './store.js';

const CANDIDATES = ['catalog.json', 'catalog.sample.json'];

let cache = null;

/** Сбрасывает кэш (вызывается после правок каталога из админки). */
export function resetCache() {
  cache = null;
}

function loadFileItems() {
  for (const file of CANDIDATES) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', file), 'utf8'));
      const items = Array.isArray(parsed) ? parsed : parsed.items || [];
      if (items.length) return items;
    } catch {
      /* пробуем следующий файл */
    }
  }
  return [];
}

/**
 * Каталог (витрина) предметов CS2. Обычный JSON:
 * { id, weapon, pattern, category, rarity, price, float: [min,max] | null, collection }
 * Положите свой файл data/catalog.json — панель подхватит его при старте.
 * Поверх файла накладываются предметы и правки, добавленные админом (data/store.json).
 */
export function loadItems() {
  if (cache) return cache;

  const map = new Map();
  for (const item of [...loadFileItems(), ...store.getCustomItems()]) {
    const normalized = normalize(item, map.size);
    map.set(normalized.id, normalized);
  }

  const overrides = store.getCatalogOverrides();
  cache = [...map.values()]
    .filter((item) => overrides[item.id]?.hidden !== true)
    .map((item) => (Number(overrides[item.id]?.price) > 0 ? { ...item, price: Math.round(Number(overrides[item.id].price)) } : item));

  return cache;
}

function normalize(item, index) {
  return {
    id: String(item.id || `${item.weapon}-${item.pattern}-${index}`).slice(0, 80),
    weapon: String(item.weapon || 'Разное').slice(0, 60),
    pattern: String(item.pattern || 'Без названия').slice(0, 80),
    category: String(item.category || 'Прочее').slice(0, 40),
    rarity: String(item.rarity || 'mil-spec').slice(0, 40),
    price: Math.max(1, Math.round(Number(item.price) || 1)),
    float: Array.isArray(item.float) && item.float.length === 2 ? [Number(item.float[0]), Number(item.float[1])] : null,
    collection: String(item.collection || '').slice(0, 80),
  };
}

const RARITY_ORDER = ['consumer', 'industrial', 'mil-spec', 'restricted', 'classified', 'covert', 'exceedingly rare'];

const SORTERS = {
  rarity: (a, b) => RARITY_ORDER.indexOf(b.rarity) - RARITY_ORDER.indexOf(a.rarity) || b.price - a.price,
  'price-desc': (a, b) => b.price - a.price,
  'price-asc': (a, b) => a.price - b.price,
  name: (a, b) => a.pattern.localeCompare(b.pattern, 'ru'),
  weapon: (a, b) => a.weapon.localeCompare(b.weapon, 'ru') || a.pattern.localeCompare(b.pattern, 'ru'),
};

export function queryItems({ query = '', weapon = '', category = '', rarity = '', minPrice, maxPrice, sort = 'rarity', page = 1, pageSize = 24 } = {}) {
  const needle = String(query).trim().toLowerCase();

  let items = loadItems().filter((item) => {
    if (needle && !`${item.weapon} ${item.pattern} ${item.collection} ${item.category} ${item.rarity}`.toLowerCase().includes(needle)) return false;
    if (weapon && item.weapon !== weapon) return false;
    if (category && item.category !== category) return false;
    if (rarity && item.rarity !== rarity) return false;
    if (minPrice !== undefined && minPrice !== '' && item.price < Number(minPrice)) return false;
    if (maxPrice !== undefined && maxPrice !== '' && item.price > Number(maxPrice)) return false;
    return true;
  });

  items = items.sort(SORTERS[sort] || SORTERS.rarity);

  const total = items.length;
  const size = Math.min(Math.max(Number(pageSize) || 24, 1), 100);
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(Number(page) || 1, 1), pages);
  const slice = items.slice((current - 1) * size, (current - 1) * size + size);

  return { items: slice, total, page: current, pages, pageSize: size };
}

export function categoryIndex() {
  const map = new Map();
  for (const item of loadItems()) {
    const entry = map.get(item.category) || { category: item.category, count: 0, minPrice: item.price, maxPrice: item.price };
    entry.count += 1;
    entry.minPrice = Math.min(entry.minPrice, item.price);
    entry.maxPrice = Math.max(entry.maxPrice, item.price);
    map.set(item.category, entry);
  }
  return [...map.values()].sort((a, b) => a.category.localeCompare(b.category, 'ru'));
}

export function weaponsIndex() {
  const map = new Map();
  for (const item of loadItems()) {
    const entry = map.get(item.weapon) || { weapon: item.weapon, category: item.category, count: 0 };
    entry.count += 1;
    map.set(item.weapon, entry);
  }
  return [...map.values()].sort((a, b) => a.weapon.localeCompare(b.weapon, 'ru'));
}

export function findItem(id) {
  return loadItems().find((i) => i.id === id) || null;
}

/** Случайные предметы для визуальной ленты рулетки. */
export function randomItems(count, excludeId = null) {
  const pool = loadItems().filter((i) => i.id !== excludeId);
  const out = [];
  for (let i = 0; i < count; i += 1) out.push(pool[Math.floor(Math.random() * pool.length)]);
  return out;
}
