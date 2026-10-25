/* CS2 Panel — клиентская логика (ванильный JS, без сборки) */

const state = {
  user: null,
  config: null,
  servers: [],
  serverId: null,
  status: null,
  draft: [],
  page: 1,
  targetPage: 1,
  econ: null,
  selection: [], // uid предметов, поставленных на апгрейд
  target: null,  // предмет-цель из каталога
  chance: 0,
  spinning: false,
  equip: null,
};

const CELL_W = 132;
const CELL_GAP = 10;
const CELL_STEP = CELL_W + CELL_GAP;

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

const coins = (value) => `${Number(value).toLocaleString('ru-RU')} 🪙`;

const CATEGORY_ICON = {
  'Ножи': '🔪', 'Перчатки': '🧤', 'Винтовки': '🔫', 'Пистолеты': '🔫',
  'Снайперские': '🎯', 'Пистолеты-пулемёты': '🔫', 'Дробовики': '💥', 'Стикеры': '⭐',
  'Медали': '🏅', 'Значки': '📌', 'Кейсы': '📦', 'Музыка': '🎵', 'Патчи': '🧩', 'Агенты': '🕵️',
};

function itemCard(item, { mode = 'shop', selected = false, inDraft = false } = {}) {
  const icon = CATEGORY_ICON[item.category] || '🎁';
  const footer = {
    shop: `<span class="price">${coins(item.price)}</span><button class="btn btn-sm btn-buy" data-buy="${escapeHtml(item.id)}">купить</button>`,
    target: `<span class="price">${coins(item.price)}</span><button class="btn btn-sm" data-target="${escapeHtml(item.id)}">цель</button>`,
    vault: `<span class="price">${coins(item.price)}</span><button class="btn btn-sm btn-ghost" data-sell="${escapeHtml(item.uid)}">продать</button>`,
  }[mode];

  return `<div class="skin ${selected ? 'selected' : ''} ${inDraft ? 'in-draft' : ''}" data-rarity="${escapeHtml(item.rarity)}" data-id="${escapeHtml(item.id)}">
    <div class="skin-art"><span>${icon}</span></div>
    <div class="weapon">${escapeHtml(item.weapon)} · ${escapeHtml(item.category)}</div>
    <div class="pattern">${escapeHtml(item.pattern)}</div>
    <div class="meta"><span class="rarity">${escapeHtml(item.rarity)}</span><span>${item.float ? `износ ${item.float[0]}–${item.float[1]}` : ''}</span></div>
    <div class="skin-foot">${footer}</div>
  </div>`;
}

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
      state.econ = null;
      renderAuth();
      renderWallet();
      renderVault();
      renderLoadouts();
      toast('Вы вышли из панели');
    };
  }
  $$('.admin-only').forEach((el) => { el.hidden = !state.user?.isAdmin; });
  $('#draftHint').textContent = state.user
    ? `Сборка сохранится за SteamID ${state.user.steamId}`
    : 'Войдите через Steam, чтобы сохранять сборки.';
  renderWallet();
}

/* -------------------------------- config -------------------------------- */

async function loadConfig() {
  state.config = await api('/api/config');
  const economy = state.config.economy || {};
  const rows = [
    ['Режим демо', state.config.demoMode ? 'включён' : 'выключен'],
    ['Steam Web API ключ', state.config.steamApiKey ? 'задан' : 'не задан'],
    ['Админы панели', state.config.admins.length ? state.config.admins.join(', ') : 'не заданы'],
    ['Экономика', 'виртуальные монеты, без реальных ставок'],
    ['Стартовый баланс', `${economy.startCoins ?? '—'} 🪙`],
    ['Ежедневный бонус', `${economy.dailyCoins ?? '—'} 🪙`],
    ['Коэффициент апгрейда', economy.edge ?? '—'],
    ['Возврат при продаже', economy.sellRate ? `${Math.round(economy.sellRate * 100)}%` : '—'],
    ['Управление серверами', state.config.allowServerManagement ? 'разрешено' : 'запрещено'],
    ['Базовый URL', state.config.baseUrl],
  ];
  $('#configState').innerHTML = rows
    .map(([key, value]) => `<li><span class="muted">${escapeHtml(key)}</span><span>${escapeHtml(String(value))}</span></li>`)
    .join('');
}

/* ------------------------------- экономика ------------------------------ */

