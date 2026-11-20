/* doc2ai — PPTX converter */
(function (g) {
  'use strict';
  var D2A = (g.D2A = g.D2A || {});
  var U = D2A.util;
  var X = D2A.xml;

  function entryText(zip, name) {
    var e = D2A.zip.findEntry(zip, name);
    return e ? e.text() : Promise.resolve(null);
  }

  function paraText(p) {
    var out = '';
    X.walk(p, function (node) {
      if (node.local === 't') out += X.textOf(node);
      else if (node.local === 'br') out += '\n';
    });
    return out;
  }

  function paragraphsOf(txBody) {
    var out = [];
    X.children(txBody, 'p').forEach(function (p) {
      var txt = paraText(p).replace(/\s+$/g, '');
      if (!txt.trim()) return;
      var pPr = X.child(p, 'pPr');
      var lvl = pPr ? parseInt(X.attr(pPr, 'lvl') || '0', 10) : 0;
      var bullet = true;
      if (pPr) {
        var buNone = X.child(pPr, 'buNone');
        if (buNone) bullet = false;
      }
      out.push({ text: txt, level: lvl, bullet: bullet });
    });
    return out;
  }

  function tableRows(tbl) {
    var rows = [];
    X.children(tbl, 'tr').forEach(function (tr) {
      var cells = [];
      X.children(tr, 'tc').forEach(function (tc) {
        var txBody = X.child(tc, 'txBody');
        var txt = txBody ? paragraphsOf(txBody).map(function (p) { return p.text; }).join(' ') : '';
        cells.push(txt.replace(/\s+/g, ' ').trim());
      });
      rows.push(cells);
    });
    return rows;
  }

  function resolvePath(base, rel) {
    if (!rel) return '';
    if (rel.charAt(0) === '/') return rel.slice(1);
    var parts = base ? base.split('/').filter(Boolean) : [];
    parts.pop();
    rel.split('/').forEach(function (seg) {
      if (seg === '..') parts.pop();
      else if (seg !== '.' && seg !== '') parts.push(seg);
    });
    return parts.join('/');
  }

  function shapeBlocks(node, out, ctx) {
    if (!node) return;
    var local = node.local;

    if (local === 'sp') {
      var nv = X.child(node, 'nvSpPr');
      var nvPr = nv ? X.child(nv, 'nvPr') : null;
      var ph = nvPr ? X.child(nvPr, 'ph') : null;
      var phType = ph ? X.attr(ph, 'type') || 'body' : '';
      var txBody = X.child(node, 'txBody');
      if (!txBody) return;
      var paras = paragraphsOf(txBody);
      if (!paras.length) return;
      var isTitle = phType === 'title' || phType === 'ctrTitle';
      if (isTitle) {
        var title = paras.map(function (p) { return p.text; }).join(' ').trim();
        if (title) ctx.title = title;
        return;
      }
      paras.forEach(function (p) {
        if (p.bullet) {
          var line = new Array(p.level + 1).join('  ') + '- ' + p.text.replace(/\n/g, ' ');
          if (out.length && /^\s*(- |\d+\. )/.test(out[out.length - 1])) out[out.length - 1] += '\n' + line;
          else out.push(line);
        } else {
          out.push(U.mdParagraph(p.text));
        }
      });
      return;
    }
    if (local === 'graphicFrame') {
      var tbl = X.findAll(node, 'tbl')[0];
      if (tbl) {
        var rows = tableRows(tbl);
        if (rows.length) {
          ctx.tables = (ctx.tables || 0) + 1;
          out.push(U.mdTable(rows));
        }
      }
      return;
    }
    if (local === 'pic') {
      ctx.images = (ctx.images || 0) + 1;
      var cnv = X.findAll(node, 'cNvPr')[0];
      var name = cnv ? X.attr(cnv, 'name') : '';
      var descr = cnv ? X.attr(cnv, 'descr') : '';
      out.push('_[image' + (descr ? ': ' + descr : name ? ': ' + name : '') + ']_');
      return;
    }
    if (local === 'grpSp' || local === 'spTree') {
      X.children(node).forEach(function (c) { shapeBlocks(c, out, ctx); });
      return;
    }
    if (local === 'AlternateContent') {
      X.children(node).forEach(function (c) { shapeBlocks(c, out, ctx); });
    }
  }

  async function convert(bytes, opts) {
    opts = opts || {};
    var zip = await D2A.zip.readZip(bytes);
    var presXml = await entryText(zip, 'ppt/presentation.xml');
    if (!presXml) throw new Error('This file is not a valid .pptx (ppt/presentation.xml is missing).');
    var presRoot = X.parse(presXml);
    if (!presRoot) throw new Error('Could not parse the PPTX presentation.');

    var relsXml = await entryText(zip, 'ppt/_rels/presentation.xml.rels');
    var rels = {};
    if (relsXml) {
      X.findAll(X.parse(relsXml), 'Relationship').forEach(function (rel) {
        var target = X.attr(rel, 'Target') || '';
        if (target.charAt(0) !== '/') target = 'ppt/' + target.replace(/^\.\//, '');
        else target = target.slice(1);
        rels[X.attr(rel, 'Id')] = target;
      });
    }

    var slidePaths = [];
    var sldIdLst = X.child(presRoot, 'sldIdLst');
    if (sldIdLst) {
      X.children(sldIdLst, 'sldId').forEach(function (s) {
        var rid = X.attr(s, 'id');
        if (rid && rels[rid]) slidePaths.push(rels[rid]);
      });
    }
    if (!slidePaths.length) {
      slidePaths = zip.entries
        .filter(function (e) { return /^ppt\/slides\/slide\d+\.xml$/i.test(e.name); })
        .sort(function (a, b) {
          return parseInt(a.name.match(/(\d+)\.xml$/)[1], 10) - parseInt(b.name.match(/(\d+)\.xml$/)[1], 10);
        })
        .map(function (e) { return e.name; });
    }

    var sections = [];
    var warnings = [];
    var meta = { slides: slidePaths.length, images: 0, tables: 0 };
    var deckTitle = '';

    for (var i = 0; i < slidePaths.length; i++) {
      var path = slidePaths[i];
      var slideXml = await entryText(zip, path);
      if (!slideXml) continue;
      var slideRoot = X.parse(slideXml);
      var cSld = slideRoot ? X.child(slideRoot, 'cSld') : null;
      var spTree = cSld ? X.child(cSld, 'spTree') : null;
      var ctx = { title: '' };
      var blocks = [];
      if (spTree) {
        X.children(spTree).forEach(function (c) { shapeBlocks(c, blocks, ctx); });
      }
      meta.tables += ctx.tables || 0;
      meta.images += ctx.images || 0;

      var slideTitle = ctx.title || '';
      if (!deckTitle && slideTitle) deckTitle = slideTitle;

      /* speaker notes */
      var notePath = path.replace(/slides\/(slide\d+)\.xml$/, 'slides/_rels/$1.xml.rels');
      var noteText = '';
      var noteRelsXml = await entryText(zip, notePath);
      if (noteRelsXml) {
        var noteRel = null;
        X.findAll(X.parse(noteRelsXml), 'Relationship').forEach(function (rel) {
          if (/notesSlide$/i.test(X.attr(rel, 'Type') || '')) noteRel = X.attr(rel, 'Target');
        });
        if (noteRel) {
          var np = resolvePath(path, noteRel);
          var notesXml = await entryText(zip, np);
          if (notesXml) {
            var nRoot = X.parse(notesXml);
            var nSpTree = nRoot ? X.child(X.child(nRoot, 'cSld') || nRoot, 'spTree') : null;
            if (nSpTree) {
              var parts = [];
              X.children(nSpTree).forEach(function (sp) {
                var tx = X.child(sp, 'txBody');
                if (!tx) return;
                var nv = X.child(sp, 'nvSpPr');
                var ph = nv && X.child(nv, 'nvPr') ? X.child(X.child(nv, 'nvPr'), 'ph') : null;
                var t = ph ? X.attr(ph, 'type') : '';
                if (t === 'sldImg' || t === 'sldNum') return;
                paragraphsOf(tx).forEach(function (p) { parts.push(p.text); });
              });
              noteText = parts.join('\n').trim();
            }
          }
        }
      }

      var body = blocks.filter(function (b) { return b && b.trim(); }).join('\n\n');
      var section = '## Slide ' + (i + 1) + (slideTitle ? ' — ' + U.mdInline(slideTitle) : '');
      if (body) section += '\n\n' + body;
      if (!body && !slideTitle) section += '\n\n_(no text on this slide)_';
      if (noteText) section += '\n\n> **Speaker notes:** ' + noteText.replace(/\n/g, '  \n> ');
      sections.push(section);
    }

    if (meta.images) warnings.push(meta.images + ' slide image(s) were not transcribed; their position is marked with [image].');

    var coreXml = await entryText(zip, 'docProps/core.xml');
    var title = '';
    if (coreXml) {
      var cRoot = X.parse(coreXml);
      if (cRoot) {
        var t = X.child(cRoot, 'title');
        if (t && X.textOf(t).trim()) title = X.textOf(t).trim();
        var creator = X.child(cRoot, 'creator');
        if (creator && X.textOf(creator).trim()) meta.author = X.textOf(creator).trim();
      }
    }
    if (!title) title = deckTitle;

    return {
      kind: 'pptx',
      title: title,
      markdown: U.collapseBlankLines(sections.join('\n\n---\n\n')),
      meta: meta,
      warnings: warnings
    };
  }

  D2A.converters = D2A.converters || {};
  D2A.converters.pptx = convert;
})(typeof globalThis !== 'undefined' ? globalThis : this);
