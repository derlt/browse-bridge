import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dir, '..');
const out = path.join(root, 'dist', 'extension');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'service'), { recursive: true });

for (const file of ['package.json', 'README.md', 'DOCUMENTATION.md', 'LICENSE', 'browse-bridge.example.json']) {
  fs.copyFileSync(path.join(root, file), path.join(out, file));
}
const localConfig = path.join(root, 'browse-bridge.json');
if (fs.existsSync(localConfig)) fs.copyFileSync(localConfig, path.join(out, 'browse-bridge.json'));
fs.copyFileSync(path.join(root, 'service', 'main.js'), path.join(out, 'service', 'main.js'));

console.log(`Extension packed at ${out}`);
