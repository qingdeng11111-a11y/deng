/* Minimal ZIP STORE writer. UTF-8 filenames; no compression; MIT. */
(function (root) {
  'use strict';
  const encoder = new TextEncoder();
  function crc32(bytes) {
    let c = 0xffffffff;
    for (const b of bytes) {
      c ^= b;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0);
    }
    return (c ^ 0xffffffff) >>> 0;
  }
  function zip(files) {
    const locals = [], centers = [];
    let offset = 0;
    for (const [name, content] of Object.entries(files)) {
      if (!/^[a-zA-Z0-9_.-]+$/.test(name)) throw new Error('ZIP 文件名不安全。');
      const n = encoder.encode(name), data = typeof content === 'string' ? encoder.encode(content) : content;
      const crc = crc32(data), local = new Uint8Array(30 + n.length + data.length), v = new DataView(local.buffer);
      v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x800, true);
      v.setUint16(12, 33, true); v.setUint32(14, crc, true); v.setUint32(18, data.length, true); v.setUint32(22, data.length, true);
      v.setUint16(26, n.length, true); local.set(n, 30); local.set(data, 30 + n.length);
      const center = new Uint8Array(46 + n.length), d = new DataView(center.buffer);
      d.setUint32(0, 0x02014b50, true); d.setUint16(4, 20, true); d.setUint16(6, 20, true); d.setUint16(8, 0x800, true);
      d.setUint16(14, 33, true); d.setUint32(16, crc, true); d.setUint32(20, data.length, true); d.setUint32(24, data.length, true);
      d.setUint16(28, n.length, true); d.setUint32(42, offset, true); center.set(n, 46);
      locals.push(local); centers.push(center); offset += local.length;
    }
    const centerSize = centers.reduce((n, x) => n + x.length, 0), end = new Uint8Array(22), d = new DataView(end.buffer);
    d.setUint32(0, 0x06054b50, true); d.setUint16(8, centers.length, true); d.setUint16(10, centers.length, true);
    d.setUint32(12, centerSize, true); d.setUint32(16, offset, true);
    const out = new Uint8Array(offset + centerSize + end.length);
    let at = 0;
    for (const part of [...locals, ...centers, end]) { out.set(part, at); at += part.length; }
    return out;
  }
  const api = {zip, crc32};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LabZip = api;
})(globalThis);
