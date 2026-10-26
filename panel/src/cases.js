import crypto from 'node:crypto';
import { config } from './config.js';
import * as items from './items.js';

/**
 * Кейсы — второй (кроме апгрейда) режим розыгрыша.
 *
 * Открытие кейса стоит виртуальные монеты, приз падает в хранилище игрока
 * и остаётся внутри экосистемы: вывода наружу нет, как и покупки за реальные деньги.
 *
 * Цена кейса считается автоматически из его наполнения:
 *   цена = математическое ожидание дропа × CASE_EDGE (по умолчанию 0.95),
 * поэтому витрина остаётся честной, если меняются цены предметов или курс Steam.
 */

/** Базовый вес редкости: чем редкость выше, тем реже выпадение. */
const RARITY_WEIGHT = {
  consumer: 120,
  industrial: 100,
  'mil-spec': 55,
  restricted: 18,
  classified: 5,
  covert: 1.4,
  'exceedingly rare': 0.25,
};

const DEFS = [
  { id: 'knives', name: 'Кейс «Ножи»', icon: '🔪', categories: ['Ножи'], accent: '#ffd700', blurb: 'Только ножи: от классики до Doppler' },
  { id: 'gloves', name: 'Кейс «Перчатки»', icon: '🧤', categories: ['Перчатки'], accent: '#d32ce6', blurb: 'Перчатки всех расцветок' },
  { id: 'rifles', name: 'Кейс «Винтовки»', icon: '🎯', categories: ['Винтовки'], accent: '#ff6b60', blurb: 'AK, M4, AWP и всё остальное' },
  { id: 'pistols', name: 'Кейс «Пистолеты»', icon: '🔫', categories: ['Пистолеты'], accent: '#ffc94d', blurb: 'Deagle, USP, Glock и компания' },
  { id: 'smgs', name: 'Кейс «Пистолеты-пулемёты»', icon: '🧨', categories: ['Пистолеты-пулемёты'], accent: '#45d66b', blurb: 'MP9, MAC-10, P90 и другие' },
  { id: 'heavy', name: 'Кейс «Тяжёлое»', icon: '💥', categories: ['Дробовики и пулемёты', 'Прочее'], accent: '#5aa9ff', blurb: 'Дробовики, пулемёты и Zeus' },
  { id: 'agents', name: 'Кейс «Агенты»', icon: '🕵️', categories: ['Агенты'], accent: '#8ce8a4', blurb: 'Персонажи для CT и T' },
  { id: 'stickers', name: 'Кейс «Стикеры»', icon: '✨', categories: ['Стикеры'], accent: '#ffd75e', blurb: 'Стикеры, включая фольгу и голографию' },
  { id: 'charms', name: 'Кейс «Брелоки»', icon: '🧸', categories: ['Брелоки'], accent: '#ff9fc6', blurb: 'Брелоки на оружие' },
  { id: 'music', name: 'Кейс «Музыка»', icon: '🎵', categories: ['Музыка'], accent: '#b48bff', blurb: 'Музыкальные наборы' },
  { id: 'collectible', name: 'Кейс «Коллекционное»', icon: '🏅', categories: ['Медали', 'Значки', 'Коллекционное', 'Патчи'], accent: '#ffd700', blurb: 'Медали, значки, монеты, патчи' },
  { id: 'premium', name: 'Кейс «Премиум»', icon: '💎', categories: ['Ножи', 'Перчатки'], accent: '#ff4fd8', blurb: 'Ножи и перчатки в одном кейсе' },
  { id: 'all', name: 'Кейс «Всё подряд»', icon: '🎁', categories: [], accent: '#5aa9ff', blurb: 'Весь каталог: от стикера до ножа' },
  {
    id: 'budget', name: 'Кейс «Бюджетный»', icon: '🪙', accent: '#45d66b',
    categories: ['Винтовки', 'Пистолеты', 'Пистолеты-пулемёты', 'Дробовики и пулемёты', 'Прочее', 'Стикеры', 'Брелоки'],
    maxPriceShare: 0.03, blurb: 'Недорогие скины — чтобы разогреться',
  },
];

const REEL_CELLS = 42;

/** Вес предмета внутри кейса: редкость плюс поправка на цену (дорогие падают реже). */
function weightOf(item, maxPrice) {
  const rarity = RARITY_WEIGHT[item.rarity] ?? 20;
  const factor = Math.pow(maxPrice / Math.max(1, item.price), 0.35);
  return Math.max(0.0001, rarity * factor);
}

function buildPool(def) {
  const all = items.loadItems();
  let pool = def.categories.length ? all.filter((item) => def.categories.includes(item.category)) : all.slice();
  if (def.maxPriceShare) {
    const ceiling = Math.max(1, Math.max(...all.map((i) => i.price)) * def.maxPriceShare);
    pool = pool.filter((item) => item.price <= ceiling);
  }
  return pool.length ? pool : all;
}

