/* zip.js — a store-only (uncompressed) zip writer.
 *
 * Pictures and clips are compressed already, so deflate would buy almost
 * nothing and cost a library. The same writer Pose Bench uses for PNG frames
 * (posebench/pose.html keeps its own copy, because it also runs on its own).
 *
 *   SB.Zip.store([{name, data: Uint8Array | string}]) -> Blob
 */
(function (SB) {
  'use strict';

  let table = null;
  function crc32(u) {
    if (!table) {
      table = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
      }
    }
    let c = 0xffffffff;
    for (let i = 0; i < u.length; i++) c = table[(c ^ u[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function bytes(d) {
    if (d instanceof Uint8Array) return d;
    if (d instanceof ArrayBuffer) return new Uint8Array(d);
    return new TextEncoder().encode(String(d == null ? '' : d));
  }

  /* data:...;base64,.... (or a percent-encoded one) -> bytes */
  function fromDataUrl(u) {
    const s = String(u || '');
    const i = s.indexOf(',');
    if (i < 0) return new Uint8Array(0);
    const head = s.slice(0, i), body = s.slice(i + 1);
    if (/;base64$/i.test(head)) {
      const b = atob(body), out = new Uint8Array(b.length);
      for (let k = 0; k < b.length; k++) out[k] = b.charCodeAt(k);
      return out;
    }
    return new TextEncoder().encode(decodeURIComponent(body));
  }

  function store(files) {
    const parts = [], central = [];
    let off = 0;
    files.forEach(function (f) {
      const data = bytes(f.data);
      const nm = new TextEncoder().encode(f.name), c = crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true);
      h.setUint16(6, 0x0800, true);            // names are UTF-8
      h.setUint32(14, c, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true);
      h.setUint16(26, nm.length, true);
      parts.push(new Uint8Array(h.buffer), nm, data);
      const ce = new DataView(new ArrayBuffer(46));
      ce.setUint32(0, 0x02014b50, true); ce.setUint16(4, 20, true); ce.setUint16(6, 20, true);
      ce.setUint16(8, 0x0800, true);
      ce.setUint32(16, c, true); ce.setUint32(20, data.length, true); ce.setUint32(24, data.length, true);
      ce.setUint16(28, nm.length, true); ce.setUint32(42, off, true);
      central.push(new Uint8Array(ce.buffer), nm);
      off += 30 + nm.length + data.length;
    });
    const cs = central.reduce(function (n, u) { return n + u.length; }, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, cs, true); e.setUint32(16, off, true);
    return new Blob(parts.concat(central, [new Uint8Array(e.buffer)]), { type: 'application/zip' });
  }

  SB.Zip = { store: store, crc32: crc32, fromDataUrl: fromDataUrl };

})(window.SB);
