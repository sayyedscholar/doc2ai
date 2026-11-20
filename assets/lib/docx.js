/* doc2ai — DOCX / DOTX converter (wordprocessingml) */
(function (g) {
  'use strict';
  var D2A = (g.D2A = g.D2A || {});
  var U = D2A.util;
  var X = D2A.xml;

  function entryText(zip, name) {
    var e = D2A.zip.findEntry(zip, name);
    return e ? e.text() : Promise.resolve(null);
  }

  function buildNumbering(xmlText) {
    var map = {};
    if (!xmlText) return map;
    var root = X.parse(xmlText);
    if (!root) return map;
    var abstractMap = {};
    X.findAll(root, 'abstractNum').forEach(function (an) {
      var id = X.attr(an, 'abstractNumId');
      var levels = {};
      X.findAll(an, 'lvl').forEach(function (lvl) {
        var ilvl = parseInt(X.attr(lvl, 'ilvl') || '0', 10);
        var fmtNode = X.child(lvl, 'numFmt');
        var startNode = X.child(lvl, 'start');
        var textNode = X.child(lvl, 'lvlText');
        levels[ilvl] = {
          fmt: fmtNode ? X.attr(fmtNode, 'val') : 'decimal',
          start: startNode ? parseInt(X.attr(startNode, 'val') || '1', 10) : 1,
          text: textNode ? X.attr(textNode, 'val') : ''
        };
      });
      abstractMap[id] = levels;
    });
    X.findAll(root, 'num').forEach(function (num) {
      var numId = X.attr(num, 'numId');
      var abs = X.child(num, 'abstractNumId');
      var absId = abs ? X.attr(abs, 'val') : null;
      if (absId != null && abstractMap[absId]) map[numId] = abstractMap[absId];
    });
    return map;
  }

  function buildStyles(xmlText) {
    var map = {};
    if (!xmlText) return map;
    var root = X.parse(xmlText);
    if (!root) return map;
    X.findAll(root, 'style').forEach(function (st) {
      var id = X.attr(st, 'styleId');
      if (!id) return;
      var nameNode = X.child(st, 'name');
      var name = nameNode ? X.attr(nameNode, 'val') : '';
      var pPr = X.child(st, 'pPr');
      var outline = pPr ? X.child(pPr, 'outlineLvl') : null;
      map[id] = {
        name: name || '',
        outline: outline ? parseInt(X.attr(outline, 'val') || '0', 10) : null
      };
    });
    return map;
  }

  function headingLevel(styleId, styles) {
    if (!styleId) return 0;
    var probe = styleId + ' ' + (styles[styleId] ? styles[styleId].name : '');
    var m = probe.match(/(?:heading|titre|überschrift|kop|titolo|encabezado)\s*([1-6])\b/i);
    if (m) return parseInt(m[1], 10);
    if (/\btitle\b/i.test(probe)) return 1;
    if (/\bsubtitle\b/i.test(probe)) return 2;
    if (styles[styleId] && styles[styleId].outline != null && styles[styleId].outline < 6) {
      return styles[styleId].outline + 1;
    }
    return 0;
  }

  /* Collect run content from a paragraph-ish node, in document order. */
  function collectRuns(node, out, state) {
    out = out || [];
    state = state || { bold: 0, italic: 0 };
    for (var i = 0; i < node.children.length; i++) {
      var c = node.children[i];
      if (c.name === '#text' || c.name === '#cdata') continue;
      var local = c.local;

      if (local === 'r') {
        var rPr = X.child(c, 'rPr');
        var bold = rPr && (X.child(rPr, 'b') || X.child(rPr, 'bCs'));
        var italic = rPr && (X.child(rPr, 'i') || X.child(rPr, 'iCs'));
        var boldOn = bold ? X.attr(bold, 'val') !== '0' && X.attr(bold, 'val') !== 'false' : false;
        var italicOn = italic ? X.attr(italic, 'val') !== '0' && X.attr(italic, 'val') !== 'false' : false;
        for (var j = 0; j < c.children.length; j++) {
          var rc = c.children[j];
          if (rc.name === '#text' || rc.name === '#cdata') continue;
          var rl = rc.local;
          if (rl === 't') out.push({ text: rc.children.map(function (x) { return x.text || ''; }).join(''), bold: boldOn, italic: italicOn });
          else if (rl === 'tab') out.push({ text: '\t', bold: false, italic: false });
          else if (rl === 'br' || rl === 'cr') out.push({ text: '\n', bold: false, italic: false });
          else if (rl === 'noBreakHyphen') out.push({ text: '-', bold: false, italic: false });
          else if (rl === 'softHyphen') out.push({ text: '', bold: false, italic: false });
          else if (rl === 'drawing' || rl === 'pict' || rl === 'object') out.push({ text: '', image: true, bold: false, italic: false });
          else if (rl === 'footnoteReference' || rl === 'endnoteReference') out.push({ text: '[^' + (X.attr(rc, 'id') || '') + ']', bold: false, italic: false });
        }
      } else if (local === 'hyperlink' || local === 'ins' || local === 'smartTag' || local === 'sdt' || local === 'sdtContent' || local === 'fldSimple' || local === 'customXml') {
        collectRuns(c, out, state);
      }
    }
    return out;
  }

  function runsToText(runs) {
    var s = '';
    runs.forEach(function (r) {
      if (r.image) { s += ' [image] '; return; }
      s += r.text;
    });
    return s;
  }

  function runsToMarkdown(runs) {
    var parts = [];
    runs.forEach(function (r) {
      if (r.image) { parts.push('[image]'); return; }
      if (!r.text) return;
      if (r.text === '\n') { parts.push('\n'); return; }
      var t = r.text;
      if (!t.trim()) { parts.push(t); return; }
      if (r.bold && r.italic) t = '***' + t + '***';
      else if (r.bold) t = '**' + t + '**';
      else if (r.italic) t = '*' + t + '*';
      parts.push(t);
    });
    var out = parts.join('');
    // Tidy up empty emphasis markers and doubled spaces.
    return out.replace(/\*\*\*\*\*\*/g, '').replace(/\*\*\*\*/g, '').replace(/[ \t]{2,}/g, ' ');
  }

  function paraInfo(p, styles) {
    var pPr = X.child(p, 'pPr');
    var styleNode = pPr ? X.child(pPr, 'pStyle') : null;
    var styleId = styleNode ? X.attr(styleNode, 'val') : '';
    var numPr = pPr ? X.child(pPr, 'numPr') : null;
    var numId = null;
    var ilvl = 0;
    if (numPr) {
      var numIdNode = X.child(numPr, 'numId');
      var ilvlNode = X.child(numPr, 'ilvl');
      numId = numIdNode ? X.attr(numIdNode, 'val') : null;
      ilvl = ilvlNode ? parseInt(X.attr(ilvlNode, 'val') || '0', 10) : 0;
      if (numId === '0') numId = null;
    }
    var jc = pPr ? X.child(pPr, 'jc') : null;
    return {
      styleId: styleId,
      level: headingLevel(styleId, styles),
      numId: numId,
      ilvl: ilvl,
      align: jc ? X.attr(jc, 'val') : ''
    };
  }

  function tableToRows(tbl) {
    var rows = [];
    X.children(tbl, 'tr').forEach(function (tr) {
      var cells = [];
      X.children(tr, 'tc').forEach(function (tc) {
        var paras = [];
        X.children(tc, 'p').forEach(function (p) {
          var txt = runsToText(collectRuns(p)).replace(/\s+/g, ' ').trim();
          if (txt) paras.push(txt);
        });
        var tcPr = X.child(tc, 'tcPr');
        var span = tcPr ? X.child(tcPr, 'gridSpan') : null;
        var spanN = span ? parseInt(X.attr(span, 'val') || '1', 10) : 1;
        cells.push(paras.join(' '));
        for (var s = 1; s < spanN; s++) cells.push('');
      });
      rows.push(cells);
    });
    return rows;
  }

  async function convert(bytes, opts) {
    opts = opts || {};
    var zip = await D2A.zip.readZip(bytes);
    var mainEntry = D2A.zip.findEntry(zip, 'word/document.xml');
    if (!mainEntry) {
      // Some templates store the body elsewhere.
      var alt = zip.entries.filter(function (e) { return /word\/document\d*\.xml$/i.test(e.name); })[0];
      mainEntry = alt || null;
    }
    if (!mainEntry) throw new Error('This file is not a valid .docx (word/document.xml is missing).');

    var docXml = await mainEntry.text();
    var root = X.parse(docXml);
    if (!root) throw new Error('Could not parse the DOCX document body.');

    var styles = buildStyles(await entryText(zip, 'word/styles.xml'));
    var numbering = buildNumbering(await entryText(zip, 'word/numbering.xml'));

    var body = X.child(root, 'body') || root;
    var blocks = [];
    var listBuffer = null;
    var stats = { paragraphs: 0, headings: 0, tables: 0, lists: 0, images: 0 };
    var counters = {};

    function flushList() {
      if (listBuffer && listBuffer.length) blocks.push(listBuffer.join('\n'));
      listBuffer = null;
    }
    function pushBlock(md) {
      flushList();
      blocks.push(md);
    }

    function emitBlock(node) {
      var local = node.local;
      if (local === 'p') {
        var info = paraInfo(node, styles);
        var runs = collectRuns(node);
        var hasImage = runs.some(function (r) { return r.image; });
        if (hasImage) stats.images++;
        var plain = runsToText(runs).replace(/\s+$/, '');
        if (!plain.trim() && !hasImage) return;
        stats.paragraphs++;

        if (info.level > 0) {
          stats.headings++;
          pushBlock(U.mdHeading(plain.trim(), info.level));
          return;
        }
        if (info.numId) {
          stats.lists++;
          var levels = numbering[info.numId] || {};
          var lvl = levels[info.ilvl] || { fmt: 'bullet', start: 1 };
          var key = info.numId + ':' + info.ilvl;
          var ordered = lvl.fmt && lvl.fmt !== 'bullet' && lvl.fmt !== 'none';
          var indent = new Array(info.ilvl + 1).join('  ');
          var marker;
          if (ordered) {
            counters[key] = (counters[key] || (lvl.start || 1) - 1) + 1;
            marker = counters[key] + '. ';
          } else {
            marker = '- ';
          }
          if (!listBuffer) listBuffer = [];
          listBuffer.push(indent + marker + runsToMarkdown(runs).trim());
          return;
        }
        pushBlock(runsToMarkdown(runs).trim());
        return;
      }
      if (local === 'tbl') {
        stats.tables++;
        var rows = tableToRows(node);
        if (rows.length) pushBlock(U.mdTable(rows));
        return;
      }
      if (local === 'sdt' || local === 'sdtContent' || local === 'customXml' || local === 'ins') {
        X.children(node).forEach(emitBlock);
      }
    }

    X.children(body).forEach(emitBlock);
    flushList();

    /* footnotes */
    var notesXml = await entryText(zip, 'word/footnotes.xml');
    var notes = [];
    if (notesXml) {
      var nRoot = X.parse(notesXml);
      if (nRoot) {
        X.findAll(nRoot, 'footnote').forEach(function (fn) {
          var id = X.attr(fn, 'id');
          if (id === '-1' || id === '0') return;
          var txt = X.children(fn, 'p').map(function (p) {
            return runsToText(collectRuns(p)).trim();
          }).filter(Boolean).join(' ');
          if (txt) notes.push('[^' + id + ']: ' + txt);
        });
      }
    }
    if (notes.length) blocks.push('## Footnotes', notes.join('\n\n'));

    /* metadata */
    var meta = { paragraphs: stats.paragraphs, headings: stats.headings, tables: stats.tables, listItems: stats.lists, images: stats.images };
    var title = '';
    var coreXml = await entryText(zip, 'docProps/core.xml');
    if (coreXml) {
      var cRoot = X.parse(coreXml);
      if (cRoot) {
        var t = X.child(cRoot, 'title');
        if (t && X.textOf(t).trim()) title = X.textOf(t).trim();
        var creator = X.child(cRoot, 'creator');
        var created = X.child(cRoot, 'created');
        if (creator && X.textOf(creator).trim()) meta.author = X.textOf(creator).trim();
        if (created && X.textOf(created).trim()) meta.created = X.textOf(created).trim();
      }
    }
    if (!title) {
      // Fall back to the first heading in the document.
      for (var i = 0; i < blocks.length; i++) {
        var m = blocks[i].match(/^#{1,3} (.+)$/);
        if (m) { title = m[1]; break; }
      }
    }

    var media = zip.entries.filter(function (e) { return /^word\/media\//i.test(e.name) && !e.dir; });
    if (media.length) {
      meta.media = media.map(function (e) { return U.baseName(e.name) + ' (' + U.humanBytes(e.size) + ')'; });
    }

    var warnings = [];
    if (stats.images) warnings.push(stats.images + ' embedded image(s) are not transcribed; only their position is marked with [image].');

    return {
      kind: 'docx',
      title: title,
      markdown: U.collapseBlankLines(blocks.join('\n\n')),
      meta: meta,
      warnings: warnings
    };
  }

  D2A.converters = D2A.converters || {};
  D2A.converters.docx = convert;
})(typeof globalThis !== 'undefined' ? globalThis : this);
