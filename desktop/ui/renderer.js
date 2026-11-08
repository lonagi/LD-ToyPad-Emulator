'use strict';

const api = window.toypad;
const $ = (id) => document.getElementById(id);
const zones = { 'zone-left': [0, 3, 4], 'zone-center': [1], 'zone-right': [2, 5, 6] };
const slotLabels = ['Левая, верх', 'Центр', 'Правая, верх', 'Левая, низ слева', 'Левая, низ справа', 'Правая, низ слева', 'Правая, низ справа'];
let state = { catalog: [], library: [], slots: Array(7).fill(null), settings: { port: 9191 }, connection: { connected: false, message: 'Ожидание эмулятора' } };
let tab = 'library';
let selectedKey = null;
let selectedCatalogKey = null;
let busy = false;
let noticeTimer;
let listSignature = '';
let padSignature = '';

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function catalogKey(item) { return `${item.type}:${item.id}`; }
function initials(name) { return String(name || '?').replace(/^\*\s*/, '').split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join('').toUpperCase(); }
function libraryItem(key) { return state.library.find((item) => item.key === key); }
function catalogItem() { return state.catalog.find((item) => catalogKey(item) === selectedCatalogKey); }
function selectedItem() { return tab === 'library' ? libraryItem(selectedKey) : catalogItem(); }

function notice(message, error = false) {
  clearTimeout(noticeTimer);
  const box = $('notice');
  box.textContent = message;
  box.className = error ? 'notice error' : 'notice';
  box.hidden = false;
  if (!error) noticeTimer = setTimeout(() => { box.hidden = true; }, 6500);
}

function applyState(next) {
  if (!next || !Array.isArray(next.catalog) || !Array.isArray(next.library)) return;
  state = next;
  if (selectedKey && !libraryItem(selectedKey)) selectedKey = null;
  if (selectedCatalogKey && !catalogItem()) selectedCatalogKey = null;
  if (document.activeElement !== $('port')) $('port').value = state.settings.port;
  render();
}

async function run(action, success) {
  if (busy) return;
  busy = true;
  render();
  try {
    const result = await action();
    applyState(result);
    if (success) notice(success);
    return result;
  } catch (error) {
    notice(String(error?.message || error || 'Не удалось выполнить действие.'), true);
    return null;
  } finally {
    busy = false;
    render();
  }
}

function switchTab(next) {
  tab = next;
  $('search').value = '';
  render();
}

function render() {
  const connected = !!state.connection?.connected;
  $('connection-dot').classList.toggle('connected', connected);
  $('connection-heading').textContent = connected ? 'Подключено к Toypad listener' : 'Ожидание эмулятора';
  $('connection-message').textContent = state.connection?.message || (connected ? 'Локальное подключение готово.' : 'Запусти совместимую сборку и открой LEGO Dimensions.');
  $('connect').textContent = busy ? 'Подожди…' : connected ? 'Проверить' : 'Подключить';
  $('connect').disabled = busy;
  $('port').disabled = busy;
  $('import').disabled = busy;
  $('library-count').textContent = state.library.length;
  $('library-tab').setAttribute('aria-selected', String(tab === 'library'));
  $('catalog-tab').setAttribute('aria-selected', String(tab === 'catalog'));
  $('library-tab').tabIndex = tab === 'library' ? 0 : -1;
  $('catalog-tab').tabIndex = tab === 'catalog' ? 0 : -1;
  $('figure-list').setAttribute('aria-labelledby', `${tab}-tab`);
  renderList();
  renderDetails();
  renderPad();
  renderLEDs();
}

