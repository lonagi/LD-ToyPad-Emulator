# Virtual tag format

The desktop client generates 180-byte virtual LEGO Dimensions tags. It does not use or include game files. Its catalog comes from the parent project's `server/json/charactermap.json` and `tokenmap.json`; catalog labels may include unreleased characters and unknown vehicles, whose in-game behavior is not guaranteed.

`lib/tags.js` exports:

- `createTag({id, type, uid?})`: a new 180-byte `Buffer`. `type` is `character` or `vehicle`. Character IDs are 1–999; vehicle IDs are 1000–65535, with 0 allowed for a blank writable vehicle tag. The caller should offer IDs from the project catalog.
- `getTagIdentity(buffer)`: `{id, type, uid}`. The UID is a lowercase 14-character hexadecimal string. Only exact 180-byte buffers are accepted; malformed identity data is rejected.
- `TAG_SIZE`: 180.

The optional UID is a 7-byte Buffer or exactly 14 hexadecimal characters. When omitted, Node's cryptographic random generator supplies a new UID, with the same manufacturer/end bytes used by Cemu (`04…80`). Generating another copy of a character creates an independent UID. Retain existing UIDs when reopening saved tags. Copying a file does **not** create a new identity: callers must prevent placing the same UID twice. Never regenerate a UID in an existing character tag without re-encrypting its identity.

| Location | Contents |
| --- | --- |
| Bytes 0–2 and 4–7 | Seven-byte UID |
| Bytes 3 and 8 | UID check bytes; skipped by the emulator's identity decoder |
| Page 35 (`0x8c`) | Vehicle upgrade data, initially zero |
| Pages 36–37 (`0x90`) | Character ID repeated twice and TEA-encrypted with a UID-derived key |
| Page 36 (`0x90`) on vehicles | Unencrypted 32-bit little-endian vehicle ID |
| Page 37 (`0x94`) on vehicles | Vehicle upgrade data, initially zero |
| Page 38 (`0x98`) on vehicles | `00 01 00 00` writable-vehicle marker |
| Page 43 (`0xac`) on characters | UID-derived password |

The cryptographic routines are adapted from Adam Shumann's ISC-licensed node-ld. The license and exact source blob IDs are retained in `vendor/node-ld`. Character payloads and passwords are checked against frozen outputs from the original upstream implementations. Binary layout was checked against `CreateFigure`, `GetFigureId`, and `WriteBlock` in [official Cemu source](https://github.com/cemu-project/Cemu/blob/main/src/Cafe/OS/libs/nsyshid/Dimensions.cpp) (inspected blob `b23560f11fab62c231eab679571b727da9b96718`). Cemu implementation code is not bundled or copied into the client.

Create each tag only once, store it in a writable application-data folder, and pass that persistent absolute file path to the compatible emulator's LOAD command. The emulator owns in-game writes to the file. Re-read its contents before a later LOAD so saved vehicle upgrades and rebuild IDs are kept. `getTagIdentity` does not modify any bytes. Do not replace a saved file with a newly generated tag on every placement.

Validation proves the byte format and upstream crypto compatibility; it is not a substitute for an end-to-end test with LEGO Dimensions running. These files target software emulators and are not a tool for programming physical NFC tags.
