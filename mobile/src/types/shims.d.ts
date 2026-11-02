// Type shims for untyped pure-JS decoders.
declare module 'upng-js' {
  interface UPngImage {
    width: number;
    height: number;
    depth: number;
    ctype: number;
  }
  const UPNG: {
    decode(buffer: ArrayBuffer): UPngImage;
    toRGBA8(img: UPngImage): ArrayBuffer[];
  };
  export default UPNG;
}
