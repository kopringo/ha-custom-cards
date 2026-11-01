import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));

export async function createBundle(root = projectRoot) {
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const shared = (await readdir(path.join(root, 'src/shared'))).filter(f => f.endsWith('.js')).sort();
  const folders = (await readdir(path.join(root, 'src/cards'), { withFileTypes: true }))
    .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  const sources = shared.map(name => path.join('src/shared', name));
  for (const folder of folders) {
    const files = (await readdir(path.join(root, 'src/cards', folder))).filter(f => f.endsWith('.js')).sort();
    for (const name of files) sources.push(path.join('src/cards', folder, name));
  }
  const chunks = [];
  for (const relative of sources) {
    const content = await readFile(path.join(root, relative), 'utf8');
    new vm.Script(content, { filename: relative });
    chunks.push(`// Source: ${relative.split(path.sep).join('/')}\n${content.trim()}\n;`);
  }
  const bundle = `/** ha-custom-cards v${pkg.version} | MIT | Generated: edit src/, not dist/. */\n(() => {\n'use strict';\n${chunks.join('\n\n')}\n})();\n`;
  new vm.Script(bundle, { filename: 'ha-custom-cards.js' });
  return bundle;
}

export async function build({ root = projectRoot, check = false } = {}) {
  const bundle = await createBundle(root);
  const destination = path.join(root, 'dist', 'ha-custom-cards.js');
  if (check) {
    const current = await readFile(destination, 'utf8').catch(() => '');
    if (current !== bundle) throw new Error('dist jest nieaktualny. Uruchom npm run build.');
  } else {
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, bundle);
  }
  return destination;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(await build({ check: process.argv.includes('--check') }));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
