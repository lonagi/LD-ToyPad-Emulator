'use strict';

// Adapted from node-ld CharCrypto.js, TEA.js and PWDGen.js.
// Copyright (c) 2015, Adam Shumann. ISC license; see LICENSE in this directory.
const CHAR_CONSTANT = Buffer.from('b7d5d7e6e7ba3ca8d8754768cf23e9feaa', 'hex');
const rotr = (value, bits) => ((value >>> bits) | (value << (32 - bits))) >>> 0;

function scramble(bytes, count) {
  let value = 0;
  for (let i = 0; i < count; i++) {
    value = (bytes.readUInt32LE(i * 4) + rotr(value, 25) + rotr(value, 10) - value) >>> 0;
  }
  const result = Buffer.alloc(4);
  result.writeUInt32LE(value);
  return result;
}

function characterKey(uid) {
  return Buffer.concat([3, 4, 5, 6].map(count => {
    const bytes = Buffer.concat([uid, CHAR_CONSTANT]);
    bytes[count * 4 - 1] = 0xaa;
    return scramble(bytes, count);
  }));
}

function tea(block, key, decrypt = false) {
  const words = [0, 4, 8, 12].map(offset => key.readUInt32LE(offset));
  let a = block.readUInt32LE(0);
  let b = block.readUInt32LE(4);
  let sum = decrypt ? 0xc6ef3720 : 0;
  const delta = 0x9e3779b9;
  for (let i = 0; i < 32; i++) {
    if (decrypt) {
      b = (b - (((a << 4) + words[2]) ^ (a + sum) ^ ((a >>> 5) + words[3]))) >>> 0;
      a = (a - (((b << 4) + words[0]) ^ (b + sum) ^ ((b >>> 5) + words[1]))) >>> 0;
      sum = (sum - delta) >>> 0;
    } else {
      sum = (sum + delta) >>> 0;
      a = (a + (((b << 4) + words[0]) ^ (b + sum) ^ ((b >>> 5) + words[1]))) >>> 0;
      b = (b + (((a << 4) + words[2]) ^ (a + sum) ^ ((a >>> 5) + words[3]))) >>> 0;
    }
  }
  const result = Buffer.alloc(8);
  result.writeUInt32LE(a, 0);
  result.writeUInt32LE(b, 4);
  return result;
}

function encryptCharacter(uid, id) {
  const block = Buffer.alloc(8);
  block.writeUInt32LE(id, 0);
  block.writeUInt32LE(id, 4);
  return tea(block, characterKey(uid));
}

function decryptCharacter(uid, bytes) {
  return tea(bytes, characterKey(uid), true);
}

function password(uid) {
  const bytes = Buffer.from('UUUUUUU(c) Copyright LEGO 2014AA', 'ascii');
  uid.copy(bytes);
  bytes[30] = bytes[31] = 0xaa;
  return scramble(bytes, 8);
}

module.exports = { encryptCharacter, decryptCharacter, password };
