/** Thrown for files that cannot be shown as text. `message` is shown to the user as is. */
export class TextDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TextDecodeError";
  }
}

/** Files above this size are rejected before reading. */
export const MAX_TEXT_BYTES = 100 * 1024 * 1024;
const BINARY_SNIFF_BYTES = 8000;

function hasUtf16Nul(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length, BINARY_SNIFF_BYTES);
  // Start after the 2-byte BOM; a 0x0000 code unit indicates binary data.
  for (let i = 2; i + 1 < limit; i += 2) {
    if (bytes[i] === 0 && bytes[i + 1] === 0) return true;
  }
  return false;
}

/**
 * Decode file bytes as text. UTF-16 is detected by its byte-order mark; everything
 * else is read as UTF-8 (invalid sequences become U+FFFD). UTF-32 BOMs and NUL bytes
 * in the first 8000 bytes mark the file as binary, the same heuristic git uses.
 */
export function decodeText(bytes: Uint8Array): string {
  // Reject UTF-32 BOMs explicitly before checking the 2-byte UTF-16LE prefix (FF FE).
  if (
    bytes.length >= 4 &&
    ((bytes[0] === 0xff && bytes[1] === 0xfe && bytes[2] === 0x00 && bytes[3] === 0x00) ||
      (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0xfe && bytes[3] === 0xff))
  ) {
    throw new TextDecodeError("UTF-32 encoded files are not supported. Save as UTF-8 or UTF-16 and try again.");
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    if (hasUtf16Nul(bytes)) {
      throw new TextDecodeError("This looks like a binary file, not text. For .xlsx workbooks, use the Spreadsheet tab.");
    }
    return new TextDecoder("utf-16le").decode(bytes);
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    if (hasUtf16Nul(bytes)) {
      throw new TextDecodeError("This looks like a binary file, not text. For .xlsx workbooks, use the Spreadsheet tab.");
    }
    return new TextDecoder("utf-16be").decode(bytes);
  }
  const sniff = bytes.subarray(0, BINARY_SNIFF_BYTES);
  if (sniff.includes(0)) {
    throw new TextDecodeError("This looks like a binary file, not text. For .xlsx workbooks, use the Spreadsheet tab.");
  }
  return new TextDecoder("utf-8").decode(bytes);
}

export async function readTextFile(file: File): Promise<string> {
  if (file.size > MAX_TEXT_BYTES) {
    throw new TextDecodeError(`The file is ${(file.size / 1024 / 1024).toFixed(0)} MB. The limit is ${MAX_TEXT_BYTES / 1024 / 1024} MB.`);
  }
  let buffer: ArrayBuffer;
  try {
    buffer = await file.arrayBuffer();
  } catch (err) {
    throw new TextDecodeError(`The browser could not read the file (${err instanceof Error ? err.message : String(err)}).`);
  }
  return decodeText(new Uint8Array(buffer));
}
