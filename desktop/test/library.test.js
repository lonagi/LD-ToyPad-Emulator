const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Library } = require('../lib/library');
const { createTag, getTagIdentity } = require('../lib/tags');

const catalog = [
  { id: 1, type: 'character', name: 'Batman', world: 'DC Comics' },
  { id: 2, type: 'character', name: 'Gandalf', world: 'The Lord of the Rings' },
  { id: 3, type: 'character', name: 'Wyldstyle', world: 'The LEGO Movie' },
  { id: 1000, type: 'vehicle', name: 'Police Car', world: 'The LEGO Movie' },
  { id: 1001, type: 'vehicle', name: 'Aerial Squad Car', world: 'The LEGO Movie' },
  { id: 1006, type: 'vehicle', name: 'Batmobile', world: 'DC Comics' },
];

function directory(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ld-toypad-library-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('initial library survives restart without regenerating any tag or UID', (t) => {
  const dir = directory(t);
  const original = new Library(dir, catalog);
  assert.equal(original.entries.length, 4);
  const before = original.entries.map((entry) => ({ entry: { ...entry }, bytes: original.read(entry.key) }));
  const restarted = new Library(dir, catalog);
  assert.deepEqual(restarted.entries, before.map((item) => item.entry));
  for (const item of before) assert.deepEqual(restarted.read(item.entry.key), item.bytes);
});

test('creating the same character twice creates independent files with distinct NFC UIDs', (t) => {
  const library = new Library(directory(t), catalog);
  const first = library.create({ id: 1, type: 'character' });
  const second = library.create({ id: 1, type: 'character' });
  assert.notEqual(first.key, second.key);
  assert.notEqual(first.uid, second.uid);
  assert.notEqual(library.file(first.key), library.file(second.key));
  assert.equal(getTagIdentity(library.read(first.key)).id, 1);
  assert.equal(getTagIdentity(library.read(second.key)).id, 1);
});

test('import copies exact bytes and rejects duplicate NFC UID without changing the index', (t) => {
  const library = new Library(directory(t), catalog);
  const tag = createTag({ id: 1000, type: 'vehicle', uid: '04112233445580' });
  tag.writeUInt32LE(0x12345678, 35 * 4);
  tag.writeUInt32LE(0xabcdef01, 37 * 4);
  const imported = library.add(tag);
  assert.deepEqual(fs.readFileSync(library.file(imported.key)), tag);
  const before = fs.readFileSync(library.indexPath);
  assert.throws(() => library.add(Buffer.from(tag)), /UID/);
  assert.deepEqual(fs.readFileSync(library.indexPath), before);
});

test('in-game upgrades and rebuilt vehicle model are reread and preserved across restart', (t) => {
  const dir = directory(t);
  const library = new Library(dir, catalog);
  const vehicle = library.create({ id: 1000, type: 'vehicle' });
  const changed = library.read(vehicle.key);
  changed.writeUInt32LE(0x1177aabb, 35 * 4);
  changed.writeUInt32LE(0x993355ee, 37 * 4);
  changed.writeUInt32LE(1001, 36 * 4);
  fs.writeFileSync(library.file(vehicle.key), changed); // Simulate emulator writes.
  assert.deepEqual(library.read(vehicle.key), changed);
  assert.equal(library.entry(vehicle.key).id, 1001);
  assert.equal(library.entry(vehicle.key).name, 'Aerial Squad Car');
  const restarted = new Library(dir, catalog);
  assert.equal(restarted.entry(vehicle.key).id, 1001);
  assert.deepEqual(restarted.read(vehicle.key), changed);
});

test('read refreshes identity when emulator changes a duplicated figure UID', (t) => {
  const dir = directory(t);
  const library = new Library(dir, catalog);
  const entry = library.create({ id: 1, type: 'character' });
  const changed = createTag({ id: 1, type: 'character', uid: '04aabbccddee80' });
  fs.writeFileSync(library.file(entry.key), changed);
  assert.deepEqual(library.read(entry.key), changed);
  assert.equal(library.entry(entry.key).uid, '04aabbccddee80');
  assert.equal(new Library(dir, catalog).entry(entry.key).uid, '04aabbccddee80');
  assert.throws(() => library.add(changed), /UID/);
});

test('invalid import and unknown catalog ID leave library files unchanged', (t) => {
  const library = new Library(directory(t), catalog);
  const before = fs.readFileSync(library.indexPath);
  const files = fs.readdirSync(library.tagsDirectory).sort();
  assert.throws(() => library.add(Buffer.alloc(179)));
  assert.throws(() => library.add(Buffer.alloc(180)));
  assert.throws(() => library.create({ id: 999, type: 'character' }));
  assert.throws(() => library.read('../../outside'));
  assert.deepEqual(fs.readFileSync(library.indexPath), before);
  assert.deepEqual(fs.readdirSync(library.tagsDirectory).sort(), files);
});

test('malformed and traversal library indexes are preserved for recovery, never reset', (t) => {
  for (const content of ['{broken', '{}', JSON.stringify([{ key: '../../outside' }])]) {
    const dir = path.join(directory(t), 'library');
    fs.mkdirSync(dir);
    const index = path.join(dir, 'library.json');
    fs.writeFileSync(index, content);
    assert.throws(() => new Library(dir, catalog), /сохранён без изменений/);
    assert.equal(fs.readFileSync(index, 'utf8'), content);
  }
});

test('failed index save rolls back the new tag without losing existing entries', (t) => {
  const library = new Library(directory(t), catalog);
  const before = library.entries.slice();
  const files = fs.readdirSync(library.tagsDirectory).sort();
  library.save = () => { throw new Error('simulated disk full'); };
  assert.throws(() => library.create({ id: 1, type: 'character' }), /disk full/);
  assert.deepEqual(library.entries, before);
  assert.deepEqual(fs.readdirSync(library.tagsDirectory).sort(), files);
});
