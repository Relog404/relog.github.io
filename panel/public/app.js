/* CS2 Panel — клиентская логика (ванильный JS, без сборки) */

const STEAM_ICON_PATH = 'M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.188.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.104l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.29-.249-1.878-.03l1.523.63c.956.4 1.409 1.5 1.009 2.455-.397.957-1.497 1.41-2.454 1.012H7.54zm11.415-9.303c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.663 0 3.015-1.35 3.015-3.015zm-5.273-.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251-1.017 2.265-2.266 2.265-1.253 0-2.265-1.014-2.265-2.265z';
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
  multiplier: null,
  chances: null,
  site: null,
  currency: null,
  rates: {},
  targetCache: {},
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

/** Цены показываются в выбранной валюте: монеты / рубли / доллары.
 *  Деньги виртуальные, курс нужен только для отображения. */
/** Курсы и выбранная валюта. Выбор игрока хранится в браузере,
 *  значение по умолчанию приходит с сервера (настройки админа). */
function currencyState() {
  const site = state.site || {};
  return {
    currency: state.currency || site.currency || 'coins',
    rates: { ...(site.rates || { rub: 1, usd: 1, usdRub: 95 }) },
    coinRateRub: Number(site.coinRateRub) || 10,
    usdRub: Number(site.usdRub || site.rates?.usdRub) || 95,
  };
}

const rub = (value) => `${Math.round(Number(value) || 0).toLocaleString('ru-RU')} ₽`;
const usd = (value) => `$${(Number(value) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const coinsText = (value) => `${Math.round(Number(value) || 0).toLocaleString('ru-RU')} 🪙`;

/** Сумма в монетах → выбранная валюта. */
function money(coinAmount) {
  const { currency, rates, coinRateRub, usdRub } = currencyState();
  const amount = Number(coinAmount) || 0;
  if (currency === 'rub') return rub(amount * coinRateRub * (rates.rub || 1));
  if (currency === 'usd') return usd((amount * coinRateRub * (rates.usd || 1)) / usdRub);
  return coinsText(amount);
}

/** Сумма в рублях (реальная цена Steam или оценка) → выбранная валюта. */
function moneyRub(rubles) {
  const { currency, rates, coinRateRub, usdRub } = currencyState();
  const amount = Number(rubles) || 0;
  if (currency === 'rub') return rub(amount * (rates.rub || 1));
  if (currency === 'usd') return usd((amount * (rates.usd || 1)) / usdRub);
  return coinsText(amount / coinRateRub);
}

/** Цена предмета: берём реальную/оценочную цену в рублях, если она есть. */
function itemMoney(item) {
  if (!item) return money(0);
  if (item.marketRub) return moneyRub(item.marketRub);
  return money(item.price);
}

/** Метка источника цены: реальная площадка Steam или оценка. */
function priceTag(item) {
  if (!item?.marketRub) return '';
  if (item.marketSource === 'steam') return `<span class="steam-tag" title="Цена с площадки Steam">Steam ${moneyRub(item.marketRub)}</span>`;
  if (item.marketSource === 'manual') return '<span class="steam-tag manual" title="Цена задана вручную в админке">цена вручную</span>';
  return `<span class="steam-tag estimate" title="Оценка по рынку: обновите цены со Steam в админке">≈ ${moneyRub(item.marketRub)}</span>`;
}

function renderCurrencyPicker() {
  const picker = $('#currencyPicker');
  if (!picker) return;
  picker.value = currencyState().currency;
  picker.onchange = async () => {
    state.currency = picker.value;
    try { localStorage.setItem('cs2panel.currency', picker.value); } catch { /* приватный режим */ }
    renderWallet();
    for (const render of [loadCatalog, loadTargets, loadChances, loadEquip, renderVault, renderCases]) {
      try { await render(); } catch (error) { toast(error.message, 'err'); }
    }
  };
}

const CATEGORY_ICON = {
  'Ножи': '🔪', 'Перчатки': '🧤', 'Винтовки': '🔫', 'Пистолеты': '🔫',
  'Снайперские': '🎯', 'Пистолеты-пулемёты': '🔫', 'Дробовики': '💥', 'Стикеры': '⭐',
  'Медали': '🏅', 'Значки': '📌', 'Кейсы': '📦', 'Музыка': '🎵', 'Патчи': '🧩', 'Агенты': '🕵️',
};

function itemArt(item, icon) {
  return item.image
    ? `<img src="${escapeHtml(item.image)}" alt="" loading="lazy" onerror="this.classList.add('broken')"><span class="fallback">${icon}</span>`
    : `<span class="fallback show">${icon}</span>`;
}

/** Реальная цена Steam в монетах — чтобы было видно, что ценник не выдуман. */
function steamTag(item) {
  if (!item.steamPrice) return '';
  const rate = state.site?.coinRateRub || 10;
  const rub = item.steamPrice.rub;
  return `<span class="steam-tag" title="Цена с торговой площадки Steam">Steam ${money(rub * rate)}</span>`;
}

function itemCard(item, { mode = 'shop', selected = false, inDraft = false } = {}) {
  const icon = CATEGORY_ICON[item.category] || '🎁';
  const footer = {
    shop: `<span class="price">${itemMoney(item)}</span><button class="btn btn-sm btn-buy" data-buy="${escapeHtml(item.id)}">купить</button>`,
    target: `<span class="price">${itemMoney(item)}</span><button class="btn btn-sm" data-target="${escapeHtml(item.id)}">цель</button>`,
    vault: `<span class="price">${itemMoney(item)}</span><button class="btn btn-sm btn-ghost" data-sell="${escapeHtml(item.uid)}">продать</button>`,
  }[mode];

  const second = item.marketRub
    ? `<span class="price-sub">${money(item.price)}</span>`
    : '';

  return `<div class="skin ${selected ? 'selected' : ''} ${inDraft ? 'in-draft' : ''}"
       data-rarity="${escapeHtml(item.rarity)}" data-id="${escapeHtml(item.id)}"
       style="--rar:${RARITY_COLOR[item.rarity] || '#8b98a8'}">
    <span class="skin-shine"></span>
    <div class="skin-art">${itemArt(item, icon)}</div>
    <div class="weapon">${escapeHtml(item.weapon)}</div>
    <div class="pattern">${escapeHtml(item.pattern)}</div>
    <div class="meta">
      <span class="rarity">${escapeHtml(rarityLabel(item.rarity))}</span>
      <span>${item.float ? `износ ${item.float[0]}–${item.float[1]}` : escapeHtml(item.category)}</span>
    </div>
    <div class="skin-foot">${footer}</div>
    ${second}${priceTag(item)}
  </div>`;
}

/* --------------------------------- auth --------------------------------- */

async function loadSession() {
  const { user } = await api('/api/session');
  state.user = user;
  renderAuth();
}

function steamIcon(size = 16) {
  return `<svg class="steam-ico" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><path d="${STEAM_ICON_PATH}"/></svg>`;
}

function renderAuth() {
  const box = $('#authBox');
  if (!state.user) {
    box.innerHTML = `<a class="btn btn-steam" href="/auth/steam">${steamIcon(16)}Войти через Steam</a>`;
  } else {
    const initial = (state.user.name || state.user.steamId || '?').trim().slice(0, 1).toUpperCase();
    const avatar = state.user.avatar
      ? `<img src="${escapeHtml(state.user.avatar)}" alt="" title="Аватар из Steam">`
      : `<span class="avatar-ph" title="Аватар из Steam появится, когда в панели задан STEAM_API_KEY">${steamIcon(18)}<b>${escapeHtml(initial)}</b></span>`;
    box.innerHTML = `
      ${avatar}
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

