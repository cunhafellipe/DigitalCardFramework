import { create } from "fontkit";
import bidiFactory from "bidi-js/dist/bidi.mjs";

export const textBidi = bidiFactory();

export function openFont(bytes) {
  const font = create(bytes);
  if (!font?.layout || !font.unitsPerEm || font.numGlyphs > 65535)
    throw new Error("Unsupported font collection or glyph count");
  return font;
}
