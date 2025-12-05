// src/domain/identity/sharedKey.ts
//
// Simple client‑side helper for managing the Finance Cockpit
// "sync key". The sync key is a random secret string stored in
// localStorage that will be used to identify the same logical user
// across devices once a backend is wired up.
//
// Design notes:
// - The key itself is *not* a user ID; the backend will map it to a
//   stable userId.
// - For now this module only manages localStorage; it does not make
//   any network calls.

export const SHARED_KEY_STORAGE_KEY = "finance-cockpit:shared-key-v1";

function safeGetLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function generateKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // Fallback for very old environments; good enough for a single‑user
  // personal tool.
  return `fc_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 12)}`;
}

/**
 * Return the existing sync key if present, otherwise create, persist
 * and return a new one. If localStorage is not available this returns
 * a freshly generated key but does not persist it.
 */
export function getOrCreateSharedKey(): string {
  const storage = safeGetLocalStorage();
  if (!storage) {
    return generateKey();
  }

  const existing = storage.getItem(SHARED_KEY_STORAGE_KEY);
  if (existing && existing.trim().length > 0) {
    return existing;
  }

  const fresh = generateKey();
  try {
    storage.setItem(SHARED_KEY_STORAGE_KEY, fresh);
  } catch {
    // ignore; caller still gets the key in memory
  }
  return fresh;
}

/**
 * Returns the current sync key if one has been created, otherwise
 * null. This never generates a new key.
 */
export function getSharedKeyOrNull(): string | null {
  const storage = safeGetLocalStorage();
  if (!storage) return null;
  const existing = storage.getItem(SHARED_KEY_STORAGE_KEY);
  return existing && existing.trim().length > 0 ? existing : null;
}

/**
 * Overwrite the stored sync key with a value supplied by the user.
 * This is used when linking a new device by pasting the key that was
 * generated on another device. The caller is responsible for
 * reloading data or forcing a full app reload afterwards.
 */
export function setSharedKeyFromUserInput(key: string): void {
  const trimmed = (key ?? "").trim();
  if (!trimmed) return;
  const storage = safeGetLocalStorage();
  if (!storage) return;
  try {
    storage.setItem(SHARED_KEY_STORAGE_KEY, trimmed);
  } catch {
    // ignore
  }
}

