// Synthetic GIF89a, no artwork: clear-code before each index keeps 3-bit LZW codes.
export function gifFixture(disposal = 1) {
  const out = [
    ...Buffer.from("GIF89a"),
    2,
    0,
    1,
    0,
    0x81,
    0,
    0,
    0,
    0,
    0,
    255,
    0,
    0,
    0,
    255,
    0,
    0,
    0,
    255,
  ];
  for (const [i, pixels] of [
    [1, 0],
    [0, 2],
    [0, 0],
  ].entries()) {
    out.push(
      33,
      249,
      4,
      ((i === 1 ? disposal : 1) << 2) | 1,
      5,
      0,
      0,
      0,
      44,
      0,
      0,
      0,
      0,
      2,
      0,
      1,
      0,
      0,
      2,
    );
    const codes = [4, pixels[0], 4, pixels[1], 5];
    let bits = 0,
      value = 0;
    const data = [];
    for (const c of codes) {
      value |= c << bits;
      bits += 3;
      while (bits >= 8) {
        data.push(value & 255);
        value >>= 8;
        bits -= 8;
      }
    }
    if (bits) data.push(value & 255);
    out.push(data.length, ...data, 0);
  }
  return Uint8Array.from([...out, 59]);
}

export function gifFramesFixture({ width = 2, height = 1, background = 0, frames }) {
  const word = value => [value & 255, value >> 8], palette = [0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255];
  const out = [...Buffer.from("GIF89a"), ...word(width), ...word(height), 0x81, background, 0, ...palette];
  for (const frame of frames) {
    const w = frame.width ?? width, h = frame.height ?? height;
    if (frame.control !== false) {
      const transparent = frame.transparentIndex === undefined ? 0 : frame.transparentIndex;
      out.push(33, 249, 4, ((frame.disposal ?? 1) << 2) | (transparent === null ? 0 : 1), ...word(frame.delay ?? 5), transparent ?? 0, 0);
    }
    out.push(44, ...word(frame.x ?? 0), ...word(frame.y ?? 0), ...word(w), ...word(h), (frame.localPalette ? 0x81 : 0) | (frame.interlaced ? 0x40 : 0));
    if (frame.localPalette) out.push(...frame.localPalette);
    const rows = frame.interlaced ? [0, 4, 2, 1].flatMap((start, pass) => Array.from({ length: h }, (_, row) => row).filter(row => row >= start && (row - start) % [8, 8, 4, 2][pass] === 0)) : Array.from({ length: h }, (_, row) => row);
    const codes = rows.flatMap(row => frame.pixels.slice(row * w, (row + 1) * w).flatMap(pixel => [4, pixel]));
    codes.push(5);
    let bits = 0, value = 0;
    const data = [];
    for (const code of codes) {
      value |= code << bits; bits += 3;
      while (bits >= 8) { data.push(value & 255); value >>= 8; bits -= 8; }
    }
    if (bits) data.push(value & 255);
    out.push(2);
    for (let offset = 0; offset < data.length; offset += 255) out.push(Math.min(255, data.length - offset), ...data.slice(offset, offset + 255));
    out.push(0);
  }
  return Uint8Array.from([...out, 59]);
}
