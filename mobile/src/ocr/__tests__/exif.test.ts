import jpeg from 'jpeg-js';

import {decodeImage, DECODE_MAX_SIDE} from '../decode';
import {exifOrientation, reorient} from '../exif';
import {ctcDecode, readingOrder} from '../ctc';
import type {RgbaImage} from '../imageops';

/** Pixel (x, y) painted as (x*16, y*16, 7) so every source pixel is identifiable. */
function coordImage(w: number, h: number): RgbaImage {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      data[o] = x * 16;
      data[o + 1] = y * 16;
      data[o + 2] = 7;
      data[o + 3] = 255;
    }
  }
  return {width: w, height: h, data};
}

const at = (img: RgbaImage, x: number, y: number) => {
  const o = (y * img.width + x) * 4;
  return [img.data[o], img.data[o + 1], img.data[o + 2]];
};

/** Minimal APP1 EXIF segment (little-endian TIFF, IFD0 with only the orientation tag). */
function exifApp1(orientation: number): Uint8Array {
  const tiff = [
    0x49, 0x49, 0x2a, 0x00, // "II", 42
    0x08, 0x00, 0x00, 0x00, // IFD0 at offset 8
    0x01, 0x00, // one entry
    0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, // tag 0x0112, SHORT, count 1
    orientation & 0xff, 0x00, 0x00, 0x00, // the value
    0x00, 0x00, 0x00, 0x00, // no next IFD
  ];
  const size = 2 + 6 + tiff.length; // size field + "Exif\0\0" + TIFF
  return new Uint8Array([0xff, 0xe1, (size >> 8) & 0xff, size & 0xff, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff]);
}

/** A real JPEG (jpeg-js encoded) with an EXIF orientation spliced in after SOI. */
function jpegWithExif(img: RgbaImage, orientation: number | null): Uint8Array {
  const encoded = jpeg.encode({data: Buffer.from(img.data), width: img.width, height: img.height}, 92);
  const app1 = orientation === null ? new Uint8Array(0) : exifApp1(orientation);
  const out = new Uint8Array(2 + app1.length + encoded.data.length - 2);
  out.set(encoded.data.subarray(0, 2), 0);
  out.set(app1, 2);
  out.set(encoded.data.subarray(2), 2 + app1.length);
  return out;
}

describe('exifOrientation', () => {
  it('returns 1 for EXIF-less bytes and non-JPEGs', () => {
    expect(exifOrientation(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]))).toBe(1);
    expect(exifOrientation(jpegWithExif(coordImage(4, 3), null))).toBe(1);
  });

  it('reads the orientation tag the phone wrote', () => {
    for (const o of [2, 3, 4, 5, 6, 7, 8]) {
      expect(exifOrientation(jpegWithExif(coordImage(4, 3), o))).toBe(o);
    }
  });
});

describe('reorient (EXIF display transforms)', () => {
  // Expected source pixel per orientation, from the EXIF spec ("the 0th row is
  // the visual ... side"): independent of the implementation's mapping.
  const W = 3;
  const H = 2;
  const expectFor: Record<number, (x: number, y: number) => [number, number]> = {
    2: (x, y) => [W - 1 - x, y],
    3: (x, y) => [W - 1 - x, H - 1 - y],
    4: (x, y) => [x, H - 1 - y],
    5: (x, y) => [y, x],
    6: (x, y) => [y, H - 1 - x],
    7: (x, y) => [W - 1 - y, H - 1 - x],
    8: (x, y) => [W - 1 - y, x],
  };

  it.each(Object.keys(expectFor).map(Number))('orientation %i moves every pixel to its display place', orientation => {
    const img = coordImage(W, H);
    const out = reorient(img, orientation);
    expect(out.width).toBe(orientation >= 5 ? H : W);
    expect(out.height).toBe(orientation >= 5 ? W : H);
    const map = expectFor[orientation];
    for (let y = 0; y < out.height; y++) {
      for (let x = 0; x < out.width; x++) {
        const [sx, sy] = map(x, y);
        expect(at(out, x, y)).toEqual(at(img, sx, sy));
      }
    }
  });

  it('leaves orientation 1 untouched', () => {
    const img = coordImage(3, 2);
    expect(reorient(img, 1)).toBe(img);
  });
});

describe('decodeImage', () => {
  it('turns a sideways phone photo upright (EXIF 6)', () => {
    const bytes = jpegWithExif(coordImage(40, 26), 6);
    const img = decodeImage(bytes);
    expect(img.width).toBe(26); // swapped
    expect(img.height).toBe(40);
  });

  it('passes an upright photo through as-is', () => {
    const bytes = jpegWithExif(coordImage(40, 26), 1);
    const img = decodeImage(bytes);
    expect(img.width).toBe(40);
    expect(img.height).toBe(26);
  });

  it('caps the long side so huge camera photos stay phone-sized', () => {
    const bytes = jpegWithExif(coordImage(3000, 1000), 1);
    const img = decodeImage(bytes);
    expect(Math.max(img.width, img.height)).toBe(DECODE_MAX_SIDE);
  });
});

describe('readingOrder on tilted photos', () => {
  // Three columns per row, four rows, whole page tilted ~4.6 degrees:
  // the old fixed-tolerance grouping split every row into its columns.
  const tilt = 0.08;
  const box = (text: string, col: number, row: number) => {
    const left = 10 + col * 145;
    const top = 100 + row * 40 - tilt * left;
    return {text, left, top, width: 30, height: 20};
  };
  const lines: Array<{text: string; left: number; top: number; width: number; height: number}> = [];
  for (let r = 0; r < 4; r++) {
    for (const c of [1, 0, 2]) {
      lines.push(box(`r${r}c${c}`, c, r)); // shuffled input order
    }
  }

  it('keeps tilted rows together and reads them in order', () => {
    expect(readingOrder(lines).map(l => l.text)).toEqual([
      'r0c0', 'r0c1', 'r0c2',
      'r1c0', 'r1c1', 'r1c2',
      'r2c0', 'r2c1', 'r2c2',
      'r3c0', 'r3c1', 'r3c2',
    ]);
  });

  it('still groups straight rows when no slope wins the vote', () => {
    const straight = [
      {text: 'b', left: 100, top: 50, width: 10, height: 10},
      {text: 'c', left: 200, top: 54, width: 10, height: 10},
      {text: 'a', left: 10, top: 52, width: 10, height: 10},
      {text: 'd', left: 10, top: 120, width: 10, height: 10},
    ];
    expect(readingOrder(straight).map(l => l.text)).toEqual(['a', 'b', 'c', 'd']);
  });
});
