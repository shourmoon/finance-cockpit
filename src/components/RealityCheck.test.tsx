// src/components/RealityCheck.test.tsx
//
// The direction tests below are the point of this file. A drift figure with
// its sign read the wrong way round would tell someone in plain English that
// they owe less than the servicer says, or hold more than the bank says, and
// it would say it in the voice of a verified number. The domain resolves the
// direction; these check that the sentence the user actually reads still
// carries it, for both targets and both directions.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import RealityCheckRow from "./RealityCheckRow";
import RealityCheckModal from "./RealityCheckModal";
import { summarizeCheckpoints } from "../domain/reconciliation";
import type { Checkpoint, CheckpointTarget } from "../domain/reconciliation";

const noop = () => {};
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

function rowFor(
  target: CheckpointTarget,
  checkpoints: Checkpoint[],
  asOf = "2026-08-06"
) {
  return render(
    <RealityCheckRow
      summary={summarizeCheckpoints(checkpoints, target, asOf)}
      target={target}
      formatMoney={money}
      onCheck={noop}
    />
  );
}

describe("RealityCheckRow — how long ago", () => {
  it("says so plainly when the figure has never been checked", () => {
    rowFor("cash", []);
    expect(screen.getByTestId("reality-age-cash")).toHaveTextContent(
      "Never checked against a statement"
    );
    expect(screen.getByRole("button")).toHaveTextContent("Check it");
    expect(screen.queryByTestId("reality-drift-cash")).toBeNull();
  });

  it("counts the age from the statement date", () => {
    const cases: [string, string][] = [
      ["2026-08-06", "Confirmed today"],
      ["2026-08-05", "Confirmed yesterday"],
      ["2026-07-30", "Confirmed 7 days ago"],
      ["2026-02-06", "Confirmed 6 months ago"],
    ];
    for (const [date, expected] of cases) {
      const { unmount } = rowFor("cash", [
        { id: "a", date, actual: 100, modelled: 100 },
      ]);
      expect(screen.getByTestId("reality-age-cash")).toHaveTextContent(expected);
      unmount();
    }
  });

  it("offers a re-check once anything has been recorded", () => {
    rowFor("cash", [{ id: "a", date: "2026-08-01", actual: 100, modelled: 100 }]);
    expect(screen.getByRole("button")).toHaveTextContent("Re-check");
  });

  it("calls back when the user asks to check", () => {
    const onCheck = vi.fn();
    render(
      <RealityCheckRow
        summary={summarizeCheckpoints([], "cash", "2026-08-06")}
        target="cash"
        formatMoney={money}
        onCheck={onCheck}
      />
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onCheck).toHaveBeenCalledTimes(1);
  });
});

describe("RealityCheckRow — which way the model was wrong", () => {
  it("says the account holds less when cash came up short", () => {
    // Bank says 9,000; model said 10,000. The household has $1,000 less than
    // the app has been telling them.
    rowFor("cash", [
      { id: "a", date: "2026-08-01", actual: 9_000, modelled: 10_000 },
    ]);
    expect(screen.getByTestId("reality-drift-cash")).toHaveTextContent(
      "$1,000 less in the account than the model showed"
    );
  });

  it("says the account holds more when cash came up long", () => {
    rowFor("cash", [
      { id: "a", date: "2026-08-01", actual: 11_000, modelled: 10_000 },
    ]);
    expect(screen.getByTestId("reality-drift-cash")).toHaveTextContent(
      "$1,000 more in the account than the model showed"
    );
  });

  it("says more is owed when the servicer's balance is higher", () => {
    // The same raw sign as "more cash", and the opposite news.
    rowFor("mortgage", [
      { id: "a", date: "2026-08-01", actual: 505_000, modelled: 500_000 },
    ]);
    expect(screen.getByTestId("reality-drift-mortgage")).toHaveTextContent(
      "$5,000 more still owed than the model showed"
    );
  });

  it("says less is owed when the servicer's balance is lower", () => {
    rowFor("mortgage", [
      { id: "a", date: "2026-08-01", actual: 495_000, modelled: 500_000 },
    ]);
    expect(screen.getByTestId("reality-drift-mortgage")).toHaveTextContent(
      "$5,000 less still owed than the model showed"
    );
  });

  it("confirms a match rather than staying silent about it", () => {
    rowFor("cash", [
      { id: "a", date: "2026-08-01", actual: 10_000, modelled: 10_000 },
    ]);
    expect(screen.getByTestId("reality-drift-cash")).toHaveTextContent(
      "Model matched the statement last time"
    );
  });

  it("warns when the misses form a pattern, not before", () => {
    const twoMisses: Checkpoint[] = [
      { id: "a", date: "2026-06-01", actual: 9_000, modelled: 10_000 },
      { id: "b", date: "2026-07-01", actual: 9_000, modelled: 10_000 },
    ];
    const { unmount } = rowFor("cash", twoMisses);
    expect(screen.queryByTestId("reality-systematic-cash")).toBeNull();
    unmount();

    rowFor("cash", [
      ...twoMisses,
      { id: "c", date: "2026-08-01", actual: 9_000, modelled: 10_000 },
    ]);
    expect(screen.getByTestId("reality-systematic-cash")).toHaveTextContent(
      "missed the same way"
    );
  });

  it("does not call it a pattern when the misses point both ways", () => {
    rowFor("cash", [
      { id: "a", date: "2026-06-01", actual: 9_000, modelled: 10_000 },
      { id: "b", date: "2026-07-01", actual: 11_000, modelled: 10_000 },
      { id: "c", date: "2026-08-01", actual: 9_000, modelled: 10_000 },
    ]);
    expect(screen.queryByTestId("reality-systematic-cash")).toBeNull();
  });
});

