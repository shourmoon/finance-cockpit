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

### Committing — push straight to `main`

This project does not use pull requests. Commit and push directly to `main`;
do not open a PR, and do not develop on a feature branch unless explicitly
asked to. (A session may be handed a `claude/…` branch by the harness — this
instruction overrides it.)

The trade-off that comes with that: CI runs *after* the push, so a bad commit
makes `main` red rather than blocking a PR. **`npm run verify` must therefore
be clean locally before every commit** — CI is confirming the result, not
gating it. Anything touching the UI also needs `npm run verify:ui`, which CI
cannot run at all.

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
  a moment the timeline never holds.
- `persistenceInvariants.test.ts` — NaN passed straight from storage into the
  projection, so the dashboard reported "ok" over figures that were all NaN.
- `resilienceInvariants.test.ts` — clearing the Start date collapsed the
  coverage window into one fabricated month that read as clean, so the card
  claimed "1 of 1 months on one salary" from no data at all. Four more in the
  same class: a non-finite amount turned four metrics into "NaN", a
  fractional window produced month keys like `2026-8.599999999998545`, an
  infinite one hung, and a malformed transaction took down the dashboard.
- `reconciliationInvariants.test.ts` — the summary counted checkpoints that
  storage discards, so the same log read differently before and after a
  reload.
- `prepaymentImpactInvariants.test.ts` — written when the computation was
  moved out of `MortgageTab.tsx`, and it found two on its first run. A
  principal small enough to buy no schedule threw `Schedule is empty` from
  three separate render-time memos, killing the tab. And the months-saved
  column was rounded cell by cell, so on a biweekly loan (where months come
  out in 12/26ths) the increments stopped adding up to the total rendered
  beside them — 8 + 18 + 10 against a total of 37, in 64 of 400 generated
  loans. `apportion()` fixes the second; it exists for exactly this. A third
  came later, from reading rather than from a red test: the table discarded
  `unappliedPrepayments`, so a prepayment the loan refused reported a saving
  of nothing and said nothing about the refund. Its laws also caught a bad
  assumption in one of their own — a $400,000 prepayment against a $400,000
  loan does *not* apply in full, because a payment has already landed and the
  scheduled principal has first claim. That was a test bug, and the test was
  fixed, not the engine.

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

All colour lives in `src/components/ui.ts`: the semantic `colors` map (grounds, text, inputs, brand, money/status), plus shared style objects (`ui.card`, `ui.input`, `ui.primaryButton`, `ui.modalSurface`, …). Components reference these tokens — **never raw hex**. An eslint rule (`no-restricted-syntax` in `eslint.config.js`) fails the build on any hex colour literal outside `ui.ts` (and the `vite.config.ts` PWA manifest, which mirrors `colors.bg` by hand). To add a colour, add a named token; to restyle a surface, change the token so every tab moves together.

### Domain / UI split — the central rule

Everything under `src/domain/` is pure, framework-free TypeScript with no React imports. This is what makes the test suite (domain tests plus `workers/sync-worker/index.test.ts`) fast and thorough. Keep business logic in `src/domain/` and out of components; components in `src/components/` and `App.tsx` are shells over domain functions. Shared UI helpers (e.g. `DateInputWithDisplay`) live in `src/components/shared.tsx`. The four dialogs (`OverrideModal`, `QuickAddTransactionModal`, `RuleEditorModal`, `RealityCheckModal`) render their content inside the shared `src/components/Modal.tsx` shell, which owns dialog accessibility once for all of them: `role="dialog"`/`aria-modal`, Escape and backdrop-click to close, focus moved into the dialog on open (and restored to the trigger on close), and Tab wrapped inside the dialog.

### Three subsystems

