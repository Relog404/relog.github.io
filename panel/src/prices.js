import { config } from './config.js';
import * as store from './store.js';
import * as items from './items.js';

/**
 * Реальные цены с торговой площадки Steam.
 *
 * Деньги в панели по-прежнему виртуальные: здесь берётся только РЫНОЧНАЯ ЦЕНА
 * предмета, чтобы витрина и апгрейд считались по настоящему курсу Steam.
 * Никаких покупок за реальные деньги, депозитов и вывода — как и было.
 *
 * Источник — публичный endpoint площадки:
 *   https://steamcommunity.com/market/priceoverview/?appid=730&currency=5&market_hash_name=...
 * Steam ограничивает частоту запросов, поэтому синхронизация идёт порциями
 * с паузой и аккуратно переживает ответ 429.
 */

const ENDPOINT = 'https://steamcommunity.com/market/priceoverview/';
const APP_ID = 730;
const CURRENCY_RUB = 5;

/* --------------------------- имя предмета в Steam ------------------------ */

const EXTERIORS = [
  [0.07, 'Factory New'],
  [0.15, 'Minimal Wear'],
  [0.38, 'Field-Tested'],
  [0.45, 'Well-Worn'],
  [1.01, 'Battle-Scarred'],
];

/** Износ по середине диапазона float — ровно то, что пишет Steam в названии. */
export function exteriorFor(item) {
  if (!item || !Array.isArray(item.float) || item.float.length !== 2) return '';
  const min = Number(item.float[0]);
  const max = Number(item.float[1]);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return '';
  const mid = (min + max) / 2;
  const found = EXTERIORS.find(([limit]) => mid < limit);
  return found ? found[1] : 'Battle-Scarred';
}

const SPECIAL_WEAPON = {
  'Стикер': 'Sticker',
  'Патч': null,
  'Брелок': 'Charm',
  'Музыкальный набор': 'Music Kit',
  'Агент': null,
  'Коллекционное': null,
};

/**
 * market_hash_name — точное имя лота на площадке Steam.
 * Примеры: "AK-47 | Redline (Field-Tested)", "★ StatTrak™ Karambit | Fade (Factory New)",
 *          "Sticker | Shooter (Foil)", "Music Kit | Valve, Counter-Strike 2".
 */
export function marketHashName(item) {
  if (!item) return '';
  const weapon = String(item.weapon || '').trim();
  let pattern = String(item.pattern || '').trim();

  let prefix = '';
  if (/\(Souvenir\)/i.test(pattern)) prefix = 'Souvenir ';
  else if (/\(StatTrak™\)/i.test(pattern)) prefix = 'StatTrak™ ';

  const special = SPECIAL_WEAPON[weapon];
  // В каталоге часть имён уже полные: «Patch | Crazy Banana», «Bloody Darryl … | The Professionals».
  if (special === null) return `${prefix}${pattern}`.trim();

  pattern = pattern.replace(/\s*\((Souvenir|StatTrak™)\)\s*/gi, '').trim();
  const base = special || weapon;
  if (!pattern) return `${prefix}${base}`.trim();

  const star = item.category === 'Ножи' ? '★ ' : '';
  const exterior = exteriorFor(item);
  const name = `${star}${prefix}${base} | ${pattern}`.trim();
  return exterior ? `${name} (${exterior})` : name;
}

/* ------------------------------- запрос цены ----------------------------- */

/** "1 234,56 ₽" → 1234.56 */
export function parsePriceText(value) {
  if (value === undefined || value === null) return null;
  const digits = String(value)
    .replace(/\u00a0/g, ' ')
    .replace(/[^\d.,]/g, '')
    .replace(/\s/g, '')
    .replace(/,/g, '.');
  if (!digits) return null;
  // "1.234.56" (разделители тысяч) → "1234.56"
  const normalized = digits.replace(/\.(?=\d{3}\.)/g, '');
  const number = Number(normalized);
  return Number.isFinite(number) && number > 0 ? number : null;
}

/**
 * Цена одного предмета в рублях. Возвращает null, если лот не найден
 * или Steam отказал — тогда предмет остаётся на базовой цене каталога.
 */
export async function fetchSteamPrice(name, { fetchImpl, signal } = {}) {
  const doFetch = fetchImpl || globalThis.fetch;
  const url = `${ENDPOINT}?appid=${APP_ID}&currency=${CURRENCY_RUB}&market_hash_name=${encodeURIComponent(name)}`;
  const response = await doFetch(url, {
    headers: { 'User-Agent': config.priceSync.userAgent, Accept: 'application/json' },
    signal,
  });
  if (response.status === 429) {
    const error = new Error('Steam просит реже (429)');
    error.rateLimited = true;
    throw error;
  }
  if (!response.ok) throw new Error(`Steam ответил ${response.status}`);
  const data = await response.json();
  if (!data || data.success !== true) return null;
  const rub = parsePriceText(data.lowest_price) ?? parsePriceText(data.median_price);
  if (!rub) return null;
  return { rub, usd: Number((rub / config.priceSync.usdRub).toFixed(2)), name };
}

