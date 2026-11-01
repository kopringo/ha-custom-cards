import { readFile, writeFile } from 'node:fs/promises';
import { projectRoot } from './build.mjs';
import path from 'node:path';
const version = process.env.RELEASE_VERSION || process.argv[2];
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version || '')) {
  throw new Error('Podaj wersję MAJOR.MINOR.PATCH, np. 1.0.1, bez prefiksu v.');
}
const file = path.join(projectRoot, 'package.json');
const pkg = JSON.parse(await readFile(file, 'utf8'));
pkg.version = version;
await writeFile(file, `${JSON.stringify(pkg, null, 2)}\n`);
console.log(`Wersja: ${version}`);
