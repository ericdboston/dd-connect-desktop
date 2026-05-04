import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { SecureStore } from './secureStore';

/**
 * One-shot migration from the legacy electron-store credential file
 * (encrypted with a static obfuscation key that was baked into the
 * v0.1.7 binary) to the safeStorage-backed split layout used in 0.1.8+:
 *
 *   <userData>/ddconnect-auth.json     (legacy, encrypted with static key)
 *     ──→
 *   <userData>/ddconnect-secure.bin    (session blob, OS-encrypted)
 *   <userData>/ddconnect-prefs.json    (non-secret prefs, plaintext)
 *
 * Behavior:
 *   - If no legacy file exists, this is a no-op.
 *   - If the legacy file exists but safeStorage is unavailable, the
 *     legacy file is left in place untouched and the migration result
 *     reports an error so the renderer can prompt re-login.
 *   - If migration succeeds for the session blob and prefs, the legacy
 *     file is deleted. The renderer can hydrate from the new layout
 *     immediately.
 *
 * The historical static key appears here as a single inline string
 * literal scoped to the migrate function. It is no longer exported,
 * referenced from any other module, or stored in a named constant. The
 * 0.1.8 binary still contains the literal because migration needs it,
 * but no other code path uses it. Once the 0.1.8 fleet has fully
 * upgraded, this file should be deleted in 0.2.0.
 */

const LEGACY_FILE_NAME = 'ddconnect-auth.json';
const LEGACY_SESSION_KEY = 'session';
const LEGACY_PREF_KEYS = [
  'login:rememberedExtension',
  'login:serverUrl',
  'audio:input',
  'audio:output',
  'recents:clearedBefore',
] as const;

export interface MigrationResult {
  hadLegacyFile: boolean;
  migrated: boolean;
  migratedSession: boolean;
  migratedPrefCount: number;
  error?: string;
}

export interface PrefsStoreLike {
  set(key: string, value: unknown): void;
}

export async function migrateLegacyStore(
  userDataDir: string,
  secureStore: SecureStore,
  prefsStore: PrefsStoreLike,
): Promise<MigrationResult> {
  const legacyPath = path.join(userDataDir, LEGACY_FILE_NAME);
  if (!existsSync(legacyPath)) {
    return {
      hadLegacyFile: false,
      migrated: false,
      migratedSession: false,
      migratedPrefCount: 0,
    };
  }

  if (!secureStore.isAvailable()) {
    return {
      hadLegacyFile: true,
      migrated: false,
      migratedSession: false,
      migratedPrefCount: 0,
      error: 'safeStorage unavailable; legacy file left untouched',
    };
  }

  let legacy: { get: (k: string) => unknown };
  try {
    const { default: Store } = await import('electron-store');
    // Single-purpose use of the v0.1.7 obfuscation key. Inlined to keep
    // it out of any reusable surface — do NOT lift this back into a
    // shared constant or helper.
    legacy = new (Store as unknown as new (opts: unknown) => {
      get: (k: string) => unknown;
    })({
      name: 'ddconnect-auth',
      cwd: userDataDir,
      encryptionKey: 'ddconnect-desktop-v1',
    });
  } catch (err) {
    return {
      hadLegacyFile: true,
      migrated: false,
      migratedSession: false,
      migratedPrefCount: 0,
      error: `legacy store open failed: ${(err as Error).message}`,
    };
  }

  let migratedSession = false;
  let migratedPrefCount = 0;

  try {
    const session = legacy.get(LEGACY_SESSION_KEY);
    if (session && typeof session === 'object') {
      const result = await secureStore.set(session);
      if (!result.ok) {
        return {
          hadLegacyFile: true,
          migrated: false,
          migratedSession: false,
          migratedPrefCount: 0,
          error: `safeStorage write failed: ${result.error}`,
        };
      }
      migratedSession = true;
    }

    for (const key of LEGACY_PREF_KEYS) {
      const v = legacy.get(key);
      if (v !== undefined && v !== null) {
        prefsStore.set(key, v);
        migratedPrefCount++;
      }
    }

    await fs.unlink(legacyPath);
  } catch (err) {
    return {
      hadLegacyFile: true,
      migrated: false,
      migratedSession,
      migratedPrefCount,
      error: (err as Error).message,
    };
  }

  return {
    hadLegacyFile: true,
    migrated: true,
    migratedSession,
    migratedPrefCount,
  };
}