1. **Cashflow engine** (`src/domain/cashflowEngine.ts`, `safeToSpendEngine.ts`, `types.ts`):
   - `RecurringRule`s (positive amount = inflow, negative = outflow) with three schedule types: `monthly`, `twiceMonth` (optionally adjusted to the previous US Fed business day via `businessDayUS.ts`), and `biweekly` (14-day cadence from an anchor date).
   - `AdhocTransaction`s: first-class one-off inflows/outflows (`{ id, name, amount, date }` on `AppState.adhocTransactions`), expanded by `expandAdhocTransactions()` into at most one event each and merged into the same event stream. **Overrides are for things that repeat, so a one-off never carries one**: editing its amount from the dashboard writes to the transaction itself (`applyOverride` branches on whether the event's `ruleId` names an ad-hoc transaction). The override mechanism exists so one occurrence of a rule can differ from the rule's default; a one-off happens once and has no default, so an override on it was a second stored value for a quantity with one — Settings showed the original while the dashboard showed the override, and since the key is `${id}__${date}`, moving the date orphaned the override and silently reverted the amount. Adding one from Settings opens the same dialog as the dashboard's "+ One-time" rather than dropping a blank $0 row dated today.
   - `runCashflowProjection(state)` expands rules and ad-hoc transactions into `FutureEvent`s over `[startDate, startDate + horizonDays]`, applies per-event overrides (keyed `${ruleId}__${date}`; ad-hoc events use their transaction id), and walks day-by-day to build a `TimelinePoint[]` and `CashflowMetrics`.
   - **The dashboard leads with surplus, not a spending limit.** The headline is what the horizon accumulates: the timeline's last balance less its opening one (`data-testid="surplus-label"`/`-value"`). It is therefore, by construction, the sum of every row in the ledger beneath it — a reader who adds the rows up must land on the headline, and that is the law the suite holds.

     It replaced **"Safe to Spend today"**, which read the horizon's *lowest* point and subtracted the floor: `max(0, projectedMinBalance − minSafeBalance)`. That is a spending limit pinned by the single worst day, and the two answer different questions — on a household ending 90 days up $3,460 it showed $2,480, because of a dip three days out. The stated requirement, all along, was "to know across the horizon how much surplus I'm going to accumulate", and safe-to-spend never answered it. The engine functions (`computeSafeToSpend`, `computeSafeToSpendFromEvents`) survive with their tests but **no production caller**; the badge beneath the headline still reports the separate floor question ("Stays above your floor" / "Dips below your floor"), and the lowest point keeps its own line.
   - Top-up logic: `computeTopUpHint()` (same file) returns the single yield-optimal deposit (amount sized to the horizon's lowest point, deadline = first floor breach) that keeps the whole horizon above the floor — for accounts topped up from savings on demand. `computeTopUpSchedule()` (same file) is the just-in-time transfer plan: one deposit per below-floor stretch, each placed on the stretch's first breach day (latest possible) and sized to that stretch's deepest point, with prior deposits carried forward — same total as the single hint but split so the most cash stays in high-yield savings the longest. The dashboard shows the schedule when it has more than one transfer, and falls back to the single hint otherwise. Each deposit (in either view) has an "Apply" button, which calls `transferDepositToTransaction(deposit)` to create a real ad-hoc inflow (`{ name: "Top Up", amount, date, kind: "topUp" }`), so once the money is actually moved, the projection and plan recompute and that stretch drops out. Apply records the transfer outright: there is **one kind of top-up**, so there is nothing to ask.
   - **One-Salary Coverage** (`src/domain/resilience.ts`, rendered by `src/components/CoverageCard.tsx`): the running score of whether one salary covered the household unaided. `computeCoverageMetrics()` buckets recorded top-ups by calendar month and derives six metrics (months on one salary, total topped up, average monthly gap, typical top-up, clean-month streak as current·best, and optionally the share of a second salary preserved). **Every top-up counts, and there is no lens.** An earlier version recorded *why* each draw happened (a one-off shock against a recurring shortfall) and offered a lens to view either alone; the split asked the user to classify every transfer at the moment they were moving money, and the question the card answers does not depend on the answer — a month that needed money moved in did not run on one salary, whatever prompted the transfer. A `reason` left in storage by that version is not read (see v5→v6 below). The current month is **included and flagged `complete: false`** (dashed bar, "still open" in the tooltip) rather than withheld — this app forecasts ahead, so a recorded top-up is not a month-end surprise, and hiding a real draw until the month closed was worse than showing a figure that may still move. Months before `settings.trackingSince` are **unknown rather than clean** (the app wasn't recording then; absence of data is not evidence of coverage) and an unknown month breaks a streak instead of extending it. An `asOf` that is not a real date yields **no months at all**, never a fabricated clean one — claiming coverage for a month that was never measured is the one failure this card must not have.
   - Event-id uniqueness is enforced centrally in `buildFutureEvents` (repeats — from a business-day-adjusted payday colliding with the previous month's, or duplicate ad-hoc ids in corrupt data — get an occurrence suffix). The dashboard reads the timeline through figures rather than a curve: the min-balance metrics and the Upcoming Events ledger's running balances. There is no balance chart — `chartGeometry.ts`/`BalanceChart.tsx` were removed — so the timeline's only job now is to feed those figures and the top-up plan.
   - **Three dates, and they are not each other.** The app juggles *today* (the clock), *the day the balance was confirmed* (the latest checkpoint), and *the day the forecast window opens* (`settings.startDate`). Every serious defect in this area came from treating two of them as one, and there have been two: anchoring the balance to the window (see below), and measuring staleness against the window. The second is subtle — `assessFreshness` ages the last check against `asOf`, and `asOf` *was* `settings.startDate`, so a start date that did not move reported every balance as **"Confirmed today", age 0 days, forever**. A staleness detector anchored to the value that goes stale cannot see it. The cure attempted first was to make the window roll to today on load (`advanceStartDate`, v8), which worked by accident: it kept `asOf` current by moving something that was never "now" in the first place, and in doing so opened the anchor gap below a day at a time. **The actual fix is that "now" means the clock.** `today` is read once per mount at the App boundary (`src/domain` may never ask what day it is) and passed to the three things that genuinely mean now: freshness, coverage's `asOf`, and the date a reality check or a new one-off is stamped with. With that, the window is free to be nothing but the user's choice.
   - **The start date is the user's, and nothing moves it.** `advanceStartDate` and `settings.followToday` are gone (v8→v9). The Settings field is a plain date picker, always present, with no "follow today" switch; when the window does not open today the page says so (`data-testid="window-note"`) rather than leaving the reader to work out why "today" figures look odd. Fixtures no longer need to pin anything — a stored date simply stays put, which is also what makes them stable.
   - **One number, one name, one date.** `account.startingBalance` used to appear three times under two names: "Balance today" on the dashboard (a lie whenever it wasn't), "Starting balance" as the ledger's opening line a few inches below it, and a third free-text "Starting balance" box in Settings. A reader had no way to know those were the same figure. All three are now **"Balance"**, and every one carries the same `as of <date>` stamp, derived from the same `freshness.lastConfirmed` the check row uses. The stamp shows **always**, not only once stale: a figure that says when it is from needs no explaining, while one that says so only sometimes teaches the reader that a missing date means nothing in particular. (It needs `textTransform: "none"` in the ledger, whose label is uppercased — the same words rendering as "AS OF 1 SEP '26" in one place and "as of 1 Sep '26" in the other recreates the impression this removes, and `textContent` comparisons in jsdom cannot see it.)
   - **The balance cannot be set without a date.** Settings has no balance input; it shows the figure read-only beside an "Update balance" button that opens the same dated reality-check dialog the dashboard uses, and `updateStartingBalance` is gone. An undated free-text box beside a feature built to date that very figure was how it drifted in the first place — there is now no code path that writes `startingBalance` without also recording a checkpoint.
   - **The app ships empty, and says what it needs.** `createDefaultRules()`
     returns `[]`. It used to return four — a $2,000 paycheck, $1,500 rent, a
     credit card and groceries — so the first screen anyone saw was a
     stranger's finances presented as their own, forecast confidently, with a
     red floor breach and a prompt to move money that did not exist. An app
     whose whole claim is that it never shows a figure it cannot stand behind
     cannot open with invented ones. With nothing stored the dashboard and
     coverage card are replaced by a setup card (`data-testid="first-run"`)
     listing the three things the forecast needs: a confirmed balance, one
     inflow, one outflow. Each step is **done by evidence in the data**
     (`checkpoints.length > 0`, `rules.some(r => r.amount > 0)`, `< 0`), never
     by a stored "onboarded" flag, so it cannot drift out of step with what is
     actually there; the card thins out as steps complete and disappears at
     three of three. The gate for hiding the dashboard is narrower than the
     gate for showing the card: a confirmed balance or recorded top-up history
     is worth showing on its own, with no rule in sight. Its two rule buttons
     seed the editor's name from the button pressed ("Income"/"Bill") — both
     opening a blank form called "New Rule" taught the reader the labels meant
     nothing.
   - **The start date is a window, not an anchor.** `account.startingBalance` is a figure confirmed against a bank statement on a particular day — the latest checkpoint's. `settings.startDate` is where the forecast window opens. The engine treated them as one date: it seeded the running balance with the confirmed figure and began walking at `startDate`, whatever the gap. So a salary paid *after* the last reality check but *before* the window opens was too late to be in the balance and too early to be an event, and simply disappeared — moving the window six days forward deleted $4,200 and gave the same calendar day two different balances. Reported as "just changing the date there is making my running balance go up or down", which is exactly what it was. **While the window rolled to today on every load (v8), that gap opened by itself, a day at a time, between one reality check and the next** — changing the setting only made visible something that was already happening silently. The roll is gone now, but the anchor fix is what makes a manually-set window safe in the first place: without it, setting the date by hand would be the same bug on demand. `balanceOn(state, date)` now rolls the confirmed figure across the gap, using the same event expansion the projection uses (so overrides and business-day adjustment apply identically), forwards or backwards — pinning the window before the last check asks what the balance *was* then, and the answer is the confirmed figure less what happened since. With no checkpoint there is no date to roll from and nothing is rolled; inventing an anchor would be worse than the gap it closes. A roll longer than 100 years is refused rather than attempted, because storage is untrusted and a checkpoint dated in year 1000 asks for a 375,000-day expansion that freezes the tab rather than merely answering wrong.
   - **The convention that makes it coherent: a balance is the opening balance *at the start of* its date**, before that day's own events. That is what makes recording a check today a no-op on the figures — the common case, since the check is locked to today and `startDate` follows today — and what lets the first timeline point go on applying its own day's events as it always has.
   - **"What do I have" and "where does the ledger start" are two questions.** They coincide only while the window opens today. `balanceOn(state, today)` answers the first — the dashboard headline, the Settings readout, and what a reality check is compared against. `balanceOn(state, settings.startDate)` answers the second — the engine's opening balance and the ledger's first row, which is where its running totals must begin. Rolling the headline to the window instead meant typing today's bank balance into a reality check and watching the page hand back a different number. When they differ, they are *named* differently ("Balance" against "Balance on 1 Sep '26"), because one name over two numbers is the same defect as two names over one.
   - **Three UI call sites were wrong in the same way**, each by whatever had happened since the check: safe-to-spend, the ledger's running total, and the headline figure. All now read one derived `balanceNow`, never `state.account.startingBalance`. The reality check's `modelledOn` reads it too — comparing a statement against the figure it was last set to measures nothing but the gap between two statements, while the drift that card exists to capture is the *model's* error since then. The stamp changed with it: `as of <date>` over a figure rolled forward to today is the same class of lie as the old "Balance today", so it now reads `confirmed <date>` — the one thing a reader cannot work out for themselves. It briefly also spelled out what had been added since (`· +$4,200.00 since`), which was the app narrating its own arithmetic: that amount is the user's own salary and bills applied on schedule, so it can never tell them anything they did not already know. Cut at the user's request, and worth remembering as a pattern — a figure the reader could derive from what they already entered is commentary, not information. The law is in `cashflowInvariants.test.ts` ("the start date is a window, not an anchor"): over 60 generated households, two windows opening on different days and ending on the same day must agree to the cent on every date they share — with a counter (`compared > 1000`) so that a version where the windows never overlapped cannot pass by asserting nothing.
   - **All date math is UTC** (`dateUtils.ts`): construct dates with `Date.UTC(...)` and read with `getUTC*()` to avoid timezone drift. Month days are clamped to end-of-month.

2. **Mortgage module** (`src/domain/mortgage/`):
   - `baseline.ts` (annuity payment + no-prepayment schedule) → `history.ts` (re-amortization with past prepayments) → `comparison.ts` (interest/months saved) → `scenarios.ts` (what-if engine over `oneTime`/`monthly`/`yearly`/`biweekly` extra-payment patterns) → `irr.ts` (effective annual rate from a schedule) → `prepaymentImpact.ts` (`computePrepaymentImpacts()`: what each past prepayment bought, cumulative against the baseline *and* incremental over the ones before it, plus how much of it the loan could not absorb).
   - **Unapplied money is attributed per row, not just totalled.** `computeMortgageWithPrepayments` hands back what a loan could not take (it was already smaller than the amount offered, or already gone) and the table ignored it, so an overshooting prepayment showed its amount, a saving of nothing, and no hint the money was still the household's. Attribution is by differencing the chronological prefixes, which is sound because adding a later prepayment never changes how the earlier ones were applied — so the per-row figures telescope into the whole log's total, and that is the law that holds it.
   - `irr.ts` exports both `computeEffectiveAnnualRateFromSchedule()`, which **throws** on an empty schedule, and `effectiveAnnualRateOrNull()`, which is what anything rendering a rate should call. An empty schedule is reachable — the principal field accepts any positive number, and one below the engine's 1e-6 epsilon buys no schedule at all — and the throw came from inside a render-time `useMemo`, taking the whole tab down.
   - Has its own `Money`/`ISODate` aliases in `mortgage/types.ts` and its own persisted state (`MortgageUIState` in `mortgage/persistence.ts`), separate from `AppState`.
   - **There is no such thing as a default mortgage.** `createDefaultMortgageUIState()` returned a $300,000 loan at 5% starting 2025-01-01, and *three* production paths reached for it whenever the real thing was missing or unreadable: `loadMortgageUIState()` on a fresh install, `saveMortgageUIState()` when handed unusable terms, and `parseSnapshot()` when a pulled snapshot's mortgage block would not sanitize. The first meant a new user opened the tab and was told what they owed on a loan that did not exist, down to the prepayment advice; the third fired on *sync*, so a garbled payload from another device became a confident $300,000 debt on this one, indistinguishable from the real thing. All three now answer `null`, `Snapshot.mortgage_ui` and `RemoteState*.mortgage_ui` are nullable, and the save path writes **nothing** rather than inventing terms when there is no stored loan to preserve. The fixture itself was fine — it is a perfectly good $300k loan and a dozen test files assert against it — so it moved to `src/test/mortgageFixture.ts` as `sampleMortgageUIState()`, where production code cannot reach it without that being obvious in review. `persistenceInvariants.test.ts` holds the line ("the app never invents a loan"), including a positive control, because a sanitizer that returned `null` for everything would satisfy every negative law and destroy every user's mortgage.
   - **The one place sync is not remote-wins.** `applySnapshot` writes the incoming mortgage only when the snapshot carries one, and leaves the local loan untouched when it does not. The app has no way to delete a mortgage, so "no mortgage here" is never an instruction to delete one — it is a device whose owner has not entered theirs. Without that exception the first push from a phone that had never opened the Mortgage tab would wipe a real loan off the laptop.
   - **The tab is a gate over a workbench.** `MortgageTab` now holds only the null decision and renders either `MortgageSetup` (asks for the four numbers, refuses anything the engine cannot amortize, and requires the loan's own start date — guessing today would date every loan to the day it was typed) or `MortgageWorkbench`, which is the old component unchanged and still takes a concrete `MortgageUIState`. Threading `terms: … | null` through its ten render-time memos instead would have put a null check in front of each, and the engine throws on a non-positive principal from inside a `useMemo` — which takes the whole tab down.
   - `src/components/MortgageTab.tsx` (~1,045 lines) is the UI over all of this. Keep it a shell: the last piece of money math living inside it (per-prepayment attribution) was moved to `prepaymentImpact.ts` precisely because logic in a component sits outside the `src/domain` invariant discipline by construction, and it had shipped two defects nobody had laws for.

3. **Reality checks** (`src/domain/reconciliation.ts`, rendered by `src/components/RealityCheckRow.tsx` + `RealityCheckModal.tsx`): the only part of the app that looks *outside* itself. Everything else — the invariant suites, `verify:ui` — proves the app is self-consistent, never that it matches the user's actual bank. Two figures are maintained by hand and nothing corrects them (`account.startingBalance`, and the loan principal implied by the mortgage terms), so a *checkpoint* records "on this date, the statement said this". Recording one is a single act that does two jobs, which is why freshness and reconciliation are one feature: it resets the staleness clock **and** captures how far the model had drifted. `modelled` is **stored, not recomputed** — for cash it is the only option, since correcting the balance destroys the counterfactual moments later. `assessDrift()` resolves direction into terms the two targets share (`modelOptimistic` always means *reality is worse than the model said*, whichever way the raw sign points), `assessFreshness()` ages from the **statement date** and not from when it was typed, and `summarizeCheckpoints()` flags a run of same-direction misses as `systematic` — three misses the same way is a missing rule, not bad luck, and re-entering the balance would only hide it. Cash checkpoints live on `AppState.checkpoints`, mortgage ones on `MortgageUIState.checkpoints`. **The cash check is deliberately locked to today and compared against `account.startingBalance`**, not against the timeline's first point: that point already has today's events applied, and comparing against it would put two different numbers for one quantity inside the same card.

4. **Sync** (`src/domain/persistence/`, `workers/sync-worker/`):
   - `snapshot.ts` defines the canonical envelope: `{ schemaVersion, app_state, mortgage_ui, updated_at, device_id }` — both `AppState` and `MortgageUIState` sync together as one unit.
   - `sync.ts` `syncNow()` decides push vs. pull: no remote → push (init); never synced locally → pull; remote `updated_at` changed since last sync → pull (remote always wins, no merge); otherwise push with `prev_updated_at` for optimistic concurrency. Before any pull overwrites local state, the current local snapshot is saved to a one-slot backup (`finance-cockpit:backup-before-pull`, readable via `loadPrePullBackup()`).
   - The app talks only to the `RemotePersistenceAdapter` interface (`remote.ts`); `remoteCloudflare.ts` is the fetch-based implementation. Adapter failures are thrown as `RemoteSyncError` with a `kind` (`unauthorized`/`conflict`/`notFound`/`network`/`server`) — branch on `kind`, never string-match error messages. The Worker (`workers/sync-worker/index.ts`) stores snapshots in KV, is PIN-gated (client sends `X-Sync-Pin: sha256(pin)`; first-seen hash is bound to the shared key), and returns `409` on `prev_updated_at` mismatch.
   - Identity is a user-entered shared key remembered in localStorage (`SyncSection.tsx`); there are no user accounts.

### Persistence and migrations

Every load path is defensive: `upgradeAppState()` (`appState.ts`), `parseSnapshot()`, and mortgage persistence all validate field-by-field and fall back to defaults rather than throwing. Rule schedules are validated by `sanitizeSchedule()` (rules with unusable schedules are dropped), ad-hoc transactions by `sanitizeAdhocTransaction()`, snapshot payloads via `upgradeAppState()`/`sanitizeMortgageUIState()`, and `parseISODate()` throws on malformed input (check with `isValidISODate()` first when the value is untrusted — the engine tolerates a transiently-invalid `startDate` by returning an empty projection). `AppState` carries `version` (`APP_STATE_VERSION`, currently 9). v1→v2 added `adhocTransactions`; v2→v3 added top-up tracking (`kind`/`reason` on `AdhocTransaction`, plus `trackingSince`/`coverageLens`/`secondSalaryMonthly` in settings); v3→v4 added `settings.surplus`; v4→v5 added `checkpoints`; **v5→v6 retired the two kinds of top-up**, dropping `reason` and `settings.coverageLens` on read; **v6→v7 retired overrides on one-time transactions**, folding any into the transaction's own amount; **v7→v8 added `settings.followToday`**; **v8→v9 retired it again**, along with the rolling start date. v2–v5 are additive — older states migrate through the field-by-field path without losing rules, and only pre-v1 states are reset. **v3 deliberately does not backfill**: older transactions named "Top Up"/"Transfer from savings" are left unmarked, because past top-ups were never recorded reliably and name-matching them would invent untrustworthy history. `trackingSince` is stamped once on the first v3 load and preserved thereafter — re-stamping it would silently reset the coverage clock. **v5 does not backfill either**: there is no honest way to invent a date on which a figure was last confirmed, so an upgraded state arrives with an empty checkpoint log and reads as never confirmed, which is what it is. **v6 is the one subtractive migration**, and deliberately narrow: a top-up is money the household really moved, so `kind`, amount, date and name all survive untouched and coverage goes on counting the draw — only the label saying *why*, and the lens that existed to filter on it, are dropped. A retired field carried forward is one the app keeps writing back forever, so `sanitizeAdhocTransaction()` simply stops reading it; `persistenceInvariants.test.ts` holds that line, as does the browser check in `scripts/verify-ui.mjs`, whose seed payload is deliberately a v3 state carrying both. **v7 folds rather than discards**: an override on a one-off is dropped, but its value is written onto the transaction first, so the figure the user was looking at is the one that survives and nothing on screen moves across the upgrade — a migration that "tidied up" by reverting to the pre-override amount would quietly change what they are owed. `persistenceInvariants.test.ts` holds that line by running the projection over the raw stored shape and over the upgraded one and requiring every event amount to match. An override stranded on a date the transaction no longer has is dropped outright: it can never apply again, and reviving it if the date happened to move back would be a surprise rather than a feature. Overrides on *rules* are untouched. **v8 is additive and absent-means-true**: the stored `startDate` is left exactly where it is, so every existing domain caller still receives a concrete date and nothing in the engine changes — the advance happens at the App boundary on load. Only an explicit `false` pins it, stored as the exception rather than the rule so an older state, which has no opinion, gets the behaviour almost everyone wants. **v9 is subtractive and narrow, like v6**: the rolling start date was a workaround for staleness being measured against the window, and once "now" means the clock there is nothing for the flag to do. `followToday` simply stops being read, so it stops being written back forever; the stored `startDate` is left exactly where it is, because it is the user's. Snapshots carry `schemaVersion` (`CURRENT_SCHEMA_VERSION`). When changing persisted shapes, bump the relevant version and extend the corresponding upgrade/parse function additively — never assume stored JSON is well-formed, and never let a version bump discard user data.

### Settings — grouped by what each field changes

The Settings card opens with **Balance**, outside any group: everything in the app is counted forward from it, and it is the one field there that gets updated regularly rather than set once. Below it, two headed groups — **Forecast** (forecasting from — a plain date the user owns — horizon, minimum safe balance) and **One-salary coverage** (top-ups tracked since, second salary) — each named for the surface it drives, so a reader looking for one setting does not have to read all six. The groups carry `data-testid="settings-group-forecast"` / `-coverage`, and the tests assert each field sits inside the group for the thing it changes, not merely that the headings exist.

**Sync folds once it is set up.** It is configured once and then never touched, so with a key remembered it collapses to one line (`data-testid="sync-summary"`) naming the key and the last sync, with a "Change" toggle. With nothing remembered it stays open, because then setting it up *is* the task and hiding it behind a disclosure the user has to find first is worse than the clutter.

**Two things in it may never be folded away**, and this is the law the suite holds: a **conflict** is a decision the user still owes (Keep Local / Keep Remote lives nowhere else, so folding it strands two diverged devices with no route back to the choice), and an **error** means sync is silently not happening. While either is outstanding the panel is pinned open and *no toggle is rendered at all*, rather than rendered and ignored. Both are reachable in one tap — open sync, hit a 409, collapse — so neither is hypothetical. Note that those two tests pass vacuously against a version with no toggle, which is exactly the trap in "red before green": they were confirmed to bite by forcing `pinnedOpen = false` and watching them fail, not by watching them pass.

The summary's date goes through `formatDate` like every other user-facing date, not the `toLocaleString` the expanded rows use — a line that is on screen all the time is the worst place for a second date format. `lastSynced` comes from localStorage and is therefore untrusted: a value that is not a real date reads as "not synced yet", never "Invalid Date".

### Date formatting in UI

All user-facing dates go through `formatDate` in `src/utils/dates.ts` (DD MMM 'YY format; `monthYearLabel`/`monthKey` there drive the events list's month separators). Date inputs pair the native `<input type="date">` with the formatted value beneath (`DateInputWithDisplay` in `src/components/shared.tsx`); money inputs use `NumberInput` (same file), which keeps raw text locally so an in-progress `-` isn't coerced to 0. **`DateInputWithDisplay` holds raw text for the same reason**, and it matters more there: a native date input reports a value on every keystroke, and typing the year 2027 passes through 0002, 0020 and 0202. `sanitizeAdhocTransaction` and `sanitizeSchedule` drop a *whole record* whose date fails `isValidISODate`, so committing a half-typed one silently deleted the transaction — or the entire recurring rule — at the next reload. The component now commits only what `isValidISODate` accepts, plus the empty string, which is a real instruction (the Start date uses it to mean "I have not told you what today is"). **The write path must refuse exactly what the read path refuses**; a UI that can save what storage will throw away is a data-loss bug, not a validation nicety.

**`formatDate` joins its parts with non-breaking spaces** (U+00A0) so a date never wraps mid-way. That makes `toHaveTextContent("1 Sep '26")` and `/1 Sep '26/` fail against a rendered date while looking character-identical in the diff — twice now, for about twenty minutes each. Match rendered dates with `\s` (which covers U+00A0 in JS regex) or normalise with `.replace(/\s+/g, " ")`; better still, compare against `formatDate(...)` itself rather than a hand-typed literal.

Related, and the reason it was so easy to hit: **never sort a list by a field its own rows are editing.** The Settings one-time-transaction list was sorted by date, so each committed keystroke re-sorted it and moved the row out from under the cursor — in a real browser that scrambled the remaining keystrokes into dates like `225202-07-18`. That list is now in insertion order; the dashboard ledger is where transactions appear by date, and nothing there is editable.

### Service worker / PWA updates

`vite-plugin-pwa` runs in `registerType: "prompt"` mode. `src/Root.tsx` wires `virtual:pwa-register/react`'s `useRegisterSW` to the `UpdateBanner` component so a new version waits for a user tap instead of swapping silently. The pure banner (`src/components/UpdateBanner.tsx`) is unit-tested; `Root.tsx` is the untestable runtime glue.