async function loadSite() {
  try {
    state.site = state.config?.currency && state.config.currency.currency
      ? state.config.currency
      : (await api('/api/settings'));
  } catch {
    state.site = { currency: 'coins', rates: { rub: 1, usd: 0.011 } };
  }
  if (!state.currency) {
    try { state.currency = localStorage.getItem('cs2panel.currency'); } catch { /* нет доступа */ }
  }
  renderCurrencyPicker();
  renderCurrencyEditor();
}

async function loadConfig() {
  state.config = await api('/api/config');
  const hint = $('#serverBindHint');
  if (hint) {
    hint.classList.toggle('notice-ok', state.config.serverBound === true);
    hint.innerHTML = state.config.serverBound
      ? 'Игровой сервер <b>привязан</b>: плагин забирает надетые скины и показывает их в игре.'
      : 'Привязка игрового сервера <b>не обязательна</b>: сайт, магазин и апгрейд-рулетка работают и без него. Сервер нужен только чтобы плагин забирал надетые скины.';
  }
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
  const glyph = { rub: '₽', usd: '$', coins: '🪙' }[currencyState().currency] || '🪙';
  const coinEl = document.querySelector('#wallet .coin');
  if (coinEl) coinEl.textContent = glyph;
  $('#coinBalance').textContent = money(state.econ?.coins ?? 0);
  const caseHint = $('#caseBalanceHint');
  if (caseHint) caseHint.textContent = state.user ? `на счету ${money(state.econ?.coins ?? 0)}` : 'войдите через Steam, чтобы открывать кейсы';
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
    ['Баланс', money(state.econ.coins)],
    ['Предметов', items.length],
    ['Стоимость хранилища', money(value)],
    ['Розыгрышей', state.econ.stats?.upgrades ?? 0],
    ['Побед', state.econ.stats?.wins ?? 0],
    ['Лучший выигрыш', money(state.econ.stats?.bestWin ?? 0)],
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
        toast(`Продано за ${money(data.refund)}`, 'ok');
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
        toast(`Куплено: ${data.item.pattern} за ${money(data.item.price)}`, 'ok');
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
  $('#stakeLabel').textContent = `выбрано ${state.selection.length} на ${money(stake)}`;

  box.innerHTML = items
    .slice()
    .sort((a, b) => b.price - a.price)
    .map((entry) => {
      const checked = state.selection.includes(entry.uid) ? 'checked' : '';
      return `<label class="pick ${checked ? 'picked' : ''}" data-rarity="${escapeHtml(entry.item.rarity)}">
        <input type="checkbox" data-pick="${escapeHtml(entry.uid)}" ${checked} />
        <span class="pick-icon">${CATEGORY_ICON[entry.item.category] || '🎁'}</span>
        <span class="pick-name">${escapeHtml(entry.item.weapon)} — ${escapeHtml(entry.item.pattern)}</span>
        <span class="price">${money(entry.price)}</span>
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
  renderItems(data.items, { mode: 'target' });

  $('#targetPageLabel').textContent = `страница ${data.page} из ${data.pages}`;
  $('#targetPrev').disabled = data.page <= 1;
  $('#targetNext').disabled = data.page >= data.pages;
}

async function updateChance() {
  const fill = $('#chanceFill');
  const summary = $('#upgradeSummary');
  const spin = $('#spinBtn');

  if (!state.target) {
    summary.innerHTML = '<span class="muted">Выберите цель апгрейда ↑</span>';
    fill.style.width = '0%';
    $('#chanceText').textContent = '0%';
    renderWheel(0, null);
    renderWheelFacts(null);
    spin.disabled = true;
    return;
  }

  const targetPrice = state.target.price;
  const stake = (state.econ?.items || []).filter((i) => state.selection.includes(i.uid)).reduce((sum, i) => sum + i.price, 0);
  const rough = stake ? Math.min(95, Math.max(1, Math.round((stake / targetPrice) * 100 * (state.config?.economy?.edge ?? 0.95)))) : 0;

  if (!state.selection.length) {
    summary.innerHTML = `<span class="muted">Цель: <b>${escapeHtml(state.target.pattern)}</b> · ${money(targetPrice)} · поставьте предметы слева</span>`;
    fill.style.width = '0%';
    $('#chanceText').textContent = '0%';
    renderWheel(0, state.target);
    renderWheelFacts({ target: state.target, stake: 0 });
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
    renderWheel(data.chance, state.target);
    renderWheelFacts(data);
    fill.style.width = `${Math.min(100, percent)}%`;
    $('#chanceText').textContent = `${percent.toFixed(percent < 10 ? 2 : 1)}%`;
    const lossNote = data.stake > data.payout ? ' <span class="warn">ставка дороже цели</span>' : '';
    const multNote = data.multiplier && data.multiplier >= 2 ? ` <span class="badge">×${Number(data.multiplier.toFixed(1))}</span>` : '';
    summary.innerHTML = `Ставка <b>${money(data.stake)}</b> → цель <b>${escapeHtml(data.target.pattern)}</b> (${money(data.payout)})${multNote}${lossNote}`;
    spin.disabled = state.spinning || data.stake <= 0;
  } catch (error) {
    state.chance = rough / 100;
    renderWheel(rough / 100, state.target);
    $('#chanceText').textContent = `${rough}%`;
    summary.innerHTML = `<span class="muted">${escapeHtml(error.message)}</span>`;
    spin.disabled = true;
  }
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

    renderWheel(data.chance, data.target);
    spinWheel(data);
    state.selection = [];
    renderUpgradePicker();
    await wait(5400);
    stopWheel(data.win);

    const percent = (data.chance * 100).toFixed(data.chance < 0.1 ? 2 : 1);
    $('#resultBox').hidden = false;
    $('#resultBox').className = `result ${data.win ? 'win' : 'lose'}`;
    $('#resultBox').innerHTML = `
      <div class="result-title">${data.win ? '🎉 Стрелка в зелёном — апгрейд прошёл!' : '😢 Стрелка в красном — не повезло'}</div>
      <div class="result-body">
        Цель: <b>${escapeHtml(data.target.pattern)}</b> · шанс ${percent}% ·
        ставка ${money(data.stake)} · roll ${data.roll.toFixed(6)}
        ${data.win ? `→ выигрыш ${money(data.payout)}` : `→ ставка ${money(data.stake)} сгорела`}
      </div>
      <button class="btn btn-sm" id="againBtn">ещё раз</button>`;
    $('#againBtn').onclick = () => { $('#resultBox').hidden = true; };

    $('#fairBox').innerHTML = [
      ['serverSeed (hash)', data.fair.serverSeedHash],
      ['clientSeed', data.fair.clientSeed],
      ['nonce', data.fair.nonce],
      ['roll', data.roll.toFixed(8)],
      ['остановка стрелки', `${(wheelAngleFor(data.roll, data.chance) % 360).toFixed(1)}°`],
    ]
      .map(([k, v]) => `<li><span class="muted">${escapeHtml(k)}</span><span class="mono">${escapeHtml(String(v))}</span></li>`)
      .join('');

    await loadEconomy();
    loadHistory();
    if (state.user?.isAdmin) loadAdmin();
    state.spinning = false;
    updateChance();
  } catch (error) {
    state.spinning = false;
    $('#spinBtn').disabled = false;
    toast(error.message, 'err');
  }
}

async function loadHistory() {
  try {
    const { history } = await api('/api/upgrade/history');
    $('#historyFeed').innerHTML = history.length
      ? history
          .map((h) => `<div class="hist-row ${h.win ? 'win' : 'lose'}">
              <span class="mono">${new Date(h.at).toLocaleTimeString('ru-RU')}</span>
              <span class="hist-name">${h.target.image ? `<img class="hist-img" src="${escapeHtml(h.target.image)}" alt="" loading="lazy">` : CATEGORY_ICON[h.target.category] || '🎁'} ${escapeHtml(h.target.pattern)}</span>
              <span class="muted">${(h.chance * 100).toFixed(1)}%</span>
              <span>${money(h.stake)} → ${h.win ? money(h.payout) : '0'}</span>
              <span class="hist-badge">${h.win ? 'WIN' : 'LOSE'}</span>
            </div>`)
          .join('')
      : '<p class="empty">Розыгрышей пока не было.</p>';
  } catch {
    $('#historyFeed').innerHTML = '';
  }
}

/* --------------------------- пресеты множителей ------------------------- */

async function loadChances() {
  try {
    const data = await api('/api/upgrade/settings');
    state.chances = data;
    renderMultipliers();
    renderChanceEditor();
  } catch {
    state.chances = null;
  }
}

function currentStake() {
  return (state.econ?.items || [])
    .filter((i) => state.selection.includes(i.uid))
    .reduce((sum, i) => sum + i.price, 0);
}

function renderMultipliers() {
  const row = $('#multiplierRow');
  const chances = state.chances?.chances || [];
  if (!chances.length) {
    row.innerHTML = '';
    return;
  }
  row.innerHTML = chances
    .map(
      (c) => `<button class="mult ${state.multiplier === c.multiplier ? 'active' : ''}" data-mult="${c.multiplier}">
          <span class="mult-x">×${c.multiplier}</span>
          <span class="mult-chance">${(c.chance * 100).toFixed(c.chance < 0.1 ? 2 : 1)}%</span>
        </button>`
    )
    .join('');

  $$('[data-mult]').forEach((btn) => {
    btn.onclick = async () => {
      const multiplier = Number(btn.dataset.mult);
      state.multiplier = state.multiplier === multiplier ? null : multiplier;
      renderMultipliers();
      if (!state.multiplier) {
        $('#targetMode').textContent = 'Выберите множитель, чтобы подобрать цель под ставку, или ищите вручную ниже.';
        return loadTargets();
      }
      const stake = currentStake();
      if (stake <= 0) {
        $('#targetMode').textContent = 'Поставьте предметы слева — тогда подберём цель под множитель.';
        return;
      }
      try {
        const data = await api(`/api/upgrade/suggestions?stake=${stake}&multiplier=${state.multiplier}`);
        $('#targetMode').textContent = `Подобрано под ×${state.multiplier}: цель примерно за ${data.target} 🪙`;
        renderItems(data.items, { mode: 'target' });
      } catch (error) {
        toast(error.message, 'err');
      }
    };
  });
}

/** Рисует список предметов в сетке цели (общий код для поиска и подбора). */
function renderItems(list, { mode = 'target' } = {}) {
  state.targetCache = {};
  for (const item of list) state.targetCache[item.id] = item;
  $('#targetGrid').innerHTML = list.length
    ? list.map((item) => itemCard(item, { mode, selected: state.target?.id === item.id })).join('')
    : '<p class="empty">Ничего не найдено</p>';
  bindTargetButtons();
}

function bindTargetButtons() {
  $$('#targetGrid [data-target]').forEach((btn) => {
    btn.onclick = async (event) => {
      event.stopPropagation();
      const id = btn.dataset.target;
      try {
        // предметы, которые уже отрисованы, берём из кэша — это и есть прошлый баг:
        // раньше цель искалась поисковым запросом по id, а поиск по id не ищет.
        const found = state.targetCache[id] || (await api(`/api/catalog/${encodeURIComponent(id)}`)).item;
        state.target = found;
        updateChance();
        loadTargets();
      } catch (error) {
        toast(error.message || 'Предмет не найден', 'err');
      }
    };
  });
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
        .map((o) => `<option value="${escapeHtml(o.uid)}"${active?.uid === o.uid ? ' selected' : ''}>${escapeHtml(o.item.pattern)} · ${money(o.item.price)}</option>`)
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
      ['Монет в обороте', money(stats.coinsInCirculation)],
      ['Предметов в хранилищах', stats.itemsInVaults],
      ['Розыгрышей', stats.upgrades],
      ['Побед', stats.wins],
      ['RTP (выплачено / ставки)', `${Math.round((stats.rtp || 0) * 100)}%`],
      ['Ставок всего', money(stats.wagered)],
      ['Выплачено', money(stats.paid)],
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
    renderChanceEditor();
  } catch {
    /* настройки могли не загрузиться — не критично */
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
          <td>${money(h.stake)}</td>
          <td>${(h.chance * 100).toFixed(1)}%</td>
          <td><span class="hist-badge ${h.win ? 'win' : 'lose'}">${h.win ? 'WIN' : 'LOSE'}</span></td>
        </tr>`)
      .join('') || '<tr><td colspan="6" class="empty">История пуста</td></tr>';
  } catch {
    $('#adminHistory tbody').innerHTML = '';
  }
}

