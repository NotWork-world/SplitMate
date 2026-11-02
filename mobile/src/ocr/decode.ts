// Decode a photo into upright RGBA for OCR: JPEG (EXIF orientation applied)
// or PNG. Pure JS only, so the phone app and the Node pipeline check run the
// exact same code path.

import jpeg from 'jpeg-js';
import UPNG from 'upng-js';
import {Buffer} from 'buffer';

import {resizeImage, type RgbaImage} from './imageops';
import {exifOrientation, reorient} from './exif';

/** Big enough to keep small receipt text crisp, small enough for low-RAM phones. */
export const DECODE_MAX_SIDE = 2200;

function capSide(img: RgbaImage): RgbaImage {
  const side = Math.max(img.width, img.height);
  if (side <= DECODE_MAX_SIDE) {
    return img;
  }
  const scale = DECODE_MAX_SIDE / side;
  return resizeImage(img, Math.round(img.width * scale), Math.round(img.height * scale));
}

/** Sniff the format, decode, turn it upright, cap the size. */
export function decodeImage(bytes: Uint8Array): RgbaImage {
  if (bytes.length < 8) {
    throw new Error('empty image');
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    const decoded = jpeg.decode(bytes as unknown as Buffer, {useTArray: true, tolerantDecoding: true, formatAsRGBA: true});
    let img: RgbaImage = {width: decoded.width, height: decoded.height, data: decoded.data as unknown as Uint8Array};
    img = reorient(img, exifOrientation(bytes)); // phone photos store the turn in EXIF
    return capSide(img);
  }
  if (bytes[0] === 0x89 && bytes[1] === 0x50) {
    const png = UPNG.decode(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    const rgba = UPNG.toRGBA8(png)[0];
    return capSide({width: png.width, height: png.height, data: new Uint8Array(rgba)});
  }
  throw new Error('unsupported image');
}
