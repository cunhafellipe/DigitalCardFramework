import {readFileSync, writeFileSync} from 'node:fs';
import {editorTransformSchema} from '../src/presentation/editor-transforms.js';
const path = new URL('../docs/editor-transform.schema.json', import.meta.url);
const content = JSON.stringify(editorTransformSchema, null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (readFileSync(path, 'utf8') !== content) throw new Error('Editor transform schema drift');
} else writeFileSync(path, content);
