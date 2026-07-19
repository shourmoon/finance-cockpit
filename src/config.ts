// src/config.ts
//
// Build-time configuration read from Vite env vars. Kept in one module
// so it can be mocked in tests (import.meta.env is not injectable per
// dynamically-imported module).

/** Base URL of the deployed sync Worker, or undefined when sync is off. */
export const SYNC_BASE_URL: string | undefined = (import.meta as any).env
  ?.VITE_SYNC_BASE_URL;
