import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Modal from "./Modal";

describe("Modal", () => {
  it("renders children inside an accessible dialog", () => {
    render(
      <Modal onClose={() => {}} labelledBy="t">
        <h3 id="t">Hello</h3>
        <button>OK</button>
      </Modal>
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby", "t");
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(
      <Modal onClose={onClose}>
        <button>OK</button>
      </Modal>
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes when the backdrop is clicked but not when the surface is", () => {
    const onClose = vi.fn();
    render(
      <Modal onClose={onClose}>
        <button>OK</button>
      </Modal>
    );
    // Clicking inside the dialog does not close it.
    fireEvent.mouseDown(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
    // Clicking the backdrop (the dialog's parent) closes it.
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("moves focus into the dialog on open", () => {
    render(
      <Modal onClose={() => {}}>
        <input aria-label="first" />
        <button>OK</button>
      </Modal>
    );
    // The first focusable element receives focus.
    expect(screen.getByLabelText("first")).toHaveFocus();
  });

  it("wraps Tab from the last focusable element back to the first", () => {
    render(
      <Modal onClose={() => {}}>
        <input aria-label="first" />
        <button>last</button>
      </Modal>
    );
    const last = screen.getByText("last");
    last.focus();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Tab" });
    expect(screen.getByLabelText("first")).toHaveFocus();
  });

  it("wraps Shift+Tab from the first focusable element back to the last", () => {
    render(
      <Modal onClose={() => {}}>
        <input aria-label="first" />
        <button>last</button>
      </Modal>
    );
    // The first element already has focus from mount.
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Tab", shiftKey: true });
    expect(screen.getByText("last")).toHaveFocus();
  });

  it("leaves focus alone for a Tab in the middle of the dialog", () => {
    render(
      <Modal onClose={() => {}}>
        <input aria-label="first" />
        <button aria-label="middle">middle</button>
        <button>last</button>
      </Modal>
    );
    screen.getByLabelText("middle").focus();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Tab" });
    // Not first or last, so the trap does nothing — the browser's default
    // Tab order takes over (not simulated in jsdom, so focus is unchanged).
    expect(screen.getByLabelText("middle")).toHaveFocus();
  });

  it("ignores non-Tab keys and restores focus to the trigger on unmount", () => {
    const trigger = document.createElement("button");
    trigger.textContent = "trigger";
    document.body.appendChild(trigger);
    trigger.focus();

    const { unmount } = render(
      <Modal onClose={() => {}}>
        <button>only</button>
      </Modal>
    );
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter" });
    expect(screen.getByText("only")).toHaveFocus();

    unmount();
    expect(trigger).toHaveFocus();
    trigger.remove();
  });
});
