import crypto from 'node:crypto';

/**
 * Оценка рыночной цены предмета в рублях.
 *
 * Зачем: пока по каталогу не пройдена синхронизация со Steam, цены должны быть
 * похожи на настоящие, а не «топовые перчатки за 3 тысячи». Модель считает
 * правдоподобную цену из редкости, типа предмета, оружия, износа, StatTrak/Souvenir
 * и устойчивого разброса (хеш от id — поэтому цена не прыгает между перезапусками).
 *
 * Это именно ОЦЕНКА: как только админ нажимает «обновить цены», реальная цена
 * с площадки Steam перекрывает её, и на карточке появляется метка «Steam».
 */

/* -------------------------- базовые цены, в ₽ --------------------------- */

/** Оружие: база по редкости. */
const WEAPON_RARITY_BASE = {
  consumer: 60,
  industrial: 130,
  'mil-spec': 330,
  restricted: 1_400,
  classified: 6_500,
  covert: 32_000,
  'exceedingly rare': 90_000,
};

/** Популярность оружия: влияет и на оружие, и на ножи. */
const WEAPON_FACTOR = {
  'AK-47': 1.8, 'M4A4': 1.5, 'M4A1-S': 1.6, 'AWP': 1.9, 'Desert Eagle': 1.5,
  'USP-S': 1.2, 'Glock-18': 1.15, 'P250': 0.9, 'Five-SeveN': 0.9, 'Tec-9': 0.9,
  'CZ75-Auto': 0.8, 'Dual Berettas': 0.75, 'R8 Revolver': 0.85, 'P2000': 1.0,
  'MP9': 0.8, 'MAC-10': 0.85, 'MP7': 0.8, 'MP5-SD': 1.0, 'UMP-45': 0.8,
  'P90': 0.85, 'PP-Bizon': 0.7, 'FAMAS': 0.85, 'Galil AR': 0.8,
  'SSG 08': 0.9, 'SCAR-20': 0.8, 'G3SG1': 0.8, 'AUG': 0.9, 'SG 553': 0.9,
  'Nova': 0.7, 'XM1014': 0.75, 'MAG-7': 0.75, 'Sawed-Off': 0.8,
  'M249': 0.7, 'Negev': 0.7, 'Zeus x27': 1.1,
};

/** Ножи: цена типа ножа (базовая, до скина и износа). */
const KNIFE_FACTOR = {
  'Karambit': 2.4, 'Butterfly Knife': 2.6, 'M9 Bayonet': 1.9, 'Bayonet': 1.4,
  'Skeleton Knife': 1.7, 'Talon Knife': 1.6, 'Stiletto Knife': 1.3, 'Nomad Knife': 1.0,
  'Huntsman Knife': 1.0, 'Kukri Knife': 1.1, 'Bowie Knife': 0.85, 'Falchion Knife': 0.9,
  'Classic Knife': 1.15, 'Paracord Knife': 0.85, 'Survival Knife': 0.85,
  'Shadow Daggers': 0.7, 'Navaja Knife': 0.7, 'Ursus Knife': 0.9, 'Gut Knife': 0.7, 'Flip Knife': 0.8,
};
const KNIFE_BASE = 42_000;

/** Перчатки. */
const GLOVE_FACTOR = {
  'Sport Gloves': 1.9, 'Specialist Gloves': 1.2, 'Moto Gloves': 0.8, 'Hand Wraps': 0.7,
  'Driver Gloves': 0.7, 'Hydra Gloves': 0.95, 'Bloodhound Gloves': 0.6, 'Broken Fang Gloves': 0.85,
  'Snow Leopard Gloves': 0.9, 'Omega Gloves': 0.9,
};
const GLOVE_BASE = 55_000;

/** Знаменитые скины дороже своих соседей по редкости. */
const PREMIUM_PATTERN = {
  'Dragon Lore': 6, 'Howl': 5, 'Fire Serpent': 4, 'Medusa': 4, 'Gungnir': 5, 'Prince': 4,
  'Knight': 3, 'Lore': 3.2, 'Wild Lotus': 4, 'Fade': 2, 'Asiimov': 1.8, 'Neo-Noir': 1.7,
  'Printstream': 1.7, 'Vulcan': 1.6, 'Redline': 1.4, 'Case Hardened': 1.5, 'Marble Fade': 1.8,
  'Doppler': 1.6, 'Crimson Web': 1.7, 'Slaughter': 1.4, 'Tiger Tooth': 1.5, 'Gamma Doppler': 1.7,
  'Autotronic': 1.5, 'Freehand': 1.6, 'Blaze': 2.4, 'Bloodsport': 1.3, 'Neon Rider': 1.5,
  'Phantom': 1.5, 'Atheris': 1.3, 'Hyper Beast': 1.3, 'Emerald Quartz': 1.3, 'Death by Kitty': 1.6,
  'Vice': 3, "Pandora's Box": 2.6, 'Crimson Kimono': 2.2, 'Mogul': 1.7, 'King Snake': 1.5,
  'Sporty': 1.4, 'Arid': 1.2, 'Bronze Morph': 1.3, 'Snakebite': 1.3,
};

/** Износ: насколько износ сбивает цену. */
const WEAR_FACTOR = {
  'Factory New': 1.2, 'Minimal Wear': 1.0, 'Field-Tested': 0.82,
  'Well-Worn': 0.74, 'Battle-Scarred': 0.68,
};

