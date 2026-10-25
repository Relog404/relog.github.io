/* CS2 Panel — клиентская логика (ванильный JS, без сборки) */

const state = {
  user: null,
  config: null,
  servers: [],
  serverId: null,
  status: null,
  draft: [],
  page: 1,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

/* --------------------------------- utils -------------------------------- */

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: options.body ? { 'Content-Type': 'application/json' } : {},
    ...options,
  });
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) {
    const error = new Error(data?.error || `HTTP ${response.status}`);
    error.code = data?.code;
    error.needConfirm = data?.needConfirm;
    error.payload = data;
    throw error;
  }
  return data;
}

function toast(message, kind = '') {
  const el = $('#toast');
  el.textContent = message;
  el.className = `toast ${kind}`;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 3200);
}

const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* --------------------------------- auth --------------------------------- */

async function loadSession() {
  const { user } = await api('/api/session');
  state.user = user;
  renderAuth();
}

function renderAuth() {
  const box = $('#authBox');
  if (!state.user) {
    box.innerHTML = `<a class="btn" href="/auth/steam">Войти через Steam</a>`;
  } else {
    box.innerHTML = `
      ${state.user.avatar ? `<img src="${escapeHtml(state.user.avatar)}" alt="">` : ''}
      <span class="auth-name">${escapeHtml(state.user.name || state.user.steamId)}</span>
      ${state.user.isAdmin ? '<span class="badge admin">admin</span>' : '<span class="badge">player</span>'}
      <button class="btn btn-ghost btn-sm" id="logoutBtn">выйти</button>`;
    $('#logoutBtn').onclick = async () => {
      await api('/api/logout', { method: 'POST' });
      state.user = null;
      renderAuth();
      renderLoadouts();
      toast('Вы вышли из панели');
    };
  }
  $$('.admin-only').forEach((el) => { el.hidden = !state.user?.isAdmin; });
  $('#draftHint').textContent = state.user
    ? `Сборка сохранится за SteamID ${state.user.steamId}`
    : 'Войдите через Steam, чтобы сохранять сборки.';
}

/* -------------------------------- config -------------------------------- */

async function loadConfig() {
  state.config = await api('/api/config');
  const rows = [
    ['Режим демо', state.config.demoMode ? 'включён' : 'выключен'],
    ['Steam Web API ключ', state.config.steamApiKey ? 'задан' : 'не задан'],
    ['Админы панели', state.config.admins.length ? state.config.admins.join(', ') : 'не заданы'],
    ['Управление серверами', state.config.allowServerManagement ? 'разрешено' : 'запрещено'],
    ['Базовый URL', state.config.baseUrl],
  ];
  $('#configState').innerHTML = rows
    .map(([key, value]) => `<li><span class="muted">${escapeHtml(key)}</span><span>${escapeHtml(String(value))}</span></li>`)
    .join('');
}

/* -------------------------------- servers ------------------------------- */

async function loadServers() {
  if (!state.user?.isAdmin) return;
  try {
    const { servers } = await api('/api/servers');
    state.servers = servers;
    if (!state.serverId || !servers.some((s) => s.id === state.serverId)) {
      state.serverId = servers[0]?.id || null;
    }
    $('#serverSelect').innerHTML = servers
      .map((s) => `<option value="${escapeHtml(s.id)}"${s.id === state.serverId ? ' selected' : ''}>${escapeHtml(s.name)} — ${escapeHtml(s.host)}:${s.gamePort}</option>`)
      .join('');
    $('#serverSelectWrap').hidden = servers.length < 2;
    renderServerList();
    refreshStatus();
  } catch (error) {
    $('#statusPill').className = 'pill pill-err';
    $('#statusPill').textContent = error.message;
  }
}

function renderServerList() {
  $('#serverList').innerHTML = state.servers.length
    ? state.servers
        .map(
          (s) => `<div class="loadout">
            <h3>${escapeHtml(s.name)}</h3>
            <div class="mono">${escapeHtml(s.host)}:${s.gamePort} · rcon ${s.rconPort} · ${s.hasPassword ? 'пароль задан' : 'без пароля'}${s.demo ? ' · демо' : ''}</div>
            <div class="loadout-foot" style="margin-top:10px">
              <button class="btn btn-ghost btn-sm" data-ping="${escapeHtml(s.id)}">проверить</button>
              ${s.readonly ? '' : `<button class="btn btn-ghost btn-sm btn-danger" data-del="${escapeHtml(s.id)}">удалить</button>`}
            </div>
          </div>`
        )
        .join('')
    : '<p class="empty">Серверов пока нет.</p>';

  $$('[data-del]').forEach((btn) => {
    btn.onclick = async () => {
      await api(`/api/servers/${btn.dataset.del}`, { method: 'DELETE' });
      toast('Сервер удалён', 'ok');
      loadServers();
    };
  });
  $$('[data-ping]').forEach((btn) => {
    btn.onclick = async () => {
      state.serverId = btn.dataset.ping;
      $('#serverSelect').value = state.serverId;
      await refreshStatus();
    };
  });
}

