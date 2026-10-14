import {readFileSync, writeFileSync} from 'node:fs';
import {openerDisplaySchema} from '../src/presentation/opener-display.js';
const path = new URL('../docs/opener-display.schema.json', import.meta.url);
const content = JSON.stringify(openerDisplaySchema, null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (readFileSync(path, 'utf8') !== content) throw new Error('Opener display schema drift');
} else writeFileSync(path, content);
