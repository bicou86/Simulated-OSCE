// Tests du hook useKeyboardShortcuts.
// - Déclenche le handler sur keydown correspondant
// - Ignore dans un <input>/<textarea>/contenteditable
// - Ignore pendant event.isComposing (IME)
// - Respecte enabled: false

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";

afterEach(cleanup);

function Harness({ onM, enabled = true, onEscape }: { onM: () => void; enabled?: boolean; onEscape?: () => void }) {
  useKeyboardShortcuts(
    {
      m: onM,
      ...(onEscape ? { Escape: onEscape } : {}),
    },
    { enabled },
  );
  return <input data-testid="focus-target" defaultValue="" />;
}

function dispatchKey(key: string, target: Element = document.body, init: KeyboardEventInit = {}) {
  const evt = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  // Respect custom target (happy-dom supports dispatching on any EventTarget).
  target.dispatchEvent(evt);
  return evt;
}

describe("useKeyboardShortcuts", () => {
  it("fires the handler for the matching key (case-insensitive)", () => {
    const onM = vi.fn();
    render(<Harness onM={onM} />);
    dispatchKey("M");
    expect(onM).toHaveBeenCalledTimes(1);
    dispatchKey("m");
    expect(onM).toHaveBeenCalledTimes(2);
  });

  it("calls preventDefault on handled events", () => {
    const onM = vi.fn();
    render(<Harness onM={onM} />);
    const evt = dispatchKey("m");
    expect(evt.defaultPrevented).toBe(true);
  });

  it("ignores keydown when target is an <input>", () => {
    const onM = vi.fn();
    const { getByTestId } = render(<Harness onM={onM} />);
    const input = getByTestId("focus-target");
    dispatchKey("m", input);
    expect(onM).not.toHaveBeenCalled();
  });

  it("ignores keydown during IME composition", () => {
    const onM = vi.fn();
    render(<Harness onM={onM} />);
    dispatchKey("m", document.body, { isComposing: true });
    expect(onM).not.toHaveBeenCalled();
  });

  it("ignores modifier combinations by default", () => {
    const onM = vi.fn();
    render(<Harness onM={onM} />);
    dispatchKey("m", document.body, { ctrlKey: true });
    dispatchKey("m", document.body, { metaKey: true });
    dispatchKey("m", document.body, { altKey: true });
    expect(onM).not.toHaveBeenCalled();
  });

  it("does nothing when enabled is false", () => {
    const onM = vi.fn();
    render(<Harness onM={onM} enabled={false} />);
    dispatchKey("m");
    expect(onM).not.toHaveBeenCalled();
  });

  it("supports Escape as a distinct shortcut", () => {
    const onM = vi.fn();
    const onEscape = vi.fn();
    render(<Harness onM={onM} onEscape={onEscape} />);
    dispatchKey("Escape");
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(onM).not.toHaveBeenCalled();
  });
});
