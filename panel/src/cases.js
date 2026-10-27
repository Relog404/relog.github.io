import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config, ROOT } from './config.js';
import * as items from './items.js';

/**
 * Кейсы — второй (кроме апгрейда) режим розыгрыша.
 *
 * Состав и картинки — НАСТОЯЩИЕ кейсы CS2: data/cases.json собирается скриптом
 * scripts/build-cases.mjs из данных ByMykel/CSGO-API (имена, картинки площадки Steam,
 * реальный состав). Веса — настоящие шансы Valve по редкости: 79.92 / 15.98 / 3.2 / 0.64 / 0.26%.
 *
 * Открытие стоит виртуальные монеты, приз падает в хранилище игрока и остаётся
 * внутри экосистемы: вывода наружу и покупок за реальные деньги нет, как и везде в панели.
 *
 * Цена кейса не выдумывается: она считается из наполнения —
 *   цена = математическое ожидание дропа × CASE_EDGE (по умолчанию 0.95).
 */

const REEL_CELLS = 42;

/** Русские названия редкостей CS2 и их цвета — для карточки кейса. */
export const RARITY_META = {
  'Mil-Spec Grade': { label: 'армейское', color: '#4b69ff' },
  Restricted: { label: 'запрещённое', color: '#8847ff' },
  Classified: { label: 'секретное', color: '#d32ce6' },
  Covert: { label: 'тайное', color: '#eb4b4b' },
  'Exceedingly Rare': { label: 'ножи и перчатки', color: '#ffd700' },
  Extraordinary: { label: 'экстраординарное', color: '#ffd700' },
  'High Grade': { label: 'высшее качество', color: '#4b69ff' },
  Remarkable: { label: 'примечательное', color: '#8847ff' },
  Exotic: { label: 'экзотическое', color: '#d32ce6' },
  'Base Grade': { label: 'базовое', color: '#b0c3d9' },
  'Industrial Grade': { label: 'промышленное', color: '#5e98d9' },
  'Consumer Grade': { label: 'ширпотреб', color: '#b0c3d9' },
};

const TIER_LABEL = { common: 'обычные', uncommon: 'необычные', rare: 'редкие', legendary: 'легендарные' };
const TIER_COLOR = { common: '#b0c3d9', uncommon: '#4b69ff', rare: '#d32ce6', legendary: '#ffd700' };

/* ------------------------------- источник -------------------------------- */

function loadRealCases() {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'cases.json'), 'utf8'));
    return Array.isArray(parsed?.cases) ? parsed.cases : [];
  } catch {
    return [];
  }
}

/** Запасной вариант, если data/cases.json не положили: кейсы по категориям каталога. */
const FALLBACK_DEFS = [
  { id: 'knives', name: 'Кейс «Ножи»', icon: '🔪', categories: ['Ножи'], accent: '#ffd700', blurb: 'Только ножи: от классики до Doppler' },
  { id: 'gloves', name: 'Кейс «Перчатки»', icon: '🧤', categories: ['Перчатки'], accent: '#d32ce6', blurb: 'Перчатки всех расцветок' },
  { id: 'rifles', name: 'Кейс «Винтовки»', icon: '🎯', categories: ['Винтовки'], accent: '#ff6b60', blurb: 'AK, M4, AWP и всё остальное' },
  { id: 'pistols', name: 'Кейс «Пистолеты»', icon: '🔫', categories: ['Пистолеты'], accent: '#ffc94d', blurb: 'Deagle, USP, Glock и компания' },
  { id: 'smgs', name: 'Кейс «Пистолеты-пулемёты»', icon: '🧨', categories: ['Пистолеты-пулемёты'], accent: '#45d66b', blurb: 'MP9, MAC-10, P90 и другие' },
  { id: 'stickers', name: 'Кейс «Стикеры»', icon: '✨', categories: ['Стикеры'], accent: '#ffd75e', blurb: 'Стикеры, включая фольгу' },
  { id: 'all', name: 'Кейс «Всё подряд»', icon: '🎁', categories: [], accent: '#5aa9ff', blurb: 'Весь каталог: от стикера до ножа' },
];

const RARITY_WEIGHT_FALLBACK = {
  consumer: 120,
  industrial: 100,
  'mil-spec': 55,
  restricted: 18,
  classified: 5,
  covert: 1.4,
  'exceedingly rare': 0.25,
};

function buildFallback(def) {
  const all = items.loadItems();
  const pool = def.categories.length ? all.filter((item) => def.categories.includes(item.category)) : all;
  const maxPrice = Math.max(1, ...pool.map((i) => i.price));
  return {
    ...def,
    image: '',
    type: 'weapon',
    entries: pool.map((item) => ({
      item,
      weight: Math.max(0.0001, (RARITY_WEIGHT_FALLBACK[item.rarity] ?? 20) * Math.pow(maxPrice / Math.max(1, item.price), 0.35)),
      tier: RARITY_META[item.rarity] ? (RARITY_META[item.rarity].label ? { consumer: 'Consumer Grade', industrial: 'Industrial Grade', 'mil-spec': 'Mil-Spec Grade', restricted: 'Restricted', classified: 'Classified', covert: 'Covert', 'exceedingly rare': 'Exceedingly Rare' }[item.rarity] : 'Mil-Spec Grade') : 'Mil-Spec Grade',
    })),
  };
}