async function refreshStatus() {
  if (!state.user?.isAdmin) return;
  const pill = $('#statusPill');
  pill.className = 'pill pill-warn';
  pill.textContent = 'обновляю…';
  try {
    const data = await api(`/api/status?serverId=${encodeURIComponent(state.serverId || '')}`);
    state.status = data;
    pill.className = 'pill pill-ok';
    pill.textContent = data.demo
      ? 'демо-данные (реальный сервер не подключён)'
      : `онлайн · ${data.info.hostname || data.server.host}`;

    const cards = [
      ['Карта', data.info.map || '—'],
      ['Игроки', `${data.info.players ?? data.players.length} / ${data.info.maxPlayers || '—'}`],
      ['Люди / боты', `${data.info.humans ?? '—'} / ${data.info.bots ?? '—'}`],
      ['Адрес', `${data.server.host}:${data.server.gamePort}`],
      ['Версия', data.info.version || '—'],
    ];
    $('#infoCards').innerHTML = cards
      .map(([label, value]) => `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(String(value))}</div></div>`)
      .join('');

    const rows = data.players.map((p) => {
      const avatar = p.profile?.avatar ? `<img src="${escapeHtml(p.profile.avatar)}" alt="">` : `<div class="ph">${escapeHtml((p.name || '?').slice(0, 1))}</div>`;
      const profileUrl = p.steamId64 ? `https://steamcommunity.com/profiles/${p.steamId64}` : null;
      return `<tr>
        <td>
          <div class="player">
            ${avatar}
            <div>${profileUrl ? `<a href="${profileUrl}" target="_blank" rel="noopener">${escapeHtml(p.name || '—')}</a>` : escapeHtml(p.name || '—')}
              ${p.isBot ? '<span class="badge">BOT</span>' : ''}</div>
          </div>
        </td>
        <td class="mono">${escapeHtml(p.steamId64 || '—')}</td>
        <td>${escapeHtml(p.ping)}</td>
        <td class="mono">${escapeHtml(p.connected)}</td>
        <td>${p.isBot ? '' : `<button class="btn btn-ghost btn-sm" data-kick="${escapeHtml(p.name)}">кик</button>`}</td>
      </tr>`;
    });
    $('#playersTable tbody').innerHTML = rows.join('') || '<tr><td colspan="5" class="empty">На сервере никого нет</td></tr>';

    $$('[data-kick]').forEach((btn) => {
      btn.onclick = () => doAction('kick', { name: btn.dataset.kick });
    });
  } catch (error) {
    state.status = null;
    pill.className = 'pill pill-err';
    pill.textContent = `сервер недоступен: ${error.message}`;
    $('#infoCards').innerHTML = '';
    $('#playersTable tbody').innerHTML = '<tr><td colspan="5" class="empty">Нет данных</td></tr>';
  }
}

async function doAction(action, payload = {}, confirmNeeded = false) {
  try {
    const data = await api('/api/action', {
      method: 'POST',
      body: JSON.stringify({ serverId: state.serverId, action, payload, confirm: confirmNeeded }),
    });
    logConsole(data.command, data.output);
    if (data.demo) toast('Демо-режим: команда не ушла на сервер');
    setTimeout(refreshStatus, 800);
  } catch (error) {
    toast(error.message, 'err');
  }
}

function logConsole(command, output) {
  const box = $('#consoleOut');
  box.textContent += `> ${command}\n${output ? `${output}\n` : ''}`;
  box.scrollTop = box.scrollHeight;
}

/* -------------------------------- console ------------------------------- */

async function runConsole(command, confirmNeeded = false) {
  try {
    const data = await api('/api/console', {
      method: 'POST',
      body: JSON.stringify({ serverId: state.serverId, command, confirm: confirmNeeded }),
    });
    logConsole(command, data.output);
    $('#consoleInput').value = '';
  } catch (error) {
    if (error.needConfirm && confirm(`${error.message}\n\nВыполнить «${command}»?`)) {
      return runConsole(command, true);
    }
    toast(error.message, 'err');
    logConsole(command, `ошибка: ${error.message}`);
  }
}

