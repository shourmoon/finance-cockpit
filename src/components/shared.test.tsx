// src/components/shared.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DateInputWithDisplay, NumberInput } from "./shared";
import { isValidISODate } from "../domain/dateUtils";

describe("DateInputWithDisplay", () => {
  it("shows the formatted date beneath the input", () => {
    render(
      <DateInputWithDisplay value="2025-01-26" onChange={() => {}} inputStyle={{}} />
    );
    expect(screen.getByText(/26 Jan/)).toBeInTheDocument();
  });

  it("renders an em dash when the value is empty", () => {
    render(<DateInputWithDisplay value="" onChange={() => {}} inputStyle={{}} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("calls onChange with the new value", () => {
    const onChange = vi.fn();
    const { container } = render(
      <DateInputWithDisplay value="2025-01-01" onChange={onChange} inputStyle={{}} />
    );
    const input = container.querySelector('input[type="date"]')!;
    fireEvent.change(input, { target: { value: "2025-02-02" } });
    expect(onChange).toHaveBeenCalledWith("2025-02-02");
  });
});

describe("DateInputWithDisplay while a date is being typed", () => {
  // A native date input reports a value for every keystroke, and a
  // half-typed year reads as a real-looking string: typing 2027 passes
  // through 0002, 0020 and 0202. Those are not dates this app can store —
  // `sanitizeAdhocTransaction` drops a transaction whose date fails
  // `isValidISODate`, so committing one meant the row vanished on the next
  // reload. The write path has to refuse exactly what the read path refuses.

  it("only ever commits a date storage would keep", () => {
    // THE law. Whatever the input reports mid-typing, the caller must only
    // receive values `isValidISODate` accepts (or an empty one, below) —
    // because that is the exact test storage applies when it decides whether
    // to keep the record at all.
    const onChange = vi.fn();
    const { container } = render(
      <DateInputWithDisplay value="2026-11-25" onChange={onChange} inputStyle={{}} />
    );
    const input = container.querySelector('input[type="date"]') as HTMLInputElement;

    // What a browser reports while "2027" is typed into the year, plus the
    // six-digit year a re-sorting list used to scramble the keystrokes into.
    for (const partial of [
      "0002-11-25", "0020-11-25", "0202-11-25", "2027-11-25", "225202-07-18",
    ]) {
      fireEvent.change(input, { target: { value: partial } });
    }

    expect(onChange).toHaveBeenCalled();
    for (const [arg] of onChange.mock.calls) {
      expect(arg === "" || isValidISODate(arg), `committed ${JSON.stringify(arg)}`).toBe(true);
    }
    // The real date got through; the unusable ones did not.
    expect(onChange.mock.calls.map(([a]) => a)).toContain("2027-11-25");
    expect(onChange.mock.calls.map(([a]) => a)).not.toContain("0002-11-25");
    expect(onChange.mock.calls.map(([a]) => a)).not.toContain("225202-07-18");
  });

  it("keeps showing a half-typed date instead of snapping back", () => {
    // If the box reverted to the old value the moment a keystroke was
    // refused, the next keystroke would land on a date that had changed
    // underneath it and the user could never finish typing one.
    const { container } = render(
      <DateInputWithDisplay value="2026-11-25" onChange={() => {}} inputStyle={{}} />
    );
    const input = container.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: "0002-11-25" } });
    expect(input.value).toBe("0002-11-25");
  });

  it("still passes on a deliberate clear", () => {
    // Clearing is a real instruction, not a half-typed value: the Start date
    // field relies on it to mean "I have not told you what today is".
    const onChange = vi.fn();
    const { container } = render(
      <DateInputWithDisplay value="2026-11-25" onChange={onChange} inputStyle={{}} />
    );
    const input = container.querySelector('input[type="date"]')!;
    fireEvent.change(input, { target: { value: "" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("follows the value when the parent changes it", () => {
    // The local copy must not outlive the parent's: a reset or a sync that
    // moves the date has to show through.
    const { container, rerender } = render(
      <DateInputWithDisplay value="2026-11-25" onChange={() => {}} inputStyle={{}} />
    );
    const input = container.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: "0002-11-25" } });
    expect(input.value).toBe("0002-11-25");

    rerender(
      <DateInputWithDisplay value="2030-01-01" onChange={() => {}} inputStyle={{}} />
    );
    expect(input.value).toBe("2030-01-01");
  });
});

describe("NumberInput", () => {
  function setup(value = 0) {
    const onChange = vi.fn();
    render(<NumberInput value={value} onChange={onChange} ariaLabel="Amount" />);
    return { input: screen.getByLabelText("Amount") as HTMLInputElement, onChange };
  }

  it("commits finite parses as the user types", () => {
    const { input, onChange } = setup();
    fireEvent.change(input, { target: { value: "42" } });
    expect(onChange).toHaveBeenLastCalledWith(42);
  });

  it("preserves an in-progress minus sign instead of coercing to 0", () => {
    // Regression: typing "-800" keystroke-by-keystroke used to store +800
    // because the intermediate "-" was coerced to 0 by the controlled
    // number input.
    const { input, onChange } = setup();
    fireEvent.change(input, { target: { value: "-" } });
    expect(onChange).not.toHaveBeenCalled(); // not a number yet
    expect(input.value).toBe("-"); // text preserved
    fireEvent.change(input, { target: { value: "-8" } });
    expect(onChange).toHaveBeenLastCalledWith(-8);
    fireEvent.change(input, { target: { value: "-800" } });
    expect(onChange).toHaveBeenLastCalledWith(-800);
  });

  it("does not commit on an emptied field and snaps back on blur", () => {
    const { input, onChange } = setup(150);
    fireEvent.change(input, { target: { value: "" } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(input.value).toBe("150");
  });

  it("accepts comma-separated values", () => {
    const { input, onChange } = setup();
    fireEvent.change(input, { target: { value: "10,500" } });
    expect(onChange).toHaveBeenLastCalledWith(10500);
  });

  it("resyncs when the value changes externally", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <NumberInput value={5} onChange={onChange} ariaLabel="Amount" />
    );
    rerender(<NumberInput value={99} onChange={onChange} ariaLabel="Amount" />);
    expect((screen.getByLabelText("Amount") as HTMLInputElement).value).toBe("99");
  });
});
