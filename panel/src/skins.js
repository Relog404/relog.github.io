import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';

const CANDIDATES = ['skins.json', 'skins.sample.json'];

let cache = null;

/**
 * Каталог скинов — обычный JSON, который можно дополнять своим файлом data/skins.json
 * (панель подхватит его при следующем старте). Схема одного элемента:
 * { id, weapon, category, pattern, rarity, float: [min, max] | null, collection }
 */
export function loadSkins() {
  if (cache) return cache;
  for (const file of CANDIDATES) {
    const full = path.join(ROOT, 'data', file);
    try {
      const parsed = JSON.parse(fs.readFileSync(full, 'utf8'));
      const items = Array.isArray(parsed) ? parsed : parsed.items || [];
      if (items.length) {
        cache = items.map(normalize);
        return cache;
      }
    } catch {
      /* пробуем следующий файл */
    }
  }
  cache = [];
  return cache;
}

function normalize(item, index) {
  return {
    id: String(item.id || `${item.weapon}-${item.pattern}-${index}`).slice(0, 80),
    weapon: String(item.weapon || 'Разное').slice(0, 60),
    category: String(item.category || 'Прочее').slice(0, 40),
    pattern: String(item.pattern || 'Без названия').slice(0, 80),
    rarity: String(item.rarity || 'mil-spec').slice(0, 40),
    float: Array.isArray(item.float) && item.float.length === 2 ? [Number(item.float[0]), Number(item.float[1])] : null,
    collection: String(item.collection || '').slice(0, 80),
  };
}

const RARITY_ORDER = [
  'consumer',
  'industrial',
  'mil-spec',
  'restricted',
  'classified',
  'covert',
  'exceedingly rare',
];

export function querySkins({ query = '', weapon = '', category = '', rarity = '', sort = 'rarity', page = 1, pageSize = 24 } = {}) {
  const all = loadSkins();
  const needle = String(query).trim().toLowerCase();

  let items = all.filter((skin) => {
    if (needle) {
      const haystack = `${skin.weapon} ${skin.pattern} ${skin.collection} ${skin.rarity}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    if (weapon && skin.weapon !== weapon) return false;
    if (category && skin.category !== category) return false;
    if (rarity && skin.rarity !== rarity) return false;
    return true;
  });

  const cmp = {
    rarity: (a, b) => RARITY_ORDER.indexOf(b.rarity) - RARITY_ORDER.indexOf(a.rarity) || a.pattern.localeCompare(b.pattern),
    weapon: (a, b) => a.weapon.localeCompare(b.weapon, 'ru') || a.pattern.localeCompare(b.pattern, 'ru'),
    name: (a, b) => a.pattern.localeCompare(b.pattern, 'ru'),
    float: (a, b) => (a.float ? a.float[0] : 1) - (b.float ? b.float[0] : 1),
  }[sort];

  items = items.sort(cmp || ((a, b) => a.pattern.localeCompare(b.pattern, 'ru')));

  const total = items.length;
  const size = Math.min(Math.max(Number(pageSize) || 24, 1), 100);
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(Number(page) || 1, 1), pages);
  const slice = items.slice((current - 1) * size, (current - 1) * size + size);

  return { items: slice, total, page: current, pages, pageSize: size };
}

export function weaponsIndex() {
  const map = new Map();
  for (const skin of loadSkins()) {
    const entry = map.get(skin.weapon) || { weapon: skin.weapon, category: skin.category, count: 0 };
    entry.count += 1;
    map.set(skin.weapon, entry);
  }
  return [...map.values()].sort((a, b) => a.weapon.localeCompare(b.weapon, 'ru'));
}

export function findSkin(id) {
  return loadSkins().find((s) => s.id === id) || null;
}
