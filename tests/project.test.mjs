import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, rm, cp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { build, createBundle, projectRoot } from '../scripts/build.mjs';
import { scaffold } from '../scripts/new-card.mjs';

test('bundle is deterministic, self-contained, and matches HACS filename', async () => {
  const a = await createBundle(), b = await createBundle();
  assert.equal(a, b);
  assert.doesNotThrow(() => new vm.Script(a));
  assert.doesNotMatch(a, /\bimport\s+(?:\(|.*\bfrom\s)/);
  const hacs = JSON.parse(await readFile(path.join(projectRoot, 'hacs.json')));
  assert.equal(hacs.filename, 'ha-custom-cards.js');
  await build({ check: true });
});

test('generator makes a registered card, handles quoted titles, and never overwrites', async () => {
  const parent = path.join(projectRoot, '.tmp'); await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, 'scaffold-'));
  try {
    await cp(path.join(projectRoot, 'src'), path.join(root, 'src'), { recursive: true });
    await cp(path.join(projectRoot, 'package.json'), path.join(root, 'package.json'));
    const title = 'Mój "test" $& <script>';
    const result = await scaffold('test-card', title, root);
    assert.equal(result.type, 'custom:ha-test-card-card');
    const bundle = await readFile(path.join(root, 'dist/ha-custom-cards.js'), 'utf8');
    const registry = new Map();
    const window = {};
    vm.runInNewContext(bundle, { window, HTMLElement: class {}, customElements: {
      get: name => registry.get(name), define: (name, value) => registry.set(name, value),
    } });
    assert.equal(registry.get('ha-test-card-card').getStubConfig().title, title);
    assert.equal(window.customCards.length, 4);
    await assert.rejects(scaffold('test-card', 'Nadpisanie', root));
    for (const bad of ['../escape', 'x/y', 'zła', '', 'blank', 'powiedz-w-domu', 'pomieszczenie']) {
      await assert.rejects(scaffold(bad, 'Bad', root));
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('syntax errors fail the build without replacing the last valid artifact', async () => {
  const parent = path.join(projectRoot, '.tmp'); await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, 'build-'));
  try {
    await cp(path.join(projectRoot, 'src'), path.join(root, 'src'), { recursive: true });
    await cp(path.join(projectRoot, 'package.json'), path.join(root, 'package.json'));
    const destination = await build({ root });
    const before = await readFile(destination, 'utf8');
    await writeFile(path.join(root, 'src/cards/blank/card.js'), 'const = broken;');
    await assert.rejects(build({ root }));
    assert.equal(await readFile(destination, 'utf8'), before);
  } finally { await rm(root, { recursive: true, force: true }); }
});
