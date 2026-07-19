// src/components/shared.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DateInputWithDisplay } from "./shared";

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