/* ================================ КОЛЕСО ================================ */
/* Апгрейд крутится как колесо фортуны: зелёный сектор — это шанс (растёт от
   ставки), стрелка делает несколько оборотов и останавливается. Угол остановки
   выводится из roll, поэтому результат можно пересчитать вручную.           */

const RARITY_COLOR = {
  consumer: '#b0c3d9',
  industrial: '#5e98d9',
  'mil-spec': '#4b69ff',
  restricted: '#8847ff',
  classified: '#d32ce6',
  covert: '#eb4b4b',
  'exceedingly rare': '#ffd700',
};

const polar = (cx, cy, radius, deg) => {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [cx + radius * Math.cos(rad), cy + radius * Math.sin(rad)];
};

/** Кусок кольца (donut) от startDeg до endDeg, 0° — сверху, по часовой стрелке. */
function donutPath(cx, cy, rOuter, rInner, startDeg, endDeg) {
  const large = endDeg - startDeg > 180 ? 1 : 0;
  const [x1, y1] = polar(cx, cy, rOuter, startDeg);
  const [x2, y2] = polar(cx, cy, rOuter, endDeg);
  const [x3, y3] = polar(cx, cy, rInner, endDeg);
  const [x4, y4] = polar(cx, cy, rInner, startDeg);
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${rOuter} ${rOuter} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} L ${x3.toFixed(2)} ${y3.toFixed(2)} A ${rInner} ${rInner} 0 ${large} 0 ${x4.toFixed(2)} ${y4.toFixed(2)} Z`;
}

/** Рисует колесо под текущий шанс. */
function renderWheel(chance = 0, target = null) {
  const svg = $('#wheelSvg');
  if (!svg) return;
  const size = 340;
  const c = size / 2;
  const rOuter = 152;
  const rInner = 66;
  const span = Math.max(1.5, Math.min(358, (Number(chance) || 0) * 360));
  const percent = (Number(chance) || 0) * 100;

  const ticks = [];
  for (let deg = 0; deg < 360; deg += 3) {
    const insideGreen = deg <= span;
    const [x1, y1] = polar(c, c, rInner + 6, deg);
    const [x2, y2] = polar(c, c, rOuter - (deg % 15 === 0 ? 14 : 8), deg);
    ticks.push(
      `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${insideGreen ? 'rgba(255,255,255,.55)' : 'rgba(255,255,255,.13)'}" stroke-width="${deg % 15 === 0 ? 2.2 : 1}" />`,
    );
  }

  const [gx, gy] = polar(c, c, (rInner + rOuter) / 2, Math.min(span / 2, 40));
  const [rx, ry] = polar(c, c, (rInner + rOuter) / 2, span + (360 - span) / 2);

  svg.innerHTML = `
    <defs>
      <linearGradient id="greenZone" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#7bff9d" />
        <stop offset="100%" stop-color="#16b45c" />
      </linearGradient>
      <linearGradient id="redZone" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#4a2028" />
        <stop offset="100%" stop-color="#2a1218" />
      </linearGradient>
      <filter id="greenGlow" x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur stdDeviation="6" result="blur" />
        <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
    </defs>
    <circle cx="${c}" cy="${c}" r="${rOuter + 6}" fill="#0b0f15" stroke="#222e3b" />
    <path d="${donutPath(c, c, rOuter, rInner, 0, 360)}" fill="url(#redZone)" />
    <path d="${donutPath(c, c, rOuter, rInner, 0, span)}" fill="url(#greenZone)" filter="url(#greenGlow)" />
    <path d="${donutPath(c, c, rOuter, rInner, 0, span)}" fill="url(#greenZone)" />
    ${ticks.join('')}
    <circle cx="${c}" cy="${c}" r="${rOuter}" fill="none" stroke="#2b3849" stroke-width="2" />
    <circle cx="${c}" cy="${c}" r="${rInner}" fill="none" stroke="#2b3849" stroke-width="2" />
    <text x="${gx.toFixed(1)}" y="${gy.toFixed(1)}" class="wheel-label wheel-label-win" text-anchor="middle">${percent.toFixed(percent < 10 ? 2 : 1)}%</text>
    ${span < 300 ? `<text x="${rx.toFixed(1)}" y="${ry.toFixed(1)}" class="wheel-label wheel-label-lose" text-anchor="middle">мимо</text>` : ''}
  `;

  const hub = $('#wheelHubArt');
  const label = $('#wheelHubLabel');
  if (hub) {
    hub.innerHTML = target && target.image
      ? `<img src="${escapeHtml(target.image)}" alt="" onerror="this.style.display='none'">`
      : '<span>🎯</span>';
  }
  if (label) label.textContent = target ? target.pattern : 'цель не выбрана';
}