async function loadEconomy() {
  if (!state.user) {
    state.econ = null;
    renderWallet();
    renderVault();
    renderUpgradePicker();
    return;
  }
  try {
    state.econ = await api('/api/economy/state');
  } catch (error) {
    state.econ = null;
  }
  renderWallet();
  renderVault();
  renderUpgradePicker();
}

function renderWallet() {
  const wallet = $('#wallet');
  wallet.hidden = !state.user;
  if (!state.user) return;
  $('#coinBalance').textContent = Number(state.econ?.coins ?? 0).toLocaleString('ru-RU');
  const daily = state.econ?.daily;
  const btn = $('#dailyBtn');
  btn.disabled = !daily?.available;
  btn.textContent = daily?.available ? `+${daily.amount}` : 'получено';
}

function renderVault() {
  const grid = $('#vaultGrid');
  const cards = $('#vaultCards');
  if (!state.user) {
    grid.innerHTML = '<p class="empty">Войдите через Steam, чтобы увидеть свои предметы.</p>';
    cards.innerHTML = '';
    $('#vaultHint').textContent = '';
    return;
  }
  if (!state.econ) {
    grid.innerHTML = '<p class="empty">Экономика недоступна.</p>';
    return;
  }

  const items = state.econ.items || [];
  const value = items.reduce((sum, i) => sum + i.price, 0);
  cards.innerHTML = [
    ['Баланс', coins(state.econ.coins)],
    ['Предметов', items.length],
    ['Стоимость хранилища', coins(value)],
    ['Розыгрышей', state.econ.stats?.upgrades ?? 0],
    ['Побед', state.econ.stats?.wins ?? 0],
    ['Лучший выигрыш', coins(state.econ.stats?.bestWin ?? 0)],
  ]
    .map(([label, value2]) => `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value">${value2}</div></div>`)
    .join('');

  $('#vaultHint').textContent = items.length ? 'нажмите «в апгрейд», чтобы поставить предмет на кон' : '';
  grid.innerHTML = items.length
    ? items
        .slice()
        .sort((a, b) => b.price - a.price)
        .map((entry) => itemCard({ ...entry.item, price: entry.price, uid: entry.uid }, { mode: 'vault' }))
        .join('')
    : '<p class="empty">Хранилище пусто — купите что-нибудь в каталоге.</p>';

  $$('[data-sell]').forEach((btn) => {
    btn.onclick = async (event) => {
      event.stopPropagation();
      try {
        const data = await api('/api/economy/sell', { method: 'POST', body: JSON.stringify({ uid: btn.dataset.sell }) });
        toast(`Продано за ${coins(data.refund)}`, 'ok');
        await loadEconomy();
      } catch (error) {
        toast(error.message, 'err');
      }
    };
  });

  $$('#vaultGrid .skin').forEach((card) => {
    card.onclick = (event) => {
      if (event.target.closest('button')) return;
      const uid = card.querySelector('[data-sell]')?.dataset.sell;
      if (!uid) return;
      state.selection = state.selection.includes(uid) ? state.selection.filter((u) => u !== uid) : [...state.selection, uid];
      renderUpgradePicker();
      updateChance();
      switchTab('upgrade');
    };
  });
}

/* --------------------------------- магазин ------------------------------ */

async function loadCategories() {
  const { categories } = await api('/api/catalog/categories');
  const options = categories.map((c) => `<option value="${escapeHtml(c.category)}">${escapeHtml(c.category)} (${c.count})</option>`).join('');
  $('#skinCategory').innerHTML = `<option value="">Все категории</option>${options}`;
  $('#targetCategory').innerHTML = `<option value="">Все категории</option>${options}`;
}

async function loadWeapons() {
  const { weapons } = await api('/api/skins/weapons');
  $('#skinWeapon').innerHTML =
    '<option value="">Всё оружие</option>' +
    weapons.map((w) => `<option value="${escapeHtml(w.weapon)}">${escapeHtml(w.weapon)} (${w.count})</option>`).join('');
}