/* --------------------------------- skins -------------------------------- */

async function loadWeapons() {
  const { weapons } = await api('/api/skins/weapons');
  $('#skinWeapon').innerHTML =
    '<option value="">Всё оружие</option>' +
    weapons.map((w) => `<option value="${escapeHtml(w.weapon)}">${escapeHtml(w.weapon)} (${w.count})</option>`).join('');
}

async function loadSkins() {
  const params = new URLSearchParams({
    query: $('#skinQuery').value,
    weapon: $('#skinWeapon').value,
    rarity: $('#skinRarity').value,
    sort: $('#skinSort').value,
    page: String(state.page),
  });
  const data = await api(`/api/skins?${params.toString()}`);
  $('#skinGrid').innerHTML = data.items
    .map((skin) => {
      const inDraft = state.draft.some((d) => d.skinId === skin.id);
      const float = skin.float ? `износ ${skin.float[0]}–${skin.float[1]}` : 'износ —';
      return `<div class="skin ${inDraft ? 'in-draft' : ''}" data-rarity="${escapeHtml(skin.rarity)}" data-id="${escapeHtml(skin.id)}" data-weapon="${escapeHtml(skin.weapon)}" data-pattern="${escapeHtml(skin.pattern)}">
        <div class="weapon">${escapeHtml(skin.weapon)} · ${escapeHtml(skin.category)}</div>
        <div class="pattern">${escapeHtml(skin.pattern)}</div>
        <div class="meta"><span class="rarity">${escapeHtml(skin.rarity)}</span><span>${escapeHtml(float)}</span></div>
      </div>`;
    })
    .join('') || '<p class="empty">Ничего не найдено</p>';

  $('#pageLabel').textContent = `страница ${data.page} из ${data.pages} · найдено ${data.total}`;
  $('#prevPage').disabled = data.page <= 1;
  $('#nextPage').disabled = data.page >= data.pages;

  $$('.skin').forEach((card) => {
    card.onclick = () => {
      const entry = {
        skinId: card.dataset.id,
        weapon: card.dataset.weapon,
        pattern: card.dataset.pattern,
        float: null,
        statTrak: false,
      };
      const index = state.draft.findIndex((d) => d.skinId === entry.skinId);
      if (index >= 0) state.draft.splice(index, 1);
      else state.draft.push(entry);
      renderDraft();
      loadSkins();
    };
  });
}

function renderDraft() {
  const block = $('#draftBlock');
  block.hidden = state.draft.length === 0;
  $('#draftCount').textContent = `${state.draft.length} поз.`;
  $('#draftList').innerHTML = state.draft
    .map((entry, index) => `<li>${escapeHtml(entry.weapon)} — ${escapeHtml(entry.pattern)} <button data-index="${index}" title="убрать">×</button></li>`)
    .join('');
  $$('#draftList button').forEach((btn) => {
    btn.onclick = () => {
      state.draft.splice(Number(btn.dataset.index), 1);
      renderDraft();
      loadSkins();
    };
  });
}

/* -------------------------------- loadouts ------------------------------ */

async function renderLoadouts() {
  const mine = $('#myLoadouts');
  if (!state.user) {
    mine.innerHTML = '<p class="empty">Войдите через Steam, чтобы сохранять сборки.</p>';
  } else {
    try {
      const { loadouts } = await api('/api/loadout');
      mine.innerHTML = loadouts.length
        ? loadouts.map((l) => loadoutCard(l, true)).join('')
        : '<p class="empty">Сборок пока нет — соберите их на вкладке «Скины».</p>';
      $$('[data-loadout-del]').forEach((btn) => {
        btn.onclick = async () => {
          await api(`/api/loadout/${btn.dataset.loadoutDel}`, { method: 'DELETE' });
          toast('Сборка удалена', 'ok');
          renderLoadouts();
        };
      });
    } catch (error) {
      mine.innerHTML = `<p class="empty">${escapeHtml(error.message)}</p>`;
    }
  }

  const { loadouts: publicOnes } = await api('/api/loadout/public');
  $('#publicLoadouts').innerHTML = publicOnes.length
    ? publicOnes.map((l) => loadoutCard(l, false)).join('')
    : '<p class="empty">Пока никто не опубликовал сборку.</p>';
}