describe("RealityCheckModal", () => {
  function open(
    props: Partial<React.ComponentProps<typeof RealityCheckModal>> = {}
  ) {
    const onSave = vi.fn();
    const { unmount } = render(
      <RealityCheckModal
        open
        target="cash"
        defaultDate="2026-08-06"
        modelledOn={() => 10_000}
        formatMoney={money}
        onSave={onSave}
        onClose={noop}
        {...props}
      />
    );
    return { onSave, unmount };
  }

  it("renders nothing when closed", () => {
    const { container } = render(
      <RealityCheckModal
        open={false}
        target="cash"
        defaultDate="2026-08-06"
        modelledOn={() => 10_000}
        formatMoney={money}
        onSave={noop}
        onClose={noop}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("waits for a figure before comparing anything", () => {
    open();
    expect(screen.getByTestId("reality-modelled")).toHaveTextContent("$10,000");
    expect(screen.getByTestId("reality-difference")).toHaveTextContent("—");
    expect(screen.getByRole("button", { name: "Record check" })).toBeDisabled();
  });

  it("compares live, before anything is saved", () => {
    open();
    fireEvent.change(screen.getByLabelText("Statement amount"), {
      target: { value: "9,400" },
    });
    expect(screen.getByTestId("reality-difference")).toHaveTextContent("$600");
  });

  it("treats zero as a figure a statement can report", () => {
    // The distinction that matters: an empty field means "not told yet",
    // a zero means "the bank says nothing is there".
    const { onSave } = open();
    const field = screen.getByLabelText("Statement amount");
    expect(screen.getByRole("button", { name: "Record check" })).toBeDisabled();

    fireEvent.change(field, { target: { value: "0" } });
    const save = screen.getByRole("button", { name: "Record check" });
    expect(save).not.toBeDisabled();
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledWith({
      date: "2026-08-06",
      actual: 0,
      modelled: 10_000,
    });
  });

  it("records both figures, so the log can tell drift from noise later", () => {
    const { onSave } = open();
    fireEvent.change(screen.getByLabelText("Statement amount"), {
      target: { value: "12345.67" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record check" }));
    expect(onSave).toHaveBeenCalledWith({
      date: "2026-08-06",
      actual: 12345.67,
      modelled: 10_000,
    });
  });

  it("says so when the model has no opinion about that date", () => {
    const { onSave } = open({ target: "mortgage", modelledOn: () => null });
    expect(screen.getByTestId("reality-out-of-range")).toBeInTheDocument();
    expect(screen.getByTestId("reality-modelled")).toHaveTextContent("—");
    fireEvent.change(screen.getByLabelText("Statement amount"), {
      target: { value: "9000" },
    });
    // Nothing to compare against means nothing worth recording.
    expect(screen.getByRole("button", { name: "Record check" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Record check" }));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("asks for the right figure for the target", () => {
    const { unmount } = open();
    expect(screen.getByText(/Check against your bank/)).toBeInTheDocument();
    expect(screen.getByText("Balance on the statement")).toBeInTheDocument();
    unmount();

    open({ target: "mortgage", modelledOn: () => 500_000 });
    expect(screen.getByText(/Check against your servicer/)).toBeInTheDocument();
    expect(screen.getByText("Principal still owed")).toBeInTheDocument();
  });

  it("fixes the date for a cash check, and lets the user pick it for a loan", () => {
    // A cash check confirms the balance the app holds right now; there is no
    // other date it could be about, and offering one would invite a check
    // against a day the app has no figure for.
    const { unmount } = open({ dateEditable: false });
    expect(screen.getByTestId("reality-locked-date")).toHaveTextContent(
      "6 Aug '26"
    );
    expect(screen.queryByLabelText("Statement date")).toBeNull();
    unmount();

    open({ target: "mortgage", modelledOn: () => 500_000 });
    expect(screen.getByLabelText("Statement date")).toBeInTheDocument();
    expect(screen.queryByTestId("reality-locked-date")).toBeNull();
  });

  it("re-reads the model when the statement date changes", () => {
    open({
      target: "mortgage",
      modelledOn: (date) => (date === "2026-08-06" ? 10_000 : 7_500),
    });
    expect(screen.getByTestId("reality-modelled")).toHaveTextContent("$10,000");
    fireEvent.change(screen.getByLabelText("Statement date"), {
      target: { value: "2026-07-01" },
    });
    expect(screen.getByTestId("reality-modelled")).toHaveTextContent("$7,500");
  });

  it("ignores a half-typed amount rather than reading it as a number", () => {
    open();
    for (const partial of ["-", ".", "abc", ""]) {
      fireEvent.change(screen.getByLabelText("Statement amount"), {
        target: { value: partial },
      });
      expect(
        screen.getByRole("button", { name: "Record check" })
      ).toBeDisabled();
      expect(screen.getByTestId("reality-difference")).toHaveTextContent("—");
    }
  });
});
