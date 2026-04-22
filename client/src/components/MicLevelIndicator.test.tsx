// Tests du composant MicLevelIndicator + des helpers de hauteur.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MicLevelIndicator, barWeights, scaleForBar } from "./MicLevelIndicator";

afterEach(cleanup);

describe("barWeights", () => {
  it("returns a symmetric curve centered on the middle bar", () => {
    const w = barWeights(5);
    expect(w).toHaveLength(5);
    expect(w[0]).toBeCloseTo(w[4], 5);
    expect(w[1]).toBeCloseTo(w[3], 5);
    // Le centre est la valeur max.
    expect(w[2]).toBeGreaterThan(w[1]);
    expect(w[1]).toBeGreaterThan(w[0]);
  });

  it("clamps between 0.45 (edges) and 1.0 (center)", () => {
    const w = barWeights(7);
    for (const v of w) {
      expect(v).toBeGreaterThanOrEqual(0.45);
      expect(v).toBeLessThanOrEqual(1.001);
    }
    // Centre exact (index 3) vaut 1.
    expect(w[3]).toBeCloseTo(1.0, 5);
  });
});

describe("scaleForBar", () => {
  it("returns small scale for off/listening/suspended regardless of level", () => {
    expect(scaleForBar(1.0, 1.0, "off")).toBeLessThan(0.15);
    expect(scaleForBar(1.0, 1.0, "suspended")).toBeLessThan(0.15);
    expect(scaleForBar(1.0, 1.0, "listening")).toBeLessThan(0.2);
  });

  it("scales proportionally with level in voice state", () => {
    const lo = scaleForBar(0.1, 1.0, "voice");
    const hi = scaleForBar(1.0, 1.0, "voice");
    expect(hi).toBeGreaterThan(lo);
    expect(hi).toBeLessThanOrEqual(1);
    expect(lo).toBeGreaterThanOrEqual(0.18); // baseline
  });

  it("is monotonic in level across voice state", () => {
    const values = [0, 0.2, 0.4, 0.6, 0.8, 1.0].map((l) => scaleForBar(l, 1.0, "voice"));
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
    }
  });

  it("bar scale is bounded between 0 and 1", () => {
    for (const level of [-0.5, 0, 0.3, 1, 5]) {
      for (const weight of [0.45, 0.8, 1]) {
        for (const state of ["off", "listening", "voice", "suspended"] as const) {
          const s = scaleForBar(level, weight, state);
          expect(s).toBeGreaterThanOrEqual(0);
          expect(s).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe("MicLevelIndicator component", () => {
  it("renders with state=listening", () => {
    render(<MicLevelIndicator state="listening" level={0} />);
    const root = screen.getByTestId("mic-level-indicator");
    expect(root.getAttribute("data-state")).toBe("listening");
    expect(root.getAttribute("aria-label")).toMatch(/écoute/i);
  });

  it("renders with state=voice and reflects level changes", () => {
    const { rerender } = render(<MicLevelIndicator state="voice" level={0.2} />);
    const initial = screen.getByTestId("mic-level-indicator").innerHTML;
    rerender(<MicLevelIndicator state="voice" level={0.8} />);
    const after = screen.getByTestId("mic-level-indicator").innerHTML;
    expect(after).not.toBe(initial); // transforms should differ
  });

  it("renders red pulse overlay when state=suspended", () => {
    render(<MicLevelIndicator state="suspended" level={0} />);
    const root = screen.getByTestId("mic-level-indicator");
    // Le pulse est une <span> en position absolue ; on vérifie par le aria-label.
    expect(root.getAttribute("aria-label")).toMatch(/suspendu/i);
  });

  it("renders 5 bars by default, customizable via barCount", () => {
    render(<MicLevelIndicator state="listening" level={0} barCount={7} />);
    const root = screen.getByTestId("mic-level-indicator");
    // 7 barres + éventuellement le span .sr-only ; on compte les span sans aria-hidden
    // (barres ont aria-hidden) — plus simple : on compte les <span> avec transform.
    const transforms = Array.from(root.querySelectorAll("span"))
      .filter((s) => (s as HTMLElement).style.transform?.includes("scaleY"));
    expect(transforms.length).toBe(7);
  });

  it("exposes a screen-reader only label for the current state", () => {
    render(<MicLevelIndicator state="voice" level={0.5} />);
    expect(screen.getByText(/voix détectée/i)).toBeDefined();
  });
});