function renderList() {
  const list = $('figure-list');
  const scroll = list.scrollTop;
  const query = $('search').value.trim().toLocaleLowerCase();
  const type = $('type-filter').value;
  const source = tab === 'library' ? state.library : state.catalog;
  const signature = JSON.stringify([source, query, type, tab, selectedKey, selectedCatalogKey, busy]);
  if (signature === listSignature) return;
  listSignature = signature;
  const focusedKey = document.activeElement?.closest('.figure-row')?.dataset.key;
  const rows = source.filter((item) => {
    const detail = item.abilities || state.catalog.find((entry) => entry.id === item.id && entry.type === item.type)?.abilities || '';
    return (type === 'all' || item.type === type) && `${item.name} ${item.world || ''} ${detail}`.toLocaleLowerCase().includes(query);
  });
  $('result-count').textContent = `${rows.length} из ${source.length}`;
  list.replaceChildren();
  if (rows.length === 0) {
    const empty = element('div', 'empty-state');
    empty.append(element('h3', '', source.length === 0 && tab === 'library' ? 'Начни свою коллекцию' : 'Ничего не найдено'));
    empty.append(element('p', '', source.length === 0 && tab === 'library' ? 'Добавь Batman, Gandalf и других героев из каталога или импортируй свои .bin.' : 'Попробуй другое имя, мир или способность.'));
    if (source.length === 0 && tab === 'library') {
      const button = element('button', 'secondary', 'Открыть каталог');
      button.addEventListener('click', () => switchTab('catalog'));
      empty.append(button);
    }
    list.append(empty);
  }
  for (const item of rows) {
    const isSelected = tab === 'library' ? item.key === selectedKey : catalogKey(item) === selectedCatalogKey;
    const row = element('button', `figure-row${isSelected ? ' is-selected' : ''}`);
    row.type = 'button';
    row.dataset.key = tab === 'library' ? item.key : catalogKey(item);
    row.setAttribute('aria-pressed', String(isSelected));
    row.setAttribute('aria-label', `${item.name}, ${item.world || (item.type === 'vehicle' ? 'Транспорт' : 'Персонаж')}`);
    const glyph = element('span', `figure-glyph ${item.type === 'vehicle' ? 'vehicle' : ''}`, initials(item.name));
    glyph.setAttribute('aria-hidden', 'true');
    const copy = element('span', 'figure-copy');
    copy.append(element('span', 'figure-name', item.name), element('span', 'figure-world', item.world || `ID ${item.id}`));
    row.append(glyph, copy);
    if (isSelected) row.append(element('span', 'figure-check', '✓'));
    row.addEventListener('click', () => {
      if (tab === 'library') selectedKey = item.key;
      else selectedCatalogKey = catalogKey(item);
      render();
    });
    if (tab === 'library') {
      row.draggable = !busy;
      row.addEventListener('dragstart', (event) => {
        selectedKey = item.key;
        event.dataTransfer.setData('application/x-toypad-key', item.key);
        event.dataTransfer.effectAllowed = 'copyMove';
      });
    }
    list.append(row);
  }
  list.scrollTop = scroll;
  if (focusedKey) Array.from(list.querySelectorAll('.figure-row')).find((row) => row.dataset.key === focusedKey)?.focus({ preventScroll: true });
}

function renderDetails() {
  const item = selectedItem();
  $('selection-details').hidden = !item;
  if (!item) return;
  $('selected-world').textContent = item.world || (item.type === 'vehicle' ? 'Транспорт и гаджеты' : 'Персонаж');
  $('selected-name').textContent = item.name;
  const detail = state.catalog.find((entry) => entry.id === item.id && entry.type === item.type);
  $('selected-abilities').textContent = String(item.abilities || detail?.abilities || `ID ${item.id}`).split(',').join(' · ');
  $('selection-action').textContent = tab === 'catalog' ? 'Добавить в коллекцию' : 'Экспортировать .bin';
  $('selection-action').disabled = busy;
}

function renderPad() {
  const slots = Array.isArray(state.slots) ? state.slots : Array(7).fill(null);
  const selected = libraryItem(selectedKey);
  const connected = !!state.connection?.connected;
  $('occupied-count').textContent = `${slots.filter(Boolean).length} / 7`;
  $('placement-hint').textContent = !state.library.length ? 'Добавь фигуру из каталога или импортируй файл .bin.' : !connected ? 'Коллекция готова. Подключи эмулятор, чтобы размещать фигуры в игре.' : selected ? `Выбрано: ${selected.name}. Нажми на место, чтобы отправить фигуру в игру.` : 'Выбери фигуру в коллекции, затем нажми на место на паде.';
  const signature = JSON.stringify([slots, selectedKey, connected, busy, state.library]);
  if (signature === padSignature) return;
  padSignature = signature;
  for (const [zoneId, indexes] of Object.entries(zones)) {
    const zone = $(zoneId);
    zone.replaceChildren();
    for (const index of indexes) {
      const item = libraryItem(slots[index]);
      const card = element('div', `slot-card${item ? ' occupied' : ''}`);
      const button = element('button', 'slot-button');
      button.type = 'button';
      button.disabled = !connected || !selected || busy;
      button.setAttribute('aria-label', `Место ${index + 1}: ${slotLabels[index]}. ${item ? item.name : 'Пусто'}.${selected ? ` Разместить ${selected.name}.` : ''}`);
      button.title = !connected ? 'Сначала подключи эмулятор' : !selected ? 'Сначала выбери фигуру в коллекции' : `Разместить ${selected.name}`;
      button.append(element('span', 'slot-number', String(index + 1)), element('span', 'slot-glyph', item ? initials(item.name) : '+'), element('span', 'slot-name', item ? item.name : 'Пусто'));
      button.addEventListener('click', () => placeSelected(index));
      card.append(button);
      card.addEventListener('dragover', (event) => { if (connected && !busy && event.dataTransfer.types.includes('application/x-toypad-key')) event.preventDefault(); });
      card.addEventListener('drop', (event) => {
        event.preventDefault();
        if (!connected || busy) return;
        const key = event.dataTransfer.getData('application/x-toypad-key');
        if (!libraryItem(key)) return;
        selectedKey = key;
        placeSelected(index);
      });
      if (item) {
        const actions = element('div', 'slot-actions');
        const move = element('button', 'slot-action', 'Переместить');
        move.type = 'button';
        move.disabled = !connected || busy;
        move.setAttribute('aria-label', `Переместить ${item.name} с места ${index + 1}`);
        move.addEventListener('click', () => showMoveMenu(card, index));
        const remove = element('button', 'slot-action', 'Убрать');
        remove.type = 'button';
        remove.disabled = !connected || busy;
        remove.setAttribute('aria-label', `Убрать ${item.name} с места ${index + 1}`);
        remove.addEventListener('click', () => run(() => api.remove({ slot: index }), 'Команда удаления отправлена в эмулятор.'));
        actions.append(move, remove);
        card.append(actions);
      }
      zone.append(card);
    }
  }
}

