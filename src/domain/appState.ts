// src/domain/appState.ts
import type {
    AppState,
CashAccount,
CashflowSettings,
RecurringRule,
EventOverridesMap,
UUID,
} from "./types";
import { toISODate } from "./dateUtils";

export const APP_STATE_VERSION = 1;

function createDefaultAccount(): CashAccount {
  return {
    startingBalance: 0,
  };
}

function createDefaultSettings(): CashflowSettings {
  const today = toISODate(new Date());
  return {
    startDate: today,
    horizonDays: 90,
    minSafeBalance: 0,
  };
}

function createDefaultRules(): RecurringRule[] {
  const todayIso = toISODate(new Date());
  const mkId = (suffix: string): UUID => `rule-${suffix}`;

  return [
    {
      id: mkId("paycheck"),
      name: "Paycheck (Twice a Month)",
      amount: 2000,
      isVariable: false,
      schedule: {
        type: "twiceMonth",
        day1: 15,
        day2: 31,
        businessDayConvention: "previousBusinessDayUS",
      },
    },
    {
      id: mkId("rent"),
      name: "Rent",
      amount: -1500,
      isVariable: false,
      schedule: {
        type: "monthly",
        day: 1,
      },
    },
    {
      id: mkId("credit-card"),
      name: "Credit Card Payment",
      amount: -400,
      isVariable: true,
      schedule: {
        type: "monthly",
        day: 20,
      },
    },
    {
      id: mkId("groceries"),
      name: "Groceries (Biweekly)",
      amount: -150,
      isVariable: true,
      schedule: {
        type: "biweekly",
        anchorDate: todayIso,
      },
    },
  ];
}

function createDefaultOverrides(): EventOverridesMap {
  return {};
}

export function createInitialAppState(): AppState {
  return {
    version: APP_STATE_VERSION,
    account: createDefaultAccount(),
    settings: createDefaultSettings(),
    rules: createDefaultRules(),
    overrides: createDefaultOverrides(),
  };
}

/**
 * Upgrade raw JSON from storage into a valid AppState,
 * filling in defaults and migrating versions if needed.
 */
export function upgradeAppState(raw: any): AppState {
  if (!raw || typeof raw !== "object") {
    return createInitialAppState();
  }

  const version = typeof raw.version === "number" ? raw.version : 0;

  if (version < APP_STATE_VERSION) {
    const fresh = createInitialAppState();
    if (raw.account && typeof raw.account.startingBalance === "number") {
      fresh.account.startingBalance = raw.account.startingBalance;
    }
    return fresh;
  }

  const account: CashAccount = {
    startingBalance:
      raw.account && typeof raw.account.startingBalance === "number"
        ? raw.account.startingBalance
        : 0,
  };

  const settings: CashflowSettings = {
    startDate:
      raw.settings && typeof raw.settings.startDate === "string"
        ? raw.settings.startDate
        : toISODate(new Date()),
    horizonDays:
      raw.settings && typeof raw.settings.horizonDays === "number"
        ? raw.settings.horizonDays
        : 90,
    minSafeBalance:
      raw.settings && typeof raw.settings.minSafeBalance === "number"
        ? raw.settings.minSafeBalance
        : 0,
  };

  const rules: RecurringRule[] = Array.isArray(raw.rules)
    ? raw.rules
        .filter((r: any) => r && typeof r.id === "string")
        .map((r: any) => ({
          id: r.id,
          name: typeof r.name === "string" ? r.name : "Rule",
          amount: typeof r.amount === "number" ? r.amount : 0,
          isVariable: !!r.isVariable,
          schedule: r.schedule,
        }))
    : createDefaultRules();

  const overrides: EventOverridesMap =
    raw.overrides && typeof raw.overrides === "object" ? raw.overrides : {};

  return {
    version: APP_STATE_VERSION,
    account,
    settings,
    rules,
    overrides,
  };
}
