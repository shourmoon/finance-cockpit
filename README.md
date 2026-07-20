# Finance Cockpit

A local-first personal-finance PWA: project your cash balance day by day, see what's safe to spend, and optimize mortgage prepayments. Built with React 18 + TypeScript + Vite. All data lives in your browser's localStorage; an optional Cloudflare Worker enables PIN-protected sync across devices.

## Features

- **Cashflow projection** — recurring income/expense rules (monthly, twice-a-month with US-Fed business-day adjustment, or biweekly) plus ad-hoc one-time transactions, expanded over a configurable horizon into a daily balance timeline, with per-occurrence amount overrides.
- **Safe to spend** — computes how much you can spend today without the projected balance ever dropping below your safety floor.
- **Mortgage optimizer** — amortization with past prepayments, baseline-vs-actual comparison (interest and months saved), what-if scenarios (one-time / monthly / yearly / biweekly extra payments), and effective-APR calculation.
- **Cross-device sync (optional)** — snapshots pushed/pulled through a Cloudflare Worker + KV, gated by a shared key and PIN, with optimistic concurrency and an in-app conflict resolver. A local backup is saved before any pull overwrites local data.

## Quick start

```bash
npm install
npm run dev        # Vite dev server
npm test           # Vitest in watch mode
npx vitest run     # run the whole suite once
npm run build      # typecheck (tsc --noEmit) + production PWA build
```

## Sync backend (optional)

The app works fully offline without a backend. To enable cross-device sync:

1. Create a Cloudflare KV namespace and set its IDs in `workers/sync-worker/wrangler.toml` (binding name `SYNC_KV`).
2. Deploy the worker:

   ```bash
   cd workers/sync-worker
   npx wrangler deploy
   ```

3. Build the app with `VITE_SYNC_BASE_URL` pointing at the deployed worker URL.

On first sync from the Sync section of the app, pick a shared key and a PIN; the worker binds the PIN (as a SHA-256 hash) to that key on first use and requires it thereafter. Enter the same key + PIN on another device to link it.

## Architecture

Business logic is pure, framework-free TypeScript under `src/domain/` (cashflow engine, mortgage math, persistence/sync) with the React components in `src/components/` as thin shells over it. The test suite runs against the domain layer and the worker. See `CLAUDE.md` for a fuller architectural walkthrough.
