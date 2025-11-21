// src/domain/mortgageEngine.ts
import type {
    MortgageConfig,
MortgageScheduleEntry,
MortgageSimulationResult,
Money,
ISODate,
} from "./types";
import { toISODate, parseISODate } from "./dateUtils";

function addMonthsUTC(date: Date, months: number): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const d = date.getUTCDate();

  const base = new Date(Date.UTC(y, m + months, 1));
  const baseYear = base.getUTCFullYear();
  const baseMonth = base.getUTCMonth();

  const lastDay = new Date(
    Date.UTC(baseYear, baseMonth + 1, 0)
  ).getUTCDate();

  const safeDay = Math.min(d, lastDay);
  return new Date(Date.UTC(baseYear, baseMonth, safeDay));
}

/**
 * Compute fixed-rate mortgage monthly payment.
 */
export function computeMonthlyPayment(config: MortgageConfig): Money {
  const { principal, annualRate, termMonths } = config;

  if (termMonths <= 0) {
    throw new Error("termMonths must be > 0");
  }

  if (annualRate === 0) {
    return principal / termMonths;
  }

  const r = annualRate / 12;
  const pow = Math.pow(1 + r, termMonths);
  const payment = (principal * r * pow) / (pow - 1);

  return payment;
}

interface InternalSimResult {
  schedule: MortgageScheduleEntry[];
  totalInterestPaid: Money;
  payoffDate: ISODate;
}

function simulateMortgageInternal(
  config: MortgageConfig,
  extraMonthlyPayment: Money
): InternalSimResult {
  const { principal, annualRate, termMonths, startDate } = config;

  if (termMonths <= 0) {
    throw new Error("termMonths must be > 0");
  }

  if (config.monthlyPayment <= 0 && annualRate > 0) {
    throw new Error("monthlyPayment must be > 0 for positive interest rate");
  }

  const schedule: MortgageScheduleEntry[] = [];
  let balance = principal;
  let totalInterest = 0;

  const monthlyRate = annualRate / 12;
  const basePayment = config.monthlyPayment;

  let currentDate = parseISODate(startDate);

  const maxIterations = termMonths * 2;

  let i = 0;
  for (; i < maxIterations; i++) {
    if (balance <= 0) break;

    const interest = monthlyRate > 0 ? balance * monthlyRate : 0;
    const targetPayment = basePayment + extraMonthlyPayment;

    if (targetPayment <= interest && balance > 0) {
      break;
    }

    let payment = targetPayment;
    const maxNeeded = balance + interest;
    if (payment > maxNeeded) {
      payment = maxNeeded;
    }

    const principalPaid = payment - interest;
    balance = balance - principalPaid;
    totalInterest += interest;

    const entry: MortgageScheduleEntry = {
      date: toISODate(currentDate),
      interest,
      principal: principalPaid,
      remainingBalance: Math.max(balance, 0),
    };

    schedule.push(entry);

    currentDate = addMonthsUTC(currentDate, 1);
  }

  const payoffDate =
    schedule.length > 0
      ? schedule[schedule.length - 1].date
      : startDate;

  return {
    schedule,
    totalInterestPaid: totalInterest,
    payoffDate,
  };
}

export function simulateMortgage(
  config: MortgageConfig,
  extraMonthlyPayment: Money = 0
): MortgageSimulationResult {
  const baseline = simulateMortgageInternal(config, 0);

  const withExtra =
    extraMonthlyPayment > 0
      ? simulateMortgageInternal(config, extraMonthlyPayment)
      : baseline;

  const interestSaved =
    baseline.totalInterestPaid - withExtra.totalInterestPaid;

  return {
    schedule: withExtra.schedule,
    totalInterestPaid: withExtra.totalInterestPaid,
    payoffDate: withExtra.payoffDate,
    interestSaved,
    baselineInterest: baseline.totalInterestPaid,
  };
}

// --- Optimization helper: summarizes baseline vs extra-payment scenario ---

export interface MortgageOptimizationSummary {
  baselineMonthlyPayment: Money;
  baselineTotalInterest: Money;
  baselineTermMonths: number;
  newTotalInterest: Money;
  newTermMonths: number;
  interestSaved: Money;
  monthsSaved: number;
}

/**
 * Runs a baseline simulation (no extra payment) and a scenario with a fixed
 * extra monthly payment, and returns a concise summary of the impact.
 */
export function summarizeMortgageOptimization(
  baseConfig: MortgageConfig,
  extraMonthlyPayment: Money
): MortgageOptimizationSummary {
  const monthlyPayment = computeMonthlyPayment(baseConfig);

  const configWithPayment: MortgageConfig = {
    ...baseConfig,
    monthlyPayment,
  };

  const baseline: MortgageSimulationResult = simulateMortgage(
    configWithPayment,
    0
  );
  const withExtra: MortgageSimulationResult = simulateMortgage(
    configWithPayment,
    extraMonthlyPayment
  );

  const baselineTermMonths = baseline.schedule.length;
  const newTermMonths = withExtra.schedule.length;

  const interestSaved =
    baseline.totalInterestPaid - withExtra.totalInterestPaid;
  const monthsSaved =
    baselineTermMonths > newTermMonths
      ? baselineTermMonths - newTermMonths
      : 0;

  return {
    baselineMonthlyPayment: monthlyPayment,
    baselineTotalInterest: baseline.totalInterestPaid,
    baselineTermMonths,
    newTotalInterest: withExtra.totalInterestPaid,
    newTermMonths,
    interestSaved,
    monthsSaved,
  };
}
