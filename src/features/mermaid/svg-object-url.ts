import type { SanitizedSvg } from "./sanitize-svg";

declare const sanitizedSvgUrlBrand: unique symbol;

// An object URL of sanitised SVG. Only `createSvgObjectUrl` produces it, so an <img> that
// asks for this type cannot be given an arbitrary address.
export type SanitizedSvgUrl = string & {
  readonly [sanitizedSvgUrlBrand]: true;
};

const SVG_MEDIA_TYPE = "image/svg+xml";

export function createSvgObjectUrl(svg: SanitizedSvg): SanitizedSvgUrl {
  return URL.createObjectURL(
    new Blob([svg], { type: SVG_MEDIA_TYPE }),
  ) as SanitizedSvgUrl;
}

export function revokeSvgObjectUrl(url: SanitizedSvgUrl): void {
  URL.revokeObjectURL(url);
}
