'use strict';

const { randomBytes } = require('node:crypto');
const { encryptCharacter, decryptCharacter, password } = require('../vendor/node-ld/crypto');

const TAG_SIZE = 180;
const MODEL_OFFSET = 36 * 4;
const VEHICLE_MARKER_OFFSET = 38 * 4;

function normalizeUid(value) {
  if (value === undefined) {
    const uid = randomBytes(7);
    uid[0] = 0x04;
    uid[6] = 0x80;
    return uid;
  }
  if (typeof value === 'string' && /^[a-fA-F0-9]{14}$/.test(value)) {
    return Buffer.from(value, 'hex');
  }
  if (Buffer.isBuffer(value) && value.length === 7) return Buffer.from(value);
  throw new TypeError('UID must be a 7-byte Buffer or 14 hexadecimal characters.');
}

/** Create a new virtual tag. Never call this to update an existing tag file. */
function createTag({ id, type, uid: suppliedUid } = {}) {
  if (type !== 'character' && type !== 'vehicle') {
    throw new TypeError('Tag type must be character or vehicle.');
  }
  if (!Number.isInteger(id) ||
      (type === 'character' && (id < 1 || id >= 1000)) ||
      (type === 'vehicle' && id !== 0 && (id < 1000 || id > 0xffff))) {
    throw new RangeError('Invalid ID for this tag type.');
  }
  const uid = normalizeUid(suppliedUid);
  const tag = Buffer.alloc(TAG_SIZE);
  uid.copy(tag, 0, 0, 3);
  uid.copy(tag, 4, 3, 7);
  // UID check bytes follow the NTAG layout. The emulators skip these bytes.
  tag[3] = 0x88 ^ uid[0] ^ uid[1] ^ uid[2];
  tag[8] = uid[3] ^ uid[4] ^ uid[5] ^ uid[6];
  if (type === 'character') {
    encryptCharacter(uid, id).copy(tag, MODEL_OFFSET);
    password(uid).copy(tag, 43 * 4);
  } else {
    tag.writeUInt32LE(id, MODEL_OFFSET);
    tag[VEHICLE_MARKER_OFFSET + 1] = 1;
    // Vehicle upgrade pages 35 and 37 start empty; the game owns later writes.
  }
  return tag;
}

/** Decode only the identity; do not alter imported data or in-game upgrades. */
function getTagIdentity(tag) {
  if (!Buffer.isBuffer(tag) || tag.length !== TAG_SIZE) {
    throw new TypeError('A Toy Pad tag must contain exactly 180 bytes.');
  }
  const uidBytes = Buffer.concat([tag.subarray(0, 3), tag.subarray(4, 8)]);
  const uid = uidBytes.toString('hex');
  if (tag[VEHICLE_MARKER_OFFSET] === 0 && tag[VEHICLE_MARKER_OFFSET + 1] === 1) {
    const id = tag.readUInt32LE(MODEL_OFFSET);
    if (id === 0 || (id >= 1000 && id <= 0xffff)) return { id, type: 'vehicle', uid };
    throw new Error('The vehicle tag contains an invalid model ID.');
  }
  const decrypted = decryptCharacter(uidBytes, tag.subarray(MODEL_OFFSET, MODEL_OFFSET + 8));
  const id = decrypted.readUInt32LE(0);
  if (id > 0 && id < 1000 && decrypted.readUInt32LE(4) === id) {
    return { id, type: 'character', uid };
  }
  throw new Error('The file is not a recognized LEGO Dimensions character or vehicle tag.');
}

module.exports = { TAG_SIZE, createTag, getTagIdentity };
