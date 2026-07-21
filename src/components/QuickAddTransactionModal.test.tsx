// src/components/QuickAddTransactionModal.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import QuickAddTransactionModal from "./QuickAddTransactionModal";

const noop = () => {};

describe("QuickAddTransactionModal", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <QuickAddTransactionModal
        open={false}
        defaultDate="2026-07-10"
        onAdd={noop}
        onClose={noop}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("adds a transaction with the entered values", () => {
    const onAdd = vi.fn();
    render(
      <QuickAddTransactionModal
        open
        defaultDate="2026-07-10"
        onAdd={onAdd}
        onClose={noop}
      />
    );
    fireEvent.change(screen.getByLabelText("Transaction name"), {
      target: { value: "Car repair" },
    });
    fireEvent.change(screen.getByLabelText("Transaction amount"), {
      target: { value: "-800" },
    });
    fireEvent.click(screen.getByText("Add"));
    expect(onAdd).toHaveBeenCalledWith({
      name: "Car repair",
      amount: -800,
      date: "2026-07-10",
    });
  });

  it("defaults a blank name and uses the default date", () => {
    const onAdd = vi.fn();
    render(
      <QuickAddTransactionModal
        open
        defaultDate="2026-07-10"
        onAdd={onAdd}
        onClose={noop}
      />
    );
    fireEvent.click(screen.getByText("Add"));
    expect(onAdd).toHaveBeenCalledWith({
      name: "One-time transaction",
      amount: 0,
      date: "2026-07-10",
    });
  });

  it("resets its fields each time it reopens", () => {
    const { rerender } = render(
      <QuickAddTransactionModal
        open
        defaultDate="2026-07-10"
        onAdd={noop}
        onClose={noop}
      />
    );
    fireEvent.change(screen.getByLabelText("Transaction name"), {
      target: { value: "Stale" },
    });
    rerender(
      <QuickAddTransactionModal
        open={false}
        defaultDate="2026-07-10"
        onAdd={noop}
        onClose={noop}
      />
    );
    rerender(
      <QuickAddTransactionModal
        open
        defaultDate="2026-08-01"
        onAdd={noop}
        onClose={noop}
      />
    );
    expect(screen.getByLabelText("Transaction name")).toHaveValue("");
  });

  it("calls onClose from Cancel", () => {
    const onClose = vi.fn();
    render(
      <QuickAddTransactionModal
        open
        defaultDate="2026-07-10"
        onAdd={noop}
        onClose={onClose}
      />
    );
    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalled();
  });
});
