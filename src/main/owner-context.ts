import { app } from 'electron';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** The owner's notes about themselves/their work (Markdown), used as context for answers. */
const file = (): string => join(app.getPath('userData'), 'context.md');

export function readOwnerContext(): string {
  try {
    return readFileSync(file(), 'utf8');
  } catch {
    return '';
  }
}

export function writeOwnerContext(text: string): void {
  const target = file();
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(`${target}.tmp`, text);
  renameSync(`${target}.tmp`, target);
}
