// src/components/shared.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DateInputWithDisplay, NumberInput } from "./shared";

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
