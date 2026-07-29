import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import ErrorBoundary from "./ErrorBoundary";

// React logs caught render errors; keep the test output readable.
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

function Boom({ explode }: { explode: boolean }): React.ReactElement {
  if (explode) throw new Error("principal must be positive");
  return <div>working content</div>;
}

describe("ErrorBoundary", () => {
  it("renders children when nothing throws", () => {
    render(
      <ErrorBoundary>
        <Boom explode={false} />
      </ErrorBoundary>
    );
    expect(screen.getByText("working content")).toBeInTheDocument();
  });

  it("shows a recoverable message instead of unmounting when a child throws", () => {
    render(
      <ErrorBoundary label="The mortgage optimizer">
        <Boom explode />
      </ErrorBoundary>
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(
      screen.getByText("The mortgage optimizer couldn't be displayed")
    ).toBeInTheDocument();
    // The underlying reason is surfaced, not swallowed.
    expect(screen.getByText("principal must be positive")).toBeInTheDocument();
  });

  it("falls back to a generic title when no label is given", () => {
    render(
      <ErrorBoundary>
        <Boom explode />
      </ErrorBoundary>
    );
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("recovers when the underlying problem is fixed and the user retries", () => {
    function Harness() {
      const [explode, setExplode] = useState(true);
      return (
        <>
          <button onClick={() => setExplode(false)}>fix it</button>
          <ErrorBoundary>
            <Boom explode={explode} />
          </ErrorBoundary>
        </>
      );
    }
    render(<Harness />);
    expect(screen.getByRole("alert")).toBeInTheDocument();

    fireEvent.click(screen.getByText("fix it"));
    fireEvent.click(screen.getByText("Try again"));

    expect(screen.getByText("working content")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