function loadoutCard(loadout, mine) {
  const items = loadout.entries
    .map((e) => `<li>${escapeHtml(e.weapon)} — ${escapeHtml(e.pattern)}${e.statTrak ? ' (ST)' : ''}</li>`)
    .join('');
  return `<div class="loadout">
    <h3>${escapeHtml(loadout.name)}${loadout.public ? ' <span class="badge">публичная</span>' : ''}</h3>
    <div class="mono">${escapeHtml(loadout.steamId || '')} · обновлено ${new Date(loadout.updatedAt).toLocaleString('ru-RU')}</div>
    <ul>${items || '<li class="muted">пусто</li>'}</ul>
    <div class="loadout-foot">
      <a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="https://steamcommunity.com/profiles/${escapeHtml(loadout.steamId)}">профиль Steam</a>
      ${mine ? `<button class="btn btn-ghost btn-sm btn-danger" data-loadout-del="${escapeHtml(loadout.id)}">удалить</button>` : ''}
    </div>
  </div>`;
}

/* --------------------------------- init --------------------------------- */

function bindUi() {
  $$('.tab').forEach((tab) => {
    tab.onclick = () => {
      $$('.tab').forEach((t) => t.classList.toggle('active', t === tab));
      $$('.panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${tab.dataset.tab}`));
    };
  });

  $('#refreshBtn').onclick = refreshStatus;
  $('#serverSelect').onchange = (event) => {
    state.serverId = event.target.value;
    refreshStatus();
  };

  $$('[data-action]').forEach((btn) => {
    btn.onclick = () => doAction(btn.dataset.action);
  });

  $('#mapBtn').onclick = () => doAction('map', { map: $('#mapSelect').value });
  $('#sayBtn').onclick = () => {
    const message = $('#sayInput').value.trim();
    if (!message) return toast('Введите сообщение', 'err');
    doAction('say', { message });
    $('#sayInput').value = '';
  };
  $('#botsBtn').onclick = () => doAction('bots', { count: $('#botsInput').value });
  $('#cfgBtn').onclick = () => {
    const cfg = $('#cfgInput').value.trim();
    if (!cfg) return toast('Введите имя конфига', 'err');
    doAction('settings', { cfg });
  };

  $('#consoleForm').onsubmit = (event) => {
    event.preventDefault();
    const command = $('#consoleInput').value.trim();
    if (command) runConsole(command);
  };

  const reloadSkins = () => { state.page = 1; loadSkins(); };
  $('#skinQuery').oninput = reloadSkins;
  $('#skinWeapon').onchange = reloadSkins;
  $('#skinRarity').onchange = reloadSkins;
  $('#skinSort').onchange = reloadSkins;
  $('#prevPage').onclick = () => { state.page = Math.max(1, state.page - 1); loadSkins(); };
  $('#nextPage').onclick = () => { state.page += 1; loadSkins(); };

  $('#saveLoadout').onclick = async () => {
    if (!state.user) return toast('Сначала войдите через Steam', 'err');
    const name = $('#loadoutName').value.trim() || 'Моя сборка';
    try {
      await api('/api/loadout', {
        method: 'POST',
        body: JSON.stringify({ name, entries: state.draft, isPublic: $('#loadoutPublic').checked }),
      });
      toast('Сборка сохранена', 'ok');
      state.draft = [];
      $('#loadoutName').value = '';
      renderDraft();
      loadSkins();
      renderLoadouts();
    } catch (error) {
      toast(error.message, 'err');
    }
  };

  $('#serverForm').onsubmit = async (event) => {
    event.preventDefault();
    try {
      await api('/api/servers', {
        method: 'POST',
        body: JSON.stringify({
          name: $('#srvName').value,
          host: $('#srvHost').value,
          gamePort: $('#srvGamePort').value,
          rconPort: $('#srvRconPort').value,
          password: $('#srvPassword').value,
        }),
      });
      toast('Сервер добавлен', 'ok');
      $('#serverForm').reset();
      loadServers();
    } catch (error) {
      toast(error.message, 'err');
    }
  };
}

(async function main() {
  bindUi();
  try {
    await loadSession();
    await loadConfig();
    await loadWeapons();
    await loadSkins();
    await loadServers();
    await renderLoadouts();
  } catch (error) {
    toast(error.message, 'err');
  }
  setInterval(() => { if (state.user?.isAdmin) refreshStatus(); }, 15000);
})();
