// scripts/verify-ui.mjs
//
// The checks jsdom cannot make. Every UI defect that reached the user in this
// project was invisible to the unit tests and obvious in a real browser at
// phone width: a $150,000 prepayment clipped to "15000", a row advertising a
// commitment that bought nothing, two sections quoting the same figure a
// month apart. This runs those checks mechanically so they stop being
// something someone has to think to do.
//
//   npm run verify:ui
//
// Skips with a clear message (exit 0) when Playwright is unavailable, so it
// never blocks a machine that cannot run it. Fails loudly on a real problem.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import process from "node:process";

const PORT = 5177;
const WIDTH = 360;

/** Playwright lives outside the project here; look where it plausibly is. */
async function loadPlaywright() {
  const candidates = [
    "playwright",
    "/opt/node22/lib/node_modules/playwright/index.mjs",
    "/usr/lib/node_modules/playwright/index.mjs",
  ];
  for (const c of candidates) {
    try {
      return await import(c);
    } catch {
      /* try the next one */
    }
  }
  return null;
}

function findChromium() {
  const known = [
    process.env.PLAYWRIGHT_CHROMIUM,
    "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    "/opt/pw-browsers/chromium/chrome",
  ].filter(Boolean);
  return known.find((p) => existsSync(p));
}

const failures = [];
const fail = (msg) => failures.push(msg);

const pw = await loadPlaywright();
if (!pw) {
  console.log("verify:ui — Playwright not available, skipping browser checks.");
  process.exit(0);
}

const server = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], {
  stdio: "ignore",
  detached: true,
});
const stopServer = () => {
  try {
    process.kill(-server.pid);
  } catch {
    /* already gone */
  }
};