/**
 * Угол остановки стрелки: внутри зелёного сектора при выигрыше и в красном — при проигрыше.
 * Считается из того же roll, поэтому совпадает с «честным» результатом розыгрыша.
 */
function wheelAngleFor(roll, chance) {
  const value = Math.max(0.0001, Math.min(0.9999, Number(chance) || 0));
  const span = value * 360;
  const point = Math.min(0.999999, Number(roll) || 0);
  return point < value
    ? (point / value) * span
    : span + ((point - value) / Math.max(1 - value, 1e-9)) * (360 - span);
}

/** Крутит стрелку. Остановка считается из roll — то же, что вернул сервер. */
function spinWheel(data) {
  const angle = wheelAngleFor(data.roll, data.chance);

  const needle = $('#wheelNeedle');
  const stage = $('#wheelStage');
  if (!needle) return;
  const turns = 5 + ((Number(data.fair?.nonce) || 0) % 3);
  const current = state.wheelAngle || 0;
  const delta = (((angle - current) % 360) + 360) % 360;
  const finalAngle = current + delta + 360 * turns;
  state.wheelAngle = finalAngle % 360;

  stage?.classList.add('spinning');
  needle.style.transition = 'none';
  needle.style.transform = `translateX(-50%) rotate(${current}deg)`;
  requestAnimationFrame(() => {
    needle.style.transition = 'transform 5.2s cubic-bezier(0.12, 0.68, 0.02, 1)';
    needle.style.transform = `translateX(-50%) rotate(${finalAngle}deg)`;
  });
}

