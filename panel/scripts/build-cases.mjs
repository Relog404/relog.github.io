#!/usr/bin/env node
/**
 * Собирает data/cases.json — настоящие кейсы CS2: имя, картинка с площадки Steam
 * и реальный состав (какие скины/ножи/перчатки из него падают).
 *
 * Источник данных: https://github.com/ByMykel/CSGO-API (public/api/en/crates.json).
 * Сам файл crates.json в репозиторий не кладём (7 МБ, чужие данные) — скачиваем по необходимости:
 *
 *   curl -L -o /tmp/crates.json \
 *     https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/crates.json
 *   node scripts/build-cases.mjs --crates /tmp/crates.json
 *
 * Скрипт сопоставляет предметы из кейса с нашим каталогом (по paint_index + оружию)
 * и оставляет только те кейсы, у которых совпало достаточно содержимого.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : fallback;
};

const cratesPath = arg('crates', '/tmp/crates.json');
const catalogPath = arg('catalog', path.join(ROOT, 'data', 'catalog.sample.json'));
const outPath = arg('out', path.join(ROOT, 'data', 'cases.json'));

if (!fs.existsSync(cratesPath)) {
  console.error(`Нет файла ${cratesPath} — скачайте crates.json (см. комментарий в начале скрипта).`);
  process.exit(1);
}

const crates = JSON.parse(fs.readFileSync(cratesPath, 'utf8'));
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8')).items;

/* ---------------------- сопоставление с нашим каталогом ------------------ */

const WEAPON_ALIAS = {
  Sticker: 'Стикер',
  'Music Kit': 'Музыкальный набор',
  Patch: 'Патч',
  Charm: 'Брелок',
  Agent: 'Агент',
};

/** Настоящие шансы CS2 по редкости (в процентах, как у Valve). */
const RARITY_WEIGHT = {
  'Mil-Spec Grade': 79.92,
  Restricted: 15.98,
  Classified: 3.2,
  Covert: 0.64,
  'Exceedingly Rare': 0.26,
  Extraordinary: 0.64,
  // капсулы со стикерами
  'High Grade': 79.92,
  Remarkable: 15.98,
  Exotic: 3.2,
  'Base Grade': 79.92,
  'Industrial Grade': 79.92,
  'Consumer Grade': 79.92,
};

const byWeapon = new Map();
for (const item of catalog) {
  const key = String(item.weapon).toLowerCase();
  if (!byWeapon.has(key)) byWeapon.set(key, []);
  byWeapon.get(key).push(item);
}
const byPattern = new Map();
for (const item of catalog) {
  byPattern.set(`${item.weapon} ${item.pattern}`.toLowerCase(), item);
}

function matchItem(entry, { asSticker = false } = {}) {
  const raw = String(entry.name || '');
  if (asSticker) {
    // в капсулах названия идут без префикса «Sticker | »
    const pool = byWeapon.get('стикер') || [];
    return pool.find((item) => String(item.pattern).toLowerCase().startsWith(raw.toLowerCase()))
      || pool.find((item) => String(item.pattern).toLowerCase().includes(raw.toLowerCase()))
      || null;
  }
  const [left, ...rest] = raw.split(' | ');
  let weapon = String(left || '').replace(/^★\s*/, '').replace(/^StatTrak™\s*/, '').trim();
  let pattern = rest.join(' | ').trim();
  weapon = WEAPON_ALIAS[weapon] || weapon;

  let pool = byWeapon.get(weapon.toLowerCase());
  if (!pool || !pool.length) {
    const key = [...byWeapon.keys()].find((k) => k.includes(weapon.toLowerCase()) || weapon.toLowerCase().includes(k));
    pool = key ? byWeapon.get(key) : [];
  }
  if (!pool || !pool.length) return null;

  if (entry.paint_index != null && String(entry.paint_index) !== '') {
    const exact = pool.find((item) => String(item.paint) === String(entry.paint_index));
    if (exact) return exact;
  }
  if (pattern) {
    const named = byPattern.get(`${weapon} ${pattern}`.toLowerCase())
      || pool.find((item) => String(item.pattern).toLowerCase().startsWith(pattern.toLowerCase()));
    if (named) return named;
  }
  // ванильный нож/перчатки без скина — берём любой предмет этого типа
  return pool.sort((a, b) => b.price - a.price)[0] || null;
}

/* ------------------------------- сборка --------------------------------- */

const slug = (value) =>
  String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

const INTERESTING = /(case|capsule)/i;
const SKIP = /(souvenir package|gift|tool|pass|pin|coin|patch pack|music kit box)/i;

const seen = new Set();
const cases = [];

for (const crate of crates) {
  const name = String(crate.name || '').trim();
  if (!name || !crate.image) continue;
  if (SKIP.test(name) && !INTERESTING.test(name)) continue;
  if (!INTERESTING.test(name)) continue;

  const rare = crate.contains_rare || [];
  const common = crate.contains || [];
  if (common.length + rare.length < 5) continue;

  const tiers = new Map(); // редкость → {weight, items:[]}
  let matched = 0;

  const asSticker = /capsule|sticker/i.test(name);
  const push = (entry, isRare) => {
    const item = matchItem(entry, { asSticker });
    if (!item) return;
    const tierName = isRare ? 'Exceedingly Rare' : (entry.rarity?.name || 'Mil-Spec Grade');
    const weight = isRare ? RARITY_WEIGHT['Exceedingly Rare'] : (RARITY_WEIGHT[tierName] ?? 1);
    if (!tiers.has(tierName)) tiers.set(tierName, { weight, items: [] });
    const tier = tiers.get(tierName);
    tier.weight = weight;
    if (!tier.items.some((i) => i.id === item.id)) tier.items.push(item);
    matched += 1;
  };

  for (const entry of common) push(entry, false);
  for (const entry of rare) push(entry, true);

  if (matched < 8) continue;
  const id = slug(name);
  if (seen.has(id)) continue;
  seen.add(id);

  const items = [];
  for (const [tierName, tier] of tiers) {
    if (!tier.items.length) continue;
    const share = tier.weight / tier.items.length;
    for (const item of tier.items) {
      items.push({ id: item.id, rarity: tierName, weight: Number(share.toFixed(5)) });
    }
  }

  cases.push({
    id,
    name,
    image: crate.image,
    type: asSticker ? 'sticker' : 'weapon',
    blurb: crate.description ? String(crate.description).slice(0, 120) : '',
    items,
  });
}

cases.sort((a, b) => a.name.localeCompare(b.name));

fs.writeFileSync(outPath, JSON.stringify({
  generated: new Date().toISOString().slice(0, 10),
  source: 'ByMykel/CSGO-API — public/api/en/crates.json',
  note: 'Состав и картинки — настоящие кейсы CS2; веса — реальные шансы Valve по редкости.',
  cases,
}, null, 1) + '\n');

console.log(`Готово: ${cases.length} кейсов → ${outPath}`);
for (const c of cases.slice(0, 12)) console.log(`  ${c.name}: ${c.items.length} предметов`);
