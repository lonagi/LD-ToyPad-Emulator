const net = require('node:net');

// Wire pads differ from physical slot indices. Verified against listener v2.
const PAD_BY_SLOT = Object.freeze([2, 1, 3, 2, 2, 3, 3]);

function validatePort(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Порт должен быть целым числом от 1 до 65535.');
  return port;
}

function validateSlot(slot) {
  if (!Number.isInteger(slot) || slot < 0 || slot > 6) throw new Error('Выберите одно из семи мест на паде.');
  return slot;
}

function parseLED(data) {
  if (data.length !== 40 || data[0] !== 0x4c || data[2] !== 2 || data[3] !== 3) {
    throw new Error('Неподдерживаемая версия подключения. Нужен Toypad Listener с протоколом LED v2.');
  }
  const regions = [];
  const seen = new Set();
  for (let offset = 4; offset < 40; offset += 12) {
    const [pad, mode, r, g, b, fromR, fromG, fromB, onTicks, offTicks, count, speedTicks] = data.subarray(offset, offset + 12);
    if (pad < 1 || pad > 3 || seen.has(pad) || mode > 3) throw new Error('Некорректный ответ Toypad Listener.');
    seen.add(pad);
    regions.push({ pad, mode, r, g, b, fromR, fromG, fromB, onTicks, offTicks, count, speedTicks });
  }
  return { serial: data[1], regions };
}

function packet(command, slot, oldSlot) {
  validateSlot(slot);
  if (oldSlot !== undefined) validateSlot(oldSlot);
  return Buffer.from([command, PAD_BY_SLOT[slot], slot, oldSlot === undefined ? 0 : PAD_BY_SLOT[oldSlot], oldSlot ?? 0]);
}

function loadPacket(slot, data, filePath = '') {
  if (!Buffer.isBuffer(data) || data.length !== 180) throw new Error('Файл фигурки должен содержать ровно 180 байт.');
  if (typeof filePath !== 'string' || filePath.includes('\0')) throw new Error('Некорректный путь к фигурке.');
  const encodedPath = Buffer.from(filePath, 'utf8');
  if (encodedPath.length > 65535) throw new Error('Слишком длинный путь к фигурке.');
  const length = Buffer.alloc(2);
  length.writeUInt16LE(encodedPath.length);
  return Buffer.concat([packet(1, slot), data, length, encodedPath]);
}

// One connection per command works with both Cemu and RPCS3. The emulator
// sends no acknowledgement for changes; successful writes mean "sent" only.
class ToypadBridge {
  constructor({ port = 9191, timeout = 3000 } = {}) {
    this.port = validatePort(port);
    this.timeout = timeout;
    this.queue = Promise.resolve();
  }

  request(bytes, expectedLength = 0) {
    const run = () => new Promise((resolve, reject) => {
      let received = Buffer.alloc(0);
      let settled = false;
      const socket = net.createConnection({ host: '127.0.0.1', port: this.port });
      const finish = (error) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        error ? reject(error) : resolve(received);
      };
      socket.setTimeout(this.timeout);
      socket.on('connect', () => socket.end(bytes));
      socket.on('data', (chunk) => {
        received = Buffer.concat([received, chunk]);
        if (received.length > expectedLength) finish(new Error('Неожиданный ответ от Toypad Listener.'));
      });
      socket.on('end', () => {
        if (received.length !== expectedLength) {
          finish(new Error('Неполный ответ эмулятора. Требуется Toypad Listener v2.'));
        } else finish();
      });
      socket.on('timeout', () => finish(new Error('Эмулятор не ответил вовремя. Проверьте, что игра запущена.')));
      socket.on('error', (error) => finish(new Error(error.code === 'ECONNREFUSED'
        ? 'Нет подключения. Запустите LEGO Dimensions в сборке Cemu или RPCS3 с Toypad Listener.'
        : `Соединение прервано: ${error.code || error.message}`)));
      socket.on('close', () => {
        if (!settled) finish(new Error('Эмулятор закрыл соединение до окончания команды.'));
      });
    });
    const pending = this.queue.then(run);
    this.queue = pending.catch(() => {});
    return pending;
  }

  async probe() { return parseLED(await this.request(Buffer.from([4, 0, 0, 0, 0]), 40)); }
  async load(slot, data, filePath) { await this.probe(); await this.request(loadPacket(slot, data, filePath)); }
  async remove(slot) { const bytes = packet(2, slot); await this.probe(); await this.request(bytes); }
  async move(from, to) {
    if (from === to) throw new Error('Выберите другое место для перемещения.');
    const bytes = packet(3, to, from);
    await this.probe();
    await this.request(bytes);
  }
}

module.exports = { ToypadBridge, PAD_BY_SLOT, validatePort, validateSlot, parseLED, loadPacket };
