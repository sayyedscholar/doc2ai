/* doc2ai — XLSX / XLSM / XLSB-sheet converter */
(function (g) {
  'use strict';
  var D2A = (g.D2A = g.D2A || {});
  var U = D2A.util;
  var X = D2A.xml;

  function entryText(zip, name) {
    var e = D2A.zip.findEntry(zip, name);
    return e ? e.text() : Promise.resolve(null);
  }

  function colToIndex(ref) {
    var letters = String(ref).replace(/[^A-Z]/gi, '').toUpperCase();
    var n = 0;
    for (var i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
    return n - 1;
  }

  var BUILTIN_DATE_FORMATS = {
    14: 'date', 15: 'date', 16: 'date', 17: 'date', 18: 'time', 19: 'time',
    20: 'time', 21: 'time', 22: 'datetime', 27: 'date', 30: 'date',
    36: 'date', 45: 'time', 46: 'time', 47: 'datetime', 50: 'date',
    57: 'date', 58: 'date', 71: 'date', 72: 'date', 73: 'date',
    74: 'date', 75: 'date', 76: 'date', 77: 'date', 78: 'date',
    79: 'date', 80: 'date', 81: 'date', 82: 'date'
  };

  function buildStyles(xmlText) {
    var formats = {};
    if (!xmlText) return { numFmts: formats, xf: [] };
    var root = X.parse(xmlText);
    if (!root) return { numFmts: formats, xf: [] };
    X.findAll(root, 'numFmt').forEach(function (nf) {
      var id = X.attr(nf, 'numFmtId');
      var code = X.attr(nf, 'formatCode') || '';
      if (id != null) formats[id] = code;
    });
    var xf = [];
    var cellXfs = X.child(root, 'cellXfs');
    if (cellXfs) {
      X.children(cellXfs, 'xf').forEach(function (x) {
        var id = X.attr(x, 'numFmtId');
        var code = formats[id];
        var kind = null;
        if (BUILTIN_DATE_FORMATS[id]) kind = BUILTIN_DATE_FORMATS[id];
        else if (code && /(^|[^\\])[ymdhs]/i.test(code) && !/^[#0.,%\s]+$/.test(code)) {
          var hasDate = /[ymd]/i.test(code);
          var hasTime = /[hs]/i.test(code);
          kind = hasDate && hasTime ? 'datetime' : hasTime ? 'time' : 'date';
        }
        xf.push({ numFmtId: id, kind: kind, code: code || '' });
      });
    }
    return { numFmts: formats, xf: xf };
  }

  function serialToDate(serial, kind, date1904) {
    if (!isFinite(serial)) return null;
    var base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
    var ms = Math.round(serial * 86400000);
    var d = new Date(base + ms);
    if (isNaN(d.getTime())) return null;
    var y = d.getUTCFullYear();
    var mo = d.getUTCMonth() + 1;
    var da = d.getUTCDate();
    var h = d.getUTCHours();
    var mi = d.getUTCMinutes();
    var se = d.getUTCSeconds();
    var p = function (n) { return n < 10 ? '0' + n : '' + n; };
    var datePart = y + '-' + p(mo) + '-' + p(da);
    var timePart = p(h) + ':' + p(mi) + (se ? ':' + p(se) : '');
    if (kind === 'time') return timePart;
    if (kind === 'datetime') return datePart + ' ' + timePart;
    return datePart;
  }

  function sharedString(si) {
    // Rich text: concatenate every <t>, skipping phonetic runs (rPh).
    var out = '';
    X.children(si).forEach(function (c) {
      if (c.local === 't') out += X.textOf(c);
      else if (c.local === 'r') {
        X.children(c, 't').forEach(function (t) { out += X.textOf(t); });
      }
    });
    return out;
  }

  function readSheet(xmlText, shared, styles, date1904, limits) {
    var root = X.parse(xmlText);
    if (!root) return { rows: [], truncated: false, maxRow: 0, maxCol: 0 };
    var sheetData = X.child(root, 'sheetData');
    if (!sheetData) return { rows: [], truncated: false, maxRow: 0, maxCol: 0 };

    var rows = [];
    var truncated = false;
    var maxCol = 0;
    var rowCount = 0;

    var rowNodes = X.children(sheetData, 'row');
    for (var r = 0; r < rowNodes.length; r++) {
      var rowNode = rowNodes[r];
      if (rowCount >= limits.maxRows) { truncated = true; break; }
      var cells = [];
      var cellNodes = X.children(rowNode, 'c');
      for (var c = 0; c < cellNodes.length; c++) {
        var cell = cellNodes[c];
        var ref = X.attr(cell, 'r');
        var idx = ref ? colToIndex(ref) : cells.length;
        if (idx >= limits.maxCols) { truncated = true; continue; }
        var type = X.attr(cell, 't') || 'n';
        var styleIdx = parseInt(X.attr(cell, 's') || '0', 10);
        var vNode = X.child(cell, 'v');
        var fNode = X.child(cell, 'f');
        var raw = vNode ? X.textOf(vNode) : '';
        var value = '';

        if (type === 's') {
          var si = shared[parseInt(raw, 10)];
          value = si === undefined ? '' : si;
        } else if (type === 'inlineStr') {
          var isNode = X.child(cell, 'is');
          value = isNode ? sharedString(isNode) : '';
        } else if (type === 'str') {
          value = raw;
        } else if (type === 'b') {
          value = raw === '1' ? 'TRUE' : 'FALSE';
        } else if (type === 'e') {
          value = raw || '#ERROR';
        } else {
          if (raw === '') {
            value = '';
          } else {
            var num = parseFloat(raw);
            if (!isFinite(num)) {
              value = raw;
            } else {
              var kind = styles.xf[styleIdx] ? styles.xf[styleIdx].kind : null;
              if (kind) {
                var d = serialToDate(num, kind, date1904);
                value = d === null ? raw : d;
              } else {
                value = String(num);
              }
            }
          }
        }

        if (fNode && !value) {
          value = '=' + (X.textOf(fNode) || '').trim();
        }
        while (cells.length < idx) cells.push('');
        cells[idx] = value;
      }
      // Trim trailing empty cells.
      while (cells.length && String(cells[cells.length - 1]).trim() === '') cells.pop();
      rows.push(cells);
      maxCol = Math.max(maxCol, cells.length);
      rowCount++;
    }

    // Drop trailing empty rows.
    while (rows.length && rows[rows.length - 1].join('').trim() === '') rows.pop();
    return { rows: rows, truncated: truncated, maxRow: rows.length, maxCol: maxCol };
  }

  async function convert(bytes, opts) {
    opts = opts || {};
    var zip = await D2A.zip.readZip(bytes);

    var wbXml = await entryText(zip, 'xl/workbook.xml');
    if (!wbXml) throw new Error('This file is not a valid .xlsx (xl/workbook.xml is missing).');
    var wbRoot = X.parse(wbXml);
    if (!wbRoot) throw new Error('Could not parse the XLSX workbook.');

    var date1904 = false;
    var wbPr = X.child(wbRoot, 'workbookPr');
    if (wbPr && /^(1|true)$/i.test(X.attr(wbPr, 'date1904') || '')) date1904 = true;

    var relsXml = await entryText(zip, 'xl/_rels/workbook.xml.rels');
    var rels = {};
    if (relsXml) {
      var relRoot = X.parse(relsXml);
      X.findAll(relRoot, 'Relationship').forEach(function (rel) {
        var id = X.attr(rel, 'Id');
        var target = X.attr(rel, 'Target') || '';
        if (target.charAt(0) !== '/') target = 'xl/' + target.replace(/^\.\//, '');
        else target = target.slice(1);
        rels[id] = target;
      });
    }

    var sheetsXml = X.child(wbRoot, 'sheets');
    var sheetDefs = [];
    if (sheetsXml) {
      X.children(sheetsXml, 'sheet').forEach(function (sh) {
        sheetDefs.push({
          name: X.attr(sh, 'name') || 'Sheet',
          rid: X.attr(sh, 'id') || '',
          sheetId: X.attr(sh, 'sheetId') || ''
        });
      });
    }

    var shared = [];
    var ssXml = await entryText(zip, 'xl/sharedStrings.xml');
    if (ssXml) {
      var ssRoot = X.parse(ssXml);
      if (ssRoot) X.children(ssRoot, 'si').forEach(function (si) { shared.push(sharedString(si)); });
    }

    var styles = buildStyles(await entryText(zip, 'xl/styles.xml'));
    var limits = { maxRows: opts.maxRows || 3000, maxCols: opts.maxCols || 80 };

    var sections = [];
    var meta = { sheets: [], rows: 0, truncated: false };
    var warnings = [];

    for (var i = 0; i < sheetDefs.length; i++) {
      var def = sheetDefs[i];
      var path = rels[def.rid] || 'xl/worksheets/sheet' + (i + 1) + '.xml';
      var sheetXml = await entryText(zip, path);
      var sheetName = def.name || 'Sheet ' + (i + 1);
      if (!sheetXml) {
        sections.push('## Sheet: ' + sheetName + '\n\n_(sheet data unavailable)_');
        meta.sheets.push({ name: sheetName, rows: 0 });
        continue;
      }
      var data = readSheet(sheetXml, shared, styles, date1904, limits);
      meta.rows += data.maxRow;
      if (data.truncated) meta.truncated = true;
      meta.sheets.push({ name: sheetName, rows: data.maxRow, columns: data.maxCol });

      var block = '## Sheet: ' + sheetName;
      if (!data.rows.length) {
        block += '\n\n_(empty sheet)_';
      } else {
        block += '\n\n' + U.mdTable(data.rows);
        if (data.truncated) {
          block += '\n\n> _Truncated: only the first ' + limits.maxRows + ' rows / ' + limits.maxCols + ' columns were included._';
        }
      }
      sections.push(block);
    }

    if (meta.truncated) warnings.push('Large spreadsheet: some rows/columns were truncated to keep the output AI-friendly.');
    if (!sheetDefs.length) warnings.push('No worksheets were found in this workbook.');

    var title = '';
    var coreXml = await entryText(zip, 'docProps/core.xml');
    if (coreXml) {
      var cRoot = X.parse(coreXml);
      if (cRoot) {
        var t = X.child(cRoot, 'title');
        if (t && X.textOf(t).trim()) title = X.textOf(t).trim();
        var creator = X.child(cRoot, 'creator');
        if (creator && X.textOf(creator).trim()) meta.author = X.textOf(creator).trim();
      }
    }

    return {
      kind: 'xlsx',
      title: title,
      markdown: U.collapseBlankLines(sections.join('\n\n')),
      meta: meta,
      warnings: warnings
    };
  }

  D2A.converters = D2A.converters || {};
  D2A.converters.xlsx = convert;
})(typeof globalThis !== 'undefined' ? globalThis : this);
