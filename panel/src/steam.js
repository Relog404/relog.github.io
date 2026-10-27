import crypto from 'node:crypto';
import { config } from './config.js';

const STEAM_OPENID_URL = 'https://steamcommunity.com/openid/login';
const STEAM_API_SUMMARIES = 'https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/';

/** URL, куда нужно отправить пользователя для входа через Steam (OpenID 2.0). */
export function steamLoginUrl(returnTo) {
  const params = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': returnTo,
    'openid.realm': new URL(returnTo).origin,
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
  });
  return `${STEAM_OPENID_URL}?${params.toString()}`;
}

/** Проверяет ответ Steam и достаёт SteamID64 из claimed_id. */
export async function verifySteamLogin(query) {
  const params = new URLSearchParams();
  params.set('openid.mode', 'check_authentication');
  let hasNs = false;
  for (const [key, value] of Object.entries(query)) {
    if (!key.startsWith('openid.')) continue;
    if (key === 'openid.mode') continue;
    if (key === 'openid.ns') hasNs = true;
    params.set(key, String(value));
  }
  if (!hasNs || !params.get('openid.signed') || !params.get('openid.sig')) {
    return null;
  }

  const response = await fetch(STEAM_OPENID_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const body = await response.text();
  if (!/is_valid\s*:\s*true/i.test(body)) return null;

  const claimedId = String(query['openid.claimed_id'] || '');
  const match = /\/openid\/id\/(\d{17})\/?$/.exec(claimedId);
  if (!match) return null;
  return match[1];
}

/** Имя и аватар из Steam Web API (работает только при заданном STEAM_API_KEY). */
export async function getPlayerSummaries(steamIds) {
  const ids = [...new Set(steamIds.filter(Boolean))].slice(0, 100);
  if (!config.steamApiKey || ids.length === 0) return {};
  try {
    const url = `${STEAM_API_SUMMARIES}?key=${encodeURIComponent(config.steamApiKey)}&steamids=${ids.join(',')}`;
    const response = await fetch(url);
    if (!response.ok) return {};
    const data = await response.json();
    const out = {};
    for (const player of data?.response?.players || []) {
      out[player.steamid] = { name: player.personaname || '', avatar: player.avatarmedium || player.avatar || '' };
    }
    return out;
  } catch {
    return {};
  }
}

/* ------------------------- подписанные сессии ---------------------------- */

const b64url = (buf) => Buffer.from(buf).toString('base64url');

export function createSession(steamId) {
  const payload = {
    steamId: String(steamId),
    exp: Date.now() + config.sessionTtlDays * 24 * 60 * 60 * 1000,
  };
  const body = b64url(JSON.stringify(payload));
  const sign = crypto.createHmac('sha256', config.sessionSecret).update(body).digest('base64url');
  return `${body}.${sign}`;
}

export function readSession(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sign] = token.split('.');
  const expected = crypto.createHmac('sha256', config.sessionSecret).update(body).digest('base64url');
  if (
    sign.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(sign), Buffer.from(expected))
  ) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload?.steamId || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
