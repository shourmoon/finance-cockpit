// src/App.test.tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
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

    const startingBalance = screen.getByRole("spinbutton", { name: /Starting Balance/i });
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
    fireEvent.change(screen.getByRole("spinbutton", { name: /Minimum Safe Balance/i }), {
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

    fireEvent.click(screen.getByText("+ Add"));
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

  it("restores persisted state on reload", () => {
    const { unmount } = render(<App />);
    fireEvent.click(screen.getByText("Settings & Rules"));
    fireEvent.change(screen.getByRole("spinbutton", { name: /Starting Balance/i }), {
      target: { value: "4242" },
    });
    unmount();

    render(<App />);
    fireEvent.click(screen.getByText("Settings & Rules"));
    expect(screen.getByDisplayValue("4242")).toBeInTheDocument();
  });
});
