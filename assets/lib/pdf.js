/* doc2ai — PDF text extractor (pure JS: objects, object streams, ToUnicode CMaps, content streams) */
(function (g) {
  'use strict';
  var D2A = (g.D2A = g.D2A || {});
  var U = D2A.util;

  var WS = { 0: 1, 9: 1, 10: 1, 12: 1, 13: 1, 32: 1 };
  var DELIM = { 40: 1, 41: 1, 60: 1, 62: 1, 91: 1, 93: 1, 123: 1, 125: 1, 47: 1, 37: 1 };

  function isWs(c) { return !!WS[c]; }
  function isDelim(c) { return !!DELIM[c]; }

  /* ---------------- low level values ---------------- */

  function skipWs(s, i) {
    while (i < s.length) {
      var c = s.charCodeAt(i);
      if (isWs(c)) { i++; continue; }
      if (c === 37) { while (i < s.length && s[i] !== '\n' && s[i] !== '\r') i++; continue; }
      break;
    }
    return i;
  }

  function parseValue(s, i) {
    i = skipWs(s, i);
    if (i >= s.length) return { t: 'null', i: i };
    var c = s[i];

    if (c === '/') {
      var j = i + 1;
      while (j < s.length) {
        var cc = s.charCodeAt(j);
        if (isWs(cc) || isDelim(cc)) break;
        j++;
      }
      return { t: 'name', v: s.slice(i + 1, j), i: j };
    }
    if (c === '(') {
      var out = '';
      var depth = 1;
      var k = i + 1;
      while (k < s.length && depth > 0) {
        var ch = s[k];
        if (ch === '\\') {
          var nx = s[k + 1];
          if (nx === 'n') { out += '\n'; k += 2; continue; }
          if (nx === 'r') { out += '\r'; k += 2; continue; }
          if (nx === 't') { out += '\t'; k += 2; continue; }
          if (nx === 'b') { out += '\b'; k += 2; continue; }
          if (nx === 'f') { out += '\f'; k += 2; continue; }
          if (nx >= '0' && nx <= '7') {
            var oct = '';
            var m = k + 1;
            while (m < s.length && oct.length < 3 && s[m] >= '0' && s[m] <= '7') { oct += s[m]; m++; }
            out += String.fromCharCode(parseInt(oct, 8) & 0xff);
            k = m;
            continue;
          }
          if (nx === '\r') { k += s[k + 2] === '\n' ? 3 : 2; continue; }
          if (nx === '\n') { k += 2; continue; }
          out += nx === undefined ? '' : nx;
          k += 2;
          continue;
        }
        if (ch === '(') depth++;
        if (ch === ')') { depth--; if (depth === 0) { k++; break; } }
        out += ch;
        k++;
      }
      return { t: 'str', v: out, i: k };
    }
    if (c === '<') {
      if (s[i + 1] === '<') {
        var dict = {};
        var p = i + 2;
        while (p < s.length) {
          p = skipWs(s, p);
          if (s[p] === '>' && s[p + 1] === '>') { p += 2; break; }
          if (s[p] !== '/') { var skip = parseValue(s, p); if (skip.i <= p) p++; else p = skip.i; continue; }
          var keyVal = parseValue(s, p);
          p = keyVal.i;
          var val = parseValue(s, p);
          p = val.i;
          dict[keyVal.v] = val;
        }
        return { t: 'dict', v: dict, i: p };
      }
      var hex = '';
      var q = i + 1;
      while (q < s.length && s[q] !== '>') {
        var hc = s.charCodeAt(q);
        if (!isWs(hc)) hex += s[q];
        q++;
      }
      return { t: 'str', v: hexToBytes(hex), i: q + 1, hex: true };
    }
    if (c === '[') {
      var arr = [];
      var a = i + 1;
      while (a < s.length) {
        a = skipWs(s, a);
        if (s[a] === ']') { a++; break; }
        var item = parseValue(s, a);
        if (item.i <= a) { a++; continue; }
        arr.push(item);
        a = item.i;
      }
      return { t: 'arr', v: arr, i: a };
    }
    if (c === ']' || c === '>' || c === ')' || c === '}') return { t: 'op', v: c, i: i + 1 };

    var numMatch = /^[+-]?(?:\d+\.?\d*|\.\d+)/.exec(s.slice(i, i + 32));
    if (numMatch) {
      var numEnd = i + numMatch[0].length;
      var save = numEnd;
      var genMatch = /^\s+(\d+)\s+R\b/.exec(s.slice(numEnd, numEnd + 20));
      if (genMatch && /^\d+$/.test(numMatch[0])) {
        return { t: 'ref', v: parseInt(numMatch[0], 10), i: numEnd + genMatch[0].length };
      }
      return { t: 'num', v: parseFloat(numMatch[0]), i: save };
    }

    var w = i;
    while (w < s.length) {
      var wc = s.charCodeAt(w);
      if (isWs(wc) || isDelim(wc)) break;
      w++;
    }
    var word = s.slice(i, w);
    if (!word) return { t: 'op', v: s[i], i: i + 1 };
    if (word === 'true') return { t: 'bool', v: true, i: w };
    if (word === 'false') return { t: 'bool', v: false, i: w };
    if (word === 'null') return { t: 'null', i: w };
    return { t: 'op', v: word, i: w };
  }

  function hexToBytes(hex) {
    var clean = String(hex).replace(/[^0-9A-Fa-f]/g, '');
    if (clean.length % 2) clean += '0';
    var out = '';
    for (var i = 0; i < clean.length; i += 2) out += String.fromCharCode(parseInt(clean.substr(i, 2), 16));
    return out;
  }

  /* ---------------- filters ---------------- */

  async function inflate(bytes, kind) {
    if (!bytes || !bytes.length) return bytes;
    var attempts = kind === 'raw' ? ['deflate-raw', 'deflate'] : ['deflate', 'deflate-raw'];
    for (var a = 0; a < attempts.length; a++) {
      try {
        var ds = new DecompressionStream(attempts[a]);
        var stream = new Blob([bytes]).stream().pipeThrough(ds);
        var buf = await new Response(stream).arrayBuffer();
        return new Uint8Array(buf);
      } catch (e) { /* try next */ }
    }
    return bytes;
  }

  function applyPredictor(data, parms) {
    if (!parms) return data;
    var predictor = parms.Predictor || 1;
    if (predictor < 10) return data;
    var colors = parms.Colors || 1;
    var bpc = parms.BitsPerComponent || 8;
    var columns = parms.Columns || 1;
    var bpp = Math.ceil((colors * bpc) / 8);
    var rowLen = Math.ceil((columns * colors * bpc) / 8);
    var rows = Math.floor(data.length / (rowLen + 1));
    var out = new Uint8Array(rows * rowLen);
    var prev = new Uint8Array(rowLen);
    for (var r = 0; r < rows; r++) {
      var ft = data[r * (rowLen + 1)];
      var row = data.subarray(r * (rowLen + 1) + 1, (r + 1) * (rowLen + 1));
      var cur = new Uint8Array(rowLen);
      for (var x = 0; x < rowLen; x++) {
        var raw = row[x] || 0;
        var left = x >= bpp ? cur[x - bpp] : 0;
        var up = prev[x];
        var upLeft = x >= bpp ? prev[x - bpp] : 0;
        var val = raw;
        if (ft === 1) val = raw + left;
        else if (ft === 2) val = raw + up;
        else if (ft === 3) val = raw + ((left + up) >> 1);
        else if (ft === 4) {
          var pa = Math.abs(up - upLeft);
          var pb = Math.abs(left - upLeft);
          var pc = Math.abs(left + up - 2 * upLeft);
          val = raw + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
        }
        cur[x] = val & 0xff;
      }
      out.set(cur, r * rowLen);
      prev = cur;
    }
    return out;
  }

  /* ---------------- document ---------------- */

  function PdfDoc(bytes) {
    this.bytes = bytes;
    this.s = U.latin1(bytes);
    this.objs = new Map();
    this.cache = new Map();
    this.pending = [];
  }

  PdfDoc.prototype.scan = function () {
    var s = this.s;
    var re = /(\d{1,9})\s+(\d{1,5})\s+obj\b/g;
    var m;
    while ((m = re.exec(s))) {
      var num = parseInt(m[1], 10);
      var start = re.lastIndex;
      var endobj = s.indexOf('endobj', start);
      var streamIdx = s.indexOf('stream', start);
      var dictEnd = endobj < 0 ? s.length : endobj;
      var rec = { num: num, dictStr: '', dataStart: -1, dataEnd: -1, lengthRef: null, length: null };

      if (streamIdx >= 0 && streamIdx < dictEnd) {
        rec.dictStr = s.slice(start, streamIdx);
        var ds = streamIdx + 6;
        if (s[ds] === '\r') ds++;
        if (s[ds] === '\n') ds++;
        rec.dataStart = ds;
        var lenNode = parseValue(rec.dictStr, 0);
        var dict = lenNode.t === 'dict' ? lenNode.v : {};
        if (dict.Length) {
          if (dict.Length.t === 'num') rec.length = dict.Length.v;
          else if (dict.Length.t === 'ref') rec.lengthRef = dict.Length.v;
        }
        var es = s.indexOf('endstream', ds);
        rec.dataEnd = es < 0 ? s.length : es;
        // Never let the scanner walk through binary stream data.
        var afterStream = s.indexOf('endobj', rec.dataEnd);
        if (afterStream > 0) re.lastIndex = afterStream + 6;
      } else {
        rec.dictStr = s.slice(start, dictEnd);
        re.lastIndex = Math.max(re.lastIndex, dictEnd + 6);
      }
      this.objs.set(num, rec);
    }
    // Resolve stream lengths now that every object is known.
    var self = this;
    this.objs.forEach(function (rec) {
      if (rec.dataStart < 0) return;
      var len = rec.length;
      if (len == null && rec.lengthRef != null) {
        var target = self.objs.get(rec.lengthRef);
        if (target) {
          var v = parseValue(target.dictStr, 0);
          if (v.t === 'num') len = v.v;
          else if (v.t === 'dict' && v.v.Length && v.v.Length.t === 'num') len = v.v.Length.v;
        }
      }
      if (len == null || len < 0 || rec.dataStart + len > rec.dataEnd + 4) len = rec.dataEnd - rec.dataStart;
      rec.length = len;
      // strip the EOL that precedes "endstream"
      var end = rec.dataStart + len;
      if (rec.dataEnd > end) {
        rec.dataEnd = end;
      }
    });
  };

  /* Objects compressed inside /Type /ObjStm streams (PDF 1.5+). */
  PdfDoc.prototype.expandObjectStreams = async function () {
    var recs = [];
    var self = this;
    this.objs.forEach(function (rec) {
      if (rec.dataStart >= 0 && /\/Type\s*\/ObjStm/.test(rec.dictStr)) recs.push(rec);
    });
    for (var r = 0; r < recs.length; r++) {
      var rec = recs[r];
      var parsed = parseValue(rec.dictStr, 0);
      if (parsed.t !== 'dict') continue;
      var dict = parsed.v;
      var count = dict.N && dict.N.t === 'num' ? dict.N.v : 0;
      var first = dict.First && dict.First.t === 'num' ? dict.First.v : 0;
      var text;
      try {
        text = await self.streamText({
          t: 'dict',
          v: dict,
          stream: self.bytes.subarray(rec.dataStart, rec.dataStart + rec.length)
        });
      } catch (e) {
        continue;
      }
      var header = text.slice(0, first).trim().split(/\s+/);
      for (var i = 0; i < count; i++) {
        var num = parseInt(header[i * 2], 10);
        var off = parseInt(header[i * 2 + 1], 10);
        if (!isFinite(num) || !isFinite(off)) continue;
        var start = first + off;
        var nextOff = i + 1 < count ? parseInt(header[(i + 1) * 2 + 1], 10) : text.length - first;
        var end = first + (isFinite(nextOff) ? nextOff : text.length - first);
        if (self.objs.has(num)) continue;
        self.objs.set(num, {
          num: num,
          dictStr: text.slice(start, end),
          dataStart: -1,
          dataEnd: -1,
          length: null,
          lengthRef: null
        });
      }
    }
    this.cache.clear();
  };

  PdfDoc.prototype.dict = function (num) {    if (this.cache.has(num)) return this.cache.get(num);
    var rec = this.objs.get(num);
    if (!rec) { this.cache.set(num, null); return null; }
    var parsed = parseValue(rec.dictStr, 0);
    var node = parsed.t === 'dict' ? parsed : { t: 'dict', v: {} };
    if (rec.dataStart >= 0) {
      node.streamRec = rec;
      node.stream = this.bytes.subarray(rec.dataStart, rec.dataStart + rec.length);
    }
    this.cache.set(num, node);
    return node;
  };

  PdfDoc.prototype.resolve = function (node, depth) {
    depth = depth || 0;
    if (!node || depth > 12) return node;
    if (node.t === 'ref') return this.dict(node.v);
    return node;
  };

  PdfDoc.prototype.get = function (dictNode, key) {
    var d = this.resolve(dictNode);
    if (!d || d.t !== 'dict') return null;
    return d.v[key] || null;
  };

  PdfDoc.prototype.nameOf = function (node) {
    var n = this.resolve(node);
    return n && n.t === 'name' ? n.v : null;
  };

  PdfDoc.prototype.numOf = function (node) {
    var n = this.resolve(node);
    return n && n.t === 'num' ? n.v : null;
  };

  PdfDoc.prototype.streamText = async function (dictNode) {
    var d = this.resolve(dictNode);
    if (!d || !d.stream) return '';
    var data = d.stream;
    var filter = d.v.Filter;
    var filters = [];
    if (filter) {
      if (filter.t === 'name') filters = [filter.v];
      else if (filter.t === 'arr') filters = filter.v.map(function (f) { return f.v; });
    }
    var parms = d.v.DecodeParms || d.v.DP;
    for (var i = 0; i < filters.length; i++) {
      var f = filters[i];
      if (f === 'FlateDecode' || f === 'Fl') {
        data = await inflate(data, 'zlib');
        if (parms) {
          var p = this.resolve(parms);
          if (p && p.t === 'arr') p = this.resolve(p.v[i]);
          if (p && p.t === 'dict') {
            data = applyPredictor(data, {
              Predictor: this.numOf(p.v.Predictor) || 1,
              Colors: this.numOf(p.v.Colors) || 1,
              BitsPerComponent: this.numOf(p.v.BitsPerComponent) || 8,
              Columns: this.numOf(p.v.Columns) || 1
            });
          }
        }
      } else if (f === 'ASCIIHexDecode') {
        data = new Uint8Array(hexToBytes(U.latin1(data)).split('').map(function (c) { return c.charCodeAt(0); }));
      } else if (f === 'ASCII85Decode') {
        data = ascii85(U.latin1(data));
      }
    }
    return U.latin1(data);
  };

  function ascii85(str) {
    var out = [];
    var i = 0;
    while (i < str.length) {
      if (str[i] === '~') break;
      if (/\s/.test(str[i])) { i++; continue; }
      if (str[i] === 'z') { out.push(0, 0, 0, 0); i++; continue; }
      var group = [];
      while (group.length < 5 && i < str.length && !/\s/.test(str[i]) && str[i] !== '~') {
        group.push(str.charCodeAt(i) - 33);
        i++;
      }
      while (group.length < 5) group.push(84);
      var val = 0;
      for (var k = 0; k < 5; k++) val = val * 85 + group[k];
      out.push((val >>> 24) & 255, (val >>> 16) & 255, (val >>> 8) & 255, val & 255);
    }
    return new Uint8Array(out);
  }

  PdfDoc.prototype.pages = function () {
    var self = this;
    var pages = [];
    var visited = new Set();

    function walk(node, inherited) {
      var d = self.resolve(node);
      if (!d || d.t !== 'dict') return;
      var key = d.streamRec ? d.streamRec.num : null;
      if (key != null) {
        if (visited.has(key)) return;
        visited.add(key);
      }
      var type = self.nameOf(d.v.Type);
      var res = d.v.Resources || inherited;
      if (type === 'Pages' || d.v.Kids) {
        var kids = self.resolve(d.v.Kids);
        if (kids && kids.t === 'arr') {
          kids.v.forEach(function (kid) { walk(kid, res); });
        }
        return;
      }
      if (type === 'Page' || d.v.Contents || d.v.MediaBox) {
        pages.push({ dict: d, resources: res, num: key });
      }
    }

    var catalog = null;
    var self2 = this;
    this.objs.forEach(function (rec) {
      if (catalog) return;
      if (/\/Type\s*\/Catalog/.test(rec.dictStr)) catalog = self2.dict(rec.num);
    });
    if (catalog) walk(catalog.v.Pages, catalog.v.Resources);
    if (!pages.length) {
      this.objs.forEach(function (rec) {
        if (/\/Type\s*\/Page[^s]/.test(rec.dictStr)) {
          var d = self2.dict(rec.num);
          pages.push({ dict: d, resources: d.v.Resources, num: rec.num });
        }
      });
    }
    return pages;
  };

  /* ---------------- fonts / CMaps ---------------- */

  var GLYPHS = {
    space: ' ', exclam: '!', quotedbl: '"', numbersign: '#', dollar: '$', percent: '%',
    ampersand: '&', quotesingle: "'", parenleft: '(', parenright: ')', asterisk: '*',
    plus: '+', comma: ',', hyphen: '-', period: '.', slash: '/', zero: '0', one: '1',
    two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8',
    nine: '9', colon: ':', semicolon: ';', less: '<', equal: '=', greater: '>',
    question: '?', at: '@', bracketleft: '[', backslash: '\\', bracketright: ']',
    asciicircum: '^', underscore: '_', grave: '`', braceleft: '{', bar: '|',
    braceright: '}', asciitilde: '~', quoteleft: '\u2018', quoteright: '\u2019',
    quotedblleft: '\u201c', quotedblright: '\u201d', endash: '\u2013', emdash: '\u2014',
    bullet: '\u2022', ellipsis: '\u2026', dagger: '\u2020', daggerdbl: '\u2021',
    trademark: '\u2122', copyright: '\u00a9', registered: '\u00ae', degree: '\u00b0',
    plusminus: '\u00b1', multiply: '\u00d7', divide: '\u00f7', fi: 'fi', fl: 'fl',
    ff: 'ff', ffi: 'ffi', ffl: 'ffl', section: '\u00a7', paragraph: '\u00b6',
    periodcentered: '\u00b7', germandbls: '\u00df', ae: '\u00e6', oe: '\u0153',
    oslash: '\u00f8', lslash: '\u0142', dotlessi: '\u0131', nbspace: ' '
  };

  function glyphToUnicode(name) {
    if (!name) return '';
    if (GLYPHS[name] !== undefined) return GLYPHS[name];
    var m = /^uni([0-9A-Fa-f]{4,6})$/.exec(name);
    if (m) { try { return String.fromCodePoint(parseInt(m[1], 16)); } catch (e) { return ''; } }
    m = /^u([0-9A-Fa-f]{4,6})$/.exec(name);
    if (m) { try { return String.fromCodePoint(parseInt(m[1], 16)); } catch (e) { return ''; } }
    if (name.length === 1) return name;
    // Accented names such as "eacute", "agrave".
    var ACC = { acute: '\u00b4', grave: '`', circumflex: '^', tilde: '~', dieresis: '\u00a8', ring: '\u02da', cedilla: '\u00b8', caron: '\u02c7' };
    m = /^([a-zA-Z])(acute|grave|circumflex|tilde|dieresis|ring|cedilla|caron)$/.exec(name);
    if (m) {
      var base = m[1];
      var comb = { acute: '\u0301', grave: '\u0300', circumflex: '\u0302', tilde: '\u0303', dieresis: '\u0308', ring: '\u030a', cedilla: '\u0327', caron: '\u030c' };
      try { return (base + comb[m[2]]).normalize('NFC'); } catch (e) { return base; }
    }
    return '';
  }

  function parseCMap(text) {
    var map = new Map();
    var re = /beginbfchar([\s\S]*?)endbfchar/g;
    var m;
    while ((m = re.exec(text))) {
      var body = m[1];
      var pairRe = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/g;
      var p;
      while ((p = pairRe.exec(body))) {
        map.set(parseInt(p[1], 16), hexToUtf16(p[2]));
      }
    }
    re = /beginbfrange([\s\S]*?)endbfrange/g;
    while ((m = re.exec(text))) {
      var rbody = m[1];
      var rangeRe = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]+)>|\[([\s\S]*?)\])/g;
      var r;
      while ((r = rangeRe.exec(rbody))) {
        var lo = parseInt(r[1], 16);
        var hi = parseInt(r[2], 16);
        if (r[3] !== undefined) {
          var start = parseInt(r[3], 16);
          var span = Math.min(hi - lo, 65535);
          for (var i = 0; i <= span; i++) {
            map.set(lo + i, String.fromCharCode(start + i));
          }
        } else if (r[4] !== undefined) {
          var items = r[4].match(/<([0-9A-Fa-f]*)>/g) || [];
          items.forEach(function (h, idx) {
            map.set(lo + idx, hexToUtf16(h.replace(/[<>]/g, '')));
          });
        }
      }
    }
    return map;
  }

  function hexToUtf16(hex) {
    var clean = String(hex).replace(/[^0-9A-Fa-f]/g, '');
    if (clean.length % 4) clean = clean.padStart(Math.ceil(clean.length / 4) * 4, '0');
    var out = '';
    for (var i = 0; i < clean.length; i += 4) {
      out += String.fromCharCode(parseInt(clean.substr(i, 4), 16));
    }
    return out;
  }

  /* Legacy single-byte encodings. TextDecoder covers them natively in modern
     browsers and Node; the tables below are the fallback. */
  var decoderCache = {};

  function decoderFor(label) {
    if (decoderCache[label] !== undefined) return decoderCache[label];
    var d = null;
    try { d = new TextDecoder(label); } catch (e) { d = null; }
    decoderCache[label] = d;
    return d;
  }

  var MAC_ROMAN_HIGH =
    '\u00c4\u00c5\u00c7\u00c9\u00d1\u00d6\u00dc\u00e1\u00e0\u00e2\u00e4\u00e3\u00e5\u00e7\u00e9\u00e8' +
    '\u00ea\u00eb\u00ed\u00ec\u00ee\u00ef\u00f1\u00f3\u00f2\u00f4\u00f6\u00f5\u00fa\u00f9\u00fb\u00fc' +
    '\u2020\u00b0\u00a2\u00a3\u00a7\u2022\u00b6\u00df\u00ae\u00a9\u2122\u00b4\u00a8\u2260\u00c6\u00d8' +
    '\u221e\u00b1\u2264\u2265\u00a5\u00b5\u2202\u2211\u220f\u03c0\u222b\u00aa\u00ba\u03a9\u00e6\u00f8' +
    '\u00bf\u00a1\u00ac\u221a\u0192\u2248\u2206\u00ab\u00bb\u2026\u00a0\u00c0\u00c3\u00d5\u0152\u0153' +
    '\u2013\u2014\u201c\u201d\u2018\u2019\u00f7\u25ca\u00ff\u0178\u2044\u20ac\u2039\u203a\ufb01\ufb02' +
    '\u2021\u00b7\u201a\u201e\u2030\u00c2\u00ca\u00c1\u00cb\u00c8\u00cd\u00ce\u00cf\u00cc\u00d3\u00d4' +
    '\uf8ff\u00d2\u00da\u00db\u00d9\u0131\u02c6\u02dc\u00af\u02d8\u02d9\u02da\u00b8\u02dd\u02db\u02c7';

  function decodeByte(c, encoding) {
    if (encoding === 'WinAnsiEncoding') {
      var w = decoderFor('windows-1252');
      if (w) return w.decode(new Uint8Array([c]));
      return String.fromCharCode(c);
    }
    if (encoding === 'MacRomanEncoding') {
      if (c < 0x80) return String.fromCharCode(c);
      var m = decoderFor('macintosh');
      if (m) return m.decode(new Uint8Array([c]));
      return MAC_ROMAN_HIGH.charAt(c - 0x80) || String.fromCharCode(c);
    }
    return String.fromCharCode(c);
  }

  var LIGATURES = {
    '\ufb00': 'ff', '\ufb01': 'fi', '\ufb02': 'fl', '\ufb03': 'ffi',
    '\ufb04': 'ffl', '\ufb05': 'st', '\ufb06': 'st'
  };

  function normalizeLigatures(text) {
    return text.replace(/[\ufb00-\ufb06]/g, function (ch) { return LIGATURES[ch] || ch; });
  }

  function buildFonts(doc, resources) {
    var fonts = {};
    var res = doc.resolve(resources);
    if (!res || res.t !== 'dict') return fonts;
    var fontDict = doc.resolve(res.v.Font);
    if (!fontDict || fontDict.t !== 'dict') return fonts;
    Object.keys(fontDict.v).forEach(function (key) {
      var font = doc.resolve(fontDict.v[key]);
      if (!font || font.t !== 'dict') return;
      var subtype = doc.nameOf(font.v.Subtype);
      var info = { cmap: null, twoByte: subtype === 'Type0', differences: null, baseEncoding: doc.nameOf(font.v.Encoding) };
      if (font.v.ToUnicode && font.v.ToUnicode.t === 'ref') {
        var tu = doc.dict(font.v.ToUnicode.v);
        if (tu && tu.stream) info.cmap = tu;
      }
      var enc = doc.resolve(font.v.Encoding);
      if (enc && enc.t === 'dict') {
        var diffs = doc.resolve(enc.v.Differences);
        if (diffs && diffs.t === 'arr') {
          var code = 0;
          var table = {};
          diffs.v.forEach(function (item) {
            if (item.t === 'num') code = item.v;
            else if (item.t === 'name') { table[code] = glyphToUnicode(item.v); code++; }
          });
          info.differences = table;
        }
        var be = doc.nameOf(enc.v.BaseEncoding);
        if (be) info.baseEncoding = be;
      }

      // Glyph advance widths, used to place spaces when a PDF positions every
      // word with its own text matrix.
      var widthsNode = doc.resolve(font.v.Widths);
      if (widthsNode && widthsNode.t === 'arr') {
        var firstChar = font.v.FirstChar && font.v.FirstChar.t === 'num' ? font.v.FirstChar.v : 0;
        var wmap = {};
        widthsNode.v.forEach(function (w, idx) {
          var wd = doc.resolve(w);
          if (wd && wd.t === 'num') wmap[firstChar + idx] = wd.v;
        });
        info.widths = wmap;
      }
      var desc = doc.resolve(font.v.FontDescriptor);
      if (desc && desc.t === 'dict' && desc.v.MissingWidth && desc.v.MissingWidth.t === 'num') {
        info.defaultWidth = desc.v.MissingWidth.v;
      }

      fonts[key] = info;
    });
    return fonts;
  }

  /* ---------------- content stream text ---------------- */

  function decodeStringWithFont(str, font) {
    var out = '';
    if (!font) {
      for (var i = 0; i < str.length; i++) out += str[i];
      return out;
    }
    if (font.twoByte) {
      for (var j = 0; j + 1 < str.length; j += 2) {
        var code = (str.charCodeAt(j) << 8) | str.charCodeAt(j + 1);
        if (font.cmap && font.cmap.has(code)) out += font.cmap.get(code);
        else if (code >= 32 && code < 127) out += String.fromCharCode(code);
        else if (font.cmap && font.cmap.has(code & 0xff)) out += font.cmap.get(code & 0xff);
      }
      if (str.length % 2) {
        var last = str.charCodeAt(str.length - 1);
        if (font.cmap && font.cmap.has(last)) out += font.cmap.get(last);
      }
      return normalizeLigatures(out);
    }
    for (var k = 0; k < str.length; k++) {
      var c = str.charCodeAt(k) & 0xff;
      if (font.cmap && font.cmap.has(c)) { out += font.cmap.get(c); continue; }
      if (font.differences && font.differences[c] !== undefined) { out += font.differences[c]; continue; }
      out += decodeByte(c, font.baseEncoding);
    }
    return normalizeLigatures(out);
  }

  async function extractPageText(doc, page) {
    var contents = page.dict.v.Contents;
    var streams = [];
    var node = doc.resolve(contents);
    if (node && node.t === 'arr') {
      node.v.forEach(function (r) { var d = doc.resolve(r); if (d && d.stream) streams.push(d); });
    } else if (node && node.stream) {
      streams.push(node);
    }
    var chunks = [];
    for (var i = 0; i < streams.length; i++) chunks.push(await doc.streamText(streams[i]));
    var content = chunks.join('\n');

    var fonts = buildFonts(doc, page.resources);
    var fontData = {};
    var keys = Object.keys(fonts);
    for (var k = 0; k < keys.length; k++) {
      var f = fonts[keys[k]];
      var cmap = null;
      if (f.cmap) {
        try { cmap = parseCMap(await doc.streamText(f.cmap)); } catch (e) { cmap = null; }
      }
      fontData[keys[k]] = {
        cmap: cmap,
        twoByte: f.twoByte,
        differences: f.differences,
        baseEncoding: f.baseEncoding,
        widths: f.widths || null,
        defaultWidth: f.defaultWidth || 500
      };
    }

    var lines = [];
    var buf = '';
    var bufSize = 0;
    var curY = 0;
    var curX = 0;
    var leading = 0;
    var fontSize = 12;
    var font = null;
    var tm = [1, 0, 0, 1, 0, 0];
    var tmScale = 1;
    var ctmScale = 1;

    function effectiveSize() {
      return (fontSize || 12) * tmScale * ctmScale;
    }

    function flush() {
      if (buf.trim()) lines.push({ text: buf.replace(/\s+$/, ''), size: bufSize || effectiveSize(), y: curY });
      buf = '';
    }

    function show(str) {
      var txt = decodeStringWithFont(str, font);
      if (!txt) return;
      if (buf && Math.abs(curY - (lines.length ? lines[lines.length - 1].y : curY)) > fontSize * 40) {
        // far jump: nothing to do, keep simple
      }
      if (!buf) bufSize = effectiveSize();
      buf += txt;
      var eff = effectiveSize();
      var w = 0;
      for (var ci = 0; ci < txt.length; ci++) {
        var code = txt.charCodeAt(ci);
        var gw = font && font.widths && font.widths[code] !== undefined ? font.widths[code] : (font && font.defaultWidth ? font.defaultWidth : 500);
        w += (gw / 1000) * eff;
      }
      curX += w;
    }

    var i2 = 0;
    var stack = [];
    var pending = [];
    var s = content;
    var guard = 0;

    while (i2 < s.length && guard++ < 4000000) {
      var c = s[i2];
      if (c === '(' || c === '<' && s[i2 + 1] !== '<' || c === '[' || c === '/' || c === '+' || c === '-' || c === '.' || (c >= '0' && c <= '9')) {
        var val = parseValue(s, i2);
        if (val.i <= i2) { i2++; continue; }
        pending.push(val);
        i2 = val.i;
        continue;
      }
      if (c === '%') { while (i2 < s.length && s[i2] !== '\n') i2++; continue; }
      if (isWs(c.charCodeAt(0))) { i2++; continue; }
      if (c === '<' && s[i2 + 1] === '<') {
        var dv = parseValue(s, i2);
        pending.push(dv);
        i2 = dv.i;
        continue;
      }
      if (c === ']' || c === ')' || c === '>') { i2++; continue; }

      var opStart = i2;
      while (i2 < s.length) {
        var oc = s.charCodeAt(i2);
        if (isWs(oc) || isDelim(oc)) break;
        i2++;
      }
      var op = s.slice(opStart, i2);
      if (!op) { i2++; continue; }

      if (op === 'BI') {
        var idIdx = s.indexOf('ID', i2);
        if (idIdx < 0) break;
        var eiIdx = s.indexOf('EI', idIdx + 2);
        i2 = eiIdx < 0 ? s.length : eiIdx + 2;
        pending = [];
        continue;
      }

      switch (op) {
        case 'BT':
          tm = [1, 0, 0, 1, 0, 0];
          tmScale = 1;
          break;
        case 'ET':
          break;
        case 'Tf': {
          var nameNode = pending[pending.length - 2];
          var sizeNode = pending[pending.length - 1];
          if (nameNode && nameNode.t === 'name') font = fontData[nameNode.v] || null;
          if (sizeNode && sizeNode.t === 'num') fontSize = sizeNode.v || fontSize;
          break;
        }
        case 'TL':
          if (pending.length && pending[pending.length - 1].t === 'num') leading = pending[pending.length - 1].v;
          break;
        case 'Td': {
          var tx = pending[pending.length - 2];
          var ty = pending[pending.length - 1];
          if (ty && ty.t === 'num' && ty.v !== 0) { flush(); curY -= ty.v; }
          if (tx && tx.t === 'num') curX += tx.v;
          break;
        }
        case 'TD': {
          var tdx = pending[pending.length - 2];
          var tdy = pending[pending.length - 1];
          if (tdy && tdy.t === 'num') { leading = -tdy.v; if (tdy.v !== 0) flush(); curY -= tdy.v; }
          if (tdx && tdx.t === 'num') curX += tdx.v;
          break;
        }
        case 'Tm': {
          if (pending.length >= 6) {
            var ta = pending[pending.length - 6];
            var tb = pending[pending.length - 5];
            var tc = pending[pending.length - 4];
            var td = pending[pending.length - 3];
            var e = pending[pending.length - 2];
            var f = pending[pending.length - 1];
            if (ta && ta.t === 'num' && td && td.t === 'num') {
              var tvb = tb && tb.t === 'num' ? tb.v : 0;
              var tvc = tc && tc.t === 'num' ? tc.v : 0;
              var s1 = Math.sqrt(ta.v * ta.v + tvb * tvb);
              var s2 = Math.sqrt(tvc * tvc + td.v * td.v);
              tmScale = Math.max(s1, s2) || 1;
            }
            if (f && f.t === 'num') {
              if (Math.abs(f.v - curY) > 0.5 && buf.trim()) flush();
              curY = f.v;
            }
            if (e && e.t === 'num') {
              var newX = e.v;
              if (buf && !buf.endsWith(' ') && Math.abs((f && f.t === 'num' ? f.v : curY) - curY) <= 0.5) {
                var eff = effectiveSize();
                var gap = newX - curX;
                if (gap > eff * 0.22) {
                  buf += ' ';
                }
              }
              curX = newX;
            }
          }
          break;
        }
        case 'cm': {
          if (pending.length >= 6) {
            var ca = pending[pending.length - 6];
            var cb = pending[pending.length - 5];
            var cc = pending[pending.length - 4];
            var cd = pending[pending.length - 3];
            if (ca && ca.t === 'num' && cd && cd.t === 'num') {
              var cvb = cb && cb.t === 'num' ? cb.v : 0;
              var cvc = cc && cc.t === 'num' ? cc.v : 0;
              var cs1 = Math.sqrt(ca.v * ca.v + cvb * cvb);
              var cs2 = Math.sqrt(cvc * cvc + cd.v * cd.v);
              ctmScale = Math.max(cs1, cs2) || 1;
            }
          }
          break;
        }
        case 'T*':
          flush();
          curY -= leading || fontSize * 1.2;
          break;
        case 'Tj': {
          var t = pending[pending.length - 1];
          if (t && t.t === 'str') show(t.v);
          break;
        }
        case 'TJ': {
          var arr = pending[pending.length - 1];
          if (arr && arr.t === 'arr') {
            arr.v.forEach(function (item) {
              if (item.t === 'str') show(item.v);
              else if (item.t === 'num' && item.v < -120) buf += ' ';
            });
          }
          break;
        }
        case "'": {
          flush();
          curY -= leading || fontSize * 1.2;
          var ts = pending[pending.length - 1];
          if (ts && ts.t === 'str') show(ts.v);
          break;
        }
        case '"': {
          flush();
          curY -= leading || fontSize * 1.2;
          var tss = pending[pending.length - 1];
          if (tss && tss.t === 'str') show(tss.v);
          break;
        }
        default:
          break;
      }
      pending = [];
    }
    flush();
    return lines;
  }

  /* ---------------- post-processing ---------------- */

  function linesToMarkdown(lines) {
    if (!lines.length) return '';
    var freq = {};
    var sizes = [];
    lines.forEach(function (l) {
      var key = Math.round(l.size * 2) / 2;
      freq[key] = (freq[key] || 0) + 1;
      sizes.push(key);
    });
    var bodySize = 12;
    var best = -1;
    Object.keys(freq).forEach(function (k) {
      if (freq[k] > best) { best = freq[k]; bodySize = parseFloat(k); }
    });
    sizes.sort(function (a, b) { return a - b; });
    var median = sizes[Math.floor(sizes.length / 2)] || bodySize;

    var blocks = [];
    var para = '';
    var prev = null;

    /* Learn the dominant line spacing of this page: body text uses it, paragraph
       gaps are larger. This keeps double-spaced PDFs from turning into one
       paragraph per line. */
    var gapFreq = {};
    for (var gi = 1; gi < lines.length; gi++) {
      var g = Math.abs(lines[gi - 1].y - lines[gi].y);
      if (g > 0 && g < median * 4) {
        var gk = Math.round(g * 2) / 2;
        gapFreq[gk] = (gapFreq[gk] || 0) + 1;
      }
    }
    var leading = median * 1.2;
    var bestGap = 0;
    Object.keys(gapFreq).forEach(function (k) {
      if (gapFreq[k] > bestGap) { bestGap = gapFreq[k]; leading = parseFloat(k); }
    });

    function flushPara() {
      if (para.trim()) blocks.push(U.mdParagraph(para));
      para = '';
    }

    lines.forEach(function (line) {
      var text = line.text.replace(/\s+/g, ' ').trim();
      if (!text) return;
      var size = Math.round(line.size * 2) / 2;

      var headingLevel = 0;
      if (/^(table of contents|contents|overview|abstract|executive summary|index)$/i.test(text)) headingLevel = 2;
      else if (size >= median * 1.7 && text.length < 140) headingLevel = 1;
      else if (size >= median * 1.32 && text.length < 160) headingLevel = 2;
      else if (size >= median * 1.12 && text.length < 200 && !/[.;:,]$/.test(text)) headingLevel = 3;

      if (headingLevel) {
        flushPara();
        blocks.push(U.mdHeading(text, headingLevel));
        prev = null;
        return;
      }

      var isToc = /(\.[\s.]*){3,}\s*(\d+|[ivxlcdm]+)\s*$/i.test(text);
      if (isToc) {
        flushPara();
        var clean = text.replace(/\s*(\.[\s.]*){3,}\s*(\d+|[ivxlcdm]+)\s*$/i, ' ... $2');
        var sm = /^(\d+(?:\.\d+)*)\.?\s+(.*)$/.exec(clean);
        if (sm) {
          var sec = sm[1];
          var rest = sm[2];
          var depth = (sec.match(/\./g) || []).length;
          var indent = '  '.repeat(depth);
          blocks.push(indent + '- ' + sec + '. ' + rest);
        } else {
          blocks.push('- ' + clean);
        }
        prev = null;
        return;
      }

      var secNum = /^(\d{1,3}(?:\.\d{1,3})+)\.?\s+(.*)$/.exec(text);
      if (secNum && text.length < 120 && !/[;:,]$/.test(text)) {
        flushPara();
        var secDepth = (secNum[1].match(/\./g) || []).length;
        var lvl = Math.min(6, Math.max(2, secDepth + 1));
        blocks.push(U.mdHeading(text, lvl));
        prev = null;
        return;
      }

      var bullet = /^([\u2022\u25cf\u25aa\u25e6\u00b7\u2013\u2014\-*]|\d{1,3}[.)])\s+/.exec(text);
      if (bullet) {
        flushPara();
        blocks.push(/^\d{1,3}[.)]/.test(text) ? text.replace(/^(\d{1,3})[.)]\s+/, '$1. ') : '- ' + text.replace(/^([\u2022\u25cf\u25aa\u25e6\u00b7\u2013\u2014\-*])\s+/, ''));
        prev = line;
        return;
      }

      if (!para) { para = text; prev = line; return; }

      var gap = Math.abs((prev ? prev.y : line.y) - line.y);
      var endsSentence = /[.!?:;]$/.test(para);
      var startsUpper = /^[A-Z0-9(\u2022\u201c"']/.test(text);

      // Same paragraph when the line follows at (or near) the document's own
      // leading. A sentence end plus a capitalised next line and extra space is
      // a paragraph break; anything wider than ~1.5 leadings is one too.
      var joinable;
      if (gap <= leading * 1.15) joinable = true;
      else if (gap <= leading * 1.6) joinable = !(endsSentence && startsUpper);
      else joinable = false;
      if (joinable && para.length <= 12 && endsSentence) joinable = false;

      if (joinable) para += ' ' + text;
      else { flushPara(); para = text; }
      prev = line;
    });
    flushPara();

    var md = '';
    for (var bi = 0; bi < blocks.length; bi++) {
      var b = blocks[bi];
      if (!md) {
        md = b;
      } else {
        var prevIsList = /^\s*[-*]\s+/.test(blocks[bi - 1]);
        var curIsList = /^\s*[-*]\s+/.test(b);
        if (prevIsList && curIsList) {
          md += '\n' + b;
        } else {
          md += '\n\n' + b;
        }
      }
    }
    // Re-join words broken across lines with a hyphen.
    md = md.replace(/([a-z])-\n([a-z])/g, '$1$2');
    return U.collapseBlankLines(md);
  }

  async function convert(bytes, opts) {
    opts = opts || {};
    var doc = new PdfDoc(bytes);
    doc.scan();
    await doc.expandObjectStreams();

    var encrypted = /\/Encrypt\s/.test(doc.s.slice(-200000)) || /\/Encrypt\s*\d+\s+\d+\s+R/.test(doc.s);
    var pages = doc.pages();
    var warnings = [];
    if (encrypted) warnings.push('This PDF appears to be encrypted; extracted text may be incomplete or missing.');

    var sections = [];
    var textPages = 0;
    var allText = '';
    var maxPages = opts.maxPages || 400;
    var multiPage = pages.length > 1;

    for (var i = 0; i < pages.length && i < maxPages; i++) {
      var lines = [];
      try {
        lines = await extractPageText(doc, pages[i]);
      } catch (e) {
        lines = [];
      }
      var md = linesToMarkdown(lines);
      if (md.trim()) {
        textPages++;
        allText += md + '\n\n';
        sections.push(multiPage ? '### Page ' + (i + 1) + '\n\n' + md : md);
      }
    }

    if (!pages.length) {
      warnings.push('No pages could be located in this PDF. It may be damaged or use an unusual structure.');
    }
    if (pages.length && !textPages) {
      warnings.push('No selectable text was found. This looks like a scanned/image PDF, which needs OCR — the text layer does not exist.');
    }
    if (pages.length > maxPages) warnings.push('Only the first ' + maxPages + ' pages were processed.');
    if (encrypted && !textPages) warnings.push('Encrypted PDFs cannot be read without the password.');

    var markdown = textPages ? U.collapseBlankLines(sections.join('\n\n')) : '_(No extractable text in this PDF. It is most likely a scanned document that requires OCR.)_';

    var docTitle = '';
    var h1 = markdown.match(/^#\s+(.+)$/m);
    if (h1) docTitle = h1[1].trim();

    return {
      kind: 'pdf',
      title: docTitle,
      markdown: markdown,
      meta: { pages: pages.length, pagesWithText: textPages, encrypted: encrypted },
      warnings: warnings
    };
  }

  D2A.converters = D2A.converters || {};
  D2A.converters.pdf = convert;
  D2A.pdf = { PdfDoc: PdfDoc, parseCMap: parseCMap, extractPageText: extractPageText, linesToMarkdown: linesToMarkdown };
})(typeof globalThis !== 'undefined' ? globalThis : this);
