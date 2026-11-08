const { app, BrowserWindow, ipcMain, Menu, dialog, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { ToypadBridge, validatePort, validateSlot } = require('./lib/bridge');
const { Library } = require('./lib/library');

app.setName('LD Toy Pad');
if (process.env.LD_TOYPAD_DATA_DIR) app.setPath('userData', path.resolve(process.env.LD_TOYPAD_DATA_DIR));
const isPrimary = app.requestSingleInstanceLock();
if (!isPrimary) app.quit();

let window;
let library;
let bridge;
let settings;
let settingsPath;
let catalog;
let poll;
let queue = Promise.resolve();
let connection = { connected: false, message: 'Ожидание совместимого эмулятора. Каталог доступен без подключения.' };
let slots = Array(7).fill(null);
let leds = null;
const pageURL = pathToFileURL(path.join(__dirname, 'ui', 'index.html')).href;

const enqueue = (task) => {
  const pending = queue.then(task);
  queue = pending.catch(() => {});
  return pending;
};

function snapshot() {
  return { catalog, library: library.entries, settings, slots, connection, leds, dataPath: library.directory };
}

function broadcast() {
  if (window && !window.isDestroyed()) window.webContents.send('toypad:state', snapshot());
  return snapshot();
}

function disconnected(error) {
  connection = { connected: false, message: error.message };
  leds = null;
  // This protocol cannot query occupied slots. Never display stale placements.
  slots = Array(7).fill(null);
  broadcast();
}

async function probe() {
  try {
    leds = await bridge.probe();
    connection = { connected: true, message: 'Toypad Listener подключён. Расположение показывает отправленные команды.' };
  } catch (error) { disconnected(error); }
  return broadcast();
}

async function command(task) {
  if (!connection.connected) throw new Error('Сначала подключите совместимый эмулятор кнопкой «Подключить».');
  try { await task(); } catch (error) { disconnected(error); throw error; }
  connection.message = 'Команда отправлена. Проверьте результат в игре.';
  return broadcast();
}

function register(name, handler) {
  ipcMain.handle(`toypad:${name}`, (event, input) => {
    if (!window || event.sender !== window.webContents || event.senderFrame?.url !== pageURL) throw new Error('Недопустимый источник команды.');
    return enqueue(() => handler(input));
  });
}

function installHandlers() {
  register('bootstrap', () => snapshot());
  register('create', (input) => { library.create(input); return broadcast(); });
  register('import', async () => {
    const result = await dialog.showOpenDialog(window, { title: 'Импорт фигурок', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Toy Tag (180 bytes)', extensions: ['bin'] }] });
    if (result.canceled) return snapshot();
    const errors = [];
    for (const file of result.filePaths) {
      try {
        if (fs.statSync(file).size !== 180) throw new Error('Требуется файл размером 180 байт.');
        library.add(fs.readFileSync(file));
      } catch (error) { errors.push(`${path.basename(file)}: ${error.message}`); }
    }
    if (errors.length) await dialog.showMessageBox(window, { type: 'warning', message: 'Часть фигурок не удалось импортировать', detail: errors.join('\n') });
    return broadcast();
  });
  register('place', async ({ key, slot } = {}) => {
    validateSlot(slot);
    const existingSlot = slots.indexOf(key);
    if (existingSlot !== -1 && existingSlot !== slot) throw new Error('Эта фигурка уже на паде. Используйте перемещение или создайте другую копию.');
    const bytes = library.read(key);
    return command(async () => { await bridge.load(slot, bytes, library.file(key)); slots[slot] = key; });
  });
  register('remove', async ({ slot } = {}) => {
    validateSlot(slot);
    const previous = slots[slot];
    return command(async () => {
      await bridge.remove(slot);
      slots[slot] = null;
      if (previous) library.read(previous);
    });
  });
  register('move', async ({ from, to } = {}) => {
    validateSlot(from); validateSlot(to);
    if (from === to || !slots[from]) throw new Error('Выберите занятую позицию и другое пустое место.');
    if (slots[to]) throw new Error('Сначала освободите место назначения.');
    return command(async () => { await bridge.move(from, to); slots[to] = slots[from]; slots[from] = null; });
  });
  register('probe', async ({ port = settings.port } = {}) => {
    validatePort(port);
    if (settings.port !== port) {
      settings = { port };
      const temp = `${settingsPath}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(settings, null, 2));
      fs.renameSync(temp, settingsPath);
      bridge = new ToypadBridge({ port });
      slots = Array(7).fill(null);
    }
    return probe();
  });
  register('export', async ({ key } = {}) => {
    if (slots.includes(key)) throw new Error('Сначала уберите фигурку с пада, чтобы эмулятор сохранил её последние изменения.');
    const bytes = library.read(key);
    const entry = library.entry(key);
    const safeName = entry.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
    const result = await dialog.showSaveDialog(window, { defaultPath: `${safeName}.bin`, filters: [{ name: 'Toy Tag', extensions: ['bin'] }] });
    if (result.canceled || !result.filePath) return { cancelled: true };
    if (path.resolve(result.filePath).startsWith(path.resolve(library.tagsDirectory) + path.sep)) throw new Error('Для экспорта выберите папку вне внутренней библиотеки.');
    fs.writeFileSync(result.filePath, bytes);
    return { cancelled: false, path: result.filePath };
  });
  register('folder', async () => {
    const error = await shell.openPath(library.directory);
    if (error) throw new Error(error);
  });
  register('help', async () => {
    const result = await dialog.showMessageBox(window, {
      type: 'info', title: 'Подключение к LEGO Dimensions', message: 'Нужен Cemu или RPCS3 с Toypad Listener v2',
      detail: '1. Установите совместимую сборку по ссылке ниже. Обычные сборки не принимают команды этого приложения.\n2. В Cemu включите Dimensions Toypad в Tools → Emulated USB Devices.\n3. Запустите LEGO Dimensions.\n4. Оставьте порт 9191 и нажмите «Подключить». Выберите фигурку и место на паде.\n\nДля macOS понадобится самостоятельно собранный эмулятор с этим listener: готовая совместимая macOS-сборка здесь не прилагается.\n\nУлучшения сохраняет эмулятор в файлы библиотеки. Перед закрытием приложения уберите фигурки с пада. Приложение не содержит игру и не подключается к настоящей консоли.',
      buttons: ['Закрыть', 'Cemu: совместимая сборка', 'RPCS3: совместимая сборка'], defaultId: 0, cancelId: 0,
    });
    const urls = ['https://github.com/harrysof/Cemu-2.6-Remote-Toypad-Build', 'https://github.com/NeverCookFirst/RPCS3-Seamless-Toypad-Build'];
    if (result.response > 0) await shell.openExternal(urls[result.response - 1]);
  });
}

function createWindow() {
  window = new BrowserWindow({ width: 1220, height: 850, minWidth: 960, minHeight: 680, title: 'LD Toy Pad', backgroundColor: '#f4f5f7', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => { window = null; });
  window.loadFile(path.join(__dirname, 'ui', 'index.html'));
}

app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => clearInterval(poll));

if (isPrimary) app.whenReady().then(() => {
  const dataDirectory = app.getPath('userData');
  fs.mkdirSync(dataDirectory, { recursive: true });
  settingsPath = path.join(dataDirectory, 'settings.json');
  settings = { port: 9191 };
  if (fs.existsSync(settingsPath)) {
    try { const saved = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); settings.port = validatePort(saved.port); } catch { /* Preserve corrupt settings; default port remains usable. */ }
  }
  const catalogRoot = fs.existsSync(path.join(__dirname, 'data', 'charactermap.json')) ? path.join(__dirname, 'data') : path.join(__dirname, '..', 'server', 'json');
  catalog = [['charactermap.json', 'character'], ['tokenmap.json', 'vehicle']].flatMap(([file, type]) => JSON.parse(fs.readFileSync(path.join(catalogRoot, file), 'utf8')).map((entry) => ({ ...entry, type })));
  library = new Library(dataDirectory, catalog);
  bridge = new ToypadBridge(settings);
  installHandlers();
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { role: 'editMenu' }, { label: 'Окно', submenu: [{ role: 'reload' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }, { role: 'minimize' }, { role: 'close' }] },
  ]));
  createWindow();
  let polling = false;
  poll = setInterval(() => {
    if (polling) return;
    polling = true;
    enqueue(probe).finally(() => { polling = false; });
  }, 3000);
}).catch((error) => { dialog.showErrorBox('LD Toy Pad не удалось запустить', error.message); app.exit(1); });
