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

```bash
npm run lint                         # eslint (flat config in eslint.config.js)
npx vitest run --coverage            # enforces per-directory coverage thresholds
```

CI (`.github/workflows/ci.yml`) runs `tsc --noEmit`, `eslint .`, and `npx vitest run --coverage` on every push/PR. Coverage thresholds (in `vitest.config.ts`) require **100%** on `src/domain`, `src/utils`, and `workers`; UI components have pragmatic floors. `main.tsx` and `Root.tsx` (service-worker glue) are excluded from coverage.

### Development workflow — TDD when appropriate

Prefer test-driven development: write the failing test(s) first, confirm they're red, then implement until green, then run the wider gate (`tsc --noEmit`, `eslint .`, `npx vitest run --coverage`). Apply it with judgment:

- **Do write the test first** for domain/logic/behavior changes (cashflow engine, mortgage math, persistence, sync, utils), for bug fixes (encode the reproduction as a red test), and for UI changes with an assertable outcome — an element/label appearing, a computed value, or a shared-token style checked via jest-dom's `toHaveStyle` (see the cohesion suites in `MortgageTab.test.tsx`).
- **Verify differently** for purely visual/aesthetic work with no property jsdom can assert (spacing, gradients, real layout/clipping) — drive the real app with Playwright and screenshot at a phone width (~360px). Keep the existing behavior and cohesion tests green as the regression net.

Backend worker (optional, for sync):

```bash
cd workers/sync-worker && npx wrangler deploy   # Requires SYNC_KV KV namespace (see wrangler.toml)
```

The sync endpoint URL is read from the `VITE_SYNC_BASE_URL` env var at build time (used in `src/components/SyncSection.tsx`).

## Architecture

Finance Cockpit is a local-first React 18 + TypeScript PWA (Vite + vite-plugin-pwa). All state lives in `localStorage`; a Cloudflare Worker backend is used only for opt-in cross-device sync. There is no router, no state library, no CSS framework (styling is inline `style` objects), and runtime dependencies are only `react`/`react-dom`.

### Domain / UI split — the central rule

Everything under `src/domain/` is pure, framework-free TypeScript with no React imports. This is what makes the test suite (domain tests plus `workers/sync-worker/index.test.ts`) fast and thorough. Keep business logic in `src/domain/` and out of components; components in `src/components/` and `App.tsx` are shells over domain functions. Shared UI helpers (e.g. `DateInputWithDisplay`) live in `src/components/shared.tsx`.

### Three subsystems

