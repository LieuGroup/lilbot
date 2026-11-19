/** Tiny deterministic PNG: left half solid red, right half solid blue. */
import { deflateSync } from 'node:zlib'

export function screenshot() {
  const crc = (bytes: Buffer) => {
    let n = 0xffffffff
    for (const byte of bytes) {
      n ^= byte
      for (let bit = 0; bit < 8; bit++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0)
    }
    return (n ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer) => {
    const size = Buffer.alloc(4),
      checksum = Buffer.alloc(4),
      bytes = Buffer.concat([Buffer.from(type), data])
    size.writeUInt32BE(data.length)
    checksum.writeUInt32BE(crc(bytes))
    return Buffer.concat([size, bytes, checksum])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(128, 0)
  header.writeUInt32BE(128, 4)
  header[8] = 8
  header[9] = 2
  const pixels = Buffer.alloc(128 * (1 + 128 * 3))
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) pixels[y * 385 + 1 + x * 3 + (x < 64 ? 0 : 2)] = 255
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))])
}
