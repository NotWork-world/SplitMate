// Pure helpers for reading what's inside the uniocr_mobile.bin package.
// The container is a plain zip; the rec model's 18,708-character vocabulary
// is embedded in the ONNX file's metadata under the key "character" (verified
// against the real model in scripts/uniocr_smoke.py).

/** Decode a base64 string into bytes without Node's Buffer (React Native-safe). */
export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/\s+/g, '');
  const len = clean.length;
  const out = new Uint8Array((len * 3) >> 2);
  let o = 0;
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < len; i++) {
    const c = clean.charCodeAt(i);
    let v: number;
    if (c >= 65 && c <= 90) {
      v = c - 65;
    } else if (c >= 97 && c <= 122) {
      v = c - 71;
    } else if (c >= 48 && c <= 57) {
      v = c + 4;
    } else if (c === 43 || c === 45) {
      v = 62;
    } else if (c === 47 || c === 95) {
      v = 63;
    } else if (c === 61) {
      break;
    } else {
      continue;
    }
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buffer >> bits) & 0xff;
    }
  }
  return out.subarray(0, o);
}

/** Minimal protobuf reader: the few wire types ONNX metadata parsing needs. */
function readVarint(bytes: Uint8Array, pos: number): [bigint, number] {
  let value = 0n;
  let shift = 0n;
  for (;;) {
    const b = bytes[pos++];
    value |= BigInt(b & 0x7f) << shift;
    if ((b & 0x80) === 0) {
      return [value, pos];
    }
    shift += 7n;
  }
}

/** Skip one protobuf field; returns the position after it. */
function skipField(bytes: Uint8Array, pos: number, wireType: number): number {
  if (wireType === 0) {
    return readVarint(bytes, pos)[1];
  }
  if (wireType === 1) {
    return pos + 8;
  }
  if (wireType === 2) {
    const [len, p] = readVarint(bytes, pos);
    return p + Number(len);
  }
  if (wireType === 5) {
    return pos + 4;
  }
  throw new Error(`unsupported protobuf wire type ${wireType}`);
}

import {utf8Decode} from './utf8';

const UTF8 = {decode: utf8Decode}; // Hermes has no TextDecoder; decode by hand
const PROTO_LEN = 2;

/**
 * ONNX ModelProto metadata_props (field 14): repeated { key = 1, value = 2 }.
 * Returns every key/value pair found at the top level of the model file.
 */
export function onnxMetadata(bytes: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {};
  let pos = 0;
  while (pos < bytes.length) {
    const [tag, p] = readVarint(bytes, pos);
    pos = p;
    const field = Number(tag >> 3n);
    const wireType = Number(tag & 7n);
    if (field === 14 && wireType === PROTO_LEN) {
      const [len, lp] = readVarint(bytes, pos);
      pos = lp;
      const end = pos + Number(len);
      // StringStringEntryProto
      let ep = pos;
      let key: string | null = null;
      let value: string | null = null;
      while (ep < end) {
        const [etag, ep2] = readVarint(bytes, ep);
        ep = ep2;
        const ef = Number(etag >> 3n);
        const ew = Number(etag & 7n);
        if (ef <= 2 && ew === PROTO_LEN) {
          const [elen, elp] = readVarint(bytes, ep);
          ep = elp;
          const text = UTF8.decode(bytes.subarray(ep, ep + Number(elen)));
          ep += Number(elen);
          if (ef === 1) {
            key = text;
          } else {
            value = text;
          }
        } else {
          ep = skipField(bytes, ep, ew);
        }
      }
      if (key !== null && value !== null) {
        out[key] = value;
      }
      pos = end;
    } else {
      pos = skipField(bytes, pos, wireType);
    }
  }
  return out;
}

/**
 * The recognition vocabulary: characters of the "character" metadata, one per line.
 * CTC classes are [blank, ...vocab, space]; see ctc.ts.
 */
export function vocabFromOnnx(bytes: Uint8Array): string[] {
  const meta = onnxMetadata(bytes);
  const raw = meta['character'];
  if (!raw) {
    throw new Error('the recognition model has no "character" metadata');
  }
  return raw.split('\n');
}

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Encode bytes as base64 without btoa (Hermes has none). Chunked for big buffers. */
export function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  const CHUNK = 0x6000; // multiple of 3: no padding inside the string
  for (let start = 0; start < bytes.length; start += CHUNK) {
    const end = Math.min(start + CHUNK, bytes.length);
    let s = '';
    for (let i = start; i + 2 < end; i += 3) {
      const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      s += B64_ALPHABET[(n >> 18) & 63] + B64_ALPHABET[(n >> 12) & 63] + B64_ALPHABET[(n >> 6) & 63] + B64_ALPHABET[n & 63];
    }
    const rem = (end - start) % 3;
    const full = end - rem;
    if (rem === 1) {
      const n = bytes[full] << 16;
      s += B64_ALPHABET[(n >> 18) & 63] + B64_ALPHABET[(n >> 12) & 63] + '==';
    } else if (rem === 2) {
      const n = (bytes[full] << 16) | (bytes[full + 1] << 8);
      s += B64_ALPHABET[(n >> 18) & 63] + B64_ALPHABET[(n >> 12) & 63] + B64_ALPHABET[(n >> 6) & 63] + '=';
    }
    parts.push(s);
  }
  return parts.join('');
}
