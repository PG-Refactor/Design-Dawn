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

// The pasted image in a clipboard, unless the paste is text (see CLIPBOARD_TEXT_TYPE).
export function pastedImage(
  data: DataTransfer,
): { readonly file: File; readonly extension: string } | null {
  if (data.types.includes(CLIPBOARD_TEXT_TYPE)) return null;
  for (const file of data.files) {
    const extension = PASTED_IMAGE_EXTENSIONS[file.type];
    if (extension !== undefined) return { file, extension };
  }
  return null;
}
