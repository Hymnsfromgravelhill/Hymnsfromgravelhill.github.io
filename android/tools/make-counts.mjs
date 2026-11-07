// Writes counts.json (hymns per book) for the app's book shelf.
// usage: node make-counts.mjs <path to parser.mjs> <output counts.json>   (run from the repo root)
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const { parseBook } = await import(pathToFileURL(process.argv[2]).href);
const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
const counts = {};
for (const d of config.datasets) {
  counts[d.path] = parseBook(fs.readFileSync(d.path, 'utf8'), d.name).hymns.filter((h) => h.number !== '0').length;
}
fs.writeFileSync(process.argv[3], JSON.stringify(counts));
console.log(counts);