function renderLEDs() {
  for (const pad of [1, 2, 3]) {
    const indicator = $(`led-${pad}`);
    const region = state.leds?.regions?.find((entry) => entry.pad === pad);
    const valid = !!state.connection?.connected && region && [region.r, region.g, region.b].every((value) => Number.isInteger(value) && value >= 0 && value <= 255);
    indicator.classList.toggle('known', !!valid);
    if (!valid) {
      indicator.style.backgroundColor = '';
      indicator.title = 'Цвет LED пока неизвестен';
    } else {
      indicator.style.backgroundColor = region.mode === 0 ? '#76869a' : `rgb(${region.r}, ${region.g}, ${region.b})`;
      const mode = ['выключен', 'постоянный', 'мигание', 'плавный переход'][region.mode] || 'неизвестный режим';
      indicator.title = `LED: ${mode}. Цвет команды игры; анимация здесь не воспроизводится.`;
    }
    indicator.setAttribute('aria-label', indicator.title);
  }
}

function showMoveMenu(card, from) {
  if (card.querySelector('select')) return;
  const menu = element('select', 'move-menu');
  menu.setAttribute('aria-label', 'Куда переместить фигуру');
  const placeholder = element('option', '', 'Выбери место…');
  placeholder.value = '';
  menu.append(placeholder);
  for (let to = 0; to < 7; to++) {
    if (to === from || state.slots[to]) continue;
    const option = element('option', '', `${to + 1}. ${slotLabels[to]}`);
    option.value = String(to);
    menu.append(option);
  }
  if (menu.options.length === 1) { notice('Нет свободных мест. Сначала убери одну из фигур.'); return; }
  menu.addEventListener('change', () => {
    if (menu.value === '') return;
    run(() => api.move({ from, to: Number(menu.value) }), 'Команда перемещения отправлена в эмулятор.');
  });
  card.append(menu);
  menu.focus();
}

function placeSelected(slot) {
  if (!selectedKey || !state.connection?.connected || busy) return;
  run(() => api.place({ key: selectedKey, slot }), 'Команда размещения отправлена. Проверь фигуру в игре.');
}

$('library-tab').addEventListener('click', () => switchTab('library'));
$('catalog-tab').addEventListener('click', () => switchTab('catalog'));
for (const id of ['library-tab', 'catalog-tab']) $(id).addEventListener('keydown', (event) => {
  if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    switchTab(event.key === 'Home' ? 'library' : event.key === 'End' ? 'catalog' : tab === 'library' ? 'catalog' : 'library');
    $(`${tab}-tab`).focus();
  }
});
$('search').addEventListener('input', renderList);
$('type-filter').addEventListener('change', renderList);
$('import').addEventListener('click', async () => {
  const before = new Set(state.library.map((item) => item.key));
  const result = await run(() => api.importTags());
  if (!result) return;
  const imported = state.library.filter((item) => !before.has(item.key));
  if (imported.length) {
    selectedKey = imported[0].key;
    switchTab('library');
    notice(`Добавлено фигур: ${imported.length}.`);
  }
});
$('selection-action').addEventListener('click', async () => {
  const item = selectedItem();
  if (!item) return;
  if (tab === 'catalog') {
    const before = new Set(state.library.map((entry) => entry.key));
    const result = await run(() => api.create({ id: item.id, type: item.type }));
    if (!result) return;
    const created = state.library.find((entry) => !before.has(entry.key));
    if (created) selectedKey = created.key;
    switchTab('library');
    notice(`${item.name} добавлен в коллекцию.`);
  } else {
    const result = await run(() => api.exportTag({ key: item.key }));
    if (result && !result.cancelled) notice('Фигура сохранена в выбранный файл .bin.');
  }
});
$('connection-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const port = Number($('port').value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) { notice('Порт должен быть числом от 1 до 65535.', true); return; }
  run(() => api.probe({ port }));
});
$('help').addEventListener('click', () => run(() => api.openHelp()));
$('data-folder').addEventListener('click', () => run(() => api.openDataFolder()));

if (!api) {
  notice('Приложение не смогло загрузить модуль управления. Закрой его и запусти снова.', true);
  $('connection-message').textContent = 'Модуль управления недоступен.';
  $('connect').disabled = true;
  $('import').disabled = true;
} else {
  api.onState(applyState);
  run(() => api.bootstrap());
}
