import { packager } from '@electron/packager';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [platform = process.platform, arch = process.arch] = process.argv.slice(2);
if (!['darwin', 'win32'].includes(platform) || !['arm64', 'x64'].includes(arch)) throw new Error('Unsupported build target');
fs.mkdirSync(path.join(root, 'data'), { recursive: true });
for (const file of ['charactermap.json', 'tokenmap.json']) {
  fs.copyFileSync(path.join(root, '..', 'server', 'json', file), path.join(root, 'data', file));
}
fs.copyFileSync(path.join(root, '..', 'LICENSE'), path.join(root, 'LICENSE'));
const result = await packager({
  dir: root, name: 'LD Toy Pad', executableName: 'LD Toy Pad',
  platform, arch, out: path.join(root, 'dist'), overwrite: true,
  electronVersion: '45.2.3', asar: true, prune: true,
  appBundleId: 'app.ldtoypad.desktop', appCategoryType: 'public.app-category.games',
  darwinDarkModeSupport: true,
  ignore: [/^\/dist($|\/)/, /^\/test($|\/)/, /^\/scripts($|\/)/, /^\/package-lock\.json$/],
  download: { cacheRoot: process.env.ELECTRON_CACHE },
});
console.log(result.join('\n'));
