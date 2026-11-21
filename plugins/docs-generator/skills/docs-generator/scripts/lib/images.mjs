// Reads the pixel size of PNG and JPEG files from their headers.

/** @returns {{width: number, height: number, format: "png"|"jpg"}|null} */
export function imageSize(buf) {
  // PNG: signature, then the IHDR chunk with width and height
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47 && buf.toString("ascii", 12, 16) === "IHDR") {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), format: "png" };
  }
  // JPEG: walk the segments until a start-of-frame marker
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      const isSOF = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
      if (isSOF) return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5), format: "jpg" };
      i += 2 + len;
    }
  }
  return null;
}
