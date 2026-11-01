import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectRoot, build } from './build.mjs';

export async function scaffold(slug, title, root = projectRoot) {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(slug || '')) {
    throw new Error('Nazwa: małe litery ASCII, cyfry i myślniki, np. pogoda-dom.');
  }
  if (['blank', 'powiedz-w-domu', 'starter', 'pomieszczenie'].includes(slug)) throw new Error('Ta nazwa jest zarezerwowana.');
  const destination = path.join(root, 'src/cards', slug);
  const source = await readFile(path.join(root, 'src/cards/blank/card.js'), 'utf8');
  let card = source.replace('"ha-starter-card"', JSON.stringify(`ha-${slug}-card`));
  card = card.replaceAll('"Pusta karta"', () => JSON.stringify(title || slug));
  card = card.replace('Pusty szablon do tworzenia własnych kart.', 'Własna karta Home Assistant.');
  await mkdir(destination); // Fails if it exists; never overwrites another card.
  try {
    await writeFile(path.join(destination, 'card.js'), card, { flag: 'wx' });
    await build({ root });
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    throw error;
  }
  return { destination, type: `custom:ha-${slug}-card` };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await scaffold(process.argv[2], process.argv[3]);
    console.log(`Utworzono ${result.destination}\nTyp w HA: ${result.type}\nPakiet dist został przebudowany.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
