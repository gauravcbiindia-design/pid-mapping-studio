export interface ZipFile {
  path: string;
  content: Uint8Array;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipChunk(length: number, write: (view: DataView) => void): Uint8Array {
  const bytes = new Uint8Array(length);
  write(new DataView(bytes.buffer));
  return bytes;
}

/**
 * Build a deterministic, UTF-8 ZIP using store (no compression). Keeping this
 * small utility dependency-free allows the demo to prepare downloads entirely
 * in the user's browser.
 */
export function createStoredZip(files: ZipFile[]): Blob {
  if (files.length > 65_535) {
    throw new Error('The local ZIP cannot contain more than 65,535 files.');
  }
  const encoder = new TextEncoder();
  const localChunks: Uint8Array[] = [];
  const directoryChunks: Uint8Array[] = [];
  let localOffset = 0;
  let directorySize = 0;

  for (const file of files) {
    const name = encoder.encode(file.path);
    const checksum = crc32(file.content);
    const localHeader = zipChunk(30 + name.length, (view) => {
      view.setUint32(0, 0x04034b50, true);
      view.setUint16(4, 20, true);
      view.setUint16(6, 0x0800, true);
      view.setUint16(8, 0, true);
      view.setUint16(10, 0, true);
      view.setUint16(12, 0x0021, true);
      view.setUint32(14, checksum, true);
      view.setUint32(18, file.content.length, true);
      view.setUint32(22, file.content.length, true);
      view.setUint16(26, name.length, true);
      view.setUint16(28, 0, true);
      new Uint8Array(view.buffer, 30, name.length).set(name);
    });
    localChunks.push(localHeader, file.content);

    const directoryHeader = zipChunk(46 + name.length, (view) => {
      view.setUint32(0, 0x02014b50, true);
      view.setUint16(4, 20, true);
      view.setUint16(6, 20, true);
      view.setUint16(8, 0x0800, true);
      view.setUint16(10, 0, true);
      view.setUint16(12, 0, true);
      view.setUint16(14, 0x0021, true);
      view.setUint32(16, checksum, true);
      view.setUint32(20, file.content.length, true);
      view.setUint32(24, file.content.length, true);
      view.setUint16(28, name.length, true);
      view.setUint16(30, 0, true);
      view.setUint16(32, 0, true);
      view.setUint16(34, 0, true);
      view.setUint16(36, 0, true);
      view.setUint32(38, 0, true);
      view.setUint32(42, localOffset, true);
      new Uint8Array(view.buffer, 46, name.length).set(name);
    });
    directoryChunks.push(directoryHeader);
    directorySize += directoryHeader.length;
    localOffset += localHeader.length + file.content.length;
  }

  const endRecord = zipChunk(22, (view) => {
    view.setUint32(0, 0x06054b50, true);
    view.setUint16(4, 0, true);
    view.setUint16(6, 0, true);
    view.setUint16(8, files.length, true);
    view.setUint16(10, files.length, true);
    view.setUint32(12, directorySize, true);
    view.setUint32(16, localOffset, true);
    view.setUint16(20, 0, true);
  });

  const zipBytes = [...localChunks, ...directoryChunks, endRecord];
  const parts: BlobPart[] = zipBytes.map((bytes) => {
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    return buffer;
  });
  return new Blob(parts, { type: 'application/zip' });
}
