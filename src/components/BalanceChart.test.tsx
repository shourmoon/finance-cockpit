// src/components/BalanceChart.test.tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import BalanceChart from "./BalanceChart";
import type { TimelinePoint } from "../domain/types";

function tp(date: string, balance: number): TimelinePoint {
  return { date, balance, inflow: 0, outflow: 0 };
}

describe("BalanceChart", () => {
  it("renders nothing for an empty timeline", () => {
    const { container } = render(<BalanceChart timeline={[]} minSafeBalance={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders an svg with a balance line and endpoint labels", () => {
    const timeline = [
      tp("2026-07-10", 6591),
      tp("2026-09-23", -171),
      tp("2026-12-28", -1206),
    ];
    const { container, getByText } = render(
      <BalanceChart timeline={timeline} minSafeBalance={0} />
    );
    const svg = container.querySelector("svg")!;
    expect(svg).toBeInTheDocument();
    expect(svg.getAttribute("role")).toBe("img");
    // A polyline path is present.
    expect(container.querySelector("path[stroke='#60a5fa']")).toBeInTheDocument();
    // The below-zero region is shaded when the balance dips negative.
    expect(container.querySelector("clipPath#balance-below-zero")).toBeInTheDocument();
    // Endpoint dates and the deepest-balance label render.
    expect(getByText(/10 Jul/)).toBeInTheDocument();
    expect(getByText(/28 Dec/)).toBeInTheDocument();
    expect(getByText(/-\$1,206/)).toBeInTheDocument();
  });

  it("omits the below-zero shading when the balance never goes negative", () => {
    const timeline = [tp("2026-07-10", 500), tp("2026-08-10", 800)];
    const { container } = render(
      <BalanceChart timeline={timeline} minSafeBalance={100} />
    );
    // clipPath element still defined, but no red fill path uses it.
    expect(container.querySelector("path[fill='rgba(249,115,115,0.25)']")).toBeNull();
  });
});
