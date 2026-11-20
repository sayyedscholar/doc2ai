/* doc2ai — tiny namespace-aware XML parser (no DOM dependency, works in Node too) */
(function (g) {
  'use strict';
  var D2A = (g.D2A = g.D2A || {});

  var NAMED = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
    mdash: '\u2014', ndash: '\u2013', hellip: '\u2026', bull: '\u2022',
    rsquo: '\u2019', lsquo: '\u2018', ldquo: '\u201c', rdquo: '\u201d',
    copy: '\u00a9', reg: '\u00ae', trade: '\u2122', deg: '\u00b0',
    plusmn: '\u00b1', frac12: '\u00bd', frac14: '\u00bc', frac34: '\u00be',
    times: '\u00d7', divide: '\u00f7', laquo: '\u00ab', raquo: '\u00bb',
    sect: '\u00a7', para: '\u00b6', middot: '\u00b7', euro: '\u20ac',
    pound: '\u00a3', yen: '\u00a5', cent: '\u00a2', micro: '\u00b5',
    sup2: '\u00b2', sup3: '\u00b3', ensp: '\u2002', emsp: '\u2003',
    thinsp: '\u2009', zwnj: '\u200c', zwj: '\u200d', shy: '\u00ad',
    dagger: '\u2020', Dagger: '\u2021', permil: '\u2030', prime: '\u2032',
    Prime: '\u2033', lsaquo: '\u2039', rsaquo: '\u203a', oline: '\u203e',
    frasl: '\u2044', ne: '\u2260', le: '\u2264', ge: '\u2265',
    infin: '\u221e', minus: '\u2212', radic: '\u221a', asymp: '\u2248',
    equiv: '\u2261', sum: '\u2211', prod: '\u220f', int: '\u222b',
    part: '\u2202', nabla: '\u2207', isin: '\u2208', notin: '\u2209',
    cap: '\u2229', cup: '\u222a', and: '\u2227', or: '\u2228',
    rarr: '\u2192', larr: '\u2190', uarr: '\u2191', darr: '\u2193',
    harr: '\u2194', rArr: '\u21d2', lArr: '\u21d0', hArr: '\u21d4',
    spades: '\u2660', clubs: '\u2663', hearts: '\u2665', diams: '\u2666'
  };

  function decodeEntities(s) {
    if (!s || s.indexOf('&') < 0) return s || '';
    return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g, function (m, ent) {
      if (ent.charAt(0) === '#') {
        var code = ent.charAt(1) === 'x' || ent.charAt(1) === 'X'
          ? parseInt(ent.slice(2), 16)
          : parseInt(ent.slice(1), 10);
        if (!isFinite(code) || code < 0 || code > 0x10ffff) return m;
        try { return String.fromCodePoint(code); } catch (e) { return m; }
      }
      return Object.prototype.hasOwnProperty.call(NAMED, ent) ? NAMED[ent] : m;
    });
  }

  function elem(name, attrs) {
    return { name: name, attrs: attrs || {}, children: [], parent: null, local: localName(name) };
  }

  function localName(name) {
    var i = name.indexOf(':');
    return i < 0 ? name : name.slice(i + 1);
  }

  function parseAttrs(src) {
    var attrs = {};
    var re = /([^\s=/]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
    var m;
    while ((m = re.exec(src))) {
      attrs[m[1]] = decodeEntities(m[3] !== undefined ? m[3] : m[4]);
    }
    return attrs;
  }

  /** Parse an XML string into a lightweight tree. Returns the root element. */
  function parseXml(src) {
    var s = String(src);
    var i = 0;
    var n = s.length;
    var root = null;
    var stack = [];

    while (i < n) {
      var lt = s.indexOf('<', i);
      if (lt < 0) {
        addText(s.slice(i));
        break;
      }
      if (lt > i) addText(s.slice(i, lt));

      if (s.startsWith('<!--', lt)) {
        var cEnd = s.indexOf('-->', lt + 4);
        i = cEnd < 0 ? n : cEnd + 3;
        continue;
      }
      if (s.startsWith('<![CDATA[', lt)) {
        var dEnd = s.indexOf(']]>', lt + 9);
        var cdata = s.slice(lt + 9, dEnd < 0 ? n : dEnd);
        if (stack.length) {
          var tnode = { name: '#cdata', attrs: {}, children: [], parent: stack[stack.length - 1], local: '#cdata', text: cdata };
          stack[stack.length - 1].children.push(tnode);
        }
        i = dEnd < 0 ? n : dEnd + 3;
        continue;
      }
      if (s.startsWith('<?', lt)) {
        var pEnd = s.indexOf('?>', lt + 2);
        i = pEnd < 0 ? n : pEnd + 2;
        continue;
      }
      if (s.startsWith('<!', lt)) {
        var bEnd = s.indexOf('>', lt + 2);
        i = bEnd < 0 ? n : bEnd + 1;
        continue;
      }

      var gt = findTagEnd(s, lt);
      if (gt < 0) { i = n; break; }
      var tag = s.slice(lt + 1, gt);
      i = gt + 1;

      if (tag.charAt(0) === '/') {
        var closeName = tag.slice(1).trim();
        // pop until matching name (tolerates minor malformation)
        for (var k = stack.length - 1; k >= 0; k--) {
          if (stack[k].name === closeName) {
            stack.length = k;
            break;
          }
        }
        continue;
      }

      var selfClose = tag.charAt(tag.length - 1) === '/';
      if (selfClose) tag = tag.slice(0, -1);
      var sp = tag.search(/[\s]/);
      var name = sp < 0 ? tag : tag.slice(0, sp);
      if (!name) continue;
      var node = elem(name, sp < 0 ? {} : parseAttrs(tag.slice(sp)));
      if (stack.length) {
        node.parent = stack[stack.length - 1];
        stack[stack.length - 1].children.push(node);
      } else if (!root) {
        root = node;
      }
      if (!selfClose) stack.push(node);
    }

    function addText(txt) {
      if (!stack.length) return;
      var t = decodeEntities(txt);
      if (!t) return;
      var p = stack[stack.length - 1];
      p.children.push({ name: '#text', attrs: {}, children: [], parent: p, local: '#text', text: t });
    }

    return root;
  }

  /* Find the '>' that closes a tag, honouring quoted attribute values. */
  function findTagEnd(s, from) {
    var quote = 0;
    for (var j = from + 1; j < s.length; j++) {
      var ch = s.charCodeAt(j);
      if (quote) {
        if (ch === quote) quote = 0;
      } else if (ch === 34 || ch === 39) {
        quote = ch;
      } else if (ch === 62) {
        return j;
      }
    }
    return -1;
  }

  /* ---------- helpers ---------- */

  function attr(node, name) {
    if (!node || !node.attrs) return undefined;
    if (Object.prototype.hasOwnProperty.call(node.attrs, name)) return node.attrs[name];
    // match by local name (namespace agnostic)
    var keys = Object.keys(node.attrs);
    for (var i = 0; i < keys.length; i++) {
      if (localName(keys[i]) === name) return node.attrs[keys[i]];
    }
    return undefined;
  }

  function child(node, name) {
    if (!node) return null;
    for (var i = 0; i < node.children.length; i++) {
      var c = node.children[i];
      if (c.name === name || c.local === name) return c;
    }
    return null;
  }

  function children(node, name) {
    var out = [];
    if (!node) return out;
    for (var i = 0; i < node.children.length; i++) {
      var c = node.children[i];
      if (!name || c.name === name || c.local === name) out.push(c);
    }
    return out;
  }

  function findAll(node, name, out) {
    out = out || [];
    if (!node) return out;
    if (node.name === name || node.local === name) out.push(node);
    for (var i = 0; i < node.children.length; i++) findAll(node.children[i], name, out);
    return out;
  }

  function textOf(node) {
    if (!node) return '';
    if (node.text !== undefined && node.name === '#text') return node.text;
    var out = '';
    for (var i = 0; i < node.children.length; i++) {
      var c = node.children[i];
      if (c.name === '#text' || c.name === '#cdata') out += c.text;
      else out += textOf(c);
    }
    return out;
  }

  /* Walk elements in document order. */
  function walk(node, fn) {
    if (!node) return;
    fn(node);
    for (var i = 0; i < node.children.length; i++) walk(node.children[i], fn);
  }

  D2A.xml = {
    parse: parseXml,
    decodeEntities: decodeEntities,
    localName: localName,
    attr: attr,
    child: child,
    children: children,
    findAll: findAll,
    textOf: textOf,
    walk: walk
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
