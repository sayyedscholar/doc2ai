/* doc2ai — OpenDocument (ODT/ODS/ODP) converter */
(function (g) {
  'use strict';
  var D2A = (g.D2A = g.D2A || {});
  var U = D2A.util;
  var X = D2A.xml;

  function entryText(zip, name) {
    var e = D2A.zip.findEntry(zip, name);
    return e ? e.text() : Promise.resolve(null);
  }

  function paraText(node) {
    var out = '';
    (function walk(n) {
      for (var i = 0; i < n.children.length; i++) {
        var c = n.children[i];
        if (c.name === '#text') { out += c.text; continue; }
        if (c.local === 'p' || c.local === 'h') continue;
        if (c.local === 's') {
          out += new Array((parseInt(X.attr(c, 'c') || '1', 10) || 1) + 1).join(' ');
        } else if (c.local === 'tab') {
          out += ' ';
        } else if (c.local === 'line-break') {
          out += '\n';
        } else {
          walk(c);
        }
      }
    })(node);
    return out.replace(/[ \t\u00a0]+/g, ' ').replace(/ *\n */g, '\n').trim();
  }

  function listToLines(listNode, out, depth) {
    depth = depth || 0;
    X.children(listNode).forEach(function (item) {
      if (item.local !== 'list-item') return;
      var head = '';
      var sublists = [];
      X.children(item).forEach(function (child) {
        if (child.local === 'p' || child.local === 'h') {
          var t = paraText(child);
          if (t && !head) head = t;
          else if (t) out.push(new Array(depth + 1).join('  ') + '- ' + t);
        } else if (child.local === 'list') {
          sublists.push(child);
        }
      });
      if (head) out.push(new Array(depth + 1).join('  ') + '- ' + head);
      sublists.forEach(function (s) { listToLines(s, out, depth + 1); });
    });
  }

  function tableRows(tbl) {
    var rows = [];
    X.children(tbl, 'table-row').forEach(function (row) {
      var cells = [];
      X.children(row).forEach(function (cell) {
        if (cell.local !== 'table-cell' && cell.local !== 'covered-table-cell') return;
        var parts = [];
        X.children(cell).forEach(function (c) {
          if (c.local === 'p' || c.local === 'h') {
            var t = paraText(c);
            if (t) parts.push(t);
          }
        });
        var span = parseInt(X.attr(cell, 'number-columns-spanned') || '1', 10);
        cells.push(parts.join(' '));
        for (var i = 1; i < span; i++) cells.push('');
      });
      rows.push(cells);
    });
    return rows;
  }

  function textBodyBlocks(root, out) {
    X.children(root).forEach(function (node) {
      var local = node.local;
      if (local === 'h') {
        var lvl = parseInt(X.attr(node, 'outline-level') || '1', 10);
        var t = paraText(node);
        if (t) out.push(U.mdHeading(t, lvl));
      } else if (local === 'p') {
        var txt = paraText(node);
        if (txt) out.push(U.mdParagraph(txt));
      } else if (local === 'list') {
        var lines = [];
        listToLines(node, lines, 0);
        if (lines.length) out.push(lines.join('\n'));
      } else if (local === 'table') {
        var rows = tableRows(node);
        if (rows.length) out.push(U.mdTable(rows));
      } else if (local === 'section' || local === 'text-body' || local === 'index-body') {
        textBodyBlocks(node, out);
      }
    });
  }

  async function convert(bytes, opts) {
    opts = opts || {};
    var zip = await D2A.zip.readZip(bytes);
    var content = await entryText(zip, 'content.xml');
    if (!content) throw new Error('This is not a valid OpenDocument file (content.xml is missing).');
    var root = X.parse(content);
    if (!root) throw new Error('Could not parse the OpenDocument content.');

    var meta = {};
    var metaXml = await entryText(zip, 'meta.xml');
    var title = '';
    if (metaXml) {
      var mRoot = X.parse(metaXml);
      if (mRoot) {
        var t = X.child(mRoot, 'title');
        if (t && X.textOf(t).trim()) title = X.textOf(t).trim();
        var creator = X.child(mRoot, 'creator');
        if (creator && X.textOf(creator).trim()) meta.author = X.textOf(creator).trim();
      }
    }

    var warnings = [];
    var blocks = [];

    var body = X.child(root, 'body');
    var text = body ? X.child(body, 'text') : null;
    var spreadsheet = body ? X.child(body, 'spreadsheet') : null;
    var presentation = body ? X.child(body, 'presentation') : null;

    if (spreadsheet) {
      var sheets = X.children(spreadsheet, 'table');
      meta.sheets = [];
      sheets.forEach(function (sh, idx) {
        var name = X.attr(sh, 'name') || 'Sheet ' + (idx + 1);
        var rows = tableRows(sh);
        var block = '## Sheet: ' + name;
        block += rows.length ? '\n\n' + U.mdTable(rows) : '\n\n_(empty sheet)_';
        blocks.push(block);
        meta.sheets.push({ name: name, rows: rows.length });
      });
    } else if (presentation) {
      var pages = X.children(presentation, 'page');
      meta.slides = pages.length;
      pages.forEach(function (pg, idx) {
        var name = X.attr(pg, 'name') || '';
        var lines = [];
        X.children(pg).forEach(function (c) {
          if (c.local === 'frame') {
            X.children(c).forEach(function (inner) {
              if (inner.local === 'text-box') {
                X.children(inner).forEach(function (p) {
                  if (p.local === 'p' || p.local === 'h') {
                    var t = paraText(p);
                    if (t) lines.push(t);
                  }
                });
              }
            });
          }
        });
        var block = '## Slide ' + (idx + 1) + (name ? ' — ' + U.mdInline(name) : '');
        block += lines.length ? '\n\n' + lines.map(function (l) { return '- ' + l; }).join('\n') : '\n\n_(no text)_';
        blocks.push(block);
      });
    } else if (text) {
      textBodyBlocks(text, blocks);
    } else {
      warnings.push('No readable body was found in this OpenDocument file.');
    }

    return {
      kind: 'odf',
      title: title,
      markdown: U.collapseBlankLines(blocks.join('\n\n')),
      meta: meta,
      warnings: warnings
    };
  }

  D2A.converters = D2A.converters || {};
  D2A.converters.odf = convert;
})(typeof globalThis !== 'undefined' ? globalThis : this);