/** Наклейки: множитель за тип фольги. */
const STICKER_FINISH = {
  '(Gold)': 14, '(Holo)': 6, '(Foil)': 3.6, '(Glitter)': 2.4, '(Lenticular)': 4,
};

/* ------------------------------ вычисление ------------------------------ */

const sha = (value) => crypto.createHash('sha256').update(String(value)).digest();

/** Устойчивый «разброс» цены: одно и то же значение для одного предмета всегда. */
function spread(id) {
  const hash = sha(String(id));
  const base = hash.readUInt32BE(0) / 0xffffffff;         // 0..1
  const tail = hash.readUInt8(4);                          // редкие всплески
  let factor = 0.78 + base * 0.5;                          // 0.78 … 1.28
  if (tail % 29 === 0) factor *= 1.9;                      // каждый 29-й — заметно дороже
  if (tail % 97 === 0) factor *= 2.6;                      // единицы — топ-лоты
  if (base < 0.06) factor *= 0.6;                          // и наоборот, откровенно дешёвые
  return factor;
}

const cleanPattern = (pattern) =>
  String(pattern || '').replace(/\s*\((Souvenir|StatTrak™)\)\s*/gi, '').trim();

const isStatTrak = (pattern) => /\(StatTrak™\)/i.test(String(pattern || ''));
const isSouvenir = (pattern) => /\(Souvenir\)/i.test(String(pattern || ''));

function wearOf(item) {
  if (!Array.isArray(item.float) || item.float.length !== 2) return '';
  const mid = (Number(item.float[0]) + Number(item.float[1])) / 2;
  if (mid < 0.07) return 'Factory New';
  if (mid < 0.15) return 'Minimal Wear';
  if (mid < 0.38) return 'Field-Tested';
  if (mid < 0.45) return 'Well-Worn';
  return 'Battle-Scarred';
}

function premiumFactor(pattern) {
  const name = cleanPattern(pattern);
  for (const [needle, factor] of Object.entries(PREMIUM_PATTERN)) {
    if (name.toLowerCase().includes(needle.toLowerCase())) return factor;
  }
  return 1;
}

/** Округление до «красивой» цены. */
function nice(value) {
  const v = Math.max(20, Number(value) || 0);
  if (v < 500) return Math.round(v / 5) * 5;
  if (v < 5_000) return Math.round(v / 50) * 50;
  if (v < 50_000) return Math.round(v / 500) * 500;
  if (v < 500_000) return Math.round(v / 1_000) * 1_000;
  return Math.round(v / 5_000) * 5_000;
}

/**
 * Оценка цены предмета в рублях.
 * @param {{id:string, weapon:string, pattern:string, category:string, rarity:string, float?:number[]}} item
 * @returns {number} рубли
 */
export function estimateRub(item) {
  if (!item) return 0;
  const category = String(item.category || '');
  const pattern = String(item.pattern || '');
  const name = cleanPattern(pattern);
  const jitter = spread(item.id || `${item.weapon}-${pattern}`);
  const wear = wearOf(item);
  let price;

  if (category === 'Ножи') {
    price = KNIFE_BASE * (KNIFE_FACTOR[item.weapon] || 1)
      * premiumFactor(pattern)
      * (WEAR_FACTOR[wear] || 1)
      * (isStatTrak(pattern) ? 1.25 : 1);
  } else if (category === 'Перчатки') {
    price = GLOVE_BASE * (GLOVE_FACTOR[item.weapon] || 1)
      * premiumFactor(pattern)
      * (WEAR_FACTOR[wear] || 0.9)
      * (isStatTrak(pattern) ? 1.2 : 1);
  } else if (category === 'Стикеры') {
    let finish = 1;
    for (const [suffix, factor] of Object.entries(STICKER_FINISH)) {
      if (pattern.includes(suffix)) { finish = factor; break; }
    }
    const vintage = /\b(19|20)\d{2}\b/.test(name) && /(Katowice|Cologne|DreamHack|Cluj|Columbus|Atlanta|Krakow|Boston|London|Berlin|Stockholm|Antwerp|Rio|Paris|Copenhagen|Shanghai|Austin|Budapest)\b/i.test(name);
    price = 55 * finish * (vintage ? 9 : 1) * premiumFactor(pattern);
  } else if (category === 'Музыка') {
    price = 260 * (isStatTrak(pattern) ? 2.2 : 1) * premiumFactor(pattern);
  } else if (category === 'Агенты') {
    price = 900 * premiumFactor(pattern);
  } else if (category === 'Брелоки') {
    price = 140 * premiumFactor(pattern);
  } else if (category === 'Патчи') {
    price = 170 * premiumFactor(pattern);
  } else if (['Медали', 'Значки', 'Коллекционное'].includes(category)) {
    price = 900 * (/(Service Medal|Champion|Legend|Veteran Coin|Diamond)/i.test(name) ? 2.6 : 1) * premiumFactor(pattern);
  } else {
    // обычное оружие
    price = (WEAPON_RARITY_BASE[item.rarity] || 300)
      * (WEAPON_FACTOR[item.weapon] || 1)
      * premiumFactor(pattern)
      * (WEAR_FACTOR[wear] || 1)
      * (isStatTrak(pattern) ? 1.85 : 1)
      * (isSouvenir(pattern) ? 2.3 : 1);
  }

  return nice(price * jitter);
}

/** Примерная цена в рублях для показа «от» в кейсах и сводках. */
export function estimateRubFor(item) {
  return estimateRub(item);
}
