import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Per-user, per-machine encrypted storage for the SIP/JWT session blob.
 *
 * Backed by Electron's safeStorage API:
 *   - Windows  → DPAPI (per Windows user profile)
 *   - macOS    → Keychain (per macOS user, requires app to be code-signed
 *                in production for the key to survive across launches)
 *   - Linux    → libsecret via gnome-keyring or kwallet, with a kernel
 *                keyring or "basic text encryption" fallback that
 *                isEncryptionAvailable() will report honestly
 *
 * Ciphertext is opaque bytes from safeStorage.encryptString() and is not
 * portable across machines or OS user accounts. Copying the secure file
 * to another machine yields decryption failure, which is the desired
 * behavior — credentials don't leak with the on-disk artifact.
 *
 * This wrapper is intentionally small and pure of Electron globals: it
 * takes a SafeStorageLike interface and a base directory, so it can be
 * unit-tested with a mock safeStorage and a tmp dir.
 */

export const SECURE_FILE_NAME = 'ddconnect-secure.bin';

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(cipher: Buffer): string;
}

export type SecureGetResult<T> =
  | { ok: true; data: T | null }
  | { ok: false; error: string };

export type SecureWriteResult =
  | { ok: true }
  | { ok: false; error: string };

export class SecureStore {
  constructor(
    private readonly safe: SafeStorageLike,
    private readonly baseDir: string,
    private readonly fileName: string = SECURE_FILE_NAME,
  ) {}

  /** Where the ciphertext lives on disk. */
  filePath(): string {
    return path.join(this.baseDir, this.fileName);
  }

  /**
   * Whether OS-level encryption is currently usable. Returns false if
   * the platform keychain refuses (locked Linux session, broken
   * gnome-keyring, etc.). Callers MUST refuse to persist credentials
   * if this returns false — there is no plaintext fallback.
   */
  isAvailable(): boolean {
    try {
      return this.safe.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  async get<T>(): Promise<SecureGetResult<T>> {
    const filePath = this.filePath();
    if (!existsSync(filePath)) return { ok: true, data: null };
    if (!this.isAvailable()) {
      return { ok: false, error: 'OS keychain unavailable' };
    }
    try {
      const buf = await fs.readFile(filePath);
      const plain = this.safe.decryptString(buf);
      return { ok: true, data: JSON.parse(plain) as T };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async set<T>(payload: T): Promise<SecureWriteResult> {
    if (!this.isAvailable()) {
      return { ok: false, error: 'OS keychain unavailable' };
    }
    try {
      const cipher = this.safe.encryptString(JSON.stringify(payload));
      const filePath = this.filePath();
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      // mode 0o600 has no effect on Windows (NTFS uses ACLs from the
      // userData dir, which Electron already restricts to the current
      // user). On POSIX it locks the file to the running user.
      await fs.writeFile(filePath, cipher, { mode: 0o600 });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async delete(): Promise<SecureWriteResult> {
    const filePath = this.filePath();
    try {
      if (existsSync(filePath)) await fs.unlink(filePath);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }
}
