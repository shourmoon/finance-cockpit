// src/App.test.tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import App from "./App";

beforeEach(() => {
  window.localStorage.clear();
});

describe("App shell", () => {
  it("renders the dashboard by default with projection metrics", () => {
    render(<App />);
    expect(screen.getByText("Projection Metrics")).toBeInTheDocument();
    expect(screen.getByText("Upcoming Events")).toBeInTheDocument();
    // Default rules produce upcoming events.
    expect(screen.getAllByText(/Paycheck|Rent/).length).toBeGreaterThan(0);
    // Each event row shows its running balance on the second line.
    expect(screen.getAllByText(/^Balance \$/).length).toBeGreaterThan(0);
  });

  it("switches between tabs", () => {
    render(<App />);
    fireEvent.click(screen.getByText("Settings & Rules"));
    expect(screen.getByText("Recurring Rules")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Mortgage Optimizer"));
    expect(screen.getByText(/Original loan terms/i)).toBeInTheDocument();

    fireEvent.click(screen.getByText("Dashboard"));
    expect(screen.getByText("Projection Metrics")).toBeInTheDocument();
  });

  it("edits settings and persists them to localStorage", () => {
    render(<App />);
    fireEvent.click(screen.getByText("Settings & Rules"));

    const startingBalance = screen.getByRole("textbox", { name: /Starting Balance/i });
    fireEvent.change(startingBalance, { target: { value: "5000" } });

    // Persisted state should reflect the new balance.
    const raw = window.localStorage.getItem("finance-cockpit-app-state-v1")!;
    expect(JSON.parse(raw).account.startingBalance).toBe(5000);

    // Dashboard reflects it too.
    fireEvent.click(screen.getByText("Dashboard"));
    expect(screen.getByText("$5,000.00")).toBeInTheDocument();
  });

  it("updates horizon and minimum safe balance", () => {
    render(<App />);
    fireEvent.click(screen.getByText("Settings & Rules"));
    fireEvent.change(screen.getByRole("spinbutton", { name: /Horizon/i }), {
      target: { value: "10" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /Minimum Safe Balance/i }), {
      target: { value: "200" },
    });
    const raw = JSON.parse(window.localStorage.getItem("finance-cockpit-app-state-v1")!);
    expect(raw.settings.horizonDays).toBe(10);
    expect(raw.settings.minSafeBalance).toBe(200);
  });

  it("adds a new rule through the editor modal", () => {
    render(<App />);
    fireEvent.click(screen.getByText("Settings & Rules"));
    const before = screen.getAllByText("Edit").length;

    // Two + Add buttons exist now (rules card first, one-time transactions second).
    fireEvent.click(screen.getAllByText("+ Add")[0]);
    fireEvent.change(screen.getByDisplayValue("New Rule"), {
      target: { value: "Gym Membership" },
    });
    fireEvent.click(screen.getByText("Save"));

    expect(screen.getByText("Gym Membership")).toBeInTheDocument();
    expect(screen.getAllByText("Edit").length).toBe(before + 1);
  });

  it("edits and deletes an existing rule", () => {
    render(<App />);
    fireEvent.click(screen.getByText("Settings & Rules"));

    expect(screen.getByText("Rent")).toBeInTheDocument();
    // Find the Rent rule row and open its editor.
    // ruleName -> ruleInfo -> ruleRow (which also holds the Edit button).
    const rentRow = screen.getByText("Rent").parentElement!.parentElement!;
    fireEvent.click(within(rentRow).getByText("Edit"));
    fireEvent.click(screen.getByText("Delete"));

    expect(screen.queryByText("Rent")).not.toBeInTheDocument();
  });

  it("applies a per-event override from the dashboard", () => {
    render(<App />);
    // Click the first upcoming event row to open the override modal.
    const firstEvent = screen.getAllByText(/Paycheck|Rent|Groceries|Credit Card/)[0];
    fireEvent.click(firstEvent);

    expect(screen.getByText(/Override:/)).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/leave blank/), {
      target: { value: "-999" },
    });
    fireEvent.click(screen.getByText("Save"));

    // The overridden amount now appears in the event list, and an
    // asterisk marks the overridden row.
    expect(screen.getAllByText("-$999.00").length).toBeGreaterThan(0);
    expect(screen.getByText(/\*/)).toBeInTheDocument();
  });

  it("adjusts a rule amount inline from the config list", () => {
    render(<App />);
    fireEvent.click(screen.getByText("Settings & Rules"));
    // Rent default is -1500; change it inline.
    const rentAmount = screen.getByDisplayValue("-1500");
    fireEvent.change(rentAmount, { target: { value: "-1600" } });
    const raw = JSON.parse(window.localStorage.getItem("finance-cockpit-app-state-v1")!);
    const rent = raw.rules.find((r: any) => r.name === "Rent");
    expect(rent.amount).toBe(-1600);
  });

  it("adds a one-time transaction and shows it in the projection", () => {
    render(<App />);
    fireEvent.click(screen.getByText("Settings & Rules"));
    expect(screen.getByText(/No one-time transactions yet/)).toBeInTheDocument();

    // The card has its own + Add button (the rules card has the other).
    const addButtons = screen.getAllByText("+ Add");
    fireEvent.click(addButtons[addButtons.length - 1]);

    fireEvent.change(screen.getByLabelText("Transaction name"), {
      target: { value: "Car repair" },
    });
    fireEvent.change(screen.getByLabelText("Transaction amount"), {
      target: { value: "-800" },
    });

    const raw = JSON.parse(window.localStorage.getItem("finance-cockpit-app-state-v1")!);
    expect(raw.adhocTransactions).toHaveLength(1);
    expect(raw.adhocTransactions[0]).toMatchObject({
      name: "Car repair",
      amount: -800,
    });

    // It appears in the dashboard's upcoming events (dated startDate = today).
    fireEvent.click(screen.getByText("Dashboard"));
    expect(screen.getByText("Car repair")).toBeInTheDocument();
    expect(screen.getAllByText("-$800.00").length).toBeGreaterThan(0);
  });

  it("deletes a one-time transaction", () => {
    render(<App />);
    fireEvent.click(screen.getByText("Settings & Rules"));
    const addButtons = screen.getAllByText("+ Add");
    fireEvent.click(addButtons[addButtons.length - 1]);
    expect(screen.getByLabelText("Transaction name")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Delete transaction"));
    expect(screen.getByText(/No one-time transactions yet/)).toBeInTheDocument();
    const raw = JSON.parse(window.localStorage.getItem("finance-cockpit-app-state-v1")!);
    expect(raw.adhocTransactions).toHaveLength(0);
  });

  it("changing a transaction's date moves it in the persisted state", () => {
    render(<App />);
    fireEvent.click(screen.getByText("Settings & Rules"));
    const addButtons = screen.getAllByText("+ Add");
    fireEvent.click(addButtons[addButtons.length - 1]);

    // The transaction row's date input is the last date input on the tab.
    const dateInputs = document.querySelectorAll('input[type="date"]');
    const txnDate = dateInputs[dateInputs.length - 1];
    fireEvent.change(txnDate, { target: { value: "2026-08-01" } });

    const raw = JSON.parse(window.localStorage.getItem("finance-cockpit-app-state-v1")!);
    expect(raw.adhocTransactions[0].date).toBe("2026-08-01");
  });

  it("restores persisted state on reload", () => {
    const { unmount } = render(<App />);
    fireEvent.click(screen.getByText("Settings & Rules"));
    fireEvent.change(screen.getByRole("textbox", { name: /Starting Balance/i }), {
      target: { value: "4242" },
    });
    unmount();

    render(<App />);
    fireEvent.click(screen.getByText("Settings & Rules"));
    expect(screen.getByDisplayValue("4242")).toBeInTheDocument();
  });
});
