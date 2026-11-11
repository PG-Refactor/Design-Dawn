// Measuring a print page before it is printed: it is loaded into a hidden frame of its own
// (so the app's page is untouched), laid out at its real size, measured and removed. The
// printing itself happens in a print window (see `openPrintWindow`).

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
