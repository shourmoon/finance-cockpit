# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev                          # Vite dev server
npm run build                        # tsc --noEmit (typecheck gate) + vite build
npm test                             # Vitest in watch mode
npx vitest run                       # Run all tests once
npx vitest run src/domain/cashflowEngine.test.ts   # Run a single test file
npx vitest run -t "test name"        # Run tests matching a name
```

Backend worker (optional, for sync):

```bash
cd workers/sync-worker && npx wrangler deploy   # Requires SYNC_KV KV namespace (see wrangler.toml)
```

The sync endpoint URL is read from the `VITE_SYNC_BASE_URL` env var at build time (used in `src/components/SyncSection.tsx`).

## Architecture

Finance Cockpit is a local-first React 18 + TypeScript PWA (Vite + vite-plugin-pwa). All state lives in `localStorage`; a Cloudflare Worker backend is used only for opt-in cross-device sync. There is no router, no state library, no CSS framework (styling is inline `style` objects), and runtime dependencies are only `react`/`react-dom`.

### Domain / UI split — the central rule

Everything under `src/domain/` is pure, framework-free TypeScript with no React imports. This is what makes the test suite (all tests live against `src/domain/`) fast and thorough. Keep business logic in `src/domain/` and out of components; components in `src/components/` and `App.tsx` are shells over domain functions.

### Three subsystems

1. **Cashflow engine** (`src/domain/cashflowEngine.ts`, `safeToSpendEngine.ts`, `types.ts`):
   - `RecurringRule`s (positive amount = inflow, negative = outflow) with three schedule types: `monthly`, `twiceMonth` (optionally adjusted to the previous US Fed business day via `businessDayUS.ts`), and `biweekly` (14-day cadence from an anchor date).
   - `runCashflowProjection(state)` expands rules into `FutureEvent`s over `[startDate, startDate + horizonDays]`, applies per-event overrides (keyed `${ruleId}__${date}`), and walks day-by-day to build a `TimelinePoint[]` and `CashflowMetrics`.
   - Safe-to-spend logic: spending X today shifts the whole future curve down by X, so `safeToSpendToday = max(0, projectedMinBalance − minSafeBalance)`.
   - **All date math is UTC** (`dateUtils.ts`): construct dates with `Date.UTC(...)` and read with `getUTC*()` to avoid timezone drift. Month days are clamped to end-of-month.

2. **Mortgage module** (`src/domain/mortgage/`):
   - `baseline.ts` (annuity payment + no-prepayment schedule) → `history.ts` (re-amortization with past prepayments) → `comparison.ts` (interest/months saved) → `scenarios.ts` (what-if engine over `oneTime`/`monthly`/`yearly`/`biweekly` extra-payment patterns) → `irr.ts` (effective annual rate from a schedule).
   - Has its own `Money`/`ISODate` aliases in `mortgage/types.ts` and its own persisted state (`MortgageUIState` in `mortgage/persistence.ts`), separate from `AppState`.
   - `src/components/MortgageTab.tsx` (~1,800 lines) is the UI over all of this.

3. **Sync** (`src/domain/persistence/`, `workers/sync-worker/`):
   - `snapshot.ts` defines the canonical envelope: `{ schemaVersion, app_state, mortgage_ui, updated_at, device_id }` — both `AppState` and `MortgageUIState` sync together as one unit.
   - `sync.ts` `syncNow()` decides push vs. pull: no remote → push (init); never synced locally → pull; remote `updated_at` changed since last sync → pull (remote always wins, no merge); otherwise push with `prev_updated_at` for optimistic concurrency.
   - The app talks only to the `RemotePersistenceAdapter` interface (`remote.ts`); `remoteCloudflare.ts` is the fetch-based implementation. The Worker (`workers/sync-worker/index.ts`) stores snapshots in KV, is PIN-gated (client sends `X-Sync-Pin: sha256(pin)`; first-seen hash is bound to the shared key), and returns `409` on `prev_updated_at` mismatch.
   - Identity is a user-entered shared key remembered in localStorage (`SyncSection.tsx`); there are no user accounts.

### Persistence and migrations

Every load path is defensive: `upgradeAppState()` (`appState.ts`), `parseSnapshot()`, and mortgage persistence all validate field-by-field and fall back to defaults rather than throwing. `AppState` carries `version` (`APP_STATE_VERSION`); snapshots carry `schemaVersion` (`CURRENT_SCHEMA_VERSION`). When changing persisted shapes, bump the relevant version and extend the corresponding upgrade/parse function — never assume stored JSON is well-formed.

### Date formatting in UI

All user-facing dates go through `formatDate` in `src/utils/dates.ts` (DD MMM 'YY format). Date inputs pair the native `<input type="date">` with the formatted value displayed beneath (see `DateInputWithDisplay` in `App.tsx` and `MortgageTab.tsx`).
