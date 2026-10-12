// Formats sources with prettier-eslint (prettier, then eslint --fix).
// Usage: node scripts/format.mjs --write | --check [paths...]
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, join, relative, resolve } from 'node:path';
import * as prettier from 'prettier';
import { format } from 'prettier-eslint';

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, '..');
const EXTENSIONS = new Set(['.ts', '.tsx', '.mjs', '.js', '.json', '.css', '.html']);
const ESLINT_EXTENSIONS = new Set(['.ts', '.tsx', '.mjs', '.js']);
const IGNORED_DIRS = new Set(['node_modules', 'out', 'dist', 'resources', '.git']);
const IGNORED_FILES = new Set(['package-lock.json']);

const args = process.argv.slice(2);
const mode = args.includes('--check') ? 'check' : 'write';
const targets = args.filter((a) => !a.startsWith('--'));

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) yield* walk(join(dir, entry.name));
    } else if (EXTENSIONS.has(extname(entry.name)) && !IGNORED_FILES.has(entry.name)) {
      yield join(dir, entry.name);
    }
  }
}

async function* files() {
  if (targets.length === 0) {
    yield* walk(root);
    return;
  }
  for (const t of targets) {
    const p = resolve(root, t);
    if (EXTENSIONS.has(extname(p))) yield p;
    else yield* walk(p);
  }
}

const eslintPath = require.resolve('eslint');
const prettierPath = require.resolve('prettier');
const unformatted = [];

for await (const filePath of files()) {
  const text = await readFile(filePath, 'utf8');
  const output = ESLINT_EXTENSIONS.has(extname(filePath))
    ? await format({ text, filePath, eslintPath, prettierPath, logLevel: 'warn' })
    : await prettier.format(text, { ...(await prettier.resolveConfig(filePath)), filepath: filePath });
  if (output === text) continue;
  if (mode === 'write') await writeFile(filePath, output);
  unformatted.push(relative(root, filePath));
}

if (unformatted.length > 0) {
  console.log(`${mode === 'write' ? 'Formatted' : 'Needs formatting'}:\n  ${unformatted.join('\n  ')}`);
  if (mode === 'check') process.exitCode = 1;
}
