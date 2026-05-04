import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  SecureStore,
  SECURE_FILE_NAME,
  type SafeStorageLike,
} from './secureStore';

// Toy reversible "encryption" for the available-mock: tag the bytes so a
// test can assert (a) the wrapper called encryptString before writing,
// (b) decryptString sees the same bytes back, (c) garbage bytes raise.
const MAGIC = Buffer.from('ENC:');
function makeAvailableSafe(): SafeStorageLike {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plain) =>
      Buffer.concat([MAGIC, Buffer.from(plain, 'utf8')]),
    decryptString: (cipher) => {
      if (!cipher.subarray(0, MAGIC.length).equals(MAGIC)) {
        throw new Error('not encrypted by this safeStorage');
      }
      return cipher.subarray(MAGIC.length).toString('utf8');
    },
  };
}

function makeUnavailableSafe(): SafeStorageLike {
  return {
    isEncryptionAvailable: () => false,
    encryptString: () => {
      throw new Error('encryption not available');
    },
    decryptString: () => {
      throw new Error('encryption not available');
    },
  };
}

describe('SecureStore', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ddconnect-secure-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  describe('with safeStorage available', () => {
    it('round-trips a payload through encrypt → write → read → decrypt', async () => {
      const store = new SecureStore(makeAvailableSafe(), tmp);
      const payload = {
        access: 'jwt-access',
        refresh: 'jwt-refresh',
        sip_config: { password: 'super-secret-sip-pw' },
      };

      const setResult = await store.set(payload);
      expect(setResult.ok).toBe(true);

      const filePath = path.join(tmp, SECURE_FILE_NAME);
      expect(fs.existsSync(filePath)).toBe(true);
      // The on-disk bytes must NOT contain the cleartext password.
      const onDisk = fs.readFileSync(filePath);
      expect(onDisk.toString('utf8')).toContain('ENC:');
      expect(onDisk.toString('utf8')).toContain('super-secret-sip-pw');
      // (the toy mock leaves the password recoverable; the real DPAPI
      // does not — this test only proves the wrapper called encrypt
      // before writing, not that the cipher is strong)

      const getResult = await store.get<typeof payload>();
      expect(getResult.ok).toBe(true);
      if (getResult.ok) {
        expect(getResult.data).toEqual(payload);
      }
    });

    it('returns ok with data:null when no file exists', async () => {
      const store = new SecureStore(makeAvailableSafe(), tmp);
      const r = await store.get();
      expect(r).toEqual({ ok: true, data: null });
    });

    it('reports decrypt failure as ok:false with an error message', async () => {
      const store = new SecureStore(makeAvailableSafe(), tmp);
      // Drop a file that wasn't produced by encryptString — decrypt
      // should reject and the wrapper should surface the error.
      fs.writeFileSync(path.join(tmp, SECURE_FILE_NAME), Buffer.from('garbage'));
      const r = await store.get();
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error).toMatch(/not encrypted/);
      }
    });

    it('delete() removes the on-disk ciphertext', async () => {
      const store = new SecureStore(makeAvailableSafe(), tmp);
      await store.set({ x: 1 });
      expect(fs.existsSync(path.join(tmp, SECURE_FILE_NAME))).toBe(true);

      const r = await store.delete();
      expect(r.ok).toBe(true);
      expect(fs.existsSync(path.join(tmp, SECURE_FILE_NAME))).toBe(false);
    });

    it('delete() is idempotent when no file exists', async () => {
      const store = new SecureStore(makeAvailableSafe(), tmp);
      const r = await store.delete();
      expect(r.ok).toBe(true);
    });
  });

  describe('with safeStorage unavailable', () => {
    it('isAvailable() returns false', () => {
      const store = new SecureStore(makeUnavailableSafe(), tmp);
      expect(store.isAvailable()).toBe(false);
    });

    it('set() refuses to write and reports error (no plaintext fallback)', async () => {
      const store = new SecureStore(makeUnavailableSafe(), tmp);
      const r = await store.set({ password: 'must-not-leak' });
      expect(r.ok).toBe(false);
      // Critically, no file is created — we don't fall back to
      // plaintext when the keychain is unavailable.
      expect(fs.existsSync(path.join(tmp, SECURE_FILE_NAME))).toBe(false);
    });

    it('get() refuses to read existing ciphertext when keychain unavailable', async () => {
      // Plant a file as if a previous launch wrote ciphertext, then
      // simulate the keychain becoming unavailable on this launch.
      fs.writeFileSync(
        path.join(tmp, SECURE_FILE_NAME),
        Buffer.from('ENC:{"x":1}'),
      );
      const store = new SecureStore(makeUnavailableSafe(), tmp);
      const r = await store.get();
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/keychain unavailable/i);
    });

    it('isAvailable() swallows throws from the underlying API', () => {
      const throwy: SafeStorageLike = {
        isEncryptionAvailable: () => {
          throw new Error('keychain crashed');
        },
        encryptString: () => Buffer.alloc(0),
        decryptString: () => '',
      };
      const store = new SecureStore(throwy, tmp);
      expect(store.isAvailable()).toBe(false);
    });
  });
});