async function waitForServer(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${PORT}/`);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

try {
  if (!(await waitForServer())) {
    console.error("verify:ui — dev server did not start.");
    stopServer();
    process.exit(1);
  }

  const executablePath = findChromium();
  const browser = await pw.chromium.launch(
    executablePath ? { executablePath } : {}
  );
  const page = await browser.newPage({
    viewport: { width: WIDTH, height: 900 },
    deviceScaleFactor: 2,
  });

  const noise = [];
  page.on("pageerror", (e) => noise.push(`page error: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") noise.push(`console error: ${m.text()}`);
  });

  // A realistic household, seeded so the checks exercise real figures rather
  // than empty states. Deliberately an OLD payload: it still carries the
  // retired `scenarios` array, so every run re-proves that upgrading a
  // returning user's state does not lose their loan.
  await page.addInitScript(() => {
    localStorage.setItem(
      "finance-cockpit-mortgage-v2",
      JSON.stringify({
        terms: {
          principal: 680000, annualRate: 0.0475, termMonths: 360,
          startDate: "2023-06-01", paymentFrequency: "biweekly",
        },
        prepayments: [{ date: "2025-01-01", amount: 150000, note: "lump" }],
        asOfDate: "2026-08-01",
        scenarios: [{ id: "s1", name: "retired feature", patterns: [] }],
      })
    );
    localStorage.setItem(
      "finance-cockpit-app-state-v1",
      JSON.stringify({
        version: 3,
        account: { startingBalance: 12000 },
        settings: {
          startDate: "2026-08-01", horizonDays: 90, minSafeBalance: 2000,
          trackingSince: "2025-09-01", coverageLens: "all",
          surplus: {
            parkedCash: 120000, monthlyContribution: 2000,
            yearlyContribution: 15000, yearlyMonth: 3, reserveMonths: 6,
            expectedReturn: 0.07, capitalGainsRate: 0.2517, horizonYears: 30,
          },
        },
        rules: [
          { id: "sal", name: "Salary", amount: 9000, isVariable: false,
            schedule: { type: "twiceMonth", day1: 15, day2: 31 } },
          { id: "liv", name: "Living", amount: -8000, isVariable: false,
            schedule: { type: "monthly", day: 5 } },
        ],
        adhocTransactions: [
          { id: "t1", name: "Top Up", amount: 1200, date: "2026-03-02",
            kind: "topUp", reason: "shortfall" },
        ],
        overrides: {},
      })
    );
  });

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);

  // --- 1. every tab renders, and nothing in the console complains ---
  for (const tab of ["Dashboard", "Settings & Rules", "Mortgage Optimizer"]) {
    await page.getByText(tab, { exact: false }).first().click();
    await page.waitForTimeout(500);
    const cards = await page.locator("h3").count();
    if (cards === 0) fail(`${tab}: rendered no cards`);

    // --- 2. nothing overflows or is clipped at phone width ---
    const layout = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      clipped: [...document.querySelectorAll("input,select")]
        .filter((el) => el.scrollWidth > el.clientWidth + 1)
        .map((el) => `${el.getAttribute("aria-label") || el.type}="${el.value}"`),
    }));
    if (layout.scrollWidth > layout.clientWidth) {
      fail(`${tab}: page scrolls horizontally (${layout.scrollWidth}px > ${layout.clientWidth}px)`);
    }
    for (const c of layout.clipped) fail(`${tab}: control is clipped — ${c}`);

    // --- 2b. no arithmetic wreckage rendered as a figure ---
    // A single non-finite amount reaching a metric renders as "NaN" or
    // "$Infinity" — a number the user may act on. Cheap to scan for, and
    // no legitimate copy in this app contains any of these.
    const body = await page.locator("body").innerText();
    for (const bad of ["NaN", "Infinity", "undefined", "[object Object]"]) {
      if (body.includes(bad)) fail(`${tab}: rendered "${bad}" as text`);
    }
  }

  // --- 3. the loan survived a migration from the older stored shape ---
  const stored = await page.evaluate(() => ({
    app: JSON.parse(localStorage.getItem("finance-cockpit-app-state-v1")),
    mortgage: JSON.parse(localStorage.getItem("finance-cockpit-mortgage-v2")),
  }));
  if (stored.mortgage.terms.principal !== 680000) {
    fail("migration lost the user's loan terms");
  }
  if (stored.app.rules.length !== 2 || stored.app.adhocTransactions.length !== 1) {
    fail("migration lost rules or transactions");
  }
  if (stored.app.settings.trackingSince !== "2025-09-01") {
    fail("migration reset the coverage clock");
  }

  // --- 4. figures shown together reconcile, as rendered ---
  const months = (t) => {
    const y = /(\d+)\s*yrs?/.exec(t);
    const m = /(\d+)\s*mos?/.exec(t);
    return (y ? +y[1] * 12 : 0) + (m ? +m[1] : 0);
  };
  const dollars = (t) => {
    const m = /\$([\d,]+)/.exec(t);
    return m ? +m[1].replace(/,/g, "") : 0;
  };

  await page.getByText("Mortgage Optimizer").click();
  await page.waitForTimeout(600);

  const legIds = [
    "leg-cadence", "leg-prepayments",
    "leg-futureLump", "leg-futureMonthly", "leg-futureYearly",
  ];
  let sumMonths = 0;
  let sumDollars = 0;
  for (const id of legIds) {
    const el = page.getByTestId(`${id}-value`);
    if (await el.count()) {
      const t = await el.innerText();
      sumMonths += months(t);
      sumDollars += dollars(t);
    }
  }
  const totalText = await page.getByTestId("leg-total-value").innerText();
  if (sumMonths !== months(totalText)) {
    fail(`attribution months do not add up: parts ${sumMonths}, total ${months(totalText)}`);
  }
  if (sumDollars !== dollars(totalText)) {
    fail(`attribution interest does not add up: parts ${sumDollars}, total ${dollars(totalText)}`);
  }

  // --- 5. with no "today", the app claims nothing rather than something ---
  // Clearing the Start date is one keystroke away in Settings, and it leaves
  // settings.startDate as "". Coverage used to build its window from that and
  // collapse into a single fabricated month that read as clean, so the card
  // announced "1 of 1 months on one salary" — evidence of coverage for a
  // month that was never measured. Nothing may be claimed from no date.
  await page.getByText("Settings & Rules", { exact: false }).first().click();
  await page.waitForTimeout(300);
  await page.getByLabel("Start date").fill("");
  await page.waitForTimeout(300);
  await page.getByText("Dashboard", { exact: false }).first().click();
  await page.waitForTimeout(500);

  const blankDateBody = await page.locator("body").innerText();
  if (/months on one salary/.test(blankDateBody)) {
    fail("coverage claims tracked months with no start date set");
  }
  for (const bad of ["NaN", "Infinity", "undefined"]) {
    if (blankDateBody.includes(bad)) {
      fail(`blank start date: rendered "${bad}" as text`);
    }
  }

  for (const n of noise) fail(n);
  await browser.close();
} finally {
  stopServer();
}

if (failures.length) {
  console.error(`\nverify:ui FAILED (${failures.length}):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("verify:ui — tabs render, nothing clipped or overflowing, state migrates, figures reconcile.");