async function loadCatalog() {
  const params = new URLSearchParams({
    query: $('#skinQuery').value,
    category: $('#skinCategory').value,
    weapon: $('#skinWeapon').value,
    rarity: $('#skinRarity').value,
    sort: $('#skinSort').value,
    page: String(state.page),
  });
  const data = await api(`/api/catalog?${params.toString()}`);
  $('#skinGrid').innerHTML = data.items.map((item) => itemCard(item, { inDraft: state.draft.some((d) => d.skinId === item.id) })).join('')
    || '<p class="empty">Ничего не найдено</p>';

  $('#pageLabel').textContent = `страница ${data.page} из ${data.pages} · найдено ${data.total}`;
  $('#prevPage').disabled = data.page <= 1;
  $('#nextPage').disabled = data.page >= data.pages;

  $$('#skinGrid .skin').forEach((card) => {
    card.onclick = (event) => {
      if (event.target.closest('button')) return;
      const item = { skinId: card.dataset.id, weapon: card.querySelector('.weapon').textContent.split(' · ')[0], pattern: card.querySelector('.pattern').textContent, float: null, statTrak: false };
      const index = state.draft.findIndex((d) => d.skinId === item.skinId);
      if (index >= 0) state.draft.splice(index, 1);
      else state.draft.push(item);
      renderDraft();
      loadCatalog();
    };
  });

  $$('[data-buy]').forEach((btn) => {
    btn.onclick = async (event) => {
      event.stopPropagation();
      if (!state.user) return toast('Войдите через Steam, чтобы покупать', 'err');
      try {
        const data = await api('/api/economy/buy', { method: 'POST', body: JSON.stringify({ itemId: btn.dataset.buy }) });
        toast(`Куплено: ${data.item.pattern} за ${coins(data.item.price)}`, 'ok');
        await loadEconomy();
      } catch (error) {
        toast(error.message, 'err');
      }
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
      loadCatalog();
    };
  });
}

/* -------------------------------- апгрейд ------------------------------- */

function renderUpgradePicker() {
  const box = $('#upgradePicker');
  const items = state.econ?.items || [];
  if (!state.user) {
    box.innerHTML = '<p class="empty">Войдите через Steam, чтобы играть.</p>';
    $('#stakeLabel').textContent = '';
    return;
  }
  if (!items.length) {
    box.innerHTML = '<p class="empty">Купите предметы в каталоге — ими можно играть в апгрейд.</p>';
    $('#stakeLabel').textContent = '';
    return;
  }
  state.selection = state.selection.filter((uid) => items.some((i) => i.uid === uid));
  const stake = items.filter((i) => state.selection.includes(i.uid)).reduce((sum, i) => sum + i.price, 0);
  $('#stakeLabel').textContent = `выбрано ${state.selection.length} на ${coins(stake)}`;

  box.innerHTML = items
    .slice()
    .sort((a, b) => b.price - a.price)
    .map((entry) => {
      const checked = state.selection.includes(entry.uid) ? 'checked' : '';
      return `<label class="pick ${checked ? 'picked' : ''}" data-rarity="${escapeHtml(entry.item.rarity)}">
        <input type="checkbox" data-pick="${escapeHtml(entry.uid)}" ${checked} />
        <span class="pick-icon">${CATEGORY_ICON[entry.item.category] || '🎁'}</span>
        <span class="pick-name">${escapeHtml(entry.item.weapon)} — ${escapeHtml(entry.item.pattern)}</span>
        <span class="price">${coins(entry.price)}</span>
      </label>`;
    })
    .join('');

  $$('[data-pick]').forEach((input) => {
    input.onchange = () => {
      const uid = input.dataset.pick;
      state.selection = input.checked ? [...state.selection, uid] : state.selection.filter((u) => u !== uid);
      renderUpgradePicker();
      updateChance();
    };
  });
}

async function loadTargets() {
  const params = new URLSearchParams({
    query: $('#targetQuery').value,
    category: $('#targetCategory').value,
    rarity: $('#targetRarity').value,
    sort: $('#targetSort').value,
    page: String(state.targetPage),
    pageSize: '12',
  });
  const data = await api(`/api/catalog?${params.toString()}`);
  $('#targetGrid').innerHTML = data.items
    .map((item) => itemCard(item, { mode: 'target', selected: state.target?.id === item.id }))
    .join('') || '<p class="empty">Ничего не найдено</p>';

  $('#targetPageLabel').textContent = `страница ${data.page} из ${data.pages}`;
  $('#targetPrev').disabled = data.page <= 1;
  $('#targetNext').disabled = data.page >= data.pages;

  $$('[data-target]').forEach((btn) => {
    btn.onclick = async (event) => {
      event.stopPropagation();
      const { items } = await api(`/api/catalog?query=${encodeURIComponent(btn.dataset.target)}&pageSize=1`);
      const found = items.find((i) => i.id === btn.dataset.target);
      if (!found) return toast('Предмет не найден', 'err');
      state.target = found;
      loadTargets();
      updateChance();
    };
  });
}

