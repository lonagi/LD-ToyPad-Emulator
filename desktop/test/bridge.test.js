const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { ToypadBridge, PAD_BY_SLOT, loadPacket, parseLED, validatePort, validateSlot } = require('../lib/bridge');

const LED = Buffer.from([
  0x4c, 17, 2, 3,
  1, 1, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  2, 2, 0, 255, 0, 1, 2, 3, 4, 5, 6, 7,
  3, 3, 0, 0, 255, 10, 20, 30, 8, 9, 0, 11,
]);

async function listener(t, handle) {
  const sockets = new Set();
  const messages = [];
  const errors = [];
  let active = 0;
  let maximumActive = 0;
  const server = net.createServer({ allowHalfOpen: true }, (socket) => {
    sockets.add(socket);
    active++;
    maximumActive = Math.max(maximumActive, active);
    const chunks = [];
    socket.on('error', () => {});
    socket.on('data', (chunk) => chunks.push(chunk));
    // Both emulator implementations see the client's EOF after receiving the
    // exact command. Waiting for EOF here verifies that the client half-closes.
    socket.on('end', async () => {
      const bytes = Buffer.concat(chunks);
      messages.push(bytes);
      try { await handle(socket, bytes, messages.length); }
      catch (error) { errors.push(error); socket.destroy(); }
    });
    socket.on('close', () => { active--; sockets.delete(socket); });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
    assert.deepEqual(errors, [], 'mock listener must complete without assertion errors');
  });
  return { port: server.address().port, messages, maximumActive: () => maximumActive };
}

test('real TCP listener accepts one command per connection with client half-close', async (t) => {
  const mock = await listener(t, (socket, bytes) => {
    if (bytes[0] === 4) socket.end(LED);
    else socket.end();
  });
  const bridge = new ToypadBridge({ port: mock.port, timeout: 1000 });
  const tag = Buffer.alloc(180, 0xa7);
  const tagPath = '/tmp/Фигурки/Бэтмен 🦇.bin';
  await bridge.load(0, tag, tagPath);
  await bridge.move(0, 1);
  await bridge.remove(1);
  assert.equal(mock.messages.length, 6);
  assert.deepEqual(mock.messages.filter((_, index) => index % 2 === 0), Array.from({ length: 3 }, () => Buffer.from([4, 0, 0, 0, 0])));
  const loaded = mock.messages[1];
  assert.deepEqual([...loaded.subarray(0, 5)], [1, 2, 0, 0, 0]);
  assert.deepEqual(loaded.subarray(5, 185), tag);
  assert.equal(loaded.readUInt16LE(185), Buffer.byteLength(tagPath, 'utf8'));
  assert.equal(loaded.subarray(187).toString('utf8'), tagPath);
  assert.deepEqual([...mock.messages[3]], [3, 1, 1, 2, 0]);
  assert.deepEqual([...mock.messages[5]], [2, 1, 1, 0, 0]);
});

test('probe reconstructs a fragmented LED v2 response across TCP chunks', async (t) => {
  const mock = await listener(t, async (socket) => {
    socket.write(LED.subarray(0, 3));
    await new Promise((resolve) => setTimeout(resolve, 8));
    socket.write(LED.subarray(3, 21));
    await new Promise((resolve) => setTimeout(resolve, 8));
    socket.end(LED.subarray(21));
  });
  const result = await new ToypadBridge({ port: mock.port, timeout: 1000 }).probe();
  assert.equal(result.serial, 17);
  assert.deepEqual(result.regions[2], { pad: 3, mode: 3, r: 0, g: 0, b: 255, fromR: 10, fromG: 20, fromB: 30, onTicks: 8, offTicks: 9, count: 0, speedTicks: 11 });
});