function stopWheel(win) {
  const stage = $('#wheelStage');
  stage?.classList.remove('spinning');
  stage?.classList.add(win ? 'win' : 'lose');
  setTimeout(() => stage?.classList.remove('win', 'lose'), 4000);
}

/** Карточка цели рядом с колесом: что стоит на кону. */
function renderWheelFacts(preview) {
  const box = $('#wheelTarget');
  const facts = $('#wheelFacts');
  if (!box) return;
  const target = preview?.target || state.target;
  if (!target) {
    box.innerHTML = '<p class="empty">Выберите цель апгрейда — её картинка появится в центре колеса.</p>';
    if (facts) facts.innerHTML = '';
    return;
  }
  box.innerHTML = `<div class="wheel-target-card" data-rarity="${escapeHtml(target.rarity)}" style="--rar:${RARITY_COLOR[target.rarity] || '#8b98a8'}">
      <div class="wheel-target-art">${itemArt(target, CATEGORY_ICON[target.category] || '🎁')}</div>
      <div>
        <div class="wheel-target-name">${escapeHtml(target.weapon)} — ${escapeHtml(target.pattern)}</div>
        <div class="muted small">${escapeHtml(rarityLabel(target.rarity))}${target.float ? ` · износ ${target.float[0]}–${target.float[1]}` : ''}</div>
        <div class="price">${money(target.price)}${target.steamPrice ? ` <span class="steam-tag">Steam ${money(target.steamPrice.rub * (state.site?.coinRateRub || 10))}</span>` : ''}</div>
      </div>
    </div>`;
  if (!facts) return;
  const rows = [
    ['цена цели', money(target.price)],
    ['ставка', money(preview?.stake || 0)],
    ['множитель', preview?.multiplier ? `×${Number(preview.multiplier).toFixed(1)}` : '—'],
    ['выплата при победе', money(preview?.payout || target.price)],
  ];
  facts.innerHTML = rows
    .map(([key, value]) => `<li><span class="muted">${escapeHtml(key)}</span><span>${value}</span></li>`)
    .join('');
}

/* ========================= ЦЕНЫ STEAM (АДМИН) =========================== */

function renderPriceStatus(status) {
  const box = $('#priceStatus');
  if (!box || !status) return;
  const when = status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleString('ru-RU') : 'ещё не было';
  const result = status.lastResult;
  box.innerHTML = `
    <div class="price-status-grid">
      <div><span class="muted">обновлено цен</span><b>${status.synced} из ${status.total}</b></div>
      <div><span class="muted">последний проход</span><b>${escapeHtml(when)}</b></div>
      <div><span class="muted">источник</span><b>${escapeHtml(status.provider)}</b></div>
      <div><span class="muted">пауза / порция</span><b>${status.delayMs} мс · ${status.batch}</b></div>
      <div><span class="muted">1 монета</span><b>${status.coinRateRub} ₽</b></div>
      <div><span class="muted">курс $</span><b>${status.usdRub} ₽</b></div>
    </div>
    ${result ? `<p class="muted small">Прошлый проход: обновлено ${result.updated}, пропущено ${result.skipped}, ошибок ${result.failed}.</p>` : ''}
    ${status.lastError ? `<p class="warn">Ошибка: ${escapeHtml(status.lastError)}</p>` : ''}
    ${status.running ? '<p class="pill pill-ok">Синхронизация идёт…</p>' : ''}`;
}

