const encoder = new TextEncoder();

function makeCrcTable() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
}

const CRC_TABLE = makeCrcTable();

function crc32(data) {
  let crc = ~0;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (~crc) >>> 0;
}

function getDosDateTime(date = new Date()) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);

  const dosTime = (hours << 11) | (minutes << 5) | seconds;
  const dosDate = ((year - 1980) << 9) | (month << 5) | day;
  return { dosTime, dosDate };
}

function writeUint16(arr, value) {
  arr.push(value & 0xff, (value >> 8) & 0xff);
}

function writeUint32(arr, value) {
  arr.push(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff);
}

function createLocalHeader(nameBytes, dataBytes, crc, dos) {
  const header = [];
  writeUint32(header, 0x04034b50);
  writeUint16(header, 20);
  writeUint16(header, 0);
  writeUint16(header, 0);
  writeUint16(header, dos.dosTime);
  writeUint16(header, dos.dosDate);
  writeUint32(header, crc);
  writeUint32(header, dataBytes.length);
  writeUint32(header, dataBytes.length);
  writeUint16(header, nameBytes.length);
  writeUint16(header, 0);
  return new Uint8Array([...header, ...nameBytes]);
}

function createCentralHeader(nameBytes, dataBytes, crc, dos, offset) {
  const header = [];
  writeUint32(header, 0x02014b50);
  writeUint16(header, 20);
  writeUint16(header, 20);
  writeUint16(header, 0);
  writeUint16(header, 0);
  writeUint16(header, dos.dosTime);
  writeUint16(header, dos.dosDate);
  writeUint32(header, crc);
  writeUint32(header, dataBytes.length);
  writeUint32(header, dataBytes.length);
  writeUint16(header, nameBytes.length);
  writeUint16(header, 0);
  writeUint16(header, 0);
  writeUint16(header, 0);
  writeUint16(header, 0);
  writeUint32(header, 0);
  writeUint32(header, offset);
  return new Uint8Array([...header, ...nameBytes]);
}

function createEndRecord(centralSize, centralOffset, totalEntries) {
  const footer = [];
  writeUint32(footer, 0x06054b50);
  writeUint16(footer, 0);
  writeUint16(footer, 0);
  writeUint16(footer, totalEntries);
  writeUint16(footer, totalEntries);
  writeUint32(footer, centralSize);
  writeUint32(footer, centralOffset);
  writeUint16(footer, 0);
  return new Uint8Array(footer);
}

function concatUint8(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function createZipBlob(files) {
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.path);
    const dataBytes = typeof file.content === 'string' ? encoder.encode(file.content) : new Uint8Array(file.content);
    const crc = crc32(dataBytes);
    const dos = getDosDateTime();

    const localHeader = createLocalHeader(nameBytes, dataBytes, crc, dos);
    localChunks.push(localHeader, dataBytes);

    const centralHeader = createCentralHeader(nameBytes, dataBytes, crc, dos, offset);
    centralChunks.push(centralHeader);

    offset += localHeader.length + dataBytes.length;
  }

  const centralOffset = offset;
  const central = concatUint8(centralChunks);
  offset += central.length;
  const endRecord = createEndRecord(central.length, centralOffset, files.length);

  const finalBuffer = concatUint8([...localChunks, central, endRecord]);
  return new Blob([finalBuffer], { type: 'application/zip' });
}

export class MiniZip {
  constructor() {
    this.files = [];
  }

  file(path, content) {
    this.files.push({ path, content });
    return this;
  }

  async generateAsync({ type = 'blob' } = {}) {
    const blob = createZipBlob(this.files);
    if (type === 'base64') {
      const buffer = await blob.arrayBuffer();
      let binary = '';
      const bytes = new Uint8Array(buffer);
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return btoa(binary);
    }
    return blob;
  }
}

export default MiniZip;
export function createZipFromFiles(files) {
  return createZipBlob(files);
}