async function updateChance() {
  const fill = $('#chanceFill');
  const summary = $('#upgradeSummary');
  const spin = $('#spinBtn');

  if (!state.target) {
    summary.innerHTML = '<span class="muted">Выберите цель апгрейда ↑</span>';
    fill.style.width = '0%';
    $('#chanceText').textContent = '0%';
    spin.disabled = true;
    return;
  }

  const targetPrice = state.target.price;
  const stake = (state.econ?.items || []).filter((i) => state.selection.includes(i.uid)).reduce((sum, i) => sum + i.price, 0);
  const rough = stake ? Math.min(95, Math.max(1, Math.round((stake / targetPrice) * 100 * (state.config?.economy?.edge ?? 0.95)))) : 0;

  if (!state.selection.length) {
    summary.innerHTML = `<span class="muted">Цель: <b>${escapeHtml(state.target.pattern)}</b> · ${coins(targetPrice)} · поставьте предметы слева</span>`;
    fill.style.width = '0%';
    $('#chanceText').textContent = '0%';
    spin.disabled = true;
    return;
  }

  try {
    const data = await api('/api/upgrade/preview', {
      method: 'POST',
      body: JSON.stringify({ uids: state.selection, targetItemId: state.target.id }),
    });
    state.chance = data.chance;
    const percent = data.chance * 100;
    fill.style.width = `${Math.min(100, percent)}%`;
    $('#chanceText').textContent = `${percent.toFixed(percent < 10 ? 2 : 1)}%`;
    const lossNote = data.stake > data.payout ? ' <span class="warn">ставка дороже цели</span>' : '';
    summary.innerHTML = `Ставка <b>${coins(data.stake)}</b> → цель <b>${escapeHtml(data.target.pattern)}</b> (${coins(data.payout)})${lossNote}`;
    spin.disabled = state.spinning || data.stake <= 0;
  } catch (error) {
    state.chance = rough / 100;
    $('#chanceText').textContent = `${rough}%`;
    summary.innerHTML = `<span class="muted">${escapeHtml(error.message)}</span>`;
    spin.disabled = true;
  }
}

function buildReel(cells, winIndex, loops = 3) {
  const track = $('#reelTrack');
  const strip = [];
  for (let l = 0; l < loops + 1; l += 1) strip.push(...cells);
  track.innerHTML = strip
    .map((cell) => `<div class="reel-cell ${cell.isWin ? 'win' : ''}" data-rarity="${escapeHtml(cell.rarity)}">
        <div class="reel-art">${CATEGORY_ICON[cell.category] || '🎁'}</div>
        <div class="reel-name">${escapeHtml(cell.pattern)}</div>
        <div class="reel-price">${coins(cell.price)}</div>
      </div>`)
    .join('');

  const viewportW = $('#reelViewport').clientWidth || 800;
  const finalIndex = loops * cells.length + winIndex;
  const offset = finalIndex * CELL_STEP - (viewportW / 2 - CELL_W / 2) + (Math.random() * 60 - 30);

  track.style.transition = 'none';
  track.style.transform = 'translateX(0px)';
  requestAnimationFrame(() => {
    track.style.transition = 'transform 5.5s cubic-bezier(0.1, 0.72, 0.02, 1)';
    track.style.transform = `translateX(${-offset}px)`;
  });
}

