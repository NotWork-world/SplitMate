// EXIF orientation for JPEGs: phone cameras store the photo the sensor saw
// and put the "which way is up" flag in EXIF (the gallery rotates on display).
// The OCR works on raw pixels, so it must apply the flag itself or a portrait
// photo arrives sideways and every line reads as a column.

export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}

const SOI = 0xd8;

function readU16(bytes: Uint8Array, at: number, little: boolean): number {
  const a = bytes[at];
  const b = bytes[at + 1];
  return little ? (b << 8) | a : (a << 8) | b;
}

function readU32(bytes: Uint8Array, at: number, little: boolean): number {
  const a = readU16(bytes, at, little);
  const b = readU16(bytes, at + 2, little);
  return little ? (b << 16) | a : (a << 16) | b;
}

/**
 * Read the EXIF orientation tag (1-8) out of a JPEG. No tag / no EXIF -> 1.
 * Only IFD0 is looked at (where cameras write the orientation), which keeps
 * the scan tiny and stops at the first marker block.
 */
export function exifOrientation(bytes: Uint8Array): number {
  if (bytes.length < 8 || bytes[0] !== 0xff || bytes[1] !== SOI) {
    return 1;
  }
  let i = 2;
  while (i + 4 < bytes.length) {
    if (bytes[i] !== 0xff) {
      return 1; // lost the segment stream: no EXIF to find
    }
    const marker = bytes[i + 1];
    if (marker === SOI || (marker >= 0xd0 && marker <= 0xd9)) {
      return 1; // restart/EOI markers: image data follows, no APP1 seen
    }
    const size = readU16(bytes, i + 2, false); // segment size is big-endian
    if (size < 2) {
      return 1;
    }
    if (marker === 0xe1 && bytes[i + 4] === 0x45 && bytes[i + 5] === 0x78 && bytes[i + 6] === 0x69 && bytes[i + 7] === 0x66 && bytes[i + 8] === 0x00 && bytes[i + 9] === 0x00) {
      const tiff = i + 10;
      if (tiff + 8 > bytes.length) {
        return 1;
      }
      const ii = bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49;
      const mm = bytes[tiff] === 0x4d && bytes[tiff + 1] === 0x4d;
      if (!ii && !mm) {
        return 1;
      }
      const little = ii;
      const ifdOff = readU32(bytes, tiff + 4, little);
      const ifd = tiff + ifdOff;
      if (ifd + 2 > bytes.length) {
        return 1;
      }
      const count = readU16(bytes, ifd, little);
      for (let e = 0; e < count; e++) {
        const entry = ifd + 2 + e * 12;
        if (entry + 12 > bytes.length) {
          return 1;
        }
        if (readU16(bytes, entry, little) === 0x0112) {
          const value = readU16(bytes, entry + 8, little);
          return value >= 1 && value <= 8 ? value : 1;
        }
      }
      return 1; // IFD0 walked, no orientation tag
    }
    i += 2 + size;
  }
  return 1;
}

/** Copy RGBA pixels with a per-orientation source mapping (all 8 EXIF cases). */
export function reorient(img: RgbaImage, orientation: number): RgbaImage {
  if (orientation < 2 || orientation > 8) {
    return img;
  }
  const {width: W, height: H, data} = img;
  const swap = orientation >= 5; // 5-8 turn the image on its side
  const outW = swap ? H : W;
  const outH = swap ? W : H;
  const out = new Uint8Array(outW * outH * 4);
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      let sx: number;
      let sy: number;
      switch (orientation) {
        case 2: // flip horizontal
          sx = W - 1 - x;
          sy = y;
          break;
        case 3: // 180
          sx = W - 1 - x;
          sy = H - 1 - y;
          break;
        case 4: // flip vertical
          sx = x;
          sy = H - 1 - y;
          break;
        case 5: // transpose (flip horizontal + 90 CW)
          sx = y;
          sy = x;
          break;
        case 6: // 90 CW
          sx = y;
          sy = H - 1 - x;
          break;
        case 7: // transverse (flip horizontal + 270 CW)
          sx = W - 1 - y;
          sy = H - 1 - x;
          break;
        default: // 8: 270 CW (90 CCW)
          sx = W - 1 - y;
          sy = x;
          break;
      }
      const src = (sy * W + sx) * 4;
      const dst = (y * outW + x) * 4;
      out[dst] = data[src];
      out[dst + 1] = data[src + 1];
      out[dst + 2] = data[src + 2];
      out[dst + 3] = data[src + 3];
    }
  }
  return {width: outW, height: outH, data: out};
}