async function loadPriceStatus() {
  try {
    renderPriceStatus(await api('/api/prices/status'));
  } catch {
    /* админка скрыта — нечего показывать */
  }
}

async function syncPrices() {
  const button = $('#priceSyncBtn');
  if (button) button.disabled = true;
  try {
    const data = await api('/api/admin/prices/sync', {
      method: 'POST',
      body: JSON.stringify({
        limit: Number($('#priceLimit')?.value || 150),
        force: Boolean($('#priceForce')?.checked),
      }),
    });
    renderPriceStatus(data.status);
    const { updated = 0, skipped = 0, failed = 0 } = data.result || {};
    toast(`Цены обновлены: ${updated}, пропущено ${skipped}, ошибок ${failed}`, failed ? 'err' : 'ok');
    await loadConfig();
    loadCatalog();
    loadTargets();
    renderCases();
    if (state.target) updateChance();
  } catch (error) {
    toast(error.message, 'err');
  } finally {
    if (button) button.disabled = false;
  }
}

async function resetPrices() {
  try {
    renderPriceStatus((await api('/api/admin/prices/reset', { method: 'POST' })).status);
    toast('Цены Steam сброшены — каталог вернулся к базовым ценам', 'ok');
    await loadConfig();
    loadCatalog();
    loadTargets();
    renderCases();
    if (state.target) updateChance();
  } catch (error) {
    toast(error.message, 'err');
  }
}

/* ================================ КЕЙСЫ ================================= */

async function loadCases() {
  try {
    const { cases } = await api('/api/cases');
    state.cases = cases;
    renderCases();
  } catch (error) {
    const grid = $('#caseGrid');
    if (grid) grid.innerHTML = `<p class="empty">${escapeHtml(error.message)}</p>`;
  }
}

/** Шанс в понятном виде: 12.4% или «1 из 8000» для совсем редкого. */
function chanceText(chance) {
  const value = Number(chance) || 0;
  if (value <= 0) return '—';
  const percent = value * 100;
  if (percent >= 0.1) return `${percent.toFixed(1)}%`;
  if (percent >= 0.01) return `${percent.toFixed(2)}%`;
  return `1 из ${Math.max(2, Math.round(1 / value)).toLocaleString('ru-RU')}`;
}

const TIER_LABEL = { common: 'обычные', uncommon: 'необычные', rare: 'редкие', legendary: 'легендарные' };
const TIER_COLOR = { common: '#b0c3d9', uncommon: '#4b69ff', rare: '#d32ce6', legendary: '#ffd700' };

const rarityLabel = (rarity) => ({
  consumer: 'ширпотреб',
  industrial: 'промышленное',
  'mil-spec': 'армейское',
  restricted: 'запрещённое',
  classified: 'секретное',
  covert: 'тайное',
  'exceedingly rare': 'экстраординарное',
}[rarity] || rarity);

function renderCases() {
  const grid = $('#caseGrid');
  if (!grid) return;
  const list = state.cases || [];
  if (!list.length) {
    grid.innerHTML = '<p class="empty">Кейсы пока не настроены.</p>';
    return;
  }

  grid.innerHTML = list
    .map((box) => {
      const meta = box.rarityMeta || {};
      const tiers = Object.entries(box.odds || {});
      const chips = tiers
        .filter(([, chance]) => chance >= 0.00005)
        .slice(0, 5)
        .map(([tier, chance]) => {
          const color = meta[tier]?.color || TIER_COLOR[tier] || '#8b98a8';
          const label = meta[tier]?.label || tier;
          return `<span class="odds-chip" style="--rar:${color}"><i></i>${escapeHtml(label)} ${chanceText(chance)}</span>`;
        })
        .join('');
      const shots = (box.showcase || [])
        .map((item) => `<figure class="case-shot" title="${escapeHtml(`${item.weapon} — ${item.pattern}`)} · ${chanceText(item.chance)}">
            ${item.image ? `<img src="${escapeHtml(item.image)}" alt="" loading="lazy" onerror="this.style.display='none'">` : `<span>🎁</span>`}
            <figcaption>${chanceText(item.chance)}</figcaption>
          </figure>`)
        .join('');
      const affordable = (state.econ?.coins ?? 0) >= box.price;

      return `<article class="case-card" style="--accent:${escapeHtml(box.accent)}">
          <div class="case-visual">
            <div class="case-cover">
              ${box.image ? `<img src="${escapeHtml(box.image)}" alt="${escapeHtml(box.name)}" loading="lazy" onerror="this.style.display='none'">` : `<span>${box.icon || '🎁'}</span>`}
              <span class="case-cover-glow"></span>
            </div>
            <div class="case-shots">${shots}</div>
          </div>
          <div class="case-body">
            <h3>${escapeHtml(box.name)}</h3>
            ${box.blurb ? `<p class="muted small">${escapeHtml(box.blurb)}</p>` : ''}
            <div class="case-odds">${chips}</div>
            <ul class="kv case-facts">
              <li><span class="muted">предметов в кейсе</span><span>${box.itemsCount}</span></li>
              <li><span class="muted">диапазон цен</span><span>${money(box.minPrice)} — ${money(box.maxPrice)}</span></li>
              <li><span class="muted">ожидание дропа</span><span>${money(box.expectation)}</span></li>
            </ul>
            <div class="case-foot">
              <span class="price">${money(box.price)}</span>
              <button class="btn btn-buy btn-sm" data-case="${escapeHtml(box.id)}" ${affordable ? '' : 'title="Не хватает монет"'}>Открыть</button>
            </div>
          </div>
        </article>`;
    })
    .join('');

  $$('#caseGrid [data-case]').forEach((button) => {
    button.onclick = () => openCase(button.dataset.case, Number($('#caseCount')?.value || 1));
  });
}