async function spin() {
  if (state.spinning || !state.target || !state.selection.length) return;
  state.spinning = true;
  $('#spinBtn').disabled = true;
  $('#resultBox').hidden = true;

  try {
    const data = await api('/api/upgrade/play', {
      method: 'POST',
      body: JSON.stringify({ uids: state.selection, targetItemId: state.target.id }),
    });
    buildReel(data.reel, data.winIndex);
    state.selection = [];

    setTimeout(async () => {
      $('#resultBox').hidden = false;
      $('#resultBox').className = `result ${data.win ? 'win' : 'lose'}`;
      $('#resultBox').innerHTML = `
        <div class="result-title">${data.win ? '🎉 Апгрейд прошёл!' : '😢 Не повезло'}</div>
        <div class="result-body">
          Цель: <b>${escapeHtml(data.target.pattern)}</b> · шанс ${(data.chance * 100).toFixed(2)}% ·
          ставка ${coins(data.stake)} · roll ${data.roll.toFixed(6)}
          ${data.win ? `→ выигрыш ${coins(data.payout)}` : `→ ставка ${coins(data.stake)} сгорела`}
        </div>
        <button class="btn btn-sm" id="againBtn">ещё раз</button>`;
      $('#againBtn').onclick = () => { $('#resultBox').hidden = true; };

      $('#fairBox').innerHTML = [
        ['serverSeed (hash)', data.fair.serverSeedHash],
        ['clientSeed', data.fair.clientSeed],
        ['nonce', data.fair.nonce],
        ['roll', data.roll.toFixed(8)],
      ]
        .map(([k, v]) => `<li><span class="muted">${escapeHtml(k)}</span><span class="mono">${escapeHtml(String(v))}</span></li>`)
        .join('');

      await loadEconomy();
      loadHistory();
      if (state.user?.isAdmin) loadAdmin();
      state.spinning = false;
      updateChance();
    }, 5700);
  } catch (error) {
    state.spinning = false;
    toast(error.message, 'err');
    updateChance();
  }
}

async function loadHistory() {
  try {
    const { history } = await api('/api/upgrade/history');
    $('#historyFeed').innerHTML = history.length
      ? history
          .map((h) => `<div class="hist-row ${h.win ? 'win' : 'lose'}">
              <span class="mono">${new Date(h.at).toLocaleTimeString('ru-RU')}</span>
              <span class="hist-name">${CATEGORY_ICON[h.target.category] || '🎁'} ${escapeHtml(h.target.pattern)}</span>
              <span class="muted">${(h.chance * 100).toFixed(1)}%</span>
              <span>${coins(h.stake)} → ${h.win ? coins(h.payout) : '0'}</span>
              <span class="hist-badge">${h.win ? 'WIN' : 'LOSE'}</span>
            </div>`)
          .join('')
      : '<p class="empty">Розыгрышей пока не было.</p>';
  } catch {
    $('#historyFeed').innerHTML = '';
  }
}

/* ------------------------------- экипировка ----------------------------- */

async function loadEquip() {
  if (!state.user) {
    $('#equipGrid').innerHTML = '<p class="empty">Войдите через Steam, чтобы надеть скины.</p>';
    $('#equipHint').textContent = '';
    return;
  }
  try {
    const { slots } = await api('/api/equip');
    state.equip = slots;
    renderEquip();
  } catch (error) {
    $('#equipGrid').innerHTML = `<p class="empty">${escapeHtml(error.message)}</p>`;
  }
}

