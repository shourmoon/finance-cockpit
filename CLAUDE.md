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
npm run verify                       # the whole gate: tsc + eslint + coverage
npm run verify:ui                    # real browser at 360px (see below)
```

CI (`.github/workflows/ci.yml`) runs `npm run verify` on every push/PR. `verify:ui` needs a browser and so runs locally, not in CI — which is exactly why it is listed in the definition of done below rather than left to CI to catch. Coverage thresholds (in `vitest.config.ts`) require **100%** on `src/domain`, `src/utils`, and `workers`; UI components have pragmatic floors. `main.tsx` and `Root.tsx` (service-worker glue) are excluded from coverage.

### Development workflow — how this project is verified

This app tells someone where to put real money. A wrong number here is not a
cosmetic bug, so the bar is higher than "the tests pass".

#### Definition of done

Work is not finished until all of these hold. Do not report completion before
running them.

1. `npm run verify` is clean — typecheck, lint, and 100% coverage on
   `src/domain`, `src/utils`, `workers`.
2. Anything touching **money, dates, or units** is covered by an invariant
   suite (below), not only by tests written beside the implementation.
3. Anything touching the **UI** passes `npm run verify:ui` — a real browser at
   360px. jsdom cannot see clipping, overflow, or layout.
4. Any figure shown in **two places** comes from one source and reconciles on
   screen. Two numbers for one quantity is a defect even when both are close.

#### Why the ordinary gate is not enough

Every defect that has escaped in this project was found the same way: by
comparing a result against something **independent of the implementation** —
a closed form, a physical impossibility, a conservation law, or the rendered
page. None was found by the tests written alongside the code, because those
encode the same assumptions the code does. Mutation testing does not close
the gap either: it proves the tests notice deliberate edits, not that the
right properties were ever considered.

So for any new computation over money or time, **write the laws before the
code**. Put them in a `*Invariants.test.ts` file, phrased against the problem
rather than the implementation, and run them over generated inputs. There is
one per money-adjacent surface, and **every one of them found real defects on
its first run**:

- `allocationInvariants.test.ts` — money was being destroyed when a plan
  overshot a nearly-retired loan, and cashflow equalisation was incomplete.
- `cashflowInvariants.test.ts` — the reported minimum balance was seeded from
  a moment the chart never plots.
- `persistenceInvariants.test.ts` — NaN passed straight from storage into the
  projection, so the dashboard reported "ok" over a broken chart.
- `resilienceInvariants.test.ts` — clearing the Start date collapsed the
  coverage window into one fabricated month that read as clean, so the card
  claimed "1 of 1 months on one salary" from no data at all. Four more in the
  same class: a non-finite amount turned four metrics into "NaN", a
  fractional window produced month keys like `2026-8.599999999998545`, an
  infinite one hung, and a malformed transaction took down the dashboard.
- `reconciliationInvariants.test.ts` — the summary counted checkpoints that
  storage discards, so the same log read differently before and after a
  reload.

Two rules for writing them, both learned by getting them wrong:

1. **Read the contract, do not assume it.** Three of eleven cashflow laws
   failed first time because they were written from memory — `outflow` is
   signed negative, safe-to-spend is legitimately zero when already under the
   floor. Those were test bugs, and the tests were fixed, not the engine.
2. **Compare against the raw input, never against the function under test.**
   Generating the expected value by running the same code makes both sides
   move together, and a mutation that drops a field drops it from the
   expectation too. Two mutations survived the persistence suite for exactly
   that reason until its generator kept the raw stored shape alongside the
   parsed one.

Generators use a seeded PRNG so any failure is reproducible.

#### The checklist for money code

Each line is a class of defect that has actually shipped here:

- **Conservation.** Every amount committed must end up somewhere. Money that
  cannot be applied (a prepayment larger than the balance) is handed back,
  never absorbed. Assert `in === out` over generated inputs.
- **Units.** Every quantity has one. Payment *periods* are not months —
  biweekly makes them differ by 26/12. Convert at the domain boundary and
  name the result for its unit.
- **Timing.** Every amount has a date, and compounds from that date. Do not
  discretise onto a payment grid; do not derive a calendar horizon from a
  period count (78 biweekly periods is 1,092 days, not 3 years).
- **Impossibilities.** Assert what cannot happen regardless of the code:
  cash that does not grow cannot beat avoiding interest, a balance cannot go
  negative, a schedule cannot outlive its term.
- **Agreement.** Two modules computing the same quantity must be tested
  against each other, not each against itself.
- **Degenerate inputs.** Zero, negative, NaN, Infinity, dates before the loan
  and after payoff, a stream larger than the debt. Fall back to a safe
  default, never to a silently wrong number, and never to zero where zero
  means "no reserve" or "no tax".

#### Tests first, and red before green

Write the failing test first for domain, logic, persistence and sync changes,
for bug fixes (encode the reproduction), and for UI changes with an assertable
outcome — an element or label appearing, a computed value, a shared token
checked via `toHaveStyle`. Confirm it is red for the reason you expect before
implementing: a test that was green all along has verified nothing.

For purely visual work with no property jsdom can assert (spacing, gradients,
real layout), drive the app with `npm run verify:ui` and screenshot at 360px.

#### When a defect is found

Fix the cause, then ask which of the classes above it belongs to and add the
law that would have caught it. A defect that only gets a regression test will
recur in the next feature wearing different clothes.

Backend worker (optional, for sync):

```bash
cd workers/sync-worker && npx wrangler deploy   # Requires SYNC_KV KV namespace (see wrangler.toml)
```

The sync endpoint URL is read from the `VITE_SYNC_BASE_URL` env var at build time (used in `src/components/SyncSection.tsx`).

## Architecture

Finance Cockpit is a local-first React 18 + TypeScript PWA (Vite + vite-plugin-pwa). All state lives in `localStorage`; a Cloudflare Worker backend is used only for opt-in cross-device sync. There is no router, no state library, no CSS framework (styling is inline `style` objects), and runtime dependencies are only `react`/`react-dom`.

### Design tokens — the single source of colour

All colour lives in `src/components/ui.ts`: the semantic `colors` map (grounds, text, inputs, brand, money/status) and the `chart` map (balance-chart lines), plus shared style objects (`ui.card`, `ui.input`, `ui.primaryButton`, `ui.modalSurface`, …). Components reference these tokens — **never raw hex**. An eslint rule (`no-restricted-syntax` in `eslint.config.js`) fails the build on any hex colour literal outside `ui.ts` (and the `vite.config.ts` PWA manifest, which mirrors `colors.bg` by hand). To add a colour, add a named token; to restyle a surface, change the token so every tab moves together.

### Domain / UI split — the central rule

Everything under `src/domain/` is pure, framework-free TypeScript with no React imports. This is what makes the test suite (domain tests plus `workers/sync-worker/index.test.ts`) fast and thorough. Keep business logic in `src/domain/` and out of components; components in `src/components/` and `App.tsx` are shells over domain functions. Shared UI helpers (e.g. `DateInputWithDisplay`) live in `src/components/shared.tsx`. The three dialogs (`OverrideModal`, `QuickAddTransactionModal`, `RuleEditorModal`) render their content inside the shared `src/components/Modal.tsx` shell, which owns dialog accessibility once for all of them: `role="dialog"`/`aria-modal`, Escape and backdrop-click to close, focus moved into the dialog on open (and restored to the trigger on close), and Tab wrapped inside the dialog.

### Three subsystems

1. **Cashflow engine** (`src/domain/cashflowEngine.ts`, `safeToSpendEngine.ts`, `types.ts`):
   - `RecurringRule`s (positive amount = inflow, negative = outflow) with three schedule types: `monthly`, `twiceMonth` (optionally adjusted to the previous US Fed business day via `businessDayUS.ts`), and `biweekly` (14-day cadence from an anchor date).
   - `AdhocTransaction`s: first-class one-off inflows/outflows (`{ id, name, amount, date }` on `AppState.adhocTransactions`), expanded by `expandAdhocTransactions()` into at most one event each and merged into the same event stream.
   - `runCashflowProjection(state)` expands rules and ad-hoc transactions into `FutureEvent`s over `[startDate, startDate + horizonDays]`, applies per-event overrides (keyed `${ruleId}__${date}`; ad-hoc events use their transaction id), and walks day-by-day to build a `TimelinePoint[]` and `CashflowMetrics`.
   - Safe-to-spend logic: spending X today shifts the whole future curve down by X, so `safeToSpendToday = max(0, projectedMinBalance − minSafeBalance)`. `computeTopUpHint()` (same file) returns the single yield-optimal deposit (amount sized to the horizon's lowest point, deadline = first floor breach) that keeps the whole horizon above the floor — for accounts topped up from savings on demand. `computeTopUpSchedule()` (same file) is the just-in-time transfer plan: one deposit per below-floor stretch, each placed on the stretch's first breach day (latest possible) and sized to that stretch's deepest point, with prior deposits carried forward — same total as the single hint but split so the most cash stays in high-yield savings the longest. The dashboard shows the schedule when it has more than one transfer, and falls back to the single hint otherwise. Each deposit (in either view) has an "Apply" button, which first asks *why* via `TopUpReasonModal` and then calls `transferDepositToTransaction(deposit, reason)` to create a real ad-hoc inflow (`{ name: "Top Up", amount, date, kind: "topUp", reason }`), so once the money is actually moved, the projection and plan recompute and that stretch drops out.
   - **One-Salary Coverage** (`src/domain/resilience.ts`, rendered by `src/components/CoverageCard.tsx`): the running score of whether one salary covered the household unaided. `computeCoverageMetrics()` buckets recorded top-ups by calendar month and derives six metrics (months on one salary, total topped up, average monthly gap, typical top-up, clean-month streak as current·best, and optionally the share of a second salary preserved). Two lenses — `"all"` counts every top-up, `"recurring"` counts only `reason === "shortfall"` — so a shock and a genuine shortfall are separated *by measurement, never inferred from the shape of the draws*. The current month is **included and flagged `complete: false`** (dashed bar, "still open" in the tooltip) rather than withheld — this app forecasts ahead, so a recorded top-up is not a month-end surprise, and hiding a real draw until the month closed was worse than showing a figure that may still move. Months before `settings.trackingSince` are **unknown rather than clean** (the app wasn't recording then; absence of data is not evidence of coverage) and an unknown month breaks a streak instead of extending it. An `asOf` that is not a real date yields **no months at all**, never a fabricated clean one — claiming coverage for a month that was never measured is the one failure this card must not have.
   - Event-id uniqueness is enforced centrally in `buildFutureEvents` (repeats — from a business-day-adjusted payday colliding with the previous month's, or duplicate ad-hoc ids in corrupt data — get an occurrence suffix). The dashboard balance chart is driven by the pure `src/domain/chartGeometry.ts` (`buildBalanceChartGeometry`), rendered by the dependency-free SVG `src/components/BalanceChart.tsx`.
   - **All date math is UTC** (`dateUtils.ts`): construct dates with `Date.UTC(...)` and read with `getUTC*()` to avoid timezone drift. Month days are clamped to end-of-month.

2. **Mortgage module** (`src/domain/mortgage/`):
   - `baseline.ts` (annuity payment + no-prepayment schedule) → `history.ts` (re-amortization with past prepayments) → `comparison.ts` (interest/months saved) → `scenarios.ts` (what-if engine over `oneTime`/`monthly`/`yearly`/`biweekly` extra-payment patterns) → `irr.ts` (effective annual rate from a schedule).
   - Has its own `Money`/`ISODate` aliases in `mortgage/types.ts` and its own persisted state (`MortgageUIState` in `mortgage/persistence.ts`), separate from `AppState`.
   - `src/components/MortgageTab.tsx` (~1,800 lines) is the UI over all of this.

3. **Reality checks** (`src/domain/reconciliation.ts`, rendered by `src/components/RealityCheckRow.tsx` + `RealityCheckModal.tsx`): the only part of the app that looks *outside* itself. Everything else — the invariant suites, `verify:ui` — proves the app is self-consistent, never that it matches the user's actual bank. Two figures are maintained by hand and nothing corrects them (`account.startingBalance`, and the loan principal implied by the mortgage terms), so a *checkpoint* records "on this date, the statement said this". Recording one is a single act that does two jobs, which is why freshness and reconciliation are one feature: it resets the staleness clock **and** captures how far the model had drifted. `modelled` is **stored, not recomputed** — for cash it is the only option, since correcting the balance destroys the counterfactual moments later. `assessDrift()` resolves direction into terms the two targets share (`modelOptimistic` always means *reality is worse than the model said*, whichever way the raw sign points), `assessFreshness()` ages from the **statement date** and not from when it was typed, and `summarizeCheckpoints()` flags a run of same-direction misses as `systematic` — three misses the same way is a missing rule, not bad luck, and re-entering the balance would only hide it. Cash checkpoints live on `AppState.checkpoints`, mortgage ones on `MortgageUIState.checkpoints`. **The cash check is deliberately locked to today and compared against `account.startingBalance`**, not against the timeline's first point: that point already has today's events applied, and comparing against it would put two different numbers for one quantity inside the same card.

4. **Sync** (`src/domain/persistence/`, `workers/sync-worker/`):
   - `snapshot.ts` defines the canonical envelope: `{ schemaVersion, app_state, mortgage_ui, updated_at, device_id }` — both `AppState` and `MortgageUIState` sync together as one unit.
   - `sync.ts` `syncNow()` decides push vs. pull: no remote → push (init); never synced locally → pull; remote `updated_at` changed since last sync → pull (remote always wins, no merge); otherwise push with `prev_updated_at` for optimistic concurrency. Before any pull overwrites local state, the current local snapshot is saved to a one-slot backup (`finance-cockpit:backup-before-pull`, readable via `loadPrePullBackup()`).
   - The app talks only to the `RemotePersistenceAdapter` interface (`remote.ts`); `remoteCloudflare.ts` is the fetch-based implementation. Adapter failures are thrown as `RemoteSyncError` with a `kind` (`unauthorized`/`conflict`/`notFound`/`network`/`server`) — branch on `kind`, never string-match error messages. The Worker (`workers/sync-worker/index.ts`) stores snapshots in KV, is PIN-gated (client sends `X-Sync-Pin: sha256(pin)`; first-seen hash is bound to the shared key), and returns `409` on `prev_updated_at` mismatch.
   - Identity is a user-entered shared key remembered in localStorage (`SyncSection.tsx`); there are no user accounts.

### Persistence and migrations

Every load path is defensive: `upgradeAppState()` (`appState.ts`), `parseSnapshot()`, and mortgage persistence all validate field-by-field and fall back to defaults rather than throwing. Rule schedules are validated by `sanitizeSchedule()` (rules with unusable schedules are dropped), ad-hoc transactions by `sanitizeAdhocTransaction()`, snapshot payloads via `upgradeAppState()`/`sanitizeMortgageUIState()`, and `parseISODate()` throws on malformed input (check with `isValidISODate()` first when the value is untrusted — the engine tolerates a transiently-invalid `startDate` by returning an empty projection). `AppState` carries `version` (`APP_STATE_VERSION`, currently 5). v1→v2 added `adhocTransactions`; v2→v3 added top-up tracking (`kind`/`reason` on `AdhocTransaction`, plus `trackingSince`/`coverageLens`/`secondSalaryMonthly` in settings); v3→v4 added `settings.surplus`; v4→v5 added `checkpoints`. All are additive — older states migrate through the field-by-field path without losing rules, and only pre-v1 states are reset. **v3 deliberately does not backfill**: older transactions named "Top Up"/"Transfer from savings" are left unmarked, because past top-ups were never recorded reliably and name-matching them would invent untrustworthy history. `trackingSince` is stamped once on the first v3 load and preserved thereafter — re-stamping it would silently reset the coverage clock. **v5 does not backfill either**: there is no honest way to invent a date on which a figure was last confirmed, so an upgraded state arrives with an empty checkpoint log and reads as never confirmed, which is what it is. Snapshots carry `schemaVersion` (`CURRENT_SCHEMA_VERSION`). When changing persisted shapes, bump the relevant version and extend the corresponding upgrade/parse function additively — never assume stored JSON is well-formed, and never let a version bump discard user data.

### Date formatting in UI

All user-facing dates go through `formatDate` in `src/utils/dates.ts` (DD MMM 'YY format; `monthYearLabel`/`monthKey` there drive the events list's month separators). Date inputs pair the native `<input type="date">` with the formatted value beneath (`DateInputWithDisplay` in `src/components/shared.tsx`); money inputs use `NumberInput` (same file), which keeps raw text locally so an in-progress `-` isn't coerced to 0.

### Service worker / PWA updates

`vite-plugin-pwa` runs in `registerType: "prompt"` mode. `src/Root.tsx` wires `virtual:pwa-register/react`'s `useRegisterSW` to the `UpdateBanner` component so a new version waits for a user tap instead of swapping silently. The pure banner (`src/components/UpdateBanner.tsx`) is unit-tested; `Root.tsx` is the untestable runtime glue.
