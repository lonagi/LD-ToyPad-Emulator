# node-ld cryptography

The accompanying crypto.js is adapted from node-ld by Adam Shumann (ISC).
Only character-key derivation, the 32-round TEA cipher, and password generation are retained. Buffer allocation uses current Node APIs and both halves of decoded IDs are exposed for validation.

Original source blobs inspected:
- https://github.com/Berny23/node-ld/blob/master/src/lib/CharCrypto.js (blob d2b62a84a8dd69fb2d1e55f05029465555e43d19)
- https://github.com/Berny23/node-ld/blob/master/src/lib/TEA.js (blob 3bc5cb8e11fd8b7b6f7bf845643ee3c5d709187b)
- https://github.com/Berny23/node-ld/blob/master/src/lib/PWDGen.js (blob dbe168d8b0fa299a268900da6b5eafb54e1b91bd)

The original license is preserved in LICENSE.