1. **Cashflow engine** (`src/domain/cashflowEngine.ts`, `safeToSpendEngine.ts`, `types.ts`):
   - `RecurringRule`s (positive amount = inflow, negative = outflow) with three schedule types: `monthly`, `twiceMonth` (optionally adjusted to the previous US Fed business day via `businessDayUS.ts`), and `biweekly` (14-day cadence from an anchor date).
   - `AdhocTransaction`s: first-class one-off inflows/outflows (`{ id, name, amount, date }` on `AppState.adhocTransactions`), expanded by `expandAdhocTransactions()` into at most one event each and merged into the same event stream.
   - `runCashflowProjection(state)` expands rules and ad-hoc transactions into `FutureEvent`s over `[startDate, startDate + horizonDays]`, applies per-event overrides (keyed `${ruleId}__${date}`; ad-hoc events use their transaction id), and walks day-by-day to build a `TimelinePoint[]` and `CashflowMetrics`.
   - Safe-to-spend logic: spending X today shifts the whole future curve down by X, so `safeToSpendToday = max(0, projectedMinBalance − minSafeBalance)`. `computeTopUpHint()` (same file) returns the single yield-optimal deposit (amount sized to the horizon's lowest point, deadline = first floor breach) that keeps the whole horizon above the floor — for accounts topped up from savings on demand. `computeTopUpSchedule()` (same file) is the just-in-time transfer plan: one deposit per below-floor stretch, each placed on the stretch's first breach day (latest possible) and sized to that stretch's deepest point, with prior deposits carried forward — same total as the single hint but split so the most cash stays in high-yield savings the longest. The dashboard shows the schedule when it has more than one transfer, and falls back to the single hint otherwise. Each deposit (in either view) has an "Apply" button: `transferDepositToTransaction()` turns it into a real ad-hoc inflow (`{ name: "Transfer from savings", amount, date }`), so once the money is actually moved, the projection and plan recompute and that stretch drops out.
   - Event-id uniqueness is enforced centrally in `buildFutureEvents` (repeats — from a business-day-adjusted payday colliding with the previous month's, or duplicate ad-hoc ids in corrupt data — get an occurrence suffix). The dashboard balance chart is driven by the pure `src/domain/chartGeometry.ts` (`buildBalanceChartGeometry`), rendered by the dependency-free SVG `src/components/BalanceChart.tsx`.
   - **All date math is UTC** (`dateUtils.ts`): construct dates with `Date.UTC(...)` and read with `getUTC*()` to avoid timezone drift. Month days are clamped to end-of-month.

2. **Mortgage module** (`src/domain/mortgage/`):
   - `baseline.ts` (annuity payment + no-prepayment schedule) → `history.ts` (re-amortization with past prepayments) → `comparison.ts` (interest/months saved) → `scenarios.ts` (what-if engine over `oneTime`/`monthly`/`yearly`/`biweekly` extra-payment patterns) → `irr.ts` (effective annual rate from a schedule).
   - Has its own `Money`/`ISODate` aliases in `mortgage/types.ts` and its own persisted state (`MortgageUIState` in `mortgage/persistence.ts`), separate from `AppState`.
   - `src/components/MortgageTab.tsx` (~1,800 lines) is the UI over all of this.

3. **Sync** (`src/domain/persistence/`, `workers/sync-worker/`):
   - `snapshot.ts` defines the canonical envelope: `{ schemaVersion, app_state, mortgage_ui, updated_at, device_id }` — both `AppState` and `MortgageUIState` sync together as one unit.
   - `sync.ts` `syncNow()` decides push vs. pull: no remote → push (init); never synced locally → pull; remote `updated_at` changed since last sync → pull (remote always wins, no merge); otherwise push with `prev_updated_at` for optimistic concurrency. Before any pull overwrites local state, the current local snapshot is saved to a one-slot backup (`finance-cockpit:backup-before-pull`, readable via `loadPrePullBackup()`).
   - The app talks only to the `RemotePersistenceAdapter` interface (`remote.ts`); `remoteCloudflare.ts` is the fetch-based implementation. Adapter failures are thrown as `RemoteSyncError` with a `kind` (`unauthorized`/`conflict`/`notFound`/`network`/`server`) — branch on `kind`, never string-match error messages. The Worker (`workers/sync-worker/index.ts`) stores snapshots in KV, is PIN-gated (client sends `X-Sync-Pin: sha256(pin)`; first-seen hash is bound to the shared key), and returns `409` on `prev_updated_at` mismatch.
   - Identity is a user-entered shared key remembered in localStorage (`SyncSection.tsx`); there are no user accounts.

### Persistence and migrations

Every load path is defensive: `upgradeAppState()` (`appState.ts`), `parseSnapshot()`, and mortgage persistence all validate field-by-field and fall back to defaults rather than throwing. Rule schedules are validated by `sanitizeSchedule()` (rules with unusable schedules are dropped), ad-hoc transactions by `sanitizeAdhocTransaction()`, snapshot payloads via `upgradeAppState()`/`sanitizeMortgageUIState()`, and `parseISODate()` throws on malformed input (check with `isValidISODate()` first when the value is untrusted — the engine tolerates a transiently-invalid `startDate` by returning an empty projection). `AppState` carries `version` (`APP_STATE_VERSION`, currently 2; v1→v2 added `adhocTransactions` additively — v1 states migrate through the field-by-field path without losing rules, and only pre-v1 states are reset). Snapshots carry `schemaVersion` (`CURRENT_SCHEMA_VERSION`). When changing persisted shapes, bump the relevant version and extend the corresponding upgrade/parse function additively — never assume stored JSON is well-formed, and never let a version bump discard user data.

### Date formatting in UI

All user-facing dates go through `formatDate` in `src/utils/dates.ts` (DD MMM 'YY format; `monthYearLabel`/`monthKey` there drive the events list's month separators). Date inputs pair the native `<input type="date">` with the formatted value beneath (`DateInputWithDisplay` in `src/components/shared.tsx`); money inputs use `NumberInput` (same file), which keeps raw text locally so an in-progress `-` isn't coerced to 0.

### Service worker / PWA updates

`vite-plugin-pwa` runs in `registerType: "prompt"` mode. `src/Root.tsx` wires `virtual:pwa-register/react`'s `useRegisterSW` to the `UpdateBanner` component so a new version waits for a user tap instead of swapping silently. The pure banner (`src/components/UpdateBanner.tsx`) is unit-tested; `Root.tsx` is the untestable runtime glue.
