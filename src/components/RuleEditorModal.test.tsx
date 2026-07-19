// src/components/RuleEditorModal.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import RuleEditorModal from "./RuleEditorModal";
import type { RecurringRule } from "../domain/types";

function monthlyRule(overrides: Partial<RecurringRule> = {}): RecurringRule {
  return {
    id: "rule-1",
    name: "Rent",
    amount: -1500,
    isVariable: false,
    schedule: { type: "monthly", day: 1 },
    ...overrides,
  };
}

const noop = () => {};

describe("RuleEditorModal", () => {
  it("renders nothing without a rule", () => {
    const { container } = render(
      <RuleEditorModal
        rule={null}
        defaultStartDate="2025-01-01"
        canDelete
        onSave={noop}
        onDelete={noop}
        onClose={noop}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("prefills fields from the rule", () => {
    render(
      <RuleEditorModal
        rule={monthlyRule()}
        defaultStartDate="2025-01-01"
        canDelete
        onSave={noop}
        onDelete={noop}
        onClose={noop}
      />
    );
    expect(screen.getByDisplayValue("Rent")).toBeInTheDocument();
    expect(screen.getByDisplayValue("-1500")).toBeInTheDocument();
  });

  it("saves edited monthly fields", () => {
    const onSave = vi.fn();
    render(
      <RuleEditorModal
        rule={monthlyRule()}
        defaultStartDate="2025-01-01"
        canDelete
        onSave={onSave}
        onDelete={noop}
        onClose={noop}
      />
    );
    fireEvent.change(screen.getByDisplayValue("Rent"), {
      target: { value: "New Rent" },
    });
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ id: "rule-1", name: "New Rent", amount: -1500 })
    );
  });

  it("defaults a blank name and clamps an out-of-range day on save", () => {
    const onSave = vi.fn();
    render(
      <RuleEditorModal
        rule={monthlyRule()}
        defaultStartDate="2025-01-01"
        canDelete
        onSave={onSave}
        onDelete={noop}
        onClose={noop}
      />
    );
    fireEvent.change(screen.getByDisplayValue("Rent"), { target: { value: "  " } });
    fireEvent.change(screen.getByDisplayValue("1"), { target: { value: "99" } });
    fireEvent.change(screen.getByDisplayValue("-1500"), { target: { value: "" } });
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Untitled Rule",
        amount: 0,
        schedule: { type: "monthly", day: 31 },
      })
    );
  });

  it("switches to twiceMonth and saves both days with a business-day convention", () => {
    const onSave = vi.fn();
    render(
      <RuleEditorModal
        rule={monthlyRule()}
        defaultStartDate="2025-01-01"
        canDelete
        onSave={onSave}
        onDelete={noop}
        onClose={noop}
      />
    );
    fireEvent.change(screen.getByDisplayValue("Monthly"), {
      target: { value: "twiceMonth" },
    });
    // Two day inputs (15 and 31) now present.
    expect(screen.getByDisplayValue("15")).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue("Use calendar date"), {
      target: { value: "previousBusinessDayUS" },
    });
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        schedule: {
          type: "twiceMonth",
          day1: 15,
          day2: 31,
          businessDayConvention: "previousBusinessDayUS",
        },
      })
    );
  });

  it("switches to biweekly and falls back to the default anchor when cleared", () => {
    const onSave = vi.fn();
    const { container } = render(
      <RuleEditorModal
        rule={monthlyRule()}
        defaultStartDate="2025-03-10"
        canDelete
        onSave={onSave}
        onDelete={noop}
        onClose={noop}
      />
    );
    fireEvent.change(screen.getByDisplayValue("Monthly"), {
      target: { value: "biweekly" },
    });
    const dateInput = container.querySelector('input[type="date"]')!;
    fireEvent.change(dateInput, { target: { value: "" } });
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        schedule: { type: "biweekly", anchorDate: "2025-03-10" },
      })
    );
  });

  it("prefills twiceMonth and biweekly rules from their schedules", () => {
    const { rerender, container } = render(
      <RuleEditorModal
        rule={monthlyRule({
          schedule: { type: "twiceMonth", day1: 10, day2: 20, businessDayConvention: "previousBusinessDayUS" },
        })}
        defaultStartDate="2025-01-01"
        canDelete
        onSave={noop}
        onDelete={noop}
        onClose={noop}
      />
    );
    expect(screen.getByDisplayValue("10")).toBeInTheDocument();
    expect(screen.getByDisplayValue("20")).toBeInTheDocument();

    rerender(
      <RuleEditorModal
        rule={monthlyRule({ schedule: { type: "biweekly", anchorDate: "2025-05-05" } })}
        defaultStartDate="2025-01-01"
        canDelete
        onSave={noop}
        onDelete={noop}
        onClose={noop}
      />
    );
    expect(container.querySelector('input[type="date"]')).toHaveValue("2025-05-05");
  });

  it("shows Delete only when canDelete is true and wires the callbacks", () => {
    const onDelete = vi.fn();
    const onClose = vi.fn();
    const { rerender } = render(
      <RuleEditorModal
        rule={monthlyRule()}
        defaultStartDate="2025-01-01"
        canDelete={false}
        onSave={noop}
        onDelete={onDelete}
        onClose={onClose}
      />
    );
    expect(screen.queryByText("Delete")).not.toBeInTheDocument();

    rerender(
      <RuleEditorModal
        rule={monthlyRule()}
        defaultStartDate="2025-01-01"
        canDelete
        onSave={noop}
        onDelete={onDelete}
        onClose={onClose}
      />
    );
    fireEvent.click(screen.getByText("Delete"));
    expect(onDelete).toHaveBeenCalledWith("rule-1");
    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalled();
  });
});
