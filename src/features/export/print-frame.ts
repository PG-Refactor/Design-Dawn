// Printing an export page: it is loaded into a hidden frame of its own (so the app's page
// is never printed), measured, and printed from there. The OS print dialog offers "Save
// as PDF" (Windows) or its own PDF printer.

// Far off-screen and wide, so the page lays out at its real size while nobody sees it.
const FRAME_STYLE =
  "position:fixed;left:-100000px;top:0;width:2000px;height:2000px;border:0;visibility:hidden;";
const BLOCK_BODY_SELECTOR = ".block__body";
// A body counts as cut off only when more than this is hidden (rounding of borders).
const OVERFLOW_TOLERANCE = 1;
// How long the frame stays after printing started when the print engine never says it is
// done (`afterprint`), for engines that read it late.
const REMOVE_AFTER_MS = 60_000;
const AFTER_PRINT_EVENT = "afterprint";

// Frames whose print dialog may still be open.
const printing = new Set<HTMLIFrameElement>();

export interface PreparedPrint {
  readonly frame: HTMLIFrameElement;
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

export async function preparePrintFrame(html: string): Promise<PreparedPrint> {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.style.cssText = FRAME_STYLE;
  const loaded = new Promise<void>((resolve) => {
    frame.addEventListener("load", () => resolve(), { once: true });
  });
  frame.srcdoc = html;
  document.body.append(frame);
  await loaded;
  const printed = frame.contentDocument;
  if (printed !== null) await imagesLoaded(printed);
  const overflowing =
    printed === null
      ? 0
      : [...printed.querySelectorAll(BLOCK_BODY_SELECTOR)].filter(
          (body) =>
            body.scrollHeight > body.clientHeight + OVERFLOW_TOLERANCE ||
            body.scrollWidth > body.clientWidth + OVERFLOW_TOLERANCE,
        ).length;
  return { frame, overflowing };
}

function removeFrame(frame: HTMLIFrameElement): void {
  printing.delete(frame);
  frame.remove();
}

export function printFrame(prepared: PreparedPrint): void {
  const { frame } = prepared;
  const view = frame.contentWindow;
  printing.add(frame);
  view?.addEventListener(AFTER_PRINT_EVENT, () => removeFrame(frame), {
    once: true,
  });
  view?.focus();
  view?.print();
  setTimeout(() => removeFrame(frame), REMOVE_AFTER_MS);
}

// The print dialog of a webview covers the page and takes its input, so a question the
// app asks meanwhile (save before closing?) could not be answered. Removing the frame
// that is being printed ends its print dialog.
export function abandonPendingPrints(): void {
  for (const frame of [...printing]) removeFrame(frame);
}

export function discardFrame(prepared: PreparedPrint): void {
  prepared.frame.remove();
}