function renderEquip() {
  const slots = state.equip || [];
  const used = slots.filter((s) => s.equipped).length;
  $('#equipHint').textContent = `Надето слотов: ${used} из ${slots.length}. Нет нужного предмета — купите его в каталоге.`;

  $('#equipGrid').innerHTML = slots
    .map((slot) => {
      const active = slot.equipped;
      const item = active?.item;
      const options = slot.options
        .map((o) => `<option value="${escapeHtml(o.uid)}"${active?.uid === o.uid ? ' selected' : ''}>${escapeHtml(o.item.pattern)} · ${o.item.price} 🪙</option>`)
        .join('');
      const [min, max] = item?.float || [0, 1];
      return `<div class="equip-card" data-slot-card="${escapeHtml(slot.key)}">
        <div class="equip-head">
          <span class="equip-label">${escapeHtml(slot.label)}</span>
          <span class="badge">${escapeHtml(slot.kind === 'weapon' ? 'оружие' : slot.kind)}</span>
        </div>
        <div class="equip-preview" data-rarity="${escapeHtml(item?.rarity || 'consumer')}">
          ${item?.image ? `<img src="${escapeHtml(item.image)}" alt="" loading="lazy">` : '<div class="ph">—</div>'}
        </div>
        <select data-equip-slot="${escapeHtml(slot.key)}">
          <option value="">— не надето —</option>
          ${options}
        </select>
        <div class="equip-row" ${active ? '' : 'hidden'}>
          <label>износ <input type="number" step="0.001" min="${min}" max="${max}" value="${active?.wear ?? min}" data-wear="${escapeHtml(slot.key)}"></label>
          <label>seed <input type="number" min="0" max="1000" value="${active?.seed ?? 0}" data-seed="${escapeHtml(slot.key)}"></label>
        </div>
        <div class="equip-row" ${active ? '' : 'hidden'}>
          <label class="checkbox"><input type="checkbox" data-st="${escapeHtml(slot.key)}" ${active?.statTrak ? 'checked' : ''}> StatTrak</label>
          <label>фраги <input type="number" min="0" value="${active?.kills ?? 0}" data-kills="${escapeHtml(slot.key)}" style="width:80px"></label>
        </div>
        <div class="equip-actions">
          <button class="btn btn-sm" data-equip-save="${escapeHtml(slot.key)}" ${active ? '' : 'hidden'}>применить</button>
          <button class="btn btn-sm btn-ghost ${active ? 'btn-danger' : ''}" data-equip-clear="${escapeHtml(slot.key)}" ${active ? '' : 'hidden'}>снять</button>
        </div>
      </div>`;
    })
    .join('');

  $$('[data-equip-slot]').forEach((select) => {
    select.onchange = async () => {
      const slot = select.dataset.equipSlot;
      if (!select.value) return clearSlot(slot);
      try {
        await api('/api/equip', { method: 'POST', body: JSON.stringify({ slot, uid: select.value }) });
        toast('Скин надет', 'ok');
        await loadEquip();
      } catch (error) {
        toast(error.message, 'err');
      }
    };
  });

  $$('[data-equip-save]').forEach((btn) => {
    btn.onclick = async () => {
      const slot = btn.dataset.equipSave;
      const payload = {
        slot,
        uid: $(`[data-equip-slot="${slot}"]`).value,
        wear: Number($(`[data-wear="${slot}"]`).value),
        seed: Number($(`[data-seed="${slot}"]`).value),
        statTrak: $(`[data-st="${slot}"]`).checked,
        kills: Number($(`[data-kills="${slot}"]`).value),
      };
      try {
        await api('/api/equip', { method: 'POST', body: JSON.stringify(payload) });
        toast('Сохранено', 'ok');
        await loadEquip();
      } catch (error) {
        toast(error.message, 'err');
      }
    };
  });

  $$('[data-equip-clear]').forEach((btn) => {
    btn.onclick = () => clearSlot(btn.dataset.equipClear);
  });
}

async function clearSlot(slot) {
  try {
    await api(`/api/equip/${encodeURIComponent(slot)}`, { method: 'DELETE' });
    toast('Снято', 'ok');
    await loadEquip();
  } catch (error) {
    toast(error.message, 'err');
  }
}

/* -------------------------------- сборки -------------------------------- */