function buildCaseReel(cells, winIndex) {
  const track = $('#caseReelTrack');
  if (!track) return 0;
  const strip = [];
  for (let l = 0; l < 3; l += 1) strip.push(...cells);
  track.innerHTML = strip
    .map((cell) => `<div class="case-cell ${cell.isWin ? 'win' : ''}" data-rarity="${escapeHtml(cell.rarity)}">
        <div class="case-cell-art">${itemArt(cell, CATEGORY_ICON[cell.category] || '🎁')}</div>
        <div class="case-cell-name">${escapeHtml(cell.pattern)}</div>
      </div>`)
    .join('');
  return 2 * cells.length + winIndex;
}

const CASE_CELL_W = 132;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runCaseReel(data) {
  const winIndex = buildCaseReel(data.reel, data.winIndex);
  const stage = $('#caseStageBlock');
  const reel = $('#caseReel');
  const prizes = $('#casePrizes');
  if (prizes) prizes.hidden = true;
  stage.hidden = false;
  stage.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  reel.classList.add('rolling');

  const viewport = reel.querySelector('.case-reel-viewport');
  const viewportW = viewport?.clientWidth || 800;
  const offset = winIndex * CASE_CELL_W - (viewportW / 2 - CASE_CELL_W / 2) + (Math.random() * 60 - 30);
  const track = $('#caseReelTrack');
  track.style.transition = 'none';
  track.style.transform = 'translateX(0px)';
  await wait(30);
  track.style.transition = 'transform 4.6s cubic-bezier(0.08, 0.7, 0.02, 1)';
  track.style.transform = `translateX(${-offset}px)`;
  await wait(4700);
  reel.classList.remove('rolling');
}

function renderPrizes(prizes, box) {
  const wrap = $('#casePrizes');
  if (!wrap) return;
  wrap.hidden = false;
  wrap.innerHTML = `<div class="case-prizes-grid">${prizes
    .map((prize, index) => `<div class="case-prize" data-rarity="${escapeHtml(prize.rarity)}" style="--rar:${RARITY_COLOR[prize.rarity] || '#8b98a8'};animation-delay:${index * 90}ms">
        <div class="case-prize-burst"></div>
        <div class="case-prize-art">${prize.image ? `<img src="${escapeHtml(prize.image)}" alt="">` : `<span>${CATEGORY_ICON[prize.category] || '🎁'}</span>`}</div>
        <div class="case-prize-name">${escapeHtml(prize.weapon)} — ${escapeHtml(prize.pattern)}</div>
        <div class="case-prize-meta"><span class="rarity">${escapeHtml(rarityLabel(prize.rarity))}</span><span class="price">${money(prize.price)}</span></div>
        <div class="case-prize-sparkles">${'<i></i>'.repeat(8)}</div>
      </div>`)
    .join('')}</div>
    <p class="muted small case-prize-total">Итого с кейса «${escapeHtml(box?.name || '')}»: ${prizes.length} × ${money(box?.price || 0)} = ${money((box?.price || 0) * prizes.length)} ставка, дроп на ${money(prizes.reduce((sum, p) => sum + p.price, 0))}</p>`;
}

async function openCase(caseId, times = 1) {
  if (state.caseOpening) return;
  if (!state.user) return toast('Сначала войдите через Steam', 'err');
  state.caseOpening = true;
  const prizes = [];
  let box = null;
  try {
    for (let i = 0; i < Math.max(1, Math.min(times, 5)); i += 1) {
      const data = await api('/api/case/open', { method: 'POST', body: JSON.stringify({ caseId }) });
      box = data.case;
      prizes.push(data.prize);
      $('#caseStageName').textContent = box?.name || '';
      await runCaseReel(data);
      if (i > 0) await wait(120);
    }
    renderPrizes(prizes, box);
    await loadEconomy();
    loadCaseHistory();
    $('#caseAgain').dataset.case = caseId;
  } catch (error) {
    toast(error.message, 'err');
    const stage = $('#caseStageBlock');
    if (stage && prizes.length === 0) stage.hidden = true;
    if (prizes.length) renderPrizes(prizes, box);
  } finally {
    state.caseOpening = false;
  }
}

async function loadCaseHistory() {
  const feed = $('#caseHistoryFeed');
  if (!feed) return;
  try {
    const { history } = await api('/api/history?kind=case&limit=15');
    feed.innerHTML = history.length
      ? history
          .map((entry) => `<div class="hist-row win">
              <span class="mono">${new Date(entry.at).toLocaleTimeString('ru-RU')}</span>
              <span class="hist-name">${entry.target.image ? `<img class="hist-img" src="${escapeHtml(entry.target.image)}" alt="" loading="lazy">` : '🎁'} ${escapeHtml(entry.target.pattern)}</span>
              <span class="muted">${escapeHtml(entry.caseName || 'кейс')}</span>
              <span>${money(entry.stake)} → ${money(entry.payout)}</span>
              <span class="hist-badge win">${money(entry.payout - entry.stake >= 0 ? `+${entry.payout - entry.stake}` : entry.payout - entry.stake)}</span>
            </div>`)
          .join('')
      : '<p class="empty">Кейсы ещё не открывали.</p>';
  } catch {
    feed.innerHTML = '<p class="empty">История недоступна.</p>';
  }
}

/* ------------------------- валюта и шансы (админ) ----------------------- */

