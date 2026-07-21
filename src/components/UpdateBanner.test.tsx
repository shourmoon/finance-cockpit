// src/components/UpdateBanner.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import UpdateBanner from "./UpdateBanner";

const noop = () => {};

describe("UpdateBanner", () => {
  it("renders nothing when not visible", () => {
    const { container } = render(
      <UpdateBanner visible={false} onRefresh={noop} onDismiss={noop} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the update message and actions when visible", () => {
    render(<UpdateBanner visible onRefresh={noop} onDismiss={noop} />);
    expect(screen.getByText(/new version is available/i)).toBeInTheDocument();
    expect(screen.getByText("Refresh")).toBeInTheDocument();
    expect(screen.getByText("Later")).toBeInTheDocument();
  });

  it("calls onRefresh when Refresh is tapped", () => {
    const onRefresh = vi.fn();
    render(<UpdateBanner visible onRefresh={onRefresh} onDismiss={noop} />);
    fireEvent.click(screen.getByText("Refresh"));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("calls onDismiss when Later is tapped", () => {
    const onDismiss = vi.fn();
    render(<UpdateBanner visible onRefresh={noop} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByText("Later"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