async function renderLoadouts() {
  const mine = $('#myLoadouts');
  if (!state.user) {
    mine.innerHTML = '<p class="empty">Войдите через Steam, чтобы сохранять сборки.</p>';
  } else {
    try {
      const { loadouts } = await api('/api/loadout');
      mine.innerHTML = loadouts.length
        ? loadouts.map((l) => loadoutCard(l, true)).join('')
        : '<p class="empty">Сборок пока нет — соберите их на вкладке «Каталог».</p>';
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

  try {
    const { loadouts: publicOnes } = await api('/api/loadout/public');
    $('#publicLoadouts').innerHTML = publicOnes.length
      ? publicOnes.map((l) => loadoutCard(l, false)).join('')
      : '<p class="empty">Пока никто не опубликовал сборку.</p>';
  } catch {
    $('#publicLoadouts').innerHTML = '';
  }
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

/* -------------------------------- сервер -------------------------------- */

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
            <div class="mono small">ключ плагина: <code>${escapeHtml(s.pluginKey || '—')}</code></div>
            <div class="loadout-foot" style="margin-top:10px">
              <button class="btn btn-ghost btn-sm" data-ping="${escapeHtml(s.id)}">проверить</button>
              <button class="btn btn-ghost btn-sm" data-newkey="${escapeHtml(s.id)}">новый ключ</button>
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
  $$('[data-newkey]').forEach((btn) => {
    btn.onclick = async () => {
      const data = await api(`/api/servers/${btn.dataset.newkey}/plugin-key`, { method: 'POST' });
      toast(`Новый ключ: ${data.pluginKey}`, 'ok');
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

/* -------------------------------- админка ------------------------------- */

async function loadAdmin() {
  if (!state.user?.isAdmin) return;
  try {
    const stats = await api('/api/admin/stats');
    $('#adminCards').innerHTML = [
      ['Игроков', stats.users],
      ['Монет в обороте', coins(stats.coinsInCirculation)],
      ['Предметов в хранилищах', stats.itemsInVaults],
      ['Розыгрышей', stats.upgrades],
      ['Побед', stats.wins],
      ['RTP (выплачено / ставки)', `${Math.round((stats.rtp || 0) * 100)}%`],
      ['Ставок всего', coins(stats.wagered)],
      ['Выплачено', coins(stats.paid)],
    ]
      .map(([label, value]) => `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value">${value}</div></div>`)
      .join('');
  } catch (error) {
    $('#adminCards').innerHTML = '';
  }

  try {
    const { users } = await api('/api/admin/users');
    $('#adminUsers tbody').innerHTML = users
      .map((u) => `<tr>
          <td class="mono"><a target="_blank" rel="noopener" href="https://steamcommunity.com/profiles/${escapeHtml(u.steamId)}">${escapeHtml(u.steamId)}</a></td>
          <td>${Number(u.coins).toLocaleString('ru-RU')}</td>
          <td>${u.items}</td>
          <td>${u.upgrades} / ${u.wins}</td>
          <td>${Number(u.wagered).toLocaleString('ru-RU')}</td>
          <td>
            <button class="btn btn-ghost btn-sm" data-grant="${escapeHtml(u.steamId)}" data-amount="1000">+1000</button>
            <button class="btn btn-ghost btn-sm" data-grant="${escapeHtml(u.steamId)}" data-amount="-1000">−1000</button>
            <button class="btn btn-ghost btn-sm ${u.banned ? '' : 'btn-danger'}" data-ban="${escapeHtml(u.steamId)}" data-banned="${u.banned ? '0' : '1'}">${u.banned ? 'разбанить' : 'бан'}</button>
          </td>
        </tr>`)
      .join('') || '<tr><td colspan="6" class="empty">Пользователей пока нет</td></tr>';

    $$('[data-grant]').forEach((btn) => {
      btn.onclick = async () => {
        await api('/api/admin/coins', {
          method: 'POST',
          body: JSON.stringify({ steamId: btn.dataset.grant, amount: Number(btn.dataset.amount) }),
        });
        toast('Баланс обновлён', 'ok');
        loadAdmin();
      };
    });
    $$('[data-ban]').forEach((btn) => {
      btn.onclick = async () => {
        await api('/api/admin/ban', {
          method: 'POST',
          body: JSON.stringify({ steamId: btn.dataset.ban, banned: btn.dataset.banned === '1' }),
        });
        toast('Статус обновлён', 'ok');
        loadAdmin();
      };
    });
  } catch {
    $('#adminUsers tbody').innerHTML = '';
  }

  try {
    const { custom, overrides } = await api('/api/admin/items');
    const rows = [
      ...custom.map((i) => ({ id: i.id, label: `${i.weapon} — ${i.pattern}`, price: i.price, kind: 'свой' })),
      ...Object.entries(overrides)
        .filter(([, o]) => o.price || o.hidden)
        .map(([id, o]) => ({ id, label: id, price: o.price || '—', kind: o.hidden ? 'скрыт' : 'правка цены' })),
    ];
    $('#adminItems').innerHTML = rows.length
      ? rows
          .map((r) => `<div class="loadout">
              <h3>${escapeHtml(r.label)}</h3>
              <div class="mono">${escapeHtml(r.id)} · ${escapeHtml(String(r.price))} 🪙 · ${escapeHtml(r.kind)}</div>
              <div class="loadout-foot" style="margin-top:10px">
                <button class="btn btn-ghost btn-sm btn-danger" data-item-del="${escapeHtml(r.id)}">убрать</button>
              </div>
            </div>`)
          .join('')
      : '<p class="empty">Правок каталога нет.</p>';

    $$('[data-item-del]').forEach((btn) => {
      btn.onclick = async () => {
        await api(`/api/admin/items/${encodeURIComponent(btn.dataset.itemDel)}`, { method: 'DELETE' });
        toast('Каталог обновлён', 'ok');
        loadAdmin();
        loadCatalog();
      };
    });
  } catch {
    $('#adminItems').innerHTML = '';
  }

  try {
    const { history } = await api('/api/admin/history');
    $('#adminHistory tbody').innerHTML = history
      .map((h) => `<tr>
          <td class="mono">${new Date(h.at).toLocaleString('ru-RU')}</td>
          <td class="mono">${escapeHtml(h.steamId.slice(-6))}</td>
          <td>${escapeHtml(h.target.pattern)}</td>
          <td>${coins(h.stake)}</td>
          <td>${(h.chance * 100).toFixed(1)}%</td>
          <td><span class="hist-badge ${h.win ? 'win' : 'lose'}">${h.win ? 'WIN' : 'LOSE'}</span></td>
        </tr>`)
      .join('') || '<tr><td colspan="6" class="empty">История пуста</td></tr>';
  } catch {
    $('#adminHistory tbody').innerHTML = '';
  }
}

/* ---------------------------------- UI ---------------------------------- */

function switchTab(name) {
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  $$('.panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${name}`));
}

function bindUi() {
  $$('.tab').forEach((tab) => {
    tab.onclick = () => {
      switchTab(tab.dataset.tab);
      if (tab.dataset.tab === 'admin') loadAdmin();
      if (tab.dataset.tab === 'equip') loadEquip();
      if (tab.dataset.tab === 'vault') loadEconomy();
      if (tab.dataset.tab === 'upgrade') { loadEconomy(); loadTargets(); loadHistory(); }
    };
  });

  $('#dailyBtn').onclick = async () => {
    try {
      const data = await api('/api/economy/daily', { method: 'POST' });
      toast(`Бонус начислен: ${coins(state.econ ? data.coins - state.econ.coins : data.coins)}`, 'ok');
      await loadEconomy();
    } catch (error) {
      toast(error.message, 'err');
    }
  };

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

  const reloadCatalog = () => { state.page = 1; loadCatalog(); };
  $('#skinQuery').oninput = reloadCatalog;
  $('#skinCategory').onchange = reloadCatalog;
  $('#skinWeapon').onchange = reloadCatalog;
  $('#skinRarity').onchange = reloadCatalog;
  $('#skinSort').onchange = reloadCatalog;
  $('#prevPage').onclick = () => { state.page = Math.max(1, state.page - 1); loadCatalog(); };
  $('#nextPage').onclick = () => { state.page += 1; loadCatalog(); };

  const reloadTargets = () => { state.targetPage = 1; loadTargets(); };
  $('#targetQuery').oninput = reloadTargets;
  $('#targetCategory').onchange = reloadTargets;
  $('#targetRarity').onchange = reloadTargets;
  $('#targetSort').onchange = reloadTargets;
  $('#targetPrev').onclick = () => { state.targetPage = Math.max(1, state.targetPage - 1); loadTargets(); };
  $('#targetNext').onclick = () => { state.targetPage += 1; loadTargets(); };

  $('#spinBtn').onclick = spin;
  $('#clearSelection').onclick = () => { state.selection = []; renderUpgradePicker(); updateChance(); };
  $('#selectCheap').onclick = () => {
    const cheap = (state.econ?.items || []).slice().sort((a, b) => a.price - b.price).slice(0, 5).map((i) => i.uid);
    state.selection = cheap;
    renderUpgradePicker();
    updateChance();
  };

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
      loadCatalog();
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

  $('#adminItemForm').onsubmit = async (event) => {
    event.preventDefault();
    try {
      await api('/api/admin/items', {
        method: 'POST',
        body: JSON.stringify({
          id: $('#aiId').value,
          weapon: $('#aiWeapon').value,
          pattern: $('#aiPattern').value,
          category: $('#aiCategory').value || 'Прочее',
          rarity: $('#aiRarity').value,
          price: Number($('#aiPrice').value),
        }),
      });
      toast('Предмет добавлен в каталог', 'ok');
      $('#adminItemForm').reset();
      loadAdmin();
      loadCatalog();
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
    await loadCategories();
    await loadWeapons();
    await loadCatalog();
    await loadEconomy();
    await loadEquip();
    await loadTargets();
    await loadHistory();
    await loadServers();
    await renderLoadouts();
    await loadAdmin();
  } catch (error) {
    toast(error.message, 'err');
  }
  setInterval(() => { if (state.user?.isAdmin) refreshStatus(); }, 15000);
  setInterval(() => { if (state.user) loadEconomy(); }, 30000);
})();