function renderCurrencyEditor() {
  const box = $('#currencySettings');
  if (!box || !state.site) return;
  const { currency, rates } = state.site;
  box.innerHTML = `
    <label class="row-label">Валюта цен
      <select id="currencySelect">
        <option value="coins"${currency === 'coins' ? ' selected' : ''}>Монеты 🪙</option>
        <option value="rub"${currency === 'rub' ? ' selected' : ''}>Рубли ₽</option>
        <option value="usd"${currency === 'usd' ? ' selected' : ''}>Доллары $</option>
      </select>
    </label>
    <label class="row-label">Курс: 1 монета =
      <input type="number" step="0.01" min="0.0001" id="rateRub" value="${rates.rub}" style="width:90px"> ₽
    </label>
    <label class="row-label">1 монета =
      <input type="number" step="0.5" min="0.1" id="coinRateRub" value="${state.site?.coinRateRub || 10}" style="width:90px"> ₽
    </label>
    <label class="row-label">курс $ =
      <input type="number" step="0.5" min="1" id="rateUsdRub" value="${rates.usdRub || 95}" style="width:90px"> ₽
    </label>
    <button class="btn" id="saveCurrency">Сохранить валюту</button>`;

  $('#saveCurrency').onclick = async () => {
    try {
      const data = await api('/api/admin/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          currency: $('#currencySelect').value,
          coinRateRub: Number($('#coinRateRub').value),
          rates: { rub: Number($('#rateRub').value), usd: 1, usdRub: Number($('#rateUsdRub').value) },
        }),
      });
      state.site = data;
      state.currency = data.currency;
      renderCurrencyPicker();
      renderCurrencyEditor();
      renderWallet();
      loadCatalog();
      loadEquip();
      renderVault();
      renderCases();
      toast(`Цены теперь в валюте: ${data.currency}`, 'ok');
    } catch (error) {
      toast(error.message, 'err');
    }
  };
}

/* ------------------------- редактор шансов (админ) ---------------------- */

function renderChanceEditor() {
  const box = $('#chanceEditor');
  if (!box || !state.chances) return;
  const max = Math.round((state.chances.maxChance ?? 0.8) * 100);

  box.innerHTML = state.chances.chances
    .map(
      (c) => `<label class="chance-row-item">
          <span class="chance-x">×${c.multiplier}</span>
          <input type="number" step="1" min="1" max="${max}" value="${Math.round(c.chance * 1000) / 10}" data-chance="${c.multiplier}">
          <span class="muted small">% шанса</span>
        </label>`,
    )
    .join('');

  const maxInput = $('#globalChance');
  if (maxInput) maxInput.value = max;
  const hint = $('#chanceHint');
  if (hint) hint.textContent = `Максимальный шанс — ${max}%: даже если цель дешевле ставки, выше не поднимется.`;
}

async function saveChances() {
  const chanceByMultiplier = {};
  const max = Math.min(1, Math.max(0.01, Number($('#globalChance')?.value || 80) / 100));
  $$('[data-chance]').forEach((input) => {
    const percent = Math.min(max * 100, Math.max(0.1, Number(input.value) || 1));
    chanceByMultiplier[input.dataset.chance] = Number((percent / 100).toFixed(4));
  });
  try {
    const data = await api('/api/admin/upgrade/settings', {
      method: 'PATCH',
      body: JSON.stringify({ chanceByMultiplier, maxChance: max }),
    });
    state.chances = { ...state.chances, ...data.upgrade };
    state.config.economy = { ...state.config.economy, ...economyFromSettings(data.upgrade) };
    renderChanceEditor();
    renderMultipliers();
    toast('Шансы обновлены', 'ok');
  } catch (error) {
    toast(error.message, 'err');
  }
}

function economyFromSettings(upgrade) {
  return {
    multipliers: upgrade.multipliers,
    maxChance: upgrade.maxChance ?? 0.8,
  };
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
      if (tab.dataset.tab === 'cases') { loadCases(); loadCaseHistory(); renderWallet(); }
    };
  });

  $('#dailyBtn').onclick = async () => {
    try {
      const data = await api('/api/economy/daily', { method: 'POST' });
      toast(`Бонус начислен: ${money(state.econ ? data.coins - state.econ.coins : data.coins)}`, 'ok');
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
  $('#caseAgain') && ($('#caseAgain').onclick = () => {
    const caseId = $('#caseAgain').dataset.case;
    if (caseId) openCase(caseId, Number($('#caseCount')?.value || 1));
  });
  $('#caseClose') && ($('#caseClose').onclick = () => {
    const stage = $('#caseStageBlock');
    if (stage) stage.hidden = true;
    const prizes = $('#casePrizes');
    if (prizes) prizes.hidden = true;
  });
  $('#priceSyncBtn') && ($('#priceSyncBtn').onclick = syncPrices);
  $('#priceResetBtn') && ($('#priceResetBtn').onclick = resetPrices);
  $('#clearSelection').onclick = () => { state.selection = []; renderUpgradePicker(); updateChance(); };
  $('#selectCheap').onclick = () => {
    const cheap = (state.econ?.items || []).slice().sort((a, b) => a.price - b.price).slice(0, 5).map((i) => i.uid);
    state.selection = cheap;
    renderUpgradePicker();
    updateChance();
  };

  const saveChancesBtn = $('#saveChances');
  if (saveChancesBtn) saveChancesBtn.onclick = saveChances;
  renderCurrencyEditor();

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
    await loadSite();
    renderCurrencyPicker();
    await loadEconomy();
    await loadEquip();
    await loadChances();
    await loadTargets();
    updateChance();
    await loadCases();
    await loadHistory();
    await loadCaseHistory();
    await loadServers();
    await renderLoadouts();
    await loadAdmin();
    await loadPriceStatus();
  } catch (error) {
    toast(error.message, 'err');
  }
  setInterval(() => { if (state.user?.isAdmin) refreshStatus(); }, 15000);
  setInterval(() => { if (state.user) loadEconomy(); }, 30000);
})();
