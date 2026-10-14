import {readFileSync, writeFileSync} from 'node:fs';
import {albumDisplaySchema} from '../src/presentation/album-display.js';
const path = new URL('../docs/album-display.schema.json', import.meta.url);
const content = JSON.stringify(albumDisplaySchema, null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (readFileSync(path, 'utf8') !== content) throw new Error('Album display schema drift');
} else writeFileSync(path, content);
