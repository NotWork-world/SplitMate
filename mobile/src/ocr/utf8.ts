// UTF-8 decoding without TextDecoder.
//
// React Native's JS engine (Hermes) has no TextDecoder global — the OCR vocabulary
// parser needs one to pull the 18,708-character character set out of the recognition
// model's metadata, so it decodes by hand. Same for TextEncoder: none of the OCR code
// may use browser-only globals; everything here runs in Node (tests, smoke checks) and
// on the phone.

/** Decode UTF-8 bytes to a JS string. Malformed bytes become U+FFFD, never a crash. */
export function utf8Decode(bytes: Uint8Array): string {
  const out: number[] = [];
  const n = bytes.length;
  let i = 0;
  while (i < n) {
    const b0 = bytes[i];
    if (b0 < 0x80) {
      out.push(b0);
      i += 1;
    } else if (b0 < 0xc2 || b0 > 0xf4) {
      out.push(0xfffd); // stray continuation or overlong/invalid lead
      i += 1;
    } else if (b0 < 0xe0) {
      if (i + 1 >= n || (bytes[i + 1] & 0xc0) !== 0x80) {
        out.push(0xfffd);
        i += 1;
      } else {
        out.push(((b0 & 0x1f) << 6) | (bytes[i + 1] & 0x3f));
        i += 2;
      }
    } else if (b0 < 0xf0) {
      if (i + 2 >= n || (bytes[i + 1] & 0xc0) !== 0x80 || (bytes[i + 2] & 0xc0) !== 0x80) {
        out.push(0xfffd);
        i += 1;
      } else {
        out.push(((b0 & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f));
        i += 3;
      }
    } else {
      if (i + 3 >= n || (bytes[i + 1] & 0xc0) !== 0x80 || (bytes[i + 2] & 0xc0) !== 0x80 || (bytes[i + 3] & 0xc0) !== 0x80) {
        out.push(0xfffd);
        i += 1;
      } else {
        // Beyond the BMP: build the surrogate pair String.fromCharCode would refuse.
        const cp = ((b0 & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f);
        const c = cp - 0x10000;
        out.push(0xd800 + (c >> 10), 0xdc00 + (c & 0x3ff));
        i += 4;
      }
    }
  }
  // String.fromCharCode takes a scattered list; chunk to keep call sizes small.
  let s = '';
  for (let k = 0; k < out.length; k += 4096) {
    s += String.fromCharCode(...out.slice(k, k + 4096));
  }
  return s;
}
