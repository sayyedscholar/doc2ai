/* doc2ai — shared utilities */
(function (g) {
  'use strict';
  var D2A = (g.D2A = g.D2A || {});

  var utf8Fatal = new TextDecoder('utf-8', { fatal: true });
  var utf8 = new TextDecoder('utf-8');
  var cp1252 = new TextDecoder('windows-1252');
  var utf16le = new TextDecoder('utf-16le');
  var utf16be = new TextDecoder('utf-16be');

  /* Byte -> binary string, byte preserving (used for PDF structure parsing). */
  function latin1(bytes) {
    var out = [];
    var CHUNK = 0x8000;
    for (var i = 0; i < bytes.length; i += CHUNK) {
      out.push(String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK)));
    }
    return out.join('');
  }

  function hasBom(bytes) {
    return (
      (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) ||
      (bytes[0] === 0xff && bytes[1] === 0xfe) ||
      (bytes[0] === 0xfe && bytes[1] === 0xff)
    );
  }

  /* Best-effort text decoding: BOM, then strict UTF-8, then Windows-1252. */
  function decodeText(bytes) {
    if (!bytes || !bytes.length) return '';
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      return normalizeNewlines(utf8.decode(bytes.subarray(3)));
    }
    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
      return normalizeNewlines(utf16le.decode(bytes.subarray(2)));
    }
    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      return normalizeNewlines(utf16be.decode(bytes.subarray(2)));
    }
    // Heuristic: lots of NUL bytes in even/odd positions means UTF-16 without BOM.
    var probe = Math.min(bytes.length, 4096);
    var nulEven = 0;
    var nulOdd = 0;
    for (var i = 0; i < probe; i++) {
      if (bytes[i] === 0) {
        if (i % 2) nulOdd++;
        else nulEven++;
      }
    }
    if (probe > 8 && nulOdd > probe * 0.25 && nulEven < probe * 0.05) {
      return normalizeNewlines(utf16le.decode(bytes));
    }
    if (probe > 8 && nulEven > probe * 0.25 && nulOdd < probe * 0.05) {
      return normalizeNewlines(utf16be.decode(bytes));
    }
    try {
      return normalizeNewlines(utf8Fatal.decode(bytes));
    } catch (e) {
      return normalizeNewlines(cp1252.decode(bytes));
    }
  }

  function normalizeNewlines(s) {
    return String(s).replace(/\r\n?/g, '\n');
  }

  function stripControl(s) {
    return String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  }

  function collapse(s) {
    return String(s).replace(/[ \t\u00a0]+/g, ' ').replace(/ *\n */g, '\n').trim();
  }

  function collapseBlankLines(s) {
    return String(s).replace(/\n{3,}/g, '\n\n').replace(/[ \t]+$/gm, '').trim();
  }

  function countWords(s) {
    var t = String(s).replace(/```[\s\S]*?```/g, ' ');
    t = t.replace(/[#>*_`\-|]/g, ' ');
    var m = t.match(/[^\s]+/g);
    return m ? m.length : 0;
  }

  function estimateTokens(s) {
    return Math.ceil(String(s).length / 4);
  }

  function humanBytes(n) {
    if (!n && n !== 0) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / 1048576).toFixed(1) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
  }

  function baseName(path) {
    var p = String(path).replace(/\\/g, '/');
    return p.slice(p.lastIndexOf('/') + 1);
  }

  function dirName(path) {
    var p = String(path).replace(/\\/g, '/');
    var i = p.lastIndexOf('/');
    return i < 0 ? '' : p.slice(0, i);
  }

  function stripExt(name) {
    var b = baseName(name);
    var i = b.lastIndexOf('.');
    return i <= 0 ? b : b.slice(0, i);
  }

  function extOf(name) {
    var b = baseName(name);
    var i = b.lastIndexOf('.');
    return i <= 0 ? '' : b.slice(i + 1).toLowerCase();
  }

  function slugify(s) {
    return String(s)
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80) || 'document';
  }

  function pad2(n) {
    return n < 10 ? '0' + n : '' + n;
  }

  function isoNow() {
    var d = new Date();
    var off = -d.getTimezoneOffset();
    var sign = off >= 0 ? '+' : '-';
    var oh = pad2(Math.floor(Math.abs(off) / 60));
    var om = pad2(Math.abs(off) % 60);
    return (
      d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()) +
      sign + oh + ':' + om
    );
  }

  /* ---------- Markdown helpers ---------- */

  function mdCell(v) {
    if (v === null || v === undefined) return '';
    var s = String(v).replace(/\r\n?/g, '\n').replace(/\n+/g, '<br>').replace(/\|/g, '\\|').trim();
    return s;
  }

  function mdInline(v) {
    return String(v == null ? '' : v)
      .replace(/\r\n?/g, ' ')
      .replace(/[ \t\u00a0]+/g, ' ')
      .trim();
  }

  function mdParagraph(v) {
    var s = mdInline(v);
    if (!s) return '';
    // Escape characters that would be misread as block syntax at line start.
    s = s.replace(/^(\s*)([#>])\s/, function (m, sp, ch) { return sp + '\\' + ch + ' '; });
    return s;
  }

  function mdHeading(text, level) {
    var t = mdInline(text);
    if (!t) return '';
    var lv = Math.min(6, Math.max(1, level || 2));
    return new Array(lv + 1).join('#') + ' ' + t;
  }

  function mdTable(rows, opts) {
    opts = opts || {};
    var clean = [];
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r] || [];
      var cells = [];
      for (var c = 0; c < row.length; c++) cells.push(mdCell(row[c]));
      // drop fully empty trailing rows
      if (!cells.join('').trim()) {
        clean.push(null);
        continue;
      }
      clean.push(cells);
    }
    while (clean.length && clean[clean.length - 1] === null) clean.pop();
    if (!clean.length) return '';
    var width = 0;
    clean.forEach(function (row) {
      if (row) width = Math.max(width, row.length);
    });
    if (!width) return '';
    clean = clean.map(function (row) {
      if (!row) return new Array(width).fill('');
      while (row.length < width) row.push('');
      return row;
    });
    var head = clean[0];
    // A header row of all-empty cells is not useful; synthesise one.
    if (!head.join('').trim()) {
      head = head.map(function (_, i) { return 'Column ' + (i + 1); });
      clean.unshift(head);
    }
    var out = ['| ' + head.join(' | ') + ' |'];
    out.push('| ' + head.map(function () { return '---'; }).join(' | ') + ' |');
    for (var i = 1; i < clean.length; i++) out.push('| ' + clean[i].join(' | ') + ' |');
    return out.join('\n');
  }

  function mdList(items, ordered) {
    return items
      .map(function (it, i) {
        return (ordered ? i + 1 + '. ' : '- ') + mdInline(it);
      })
      .join('\n');
  }

  function mdFence(code, lang) {
    var body = String(code).replace(/\s+$/, '');
    var fence = '```';
    while (body.indexOf(fence) >= 0) fence += '`';
    return fence + (lang || '') + '\n' + body + '\n' + fence;
  }

  /* YAML-safe scalar (double quoted). */
  function yamlStr(v) {
    return '"' + String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }

  function yamlValue(v) {
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (Array.isArray(v)) {
      if (v.some(function (x) { return x && typeof x === 'object'; })) return yamlStr(JSON.stringify(v));
      return '[' + v.map(yamlValue).join(', ') + ']';
    }
    if (typeof v === 'object') return yamlStr(JSON.stringify(v));
    return yamlStr(v);
  }

  function yamlBlock(obj, indent) {
    indent = indent || '';
    var lines = [];
    Object.keys(obj).forEach(function (k) {
      var v = obj[k];
      if (v === undefined) return;
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        var inner = yamlBlock(v, indent + '  ');
        if (inner) {
          lines.push(indent + k + ':');
          lines.push(inner);
        } else {
          lines.push(indent + k + ': {}');
        }
      } else {
        lines.push(indent + k + ': ' + yamlValue(v));
      }
    });
    return lines.join('\n');
  }

  /* ---------- misc ---------- */

  function bytesToHex(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
    return s;
  }

  function bytesToBase64(bytes) {
    var CH = 0x8000;
    var parts = [];
    for (var i = 0; i < bytes.length; i += CH) {
      parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + CH)));
    }
    if (typeof btoa === 'function') return btoa(parts.join(''));
    return Buffer.from(bytes).toString('base64');
  }

  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }

  D2A.util = {
    latin1: latin1,
    decodeText: decodeText,
    normalizeNewlines: normalizeNewlines,
    stripControl: stripControl,
    collapse: collapse,
    collapseBlankLines: collapseBlankLines,
    countWords: countWords,
    estimateTokens: estimateTokens,
    humanBytes: humanBytes,
    baseName: baseName,
    dirName: dirName,
    stripExt: stripExt,
    extOf: extOf,
    slugify: slugify,
    isoNow: isoNow,
    mdCell: mdCell,
    mdInline: mdInline,
    mdParagraph: mdParagraph,
    mdHeading: mdHeading,
    mdTable: mdTable,
    mdList: mdList,
    mdFence: mdFence,
    yamlStr: yamlStr,
    yamlBlock: yamlBlock,
    bytesToHex: bytesToHex,
    bytesToBase64: bytesToBase64,
    sleep: sleep,
    clamp: clamp,
    hasBom: hasBom
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