/* ---------------------------- синхронизация ------------------------------ */

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (signal) signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('Остановлено')); }, { once: true });
  });

/**
 * Обновляет цены каталога. Идёт по предметам, которые ещё не синхронизировались
 * (или по всем, если force), и останавливается после лимита или серии отказов.
 */
export async function syncPrices({
  limit = config.priceSync.batch,
  force = false,
  fetchImpl,
  onProgress,
  signal,
} = {}) {
  if (!config.priceSync.enabled) {
    return { ok: false, error: 'Синхронизация цен выключена (PRICE_SYNC_ENABLED=0)', updated: 0, failed: 0 };
  }

  const meta = store.getPricesMeta();
  if (meta.running) return { ok: false, error: 'Синхронизация уже идёт', updated: 0, failed: 0 };

  store.setPricesMeta({ running: true, lastRun: new Date().toISOString() });
  const known = store.getPrices();
  const queue = items
    .loadItems()
    .filter((item) => force || !known[item.id])
    .filter((item) => marketHashName(item))
    .slice(0, Math.max(1, Number(limit) || 1));

  let updated = 0;
  let failed = 0;
  let skipped = 0;
  let rateLimitHits = 0;
  let lastError = null;

  try {
    for (const [index, item] of queue.entries()) {
      const name = marketHashName(item);
      try {
        const price = await fetchSteamPrice(name, { fetchImpl, signal });
        if (price) {
          store.setPrice(item.id, { ...price, updatedAt: new Date().toISOString() });
          updated += 1;
          rateLimitHits = 0;
        } else {
          skipped += 1; // лот не торгуется (медали, агенты и т.п.) — это не ошибка
        }
      } catch (error) {
        failed += 1;
        lastError = error.message;
        if (error.rateLimited) {
          rateLimitHits += 1;
          await sleep(Math.min(30_000, config.priceSync.delayMs * 2 ** rateLimitHits), signal).catch(() => {});
          if (rateLimitHits >= 4) break;
        }
        if (failed >= 12) break;
      }
      if (onProgress) onProgress({ done: index + 1, total: queue.length, updated, failed });
      await sleep(config.priceSync.delayMs, signal).catch(() => {});
    }
  } catch (error) {
    lastError = error.message;
  } finally {
    store.setPricesMeta({
      running: false,
      lastSyncAt: new Date().toISOString(),
      lastError,
      lastResult: { updated, failed, skipped },
    });
    // цены могли измениться — сбрасываем кэш каталога
    items.resetCache();
  }

  return { ok: true, updated, failed, skipped, queued: queue.length, lastError };
}

/** Сводка для админки и публичного статуса. */
export function priceStatus() {
  const meta = store.getPricesMeta();
  const rates = store.getSiteSettings();
  return {
    enabled: config.priceSync.enabled,
    provider: 'Steam Community Market (appid 730)',
    total: items.loadItems().length,
    synced: meta.synced,
    running: meta.running,
    lastSyncAt: meta.lastSyncAt,
    lastError: meta.lastError,
    lastResult: meta.lastResult || null,
    delayMs: config.priceSync.delayMs,
    batch: config.priceSync.batch,
    usdRub: config.priceSync.usdRub,
    coinRateRub: rates.coinRateRub,
  };
}

/** Сколько монет стоит предмет с рыночной ценой rub. */
export function coinsFromRub(rub) {
  const rate = Math.max(0.01, Number(store.getSiteSettings().coinRateRub) || 10);
  return Math.max(1, Math.round((Number(rub) || 0) / rate));
}

/** Рубли по цене в монетах (обратный пересчёт для отображения). */
export function rubFromCoins(coins) {
  const rate = Math.max(0.01, Number(store.getSiteSettings().coinRateRub) || 10);
  return Math.round((Number(coins) || 0) * rate);
}

/**
 * Фоновое автообновление цен (PRICE_SYNC_HOURS=N).
 * Каждые N часов дозагружает одну порцию — полный каталог обновится постепенно.
 */
export function startAutoSync() {
  const hours = config.priceSync.autoHours;
  if (!hours || !config.priceSync.enabled) return null;
  const timer = setInterval(() => {
    syncPrices({ limit: config.priceSync.batch }).catch((error) => {
      store.setPricesMeta({ running: false, lastError: error.message });
    });
  }, hours * 3600 * 1000);
  timer.unref?.();
  // первый проход — через минуту после старта
  const kickoff = setTimeout(() => {
    syncPrices({ limit: config.priceSync.batch }).catch(() => {});
  }, 60_000);
  kickoff.unref?.();
  return timer;
}