/** Группы по цене — показываем, когда в кейсе одна редкость. */
function tiersFor(entries, totalWeight) {
  const sorted = [...entries].sort((a, b) => a.item.price - b.item.price);
  const bounds = [
    { key: 'common', upTo: 0.5 },
    { key: 'uncommon', upTo: 0.8 },
    { key: 'rare', upTo: 0.95 },
    { key: 'legendary', upTo: 1.01 },
  ];
  const out = {};
  let previous = -Infinity;
  for (const tier of bounds) {
    const limit = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * tier.upTo))]?.price ?? Infinity;
    const chance = entries
      .filter((entry) => entry.item.price > previous && entry.item.price <= limit)
      .reduce((sum, entry) => sum + entry.weight, 0) / totalWeight;
    out[tier.key] = Number(chance.toFixed(6));
    previous = limit;
  }
  return out;
}

/* ------------------------------ materialize ------------------------------ */

const cache = new Map();
let seed = 0;

/** Сбрасывает кэш кейсов (после синхронизации цен или правки каталога). */
export function resetCache() {
  seed += 1;
  cache.clear();
}

function materialize(def) {
  const key = `${def.id}:${items.loadItems().length}:${seed}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const source = def.entries ? def : {
    ...def,
    entries: (def.items || []).map((entry) => {
      const item = items.findItem(entry.id);
      return item ? { item, weight: Math.max(0.000001, Number(entry.weight) || 0.01), tier: entry.rarity || 'Mil-Spec Grade' } : null;
    }).filter(Boolean),
  };

  const entries = (source.entries || []).filter((entry) => entry.item);
  const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0) || 1;
  const expectation = entries.reduce((sum, entry) => sum + entry.weight * entry.item.price, 0) / totalWeight;
  const price = Math.max(10, Math.round(expectation * config.caseEdge));

  const odds = {};
  for (const entry of entries) odds[entry.tier] = (odds[entry.tier] || 0) + entry.weight / totalWeight;

  // витрина: самые редкие и дорогие предметы кейса
  const rarest = [...entries]
    .sort((a, b) => a.weight - b.weight || b.item.price - a.item.price)
    .slice(0, 12);
  const shown = new Set();
  const showcase = [];
  for (const entry of rarest) {
    const key2 = `${entry.item.weapon}|${entry.item.pattern}`;
    if (shown.has(key2)) continue;
    shown.add(key2);
    showcase.push({
      id: entry.item.id,
      weapon: entry.item.weapon,
      pattern: entry.item.pattern,
      rarity: entry.item.rarity,
      price: entry.item.price,
      image: entry.item.image || '',
      chance: Number((entry.weight / totalWeight).toFixed(7)),
    });
    if (showcase.length === 4) break;
  }

  const built = {
    id: def.id,
    name: def.name,
    image: def.image || '',
    icon: def.icon || '🎁',
    type: def.type || 'weapon',
    accent: def.accent || (def.type === 'sticker' ? '#ffd75e' : '#5aa9ff'),
    blurb: def.blurb || '',
    price,
    edge: config.caseEdge,
    expectation: Math.round(expectation),
    itemsCount: entries.length,
    odds: Object.fromEntries(
      Object.entries(odds)
        .sort((a, b) => b[1] - a[1])
        .map(([tier, chance]) => [tier, Number(chance.toFixed(7))]),
    ),
    rarityMeta: Object.fromEntries(Object.entries(odds).map(([tier]) => [tier, RARITY_META[tier] || { label: tier, color: '#8b98a8' }])),
    tierLabels: TIER_LABEL,
    tierColors: TIER_COLOR,
    tiers: tiersFor(entries, totalWeight),
    showcase,
    minPrice: Math.min(...entries.map((e) => e.item.price)),
    maxPrice: Math.max(...entries.map((e) => e.item.price)),
    entries,
    totalWeight,
  };

  cache.clear();
  cache.set(key, built);
  return built;
}

function definitions() {
  const real = loadRealCases();
  if (real.length) return real;
  return FALLBACK_DEFS.map(buildFallback);
}

export function listCases() {
  // сначала оружейные кейсы (в них ножи и перчатки), потом капсулы
  return definitions()
    .map(materialize)
    .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'weapon' ? -1 : 1))
    .map(({ entries, totalWeight, ...rest }) => rest);
}

export function findCase(id) {
  const def = definitions().find((item) => String(item.id) === String(id));
  return def ? materialize(def) : null;
}

/** Детерминированный выбор приза по числу [0, 1) — тому же, что показывает «честность». */
export function pickPrize(caseDef, roll) {
  const built = caseDef.entries ? caseDef : materialize(caseDef);
  let acc = 0;
  const target = Math.min(0.999999, Math.max(0, Number(roll) || 0)) * built.totalWeight;
  for (const entry of built.entries) {
    acc += entry.weight;
    if (target < acc) return entry.item;
  }
  return built.entries.at(-1).item;
}

/** Случайный предмет с учётом весов — для ленты (визуально часто падает «мелочь»). */
function weightedRandom(caseDef) {
  let target = Math.random() * caseDef.totalWeight;
  for (const entry of caseDef.entries) {
    target -= entry.weight;
    if (target <= 0) return entry.item;
  }
  return caseDef.entries.at(-1).item;
}

/** Лента анимации: приз стоит на позиции winIndex, остальное — предметы из пула кейса. */
export function reelFor(caseDef, prize, winIndex) {
  const built = caseDef.entries ? caseDef : materialize(caseDef);
  const cells = [];
  for (let i = 0; i < REEL_CELLS; i += 1) {
    if (i === winIndex) {
      cells.push({ ...prize, isWin: true });
    } else {
      const pick = weightedRandom(built) || prize;
      cells.push({ ...pick, isWin: false });
    }
  }
  return cells;
}

export const reelCells = REEL_CELLS;
export const newId = () => crypto.randomUUID();
