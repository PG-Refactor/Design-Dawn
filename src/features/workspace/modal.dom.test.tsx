// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Modal } from "./modal";

afterEach(cleanup);

function Dialogs({
  lower,
  upper,
}: {
  readonly lower: boolean;
  readonly upper: boolean;
}) {
  return (
    <>
      <button type="button">app</button>
      {lower && (
        <Modal titleId="lower-title" onCancel={() => undefined}>
          <h2 id="lower-title">lower</h2>
          <button type="button">lower action</button>
        </Modal>
      )}
      {upper && (
        <Modal titleId="upper-title" onCancel={() => undefined}>
          <h2 id="upper-title">upper</h2>
          <button type="button">upper action</button>
        </Modal>
      )}
    </>
  );
}

function hostOf(name: string): Element | null {
  let element: Element | null = screen.getByText(name, { selector: "button" });
  while (element !== null && element.parentElement !== document.body) {
    element = element.parentElement;
  }
  return element;
}

describe("Modal stacking", () => {
  it("keeps only the newest dialog usable and frees the page when the lower one closes first", () => {
    const view = render(<Dialogs lower upper={false} />);
    view.rerender(<Dialogs lower upper />);
    expect(hostOf("upper action")?.hasAttribute("inert")).toBe(false);
    expect(hostOf("lower action")?.hasAttribute("inert")).toBe(true);
    expect(hostOf("app")?.hasAttribute("inert")).toBe(true);

    // The lower dialog closes while the upper one is still open.
    view.rerender(<Dialogs lower={false} upper />);
    expect(hostOf("upper action")?.hasAttribute("inert")).toBe(false);
    expect(hostOf("app")?.hasAttribute("inert")).toBe(true);

    view.rerender(<Dialogs lower={false} upper={false} />);
    expect(hostOf("app")?.hasAttribute("inert")).toBe(false);
    expect(hostOf("app")?.hasAttribute("aria-hidden")).toBe(false);
  });

  it("gives the lower dialog back when the upper one closes", () => {
    const view = render(<Dialogs lower upper={false} />);
    view.rerender(<Dialogs lower upper />);
    view.rerender(<Dialogs lower upper={false} />);
    expect(hostOf("lower action")?.hasAttribute("inert")).toBe(false);
    expect(hostOf("app")?.hasAttribute("inert")).toBe(true);
    view.rerender(<Dialogs lower={false} upper={false} />);
    expect(hostOf("app")?.hasAttribute("inert")).toBe(false);
  });
});
