import {
  TEXT_SIZE_ROOT_PX,
  type TextSize,
} from "../../config/text-size-config";

// The part of the root element `applyTextSize` needs, so tests can pass a plain object.
export interface TextSizeTarget {
  readonly style: { fontSize: string };
}

// The UI is sized in rem, so the root font size scales all of it at once. The canvas
// content pins its own size (see `canvas.css`), so a Document looks the same for everyone.
export function applyTextSize(target: TextSizeTarget, size: TextSize): void {
  target.style.fontSize = `${TEXT_SIZE_ROOT_PX[size]}px`;
}
