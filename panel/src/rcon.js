import net from 'node:net';

/**
 * Минималистичный клиент Source RCON (протокол srcds, работает и с CS2).
 * Без внешних зависимостей: пакет = [int32 size][int32 id][int32 type][body\0]\0
 */

const SERVERDATA_RESPONSE_VALUE = 0;
const SERVERDATA_AUTH_RESPONSE = 2;
const SERVERDATA_EXECCOMMAND = 2;
const SERVERDATA_AUTH = 3;

function buildPacket(id, type, body) {
  const payload = Buffer.concat([
    Buffer.from(body, 'utf8'),
    Buffer.alloc(2), // завершающий NUL + пустая строка
  ]);
  const head = Buffer.alloc(12);
  head.writeInt32LE(payload.length + 8, 0); // size считается без поля size
  head.writeInt32LE(id, 4);
  head.writeInt32LE(type, 8);
  return Buffer.concat([head, payload]);
}

/** Разбирает накопленный буфер на пакеты, возвращает [{id, type, body}, ...] и остаток. */
function parsePackets(buffer) {
  const packets = [];
  let rest = buffer;
  for (;;) {
    if (rest.length < 4) break;
    const size = rest.readInt32LE(0);
    if (!Number.isFinite(size) || size < 10 || size > 64 * 1024 * 1024) {
      rest = Buffer.alloc(0); // битый поток — выбрасываем
      break;
    }
    if (rest.length < 4 + size) break;
    const body = rest.subarray(12, 4 + size);
    packets.push({
      id: rest.readInt32LE(4),
      type: rest.readInt32LE(8),
      body: body.subarray(0, Math.max(0, body.length - 2)).toString('utf8'),
    });
    rest = rest.subarray(4 + size);
  }
  return { packets, rest };
}

export class RconError extends Error {
  constructor(message, code = 'rcon_error') {
    super(message);
    this.name = 'RconError';
    this.code = code;
  }
}

/**
 * Выполняет одну RCON-команду.
 * @returns {Promise<string>} ответ сервера
 */
export function execRcon({ host, port, password, command, timeout = 6000 }) {
  return new Promise((resolve, reject) => {
    if (!host || !port || !password) {
      reject(new RconError('Не указан host/port/password для RCON', 'rcon_not_configured'));
      return;
    }

    const socket = new net.Socket();
    let settled = false;
    let buffer = Buffer.alloc(0);
    let authed = false;
    let output = [];
    let debounce = null;

    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(debounce);
      clearTimeout(hardTimer);
      socket.destroy();
      err ? reject(err) : resolve(value);
    };

    const hardTimer = setTimeout(() => finish(new RconError('Таймаут RCON', 'rcon_timeout')), timeout);

    socket.setTimeout(timeout);
    socket.on('timeout', () => finish(new RconError('Таймаут соединения RCON', 'rcon_timeout')));
    socket.on('error', (err) => finish(new RconError(`Ошибка соединения: ${err.message}`, 'rcon_connect')));

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const { packets, rest } = parsePackets(buffer);
      buffer = rest;

      for (const packet of packets) {
        if (!authed) {
          if (packet.type === SERVERDATA_RESPONSE_VALUE) continue; // приветствие, игнорируем
          if (packet.type === SERVERDATA_AUTH_RESPONSE) {
            if (packet.id === -1) {
              finish(new RconError('Неверный RCON-пароль', 'rcon_auth'));
              return;
            }
            authed = true;
            socket.write(buildPacket(2, SERVERDATA_EXECCOMMAND, command));
            // Страховка: если ответ пустой, завершимся по дебаунсу.
            debounce = setTimeout(() => finish(null, output.join('')), 900);
            continue;
          }
          continue;
        }

        clearTimeout(debounce);
        if (packet.type === SERVERDATA_RESPONSE_VALUE && packet.body === '' && output.length >= 0) {
          finish(null, output.join(''));
          return;
        }
        if (packet.body !== '') output.push(packet.body);
        debounce = setTimeout(() => finish(null, output.join('')), 700);
      }
    });

    socket.connect(port, host, () => {
      socket.write(buildPacket(1, SERVERDATA_AUTH, password));
    });
  });
}

