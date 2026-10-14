export interface PNGImageData {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}
/** Encode RGBA pixels; dimensions and byte length are checked at runtime. */
export function encodePNG(image: PNGImageData): Promise<Uint8Array>;