test('legacy LED v1 listener is rejected before any LOAD can be sent', async (t) => {
  const legacy = Buffer.alloc(30);
  legacy.set([0x4c, 0, 3]);
  const mock = await listener(t, (socket) => socket.end(legacy));
  const bridge = new ToypadBridge({ port: mock.port, timeout: 1000 });
  await assert.rejects(bridge.load(0, Buffer.alloc(180), ''), /v2|верс/);
  assert.equal(mock.messages.length, 1);
  assert.equal(mock.messages[0][0], 4);
});

test('truncated and oversized replies reject, then the same bridge recovers', async (t) => {
  const mock = await listener(t, (socket, _bytes, index) => {
    if (index === 1) socket.end(LED.subarray(0, 39));
    else if (index === 2) socket.end(Buffer.concat([LED, Buffer.from([0])]));
    else socket.end(LED);
  });
  const bridge = new ToypadBridge({ port: mock.port, timeout: 1000 });
  await assert.rejects(bridge.probe(), /Неполный/);
  await assert.rejects(bridge.probe(), /Неожиданный/);
  assert.equal((await bridge.probe()).serial, 17);
});

test('a silent half-open server times out and does not poison the command queue', async (t) => {
  const mock = await listener(t, (socket, _bytes, index) => {
    if (index > 1) socket.end(LED);
  });
  const bridge = new ToypadBridge({ port: mock.port, timeout: 60 });
  await assert.rejects(bridge.probe(), /вовремя/);
  assert.equal((await bridge.probe()).regions.length, 3);
});

test('server close before a response is not treated as a successful probe', async (t) => {
  const mock = await listener(t, (socket) => socket.destroy());
  await assert.rejects(new ToypadBridge({ port: mock.port, timeout: 1000 }).probe());
});

test('concurrent requests wait for previous response/EOF before another connection', async (t) => {
  let firstHandled = false;
  const mock = await listener(t, async (socket, _bytes, index) => {
    if (index === 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(mock.messages.length, 1);
      firstHandled = true;
    } else assert.equal(firstHandled, true);
    socket.end(LED);
  });
  const bridge = new ToypadBridge({ port: mock.port, timeout: 1000 });
  const replies = await Promise.all([bridge.probe(), bridge.probe(), bridge.probe()]);
  assert.equal(mock.messages.length, 3);
  assert.equal(replies.length, 3);
});

test('all seven slots encode the physical center/left/right wire mapping', () => {
  assert.deepEqual(PAD_BY_SLOT, [2, 1, 3, 2, 2, 3, 3]);
  for (let slot = 0; slot < 7; slot++) {
    const bytes = loadPacket(slot, Buffer.alloc(180), '');
    assert.deepEqual([...bytes.subarray(0, 5)], [1, PAD_BY_SLOT[slot], slot, 0, 0]);
    assert.equal(bytes.length, 187);
    assert.equal(bytes.readUInt16LE(185), 0);
  }
});

test('invalid slots, ports, tag sizes and unsafe paths are rejected', () => {
  for (const value of [-1, 7, 1.5, NaN, '1', null, undefined]) assert.throws(() => validateSlot(value));
  for (const value of [0, -1, 65536, 1.5, NaN, '9191', null]) assert.throws(() => validatePort(value));
  for (const size of [0, 179, 181]) assert.throws(() => loadPacket(0, Buffer.alloc(size)));
  assert.throws(() => loadPacket(0, new Uint8Array(180)));
  assert.throws(() => loadPacket(0, Buffer.alloc(180), '/tmp/a\0.bin'));
  assert.throws(() => loadPacket(0, Buffer.alloc(180), 'я'.repeat(32768)));
  assert.throws(() => loadPacket(0, Buffer.alloc(180), 123));
});

test('LED parser rejects unknown version, duplicate pads and unknown modes', () => {
  for (const [offset, value] of [[0, 0], [2, 1], [3, 2], [16, 1], [5, 4]]) {
    const bytes = Buffer.from(LED);
    bytes[offset] = value;
    assert.throws(() => parseLED(bytes));
  }
});
