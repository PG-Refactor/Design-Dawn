// Clipboard image types a text editor accepts, and the extension each is stored under. The
// list is narrower than what an image block accepts: a clipboard never offers SVG as an
// image file, and Rust checks the bytes against the extension anyway.
export const PASTED_IMAGE_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

// The clipboard type that marks a paste as text. Spreadsheets put a picture of the copied
// cells on the clipboard next to their text; that paste is text, not an image.
export const CLIPBOARD_TEXT_TYPE = "text/plain";
