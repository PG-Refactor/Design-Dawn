// Measuring a print page before it is printed: it is loaded into a hidden frame of its own
// (so the app's page is untouched), laid out at its real size, measured and removed. The
// printing itself happens in a print window (see `openPrintWindow`).

import { largestFittingPercent, zoomOf } from "../canvas/fit-content-scale";
import { FIT_TEXT_ATTRIBUTE } from "./export-html";

// Far off-screen and wide, so the page lays out at its real size while nobody sees it.
const FRAME_STYLE =
  "position:fixed;left:-100000px;top:0;width:2000px;height:2000px;border:0;visibility:hidden;";
const BLOCK_SELECTOR = ".block";
const BLOCK_BODY_SELECTOR = ".block__body";
// A body counts as cut off only when more than this is hidden (rounding of borders).
const OVERFLOW_TOLERANCE = 1;

export interface PrintPageMeasure {
  readonly blocks: number;
  // Blocks whose content does not fit their frame: that part is not printed.
  readonly overflowing: number;
}

async function imagesLoaded(document: Document): Promise<void> {
  await Promise.all(
    [...document.images].map((image) =>
      image.complete
        ? Promise.resolve()
        : image.decode().catch(() => undefined),
    ),
  );
}

export async function measurePrintPage(
  html: string,
): Promise<PrintPageMeasure> {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.style.cssText = FRAME_STYLE;
  const loaded = new Promise<void>((resolve) => {
    frame.addEventListener("load", () => resolve(), { once: true });
  });
  frame.srcdoc = html;
  document.body.append(frame);
  try {
    await loaded;
    const page = frame.contentDocument;
    if (page === null) return { blocks: 0, overflowing: 0 };
    await imagesLoaded(page);
    return {
      blocks: page.querySelectorAll(BLOCK_SELECTOR).length,
      overflowing: [...page.querySelectorAll(BLOCK_BODY_SELECTOR)].filter(
        (body) =>
          body.scrollHeight > body.clientHeight + OVERFLOW_TOLERANCE ||
          body.scrollWidth > body.clientWidth + OVERFLOW_TOLERANCE,
      ).length,
    };
  } finally {
    frame.remove();
  }
}

const FIT_TEXT_SELECTOR = `[${FIT_TEXT_ATTRIBUTE}]`;
const CONTENT_SELECTOR = ":scope > div";
const DOCTYPE = "<!doctype html>\n";

// Sizes every text that is to fit its block (a Markdown block set to "fit"): the page is
// laid out once in a hidden frame, each such text is shown at the largest size at which it
// is all inside its block, and the page comes back with those sizes written in. A page
// without such texts comes back as it is, without a frame.
export async function fitExportPage(html: string): Promise<string> {
  if (!html.includes(FIT_TEXT_ATTRIBUTE)) return html;
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.style.cssText = FRAME_STYLE;
  const loaded = new Promise<void>((resolve) => {
    frame.addEventListener("load", () => resolve(), { once: true });
  });
  frame.srcdoc = html;
  document.body.append(frame);
  try {
    await loaded;
    const page = frame.contentDocument;
    if (page === null) return html;
    await imagesLoaded(page);
    for (const body of page.querySelectorAll<HTMLElement>(FIT_TEXT_SELECTOR)) {
      const content = body.querySelector<HTMLElement>(CONTENT_SELECTOR);
      if (content === null) continue;
      const fits = (percent: number) => {
        content.style.zoom = String(zoomOf(percent));
        return (
          body.scrollHeight <= body.clientHeight + OVERFLOW_TOLERANCE &&
          body.scrollWidth <= body.clientWidth + OVERFLOW_TOLERANCE
        );
      };
      content.style.zoom = String(zoomOf(largestFittingPercent(fits)));
      body.removeAttribute(FIT_TEXT_ATTRIBUTE);
    }
    return `${DOCTYPE}${page.documentElement.outerHTML}`;
  } finally {
    frame.remove();
  }
}
