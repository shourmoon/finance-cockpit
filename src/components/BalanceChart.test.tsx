// src/components/BalanceChart.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import BalanceChart from "./BalanceChart";
import type { TimelinePoint } from "../domain/types";

function tp(date: string, balance: number): TimelinePoint {
  return { date, balance, inflow: 0, outflow: 0 };
}

const negativeTimeline = [
  tp("2026-07-10", 6591),
  tp("2026-09-23", -171),
  tp("2026-12-28", -1206),
];

describe("BalanceChart", () => {
  it("renders nothing for an empty timeline", () => {
    const { container } = render(<BalanceChart timeline={[]} minSafeBalance={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders an svg with a balance line and endpoint labels", () => {
    const { container, getByText } = render(
      <BalanceChart timeline={negativeTimeline} minSafeBalance={0} />
    );
    const svg = container.querySelector("svg")!;
    expect(svg).toBeInTheDocument();
    expect(svg.getAttribute("role")).toBe("img");
    expect(container.querySelector("path[stroke='#60a5fa']")).toBeInTheDocument();
    expect(container.querySelector("clipPath#balance-below-zero")).toBeInTheDocument();
    // Endpoint dates and the deepest-balance label render at rest.
    expect(getByText(/10 Jul/)).toBeInTheDocument();
    expect(getByText(/28 Dec/)).toBeInTheDocument();
    expect(getByText(/-\$1,206/)).toBeInTheDocument();
  });

  it("omits the below-zero shading when the balance never goes negative", () => {
    const timeline = [tp("2026-07-10", 500), tp("2026-08-10", 800)];
    const { container } = render(
      <BalanceChart timeline={timeline} minSafeBalance={100} />
    );
    expect(
      container.querySelector("path[fill='rgba(249,115,115,0.18)']")
    ).toBeNull();
  });

  it("shows a scrub readout with balance and floor delta on pointer move", () => {
    const { container } = render(
      <BalanceChart timeline={negativeTimeline} minSafeBalance={0} />
    );
    const svg = container.querySelector("svg")!;
    // jsdom has no layout; give the svg a width so pointer→x maps.
    vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 320,
      height: 148,
      right: 320,
      bottom: 148,
      x: 0,
      y: 0,
      toJSON() {},
    } as DOMRect);

    // Far right maps to the last point (28 Dec, -$1,206, below floor 0).
    fireEvent.pointerMove(svg, { clientX: 318 });
    expect(screen.getByText(/28 Dec/)).toBeInTheDocument();
    expect(screen.getByText(/below floor/)).toBeInTheDocument();

    // Leaving clears the readout.
    fireEvent.pointerLeave(svg);
    expect(screen.queryByText(/below floor/)).not.toBeInTheDocument();
  });

  it("reports 'above floor' when scrubbing a healthy point", () => {
    const { container } = render(
      <BalanceChart timeline={negativeTimeline} minSafeBalance={0} />
    );
    const svg = container.querySelector("svg")!;
    vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, width: 320, height: 148, right: 320, bottom: 148, x: 0, y: 0, toJSON() {},
    } as DOMRect);
    // Far left maps to the first point (10 Jul, +$6,591, above floor).
    fireEvent.pointerMove(svg, { clientX: 2 });
    expect(screen.getByText(/above floor/)).toBeInTheDocument();
  });
});
