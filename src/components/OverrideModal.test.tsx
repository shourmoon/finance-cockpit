// src/components/OverrideModal.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import OverrideModal from "./OverrideModal";
import type { FutureEvent } from "../domain/types";

function makeEvent(overrides: Partial<FutureEvent> = {}): FutureEvent {
  return {
    id: "rule-1__2025-01-15",
    ruleId: "rule-1",
    ruleName: "Credit Card",
    date: "2025-01-15",
    defaultAmount: -400,
    effectiveAmount: -400,
    isVariable: true,
    isOverridden: false,
    ...overrides,
  };
}

describe("OverrideModal", () => {
  it("renders nothing when there is no event", () => {
    const { container } = render(
      <OverrideModal event={null} onSave={() => {}} onClose={() => {}} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the rule name and the default amount", () => {
    render(<OverrideModal event={makeEvent()} onSave={() => {}} onClose={() => {}} />);
    expect(screen.getByText(/Override: Credit Card/)).toBeInTheDocument();
    expect(screen.getByText("-$400.00")).toBeInTheDocument();
  });

  it("prefills the input only when the event is already overridden", () => {
    const { rerender } = render(
      <OverrideModal event={makeEvent()} onSave={() => {}} onClose={() => {}} />
    );
    expect(screen.getByPlaceholderText(/leave blank/)).toHaveValue(null);

    rerender(
      <OverrideModal
        event={makeEvent({ isOverridden: true, effectiveAmount: -250 })}
        onSave={() => {}}
        onClose={() => {}}
      />
    );
    expect(screen.getByPlaceholderText(/leave blank/)).toHaveValue(-250);
  });

  it("saves null when the field is left blank", () => {
    const onSave = vi.fn();
    render(<OverrideModal event={makeEvent()} onSave={onSave} onClose={() => {}} />);
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith(null);
  });

  it("saves the numeric value when provided", () => {
    const onSave = vi.fn();
    render(<OverrideModal event={makeEvent()} onSave={onSave} onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/leave blank/), {
      target: { value: "-123.45" },
    });
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith(-123.45);
  });

  it("invokes onClose from the Cancel button", () => {
    const onClose = vi.fn();
    render(<OverrideModal event={makeEvent()} onSave={() => {}} onClose={onClose} />);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalled();
  });

  it("renders $0.00 for a non-finite default amount", () => {
    render(
      <OverrideModal
        event={makeEvent({ defaultAmount: Infinity })}
        onSave={() => {}}
        onClose={() => {}}
      />
    );
    expect(screen.getByText("$0.00")).toBeInTheDocument();
  });
});