/* --------------------------- разбор вывода status ------------------------ */

// Формат CS2: `# [индекс] userid "ник" [U:1:accountid] время пинг лосс состояние ...`
const STATUS_RE =
  /^#\s*(?:(?:\d+\s+){0,2})"?(?<name>[^"]*?)"?\s+(?<steamid>\[U:1:\d+\]|STEAM_[0-5]:[01]:\d+|BOT)\s+(?<connected>\d+:\d+(?::\d+)?)\s+(?<ping>-?\d+)\s+(?<loss>\d+)\s+(?<state>\w+)/i;

const STEAM_ID64_BASE = 76561197960265728n;

export function steamId3To64(accountId) {
  return (STEAM_ID64_BASE + BigInt(accountId)).toString();
}

export function steamIdLegacyTo64(legacy) {
  const m = /^STEAM_([0-5]):([01]):(\d+)$/.exec(legacy);
  if (!m) return null;
  const [, , y, z] = m;
  return (STEAM_ID64_BASE + BigInt(z) * 2n + BigInt(y)).toString();
}

export function parseStatus(raw) {
  const lines = String(raw || '').split(/\r?\n/);
  const info = { hostname: '', version: '', map: '', players: 0, humans: 0, bots: 0, maxPlayers: 0, ip: '' };
  const players = [];

  for (const line of lines) {
    const l = line.trim();

    let m = /^hostname\s*:\s*(.*)$/i.exec(l);
    if (m) { info.hostname = m[1].trim(); continue; }

    m = /^version\s*:\s*(.*)$/i.exec(l);
    if (m) { info.version = m[1].trim(); continue; }

    m = /^map\s*:\s*(.*)$/i.exec(l);
    if (m) { info.map = m[1].trim(); continue; }

    m = /^players\s*:\s*(\d+)\s+humans?,\s*(\d+)\s+bots?\s*\((\d+)\s+max\)/i.exec(l);
    if (m) {
      info.humans = Number(m[1]);
      info.bots = Number(m[2]);
      info.maxPlayers = Number(m[3]);
      info.players = info.humans + info.bots;
      continue;
    }

    m = /^udp\/ip\s*:\s*([^\s]+)/i.exec(l);
    if (m) { info.ip = m[1].trim(); continue; }

    const p = STATUS_RE.exec(l);
    if (p && p.groups) {
      const { name, steamid, connected, ping, state } = p.groups;
      let steamId64 = null;
      if (steamid.startsWith('[U:1:')) {
        steamId64 = steamId3To64(steamid.slice(5, -1));
      } else if (steamid.startsWith('STEAM_')) {
        steamId64 = steamIdLegacyTo64(steamid);
      }
      const isBot = steamid === 'BOT';
      players.push({
        name: name.trim() || (isBot ? 'BOT' : ''),
        steamId64,
        connected,
        ping: Number(ping),
        state,
        isBot: steamid === 'BOT',
      });
    }
  }

  return { info, players };
}

/* ------------------------------ демо-режим ------------------------------- */

export const DEMO_STATUS = `hostname: Relog CS2 #1 (демо)
version : 2.0.0.0/1234 1234 secure
map     : de_mirage
players : 3 humans, 2 bots (10 max)
udp/ip  : 127.0.0.1:27015
# userid name uniqueid connected ping loss state
# 2 1 "Relog" [U:1:123456789] 01:23 24 0 active
# 3 2 "Gabe Follower" [U:1:987654321] 00:47 55 0 active
# 4 3 "Vanilla Enjoyer" [U:1:555000111] 00:12 12 0 active
# 5 4 "BOT Rylan" BOT 00:05 0 0 active
# 6 5 "BOT Kyle" BOT 00:05 0 0 active`;

export const demoStatus = () => parseStatus(DEMO_STATUS);
