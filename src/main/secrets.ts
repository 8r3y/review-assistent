import { app, safeStorage } from 'electron';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

type SecretName = 'deepgramApiKey';

/** API keys encrypted with the OS keychain (DPAPI on Windows) and stored in userData. */
export class SecretStore {
  private data: Partial<Record<SecretName, string>>;

  constructor(private readonly file = join(app.getPath('userData'), 'secrets.json')) {
    try {
      this.data = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Record<SecretName, string>>;
    } catch {
      this.data = {};
    }
  }

  has(name: SecretName): boolean {
    return Boolean(this.data[name]);
  }

  get(name: SecretName): string | null {
    const stored = this.data[name];
    if (!stored) return null;
    try {
      return safeStorage.decryptString(Buffer.from(stored, 'base64'));
    } catch {
      return null;
    }
  }

  set(name: SecretName, value: string | null): void {
    if (value) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('OS encryption is not available');
      this.data[name] = safeStorage.encryptString(value).toString('base64');
    } else {
      delete this.data[name];
    }
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    renameSync(tmp, this.file);
  }
}
