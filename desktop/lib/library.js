const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createTag, getTagIdentity } = require('./tags');

class Library {
  constructor(directory, catalog) {
    this.directory = directory;
    this.catalog = catalog;
    this.tagsDirectory = path.join(directory, 'tags');
    this.indexPath = path.join(directory, 'library.json');
    fs.mkdirSync(this.tagsDirectory, { recursive: true });
    this.entries = [];
    if (fs.existsSync(this.indexPath)) {
      try {
        this.entries = JSON.parse(fs.readFileSync(this.indexPath, 'utf8'));
        if (!Array.isArray(this.entries) || this.entries.some((item) => !item || typeof item.key !== 'string' || !/^[\da-f-]{36}$/.test(item.key))) throw new Error('Invalid library index');
      } catch {
        throw new Error(`Не удалось прочитать библиотеку ${this.indexPath}. Файл сохранён без изменений. Восстановите его из резервной копии.`);
      }
    } else {
      for (const [id, type] of [[1, 'character'], [2, 'character'], [3, 'character'], [1006, 'vehicle']]) {
        if (catalog.some((item) => item.id === id && item.type === type)) this.create({ id, type });
      }
      this.save();
    }
  }

  save() {
    const temp = `${this.indexPath}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.entries, null, 2));
    fs.renameSync(temp, this.indexPath);
  }

  entry(key) {
    if (typeof key !== 'string') throw new Error('Выберите фигурку из библиотеки.');
    const found = this.entries.find((item) => item.key === key);
    if (!found) throw new Error('Фигурка не найдена в библиотеке.');
    return found;
  }

  file(key) { return path.join(this.tagsDirectory, `${this.entry(key).key}.bin`); }

  read(key) {
    const bytes = fs.readFileSync(this.file(key));
    const identity = getTagIdentity(bytes);
    const entry = this.entry(key);
    // Emulators may rebuild vehicles in-place, so re-read the current ID.
    const match = this.catalog.find((item) => item.type === identity.type && item.id === identity.id);
    if (entry.id !== identity.id || entry.uid !== identity.uid) {
      Object.assign(entry, { id: identity.id, type: identity.type, uid: identity.uid, name: match?.name || `Фигурка ${identity.id}`, world: match?.world || '' });
      this.save();
    }
    return bytes;
  }

  create({ id, type } = {}) {
    const item = this.catalog.find((entry) => entry.id === id && entry.type === type);
    if (!item) throw new Error('Выберите персонажа или транспорт из каталога.');
    return this.add(createTag({ id, type }));
  }

  add(bytes) {
    const identity = getTagIdentity(bytes);
    if (this.entries.some((entry) => entry.uid === identity.uid)) throw new Error('Фигурка с таким UID уже есть в библиотеке. Используйте её существующую копию.');
    const item = this.catalog.find((entry) => entry.id === identity.id && entry.type === identity.type);
    const key = randomUUID();
    const entry = { key, ...identity, name: item?.name || `Фигурка ${identity.id}`, world: item?.world || '' };
    const destination = path.join(this.tagsDirectory, `${key}.bin`);
    fs.writeFileSync(destination, bytes, { flag: 'wx' });
    this.entries.push(entry);
    try { this.save(); } catch (error) {
      this.entries.pop();
      fs.unlinkSync(destination);
      throw error;
    }
    return entry;
  }
}

module.exports = { Library };
