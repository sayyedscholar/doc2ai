/* doc2ai — minimal ZIP reader/writer (no dependencies) */
(function (g) {
  'use strict';
  var D2A = (g.D2A = g.D2A || {});

  var CRC_TABLE = (function () {
    var t = new Int32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })();

  function crc32(bytes) {
    var c = 0 ^ -1;
    for (var i = 0; i < bytes.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ bytes[i]) & 0xff];
    return (c ^ -1) >>> 0;
  }

  async function inflateRaw(bytes) {
    if (!bytes.length) return new Uint8Array(0);
    if (typeof DecompressionStream !== 'function') {
      throw new Error('This browser cannot decompress ZIP data (DecompressionStream is missing). Use a current Chrome, Edge, Firefox or Safari.');
    }
    var ds = new DecompressionStream('deflate-raw');
    var stream = new Blob([bytes]).stream().pipeThrough(ds);
    var buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  }

  var utf8 = new TextDecoder('utf-8');

  function readU16(dv, off) { return dv.getUint16(off, true); }
  function readU32(dv, off) { return dv.getUint32(off, true); }

  function decodeName(bytes, utf8Flag) {
    if (utf8Flag) return utf8.decode(bytes);
    // Many tools write UTF-8 without setting the flag; try strict decode first.
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (e) {
      return new TextDecoder('windows-1252').decode(bytes);
    }
  }

  /**
   * Read a ZIP archive from an ArrayBuffer / Uint8Array.
   * Returns { entries: [{ name, dir, size, method, async bytes(), async text() }], comment }
   */
  async function readZip(input) {
    var bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    // Locate End Of Central Directory (scan backwards, max 64KB + comment).
    var eocd = -1;
    var minPos = Math.max(0, bytes.length - 66000);
    for (var i = bytes.length - 22; i >= minPos; i--) {
      if (readU32(dv, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Not a valid ZIP archive (end of central directory not found).');

    var count = readU16(dv, eocd + 10);
    var cdOffset = readU32(dv, eocd + 16);
    var commentLen = readU16(dv, eocd + 20);
    var comment = commentLen ? decodeName(bytes.subarray(eocd + 22, eocd + 22 + commentLen), false) : '';

    // ZIP64 fallback: sizes/counts of 0xFFFFFFFF.
    if (count === 0xffff || cdOffset === 0xffffffff) {
      var loc = -1;
      for (var j = eocd - 20; j >= Math.max(0, eocd - 4096); j--) {
        if (readU32(dv, j) === 0x07064b50) { loc = j; break; }
      }
      if (loc >= 0) {
        var z64off = Number(dv.getBigUint64(loc + 8, true));
        if (readU32(dv, z64off) === 0x06064b50) {
          count = Number(dv.getBigUint64(z64off + 32, true));
          cdOffset = Number(dv.getBigUint64(z64off + 48, true));
        }
      }
    }

    var entries = [];
    var p = cdOffset;
    for (var n = 0; n < count; n++) {
      if (p + 46 > bytes.length) break;
      if (readU32(dv, p) !== 0x02014b50) break;
      var flags = readU16(dv, p + 8);
      var method = readU16(dv, p + 10);
      var compSize = readU32(dv, p + 20);
      var uncompSize = readU32(dv, p + 24);
      var nameLen = readU16(dv, p + 28);
      var extraLen = readU16(dv, p + 30);
      var commentLength = readU16(dv, p + 32);
      var localOffset = readU32(dv, p + 42);
      var name = decodeName(bytes.subarray(p + 46, p + 46 + nameLen), !!(flags & 0x800));

      // ZIP64 extended information extra field.
      var ex = p + 46 + nameLen;
      var exEnd = ex + extraLen;
      while (ex + 4 <= exEnd) {
        var tag = readU16(dv, ex);
        var sz = readU16(dv, ex + 2);
        if (tag === 0x0001) {
          var q = ex + 4;
          if (uncompSize === 0xffffffff) { uncompSize = Number(dv.getBigUint64(q, true)); q += 8; }
          if (compSize === 0xffffffff) { compSize = Number(dv.getBigUint64(q, true)); q += 8; }
          if (localOffset === 0xffffffff) { localOffset = Number(dv.getBigUint64(q, true)); q += 8; }
        }
        ex += 4 + sz;
      }

      entries.push(makeEntry(name, method, compSize, uncompSize, localOffset, bytes, dv));
      p += 46 + nameLen + extraLen + commentLength;
    }

    // Entry-local header may carry a different name length; offsets are what matter.
    return { entries: entries, comment: comment };
  }

  function makeEntry(name, method, compSize, uncompSize, localOffset, bytes, dv) {
    var cache = null;
    async function getBytes() {
      if (cache) return cache;
      if (readU32(dv, localOffset) !== 0x04034b50) throw new Error('Corrupt ZIP entry: ' + name);
      var nameLen = readU16(dv, localOffset + 26);
      var extraLen = readU16(dv, localOffset + 28);
      var dataStart = localOffset + 30 + nameLen + extraLen;
      var raw = bytes.subarray(dataStart, dataStart + compSize);
      var out;
      if (method === 0) out = raw;
      else if (method === 8) out = await inflateRaw(raw);
      else throw new Error('Unsupported ZIP compression method ' + method + ' for ' + name);
      if (out.length === 0 && uncompSize > 0) out = raw;
      cache = out;
      return out;
    }
    return {
      name: name,
      dir: name.endsWith('/'),
      method: method,
      size: uncompSize,
      compressedSize: compSize,
      bytes: getBytes,
      text: async function () {
        return D2A.util.decodeText(await getBytes());
      }
    };
  }

  function findEntry(zip, name) {
    var lower = String(name).toLowerCase().replace(/^\/+/, '');
    for (var i = 0; i < zip.entries.length; i++) {
      if (zip.entries[i].name.toLowerCase().replace(/^\/+/, '') === lower) return zip.entries[i];
    }
    return null;
  }

  /* ---------- writing (stored, no compression) ---------- */

  function toBytes(data) {
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (typeof data === 'string') return new TextEncoder().encode(data);
    if (data && data.buffer) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    return new Uint8Array(0);
  }

  /**
   * files: [{ name: 'path/in/zip.md', data: string|Uint8Array }]
   * Returns Uint8Array of a valid (stored) ZIP file.
   */
  function writeZip(files) {
    var encoder = new TextEncoder();
    var chunks = [];
    var central = [];
    var offset = 0;
    var now = new Date();
    var dosTime = ((now.getHours() & 31) << 11) | ((now.getMinutes() & 63) << 5) | ((now.getSeconds() / 2) & 31);
    var dosDate = (((now.getFullYear() - 1980) & 127) << 9) | (((now.getMonth() + 1) & 15) << 5) | (now.getDate() & 31);

    files.forEach(function (f) {
      var nameBytes = encoder.encode(f.name);
      var data = toBytes(f.data);
      var crc = crc32(data);

      var local = new Uint8Array(30 + nameBytes.length);
      var lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0x0800, true); // UTF-8 name flag
      lv.setUint16(8, 0, true); // stored
      lv.setUint16(10, dosTime, true);
      lv.setUint16(12, dosDate, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);
      lv.setUint32(22, data.length, true);
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);
      local.set(nameBytes, 30);

      chunks.push(local, data);

      var cen = new Uint8Array(46 + nameBytes.length);
      var cv = new DataView(cen.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, dosTime, true);
      cv.setUint16(14, dosDate, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint32(42, offset, true);
      cen.set(nameBytes, 46);
      central.push(cen);

      offset += local.length + data.length;
    });

    var cdStart = offset;
    var cdSize = 0;
    central.forEach(function (c) { cdSize += c.length; });

    var end = new Uint8Array(22);
    var ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, cdStart, true);

    var total = cdStart + cdSize + 22;
    var out = new Uint8Array(total);
    var pos = 0;
    chunks.forEach(function (c) { out.set(c, pos); pos += c.length; });
    central.forEach(function (c) { out.set(c, pos); pos += c.length; });
    out.set(end, pos);
    return out;
  }

  D2A.zip = {
    readZip: readZip,
    findEntry: findEntry,
    writeZip: writeZip,
    crc32: crc32,
    inflateRaw: inflateRaw
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
