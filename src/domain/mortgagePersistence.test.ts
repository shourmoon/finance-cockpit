// src/domain/mortgagePersistence.test.ts
import {
  saveMortgageSettings,
  loadMortgageSettings,
  type PersistedMortgageSettings,
} from "./persistence";

describe("mortgage settings persistence", () => {
  const key = "finance-cockpit:mortgage-settings";

  beforeEach(() => {
    window.localStorage.clear();
  });

  it("round-trips valid settings via localStorage", () => {
    const settings: PersistedMortgageSettings = {
      principal: 400_000,
      annualRate: 0.065,
      termMonths: 360,
      startDate: "2025-01-01",
      extraMonthlyPayment: 250,
    };

    saveMortgageSettings(settings);

    const raw = window.localStorage.getItem(key);
    expect(raw).toBeTruthy();

    const loaded = loadMortgageSettings();
    expect(loaded).not.toBeNull();
    expect(loaded).toEqual(settings);
  });

  it("returns null when stored data is missing or malformed", () => {
    // No settings set → null
    expect(loadMortgageSettings()).toBeNull();

    // Malformed JSON
    window.localStorage.setItem(key, "not-json");
    expect(loadMortgageSettings()).toBeNull();

    // Wrong shape
    window.localStorage.setItem(
      key,
      JSON.stringify({ foo: "bar" })
    );
    expect(loadMortgageSettings()).toBeNull();
  });
});