/** Группы по цене: в кейсах с одной редкостью именно цена решает, повезло или нет. */
const TIERS = [
  { key: 'common', label: 'обычные', upTo: 0.5 },
  { key: 'uncommon', label: 'необычные', upTo: 0.8 },
  { key: 'rare', label: 'редкие', upTo: 0.95 },
  { key: 'legendary', label: 'легендарные', upTo: 1.01 },
];

function tiersFor(pool, weighted, totalWeight) {
  const sorted = [...pool].sort((a, b) => a.price - b.price);
  const weightById = new Map(weighted.map((entry) => [entry.item.id, entry.weight]));
  const bounds = TIERS.map((tier) => ({
    ...tier,
    limit: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * tier.upTo))]?.price ?? Infinity,
  }));
  const out = {};
  let previous = -Infinity;
  for (const tier of bounds) {
    const chance = pool
      .filter((item) => item.price > previous && item.price <= tier.limit)
      .reduce((sum, item) => sum + (weightById.get(item.id) || 0), 0) / totalWeight;
    out[tier.key] = Number(chance.toFixed(6));
    previous = tier.limit;
  }
  return out;
}

const cache = new Map();

function build(def) {
  const pool = buildPool(def);
  const maxPrice = Math.max(1, ...pool.map((i) => i.price));
  const weighted = pool.map((item) => ({ item, weight: weightOf(item, maxPrice) }));
  const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0);
  const expectation = weighted.reduce((sum, w) => sum + w.weight * w.item.price, 0) / totalWeight;

  const odds = {};
  for (const entry of weighted) odds[entry.item.rarity] = (odds[entry.item.rarity] || 0) + entry.weight / totalWeight;

  const price = Math.max(10, Math.round(expectation * config.caseEdge));

  // Витрина кейса: самые дорогие предметы, но без клонов одного и того же скина.
  const shown = new Set();
  const rarest = [];
  for (const item of [...pool].sort((a, b) => b.price - a.price)) {
    const key = `${item.weapon}|${item.pattern}`;
    if (shown.has(key)) continue;
    shown.add(key);
    rarest.push(item);
    if (rarest.length === 4) break;
  }

  return {
    ...def,
    price,
    edge: config.caseEdge,
    expectation: Math.round(expectation),
    itemsCount: pool.length,
    odds: Object.fromEntries(
      Object.entries(odds)
        .sort((a, b) => b[1] - a[1])
        .map(([rarity, chance]) => [rarity, Number(chance.toFixed(6))]),
    ),
    tiers: tiersFor(pool, weighted, totalWeight),
    showcase: rarest.map((item) => ({
      id: item.id,
      weapon: item.weapon,
      pattern: item.pattern,
      rarity: item.rarity,
      price: item.price,
      image: item.image || '',
      chance: Number(((weighted.find((w) => w.item.id === item.id)?.weight || 0) / totalWeight).toFixed(6)),
    })),
    minPrice: Math.min(...pool.map((i) => i.price)),
    maxPrice,
    weighted,
    totalWeight,
  };
}

/** Кейсы пересчитываются на лету — цены каталога могли измениться после синхронизации. */
function materialize(def) {
  const key = `${def.id}:${items.loadItems().length}:${cacheKeySeed()}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const built = build(def);
  cache.clear();
  cache.set(key, built);
  return built;
}

let seed = 0;
function cacheKeySeed() {
  return seed;
}

/** Сбрасывает кэш кейсов (после синхронизации цен или правки каталога). */
export function resetCache() {
  seed += 1;
  cache.clear();
}

export function listCases() {
  return DEFS.map(materialize).map(({ weighted, totalWeight, ...rest }) => rest);
}

export function findCase(id) {
  return DEFS.find((def) => def.id === String(id)) ? materialize(DEFS.find((def) => def.id === String(id))) : null;
}

/** Детерминированный выбор приза по числу [0, 1) — тот же roll, что показывает «честность». */
export function pickPrize(caseDef, roll) {
  const built = caseDef.weighted ? caseDef : findCase(caseDef.id) || caseDef;
  let acc = 0;
  const target = Math.min(0.999999, Math.max(0, Number(roll) || 0)) * built.totalWeight;
  for (const entry of built.weighted) {
    acc += entry.weight;
    if (target < acc) return entry.item;
  }
  return built.weighted.at(-1).item;
}

/** Лента для анимации: приз стоит на позиции winIndex, остальное — предметы из пула кейса. */
export function reelFor(caseDef, prize, winIndex) {
  const built = caseDef.weighted ? caseDef : findCase(caseDef.id) || caseDef;
  const pool = built.weighted.map((w) => w.item);
  const cells = [];
  for (let i = 0; i < REEL_CELLS; i += 1) {
    if (i === winIndex) {
      cells.push({ ...prize, isWin: true });
    } else {
      const pick = pool[Math.floor(Math.random() * pool.length)] || prize;
      cells.push({ ...pick, isWin: false });
    }
  }
  return cells;
}

export const reelCells = REEL_CELLS;

/** Случайный идентификатор открытия — для ленты и журнала. */
export const newId = () => crypto.randomUUID();
