// "Fit to Content": the size at which a block shows all of what it holds, measured from
// what the canvas has drawn. Text keeps its width (unless something in it, such as a wide
// table, needs more) and gets the height its lines take; a picture keeps its width and
// gets the height of its own proportions (a diagram smaller than the block, which is
// never enlarged, gets its own size), so it is neither cut, stretched nor surrounded by
// empty space. Sizes are in world units: layout sizes are not changed by the zoom,
// which is a transform of the whole layer.

import { CANVAS_CONFIG } from "../../config/canvas-config";
import { BLOCK_ID_ATTRIBUTE } from "./block-dom";
import type { Extent } from "./geometry/viewport-math";

const MARKDOWN_SELECTOR = ".markdown-preview";
const PICTURE_SELECTOR = ".mermaid-preview__image, .image-block__picture";
// A diagram is drawn no larger than its own size (an image block stretches to fill).
const NOT_ENLARGED_CLASS = "mermaid-preview__image";
const PICTURE_AREA_SELECTOR = ".mermaid-preview, .image-block";
const AUTO = "auto";

function frameOf(blockId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `[${BLOCK_ID_ATTRIBUTE}="${CSS.escape(blockId)}"]`,
  );
}

// Within what the app lets a block be (an original picture may be tiny or huge).
function clampToBounds(size: Extent): Extent {
  const { minSize, maxSize } = CANVAS_CONFIG.block;
  return {
    width: Math.min(
      maxSize.width,
      Math.max(minSize.width, Math.round(size.width)),
    ),
    height: Math.min(
      maxSize.height,
      Math.max(minSize.height, Math.round(size.height)),
    ),
  };
}

function clampToMinimum(size: Extent): Extent {
  const { minSize } = CANVAS_CONFIG.block;
  return {
    width: Math.max(minSize.width, Math.ceil(size.width)),
    height: Math.max(minSize.height, Math.ceil(size.height)),
  };
}

function horizontalPadding(element: HTMLElement): number {
  const style = getComputedStyle(element);
  return (
    Number.parseFloat(style.paddingLeft || "0") +
    Number.parseFloat(style.paddingRight || "0")
  );
}

function verticalPadding(element: HTMLElement): number {
  const style = getComputedStyle(element);
  return (
    Number.parseFloat(style.paddingTop || "0") +
    Number.parseFloat(style.paddingBottom || "0")
  );
}

// The text's own height, read with the preview briefly freed from the block's height (in
// one synchronous read, so nothing is drawn in between). The block keeps what is around
// the preview (the caption) and gets the rest from the text.
function fittedText(frame: HTMLElement, preview: HTMLElement): Extent {
  const frameWidth = frame.offsetWidth;
  const widthNeeded = frameWidth + (preview.scrollWidth - preview.clientWidth);
  const frameHeight = frame.offsetHeight;
  const previewHeight = preview.offsetHeight;
  const savedFrameWidth = frame.style.width;
  const savedHeight = preview.style.height;
  frame.style.width = `${widthNeeded}px`;
  preview.style.height = AUTO;
  try {
    const contentHeight = preview.offsetHeight;
    return {
      width: widthNeeded,
      height: frameHeight - previewHeight + contentHeight,
    };
  } finally {
    frame.style.width = savedFrameWidth;
    preview.style.height = savedHeight;
  }
}

function fittedPicture(
  frame: HTMLElement,
  area: HTMLElement,
  picture: HTMLImageElement,
): Extent | null {
  if (picture.naturalWidth <= 0 || picture.naturalHeight <= 0) return null;
  const innerWidth = area.clientWidth - horizontalPadding(area);
  if (innerWidth <= 0) return null;
  // A diagram narrower than the block is shown at its own size: the block narrows to it.
  const pictureWidth = picture.classList.contains(NOT_ENLARGED_CLASS)
    ? Math.min(innerWidth, picture.naturalWidth)
    : innerWidth;
  const pictureHeight =
    (pictureWidth * picture.naturalHeight) / picture.naturalWidth;
  return {
    width: frame.offsetWidth - (innerWidth - pictureWidth),
    height:
      frame.offsetHeight -
      area.clientHeight +
      verticalPadding(area) +
      pictureHeight,
  };
}

// Null when the block is not on screen or has nothing to measure yet (a picture still
// loading, a diagram that failed to draw).
export function measureFittedBlockSize(blockId: string): Extent | null {
  const frame = frameOf(blockId);
  if (frame === null) return null;
  const preview = frame.querySelector<HTMLElement>(MARKDOWN_SELECTOR);
  if (preview !== null) return clampToMinimum(fittedText(frame, preview));
  const picture = frame.querySelector<HTMLImageElement>(PICTURE_SELECTOR);
  const area = frame.querySelector<HTMLElement>(PICTURE_AREA_SELECTOR);
  if (picture === null || area === null) return null;
  const fitted = fittedPicture(frame, area, picture);
  return fitted === null ? null : clampToMinimum(fitted);
}

const IMAGE_PICTURE_SELECTOR = ".image-block__picture";
const IMAGE_AREA_SELECTOR = ".image-block";

// "Original Size" of an image block: the size at which its picture is shown at its own
// pixel size (100 %), what is around the picture (its caption) kept. Null when the block
// is not on screen or its picture has not loaded.
export function measureOriginalImageBlockSize(blockId: string): Extent | null {
  const frame = frameOf(blockId);
  const picture = frame?.querySelector<HTMLImageElement>(
    IMAGE_PICTURE_SELECTOR,
  );
  const area = frame?.querySelector<HTMLElement>(IMAGE_AREA_SELECTOR);
  if (
    frame === null ||
    frame === undefined ||
    picture === null ||
    picture === undefined ||
    area === null ||
    area === undefined ||
    picture.naturalWidth <= 0 ||
    picture.naturalHeight <= 0
  ) {
    return null;
  }
  const innerWidth = area.clientWidth - horizontalPadding(area);
  const innerHeight = area.clientHeight - verticalPadding(area);
  const around = {
    width: frame.offsetWidth - innerWidth,
    height: frame.offsetHeight - innerHeight,
  };
  // A picture too large or too small for a block is scaled as a whole, so it keeps its
  // proportions; only what still does not fit is cut to the bounds.
  const { minSize, maxSize } = CANVAS_CONFIG.block;
  const width = picture.naturalWidth;
  const height = picture.naturalHeight;
  const shrink = Math.min(
    1,
    (maxSize.width - around.width) / width,
    (maxSize.height - around.height) / height,
  );
  const grow = Math.max(
    1,
    (minSize.width - around.width) / width,
    (minSize.height - around.height) / height,
  );
  const factor = shrink < 1 ? shrink : grow;
  return clampToBounds({
    width: around.width + width * factor,
    height: around.height + height * factor,
  });
}
