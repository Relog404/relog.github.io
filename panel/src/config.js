import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function list(value) {
  return String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const env = process.env;

/**
 * Единственный сервер, описанный через переменные окружения.
 * Остальные серверы добавляются прямо из веб-панели (хранятся в data/store.json).
 */
export const defaultServerFromEnv = () => {
  if (!env.CS2_RCON_HOST || !env.CS2_RCON_PASSWORD) return null;
  return {
    id: 'env',
    name: env.CS2_NAME || 'Основной сервер CS2',
    host: env.CS2_RCON_HOST,
    gamePort: Number(env.CS2_GAME_PORT || 27015),
    rconPort: Number(env.CS2_RCON_PORT || env.CS2_GAME_PORT || 27015),
    password: env.CS2_RCON_PASSWORD,
    demo: false,
    readonly: true,
  };
};

export const config = {
  port: Number(env.PORT || 3000),
  host: env.HOST || '0.0.0.0',
  /** Публичный адрес панели — нужен для Steam OpenID (realm/return_to). */
  baseUrl: env.PUBLIC_BASE_URL || `http://localhost:${Number(env.PORT || 3000)}`,
  sessionSecret: env.SESSION_SECRET || 'dev-only-secret-change-me',
  sessionTtlDays: Number(env.SESSION_TTL_DAYS || 30),
  steamApiKey: env.STEAM_API_KEY || '',
  adminSteamIds: list(env.ADMIN_STEAM_IDS),
  /** Разрешать ли менять список серверов из панели (иначе только сервер из env). */
  allowServerManagement: bool(env.ALLOW_SERVER_MANAGEMENT, true),
  /** Как показывать цены: coins | rub | usd (только отображение, деньги виртуальные). */
  currency: ['coins', 'rub', 'usd'].includes(String(env.CURRENCY || 'coins').toLowerCase())
    ? String(env.CURRENCY).toLowerCase()
    : 'coins',
  /** Курс отображения: сколько рублей/долларов в одной виртуальной монете. */
  rateRub: Math.min(Math.max(Number(env.RATE_RUB || 1), 0.0001), 1_000_000),
  rateUsd: Math.min(Math.max(Number(env.RATE_USD || 0.011), 0.0001), 1_000_000),

  /**
   * Курс виртуальной монеты к рублю: цена предмета со Steam (в ₽) делится на это число.
   * Монеты остаются внутренней валютой — это просто масштаб, чтобы цены были удобными.
   */
  coinRateRub: Math.min(Math.max(Number(env.COIN_RATE_RUB || 10), 0.01), 1_000_000),

  /** Доля цены кейса относительно математического ожидания дропа (дом всегда в плюсе). */
  caseEdge: Math.min(Math.max(Number(env.CASE_EDGE || 0.95), 0.1), 1.2),

  /**
   * Реальные цены с торговой площадки Steam. Работает на машине, где у панели есть
   * доступ в интернет: админ жмёт «обновить цены» в админке, либо включается автосинк.
   */
  priceSync: {
    enabled: bool(env.PRICE_SYNC_ENABLED, true),
    /** Пауза между запросами: Steam режет частые запросы (429). */
    delayMs: Math.min(Math.max(Number(env.PRICE_SYNC_DELAY_MS || 1200), 100), 60_000),
    /** Сколько предметов обновлять за один проход. */
    batch: Math.min(Math.max(Number(env.PRICE_SYNC_BATCH || 150), 1), 2000),
    /** Курс доллара к рублю, чтобы не делать второй запрос к Steam ради USD. */
    usdRub: Math.min(Math.max(Number(env.USD_RUB || 95), 1), 1000),
    /** Автообновление цен, раз в N часов (0 — выключено). */
    autoHours: Math.min(Math.max(Number(env.PRICE_SYNC_HOURS || 0), 0), 720),
    userAgent: env.PRICE_USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) cs2-panel/1.0',
  },

  /** Базовый коэффициент апгрейда по умолчанию (шанс = ставка / цена цели * edge). */
  upgradeEdge: Math.min(Math.max(Number(env.UPGRADE_EDGE || 0.95), 0.1), 1),

  /** Общий ключ для игровых плагинов (альтернатива ключу конкретного сервера). */
  pluginApiKey: env.PLUGIN_API_KEY || '',
  dataDir: env.DATA_DIR || path.join(ROOT, 'data'),
  /** DEMO_MODE=1 — всегда отдавать демонстрационные данные, даже если серверы настроены. */
  demoMode: bool(env.DEMO_MODE, false),
  /**
   * DEMO_ADMIN=1 (работает только вместе с DEMO_MODE=1) — заходить в панель сразу админом
   * под учебным SteamID, без настоящего входа через Steam. Только для локального предпросмотра.
   */
  demoAdmin: bool(env.DEMO_ADMIN, false) && bool(env.DEMO_MODE, false),
  demoAdminSteamId: '76561190000000000',
};

export const isAdmin = (steamId) =>
  config.adminSteamIds.includes(String(steamId)) ||
  (config.demoAdmin && String(steamId) === config.demoAdminSteamId);
