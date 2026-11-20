/* doc2ai — plain text, markdown, CSV/TSV, JSON, source code, notebooks, e-mail */
(function (g) {
  'use strict';
  var D2A = (g.D2A = g.D2A || {});
  var U = D2A.util;

  var LANGS = {
    js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'typescript', tsx: 'typescript',
    py: 'python', rb: 'ruby', php: 'php', java: 'java', kt: 'kotlin', kts: 'kotlin', cs: 'csharp',
    c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', m: 'objective-c', mm: 'objective-c',
    go: 'go', rs: 'rust', swift: 'swift', dart: 'dart', lua: 'lua', pl: 'perl', r: 'r',
    sh: 'bash', bash: 'bash', zsh: 'bash', bat: 'bat', cmd: 'bat', ps1: 'powershell', psm1: 'powershell',
    sql: 'sql', css: 'css', scss: 'scss', sass: 'sass', less: 'less', html: 'html', htm: 'html',
    xml: 'xml', xsd: 'xml', xsl: 'xml', svg: 'xml', json: 'json', jsonc: 'json', yml: 'yaml', yaml: 'yaml',
    toml: 'toml', ini: 'ini', cfg: 'ini', conf: 'ini', env: 'bash', dockerfile: 'dockerfile',
    vue: 'vue', svelte: 'svelte', astro: 'astro', graphql: 'graphql', gql: 'graphql',
    tex: 'latex', proto: 'protobuf', tf: 'hcl', hcl: 'hcl', gradle: 'groovy', groovy: 'groovy',
    ex: 'elixir', exs: 'elixir', erl: 'erlang', hs: 'haskell', clj: 'clojure', scala: 'scala',
    asm: 'asm', s: 'asm', v: 'verilog', vhd: 'vhdl', vhdl: 'vhdl'
  };

  function firstHeading(text) {
    var m = String(text).match(/^#{1,6}\s+(.+)$/m);
    return m ? m[1].trim() : '';
  }

  async function markdown(bytes) {
    var text = U.decodeText(bytes);
    return {
      kind: 'markdown',
      title: firstHeading(text),
      markdown: U.collapseBlankLines(text),
      meta: { lines: text.split('\n').length },
      warnings: []
    };
  }

  async function plain(bytes, name) {
    var text = U.decodeText(bytes);
    var body = U.collapseBlankLines(text);
    var lines = text.split('\n').length;
    return {
      kind: 'text',
      title: '',
      markdown: body,
      meta: { lines: lines, characters: text.length },
      warnings: []
    };
  }

  /* ---------- CSV / TSV ---------- */

  function detectDelimiter(text, fallback) {
    var sample = text.split('\n').slice(0, 8).join('\n');
    var candidates = [',', '\t', ';', '|'];
    var best = fallback || ',';
    var bestScore = -1;
    candidates.forEach(function (d) {
      var counts = sample.split('\n').map(function (line) { return line.split(d).length; });
      var max = Math.max.apply(null, counts);
      var consistent = counts.filter(function (c) { return c === max; }).length;
      var score = max > 1 ? consistent * 10 + max : 0;
      if (score > bestScore) { bestScore = score; best = d; }
    });
    return best;
  }

  function parseDelimited(text, delim, maxRows) {
    var rows = [];
    var row = [];
    var field = '';
    var inQuotes = false;
    var i = 0;
    var n = text.length;
    while (i < n && rows.length < maxRows) {
      var ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += ch; i++; continue;
      }
      if (ch === '"' && field === '') { inQuotes = true; i++; continue; }
      if (ch === delim) { row.push(field); field = ''; i++; continue; }
      if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      if (ch === '\r') { i++; continue; }
      field += ch;
      i++;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return { rows: rows, truncated: i < n };
  }

  async function csv(bytes, name, opts) {
    var text = U.decodeText(bytes);
    var ext = U.extOf(name || '');
    var delim = ext === 'tsv' ? '\t' : detectDelimiter(text, ',');
    var maxRows = (opts && opts.maxRows) || 2000;
    var parsed = parseDelimited(text, delim, maxRows + 1);
    var rows = parsed.rows;
    var truncated = parsed.truncated || rows.length > maxRows;
    if (rows.length > maxRows) rows = rows.slice(0, maxRows);

    var warnings = [];
    if (truncated) warnings.push('Only the first ' + maxRows + ' rows were converted.');
    var markdown = rows.length ? U.mdTable(rows) : '_(empty table)_';
    if (truncated) markdown += '\n\n> _Truncated after ' + maxRows + ' rows._';

    var header = rows[0] || [];
    return {
      kind: 'csv',
      title: '',
      markdown: markdown,
      meta: {
        rows: rows.length,
        columns: header.length,
        delimiter: delim === '\t' ? 'tab' : delim,
        header: header.slice(0, 30).map(function (h) { return String(h).trim(); }).filter(Boolean)
      },
      warnings: warnings
    };
  }

  /* ---------- JSON ---------- */

  async function json(bytes, name) {
    var text = U.decodeText(bytes);
    var warnings = [];
    var parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      warnings.push('This file is not strict JSON (' + e.message + '); showing it as raw text.');
    }
    if (parsed === null && !warnings.length) {
      return { kind: 'json', title: '', markdown: U.mdFence('null', 'json'), meta: { keys: 0 }, warnings: [] };
    }
    if (warnings.length) {
      return {
        kind: 'json',
        title: '',
        markdown: U.mdFence(U.collapseBlankLines(text).slice(0, 400000), 'json'),
        meta: { valid: false },
        warnings: warnings
      };
    }

    var pretty = JSON.stringify(parsed, null, 2);
    var truncated = pretty.length > 400000;
    if (truncated) pretty = pretty.slice(0, 400000);

    var outline = [];
    function describe(v, depth, prefix) {
      if (depth > 2 || outline.length > 60) return;
      if (Array.isArray(v)) {
        outline.push('- `' + (prefix || '$') + '` — array of ' + v.length);
        if (v.length && typeof v[0] === 'object') describe(v[0], depth + 1, (prefix || '$') + '[0]');
      } else if (v && typeof v === 'object') {
        var keys = Object.keys(v);
        outline.push('- `' + (prefix || '$') + '` — object with ' + keys.length + ' key(s): ' + keys.slice(0, 12).map(function (k) { return '`' + k + '`'; }).join(', ') + (keys.length > 12 ? ', …' : ''));
        keys.slice(0, 12).forEach(function (k) {
          if (typeof v[k] === 'object' && v[k] !== null) describe(v[k], depth + 1, (prefix || '$') + '.' + k);
        });
      }
    }
    describe(parsed, 0, '$');

    var md = '';
    if (outline.length) md += '### Structure\n\n' + outline.join('\n') + '\n\n### Content\n\n';
    md += U.mdFence(pretty, 'json');
    if (truncated) {
      md += '\n\n> _Truncated at 400,000 characters._';
      warnings.push('Large JSON file: output was truncated.');
    }
    if (outline.length > 60) warnings.push('Structure outline was limited to the first entries.');

    return {
      kind: 'json',
      title: '',
      markdown: md,
      meta: {
        valid: true,
        rootType: Array.isArray(parsed) ? 'array' : typeof parsed,
        size: Array.isArray(parsed) ? parsed.length : (parsed && typeof parsed === 'object' ? Object.keys(parsed).length : 1)
      },
      warnings: warnings
    };
  }

  /* ---------- source code ---------- */

  async function code(bytes, name) {
    var text = U.decodeText(bytes);
    var ext = U.extOf(name || '');
    var lang = LANGS[ext] || (U.baseName(name).toLowerCase() === 'dockerfile' ? 'dockerfile' : '');
    var body = text.replace(/\s+$/, '');
    var truncated = body.length > 300000;
    if (truncated) body = body.slice(0, 300000);
    var md = U.mdFence(body, lang);
    if (truncated) md += '\n\n> _Truncated at 300,000 characters._';
    return {
      kind: 'code',
      title: '',
      markdown: md,
      meta: { language: lang || 'text', lines: text.split('\n').length },
      warnings: truncated ? ['Large source file: output was truncated.'] : []
    };
  }

  /* ---------- Jupyter notebook ---------- */

  async function ipynb(bytes) {
    var text = U.decodeText(bytes);
    var nb;
    try {
      nb = JSON.parse(text);
    } catch (e) {
      throw new Error('This .ipynb file is not valid JSON.');
    }
    var cells = nb.cells || [];
    var blocks = [];
    var counts = { code: 0, markdown: 0, outputs: 0 };

    cells.forEach(function (cell, idx) {
      var src = Array.isArray(cell.source) ? cell.source.join('') : String(cell.source || '');
      if (cell.cell_type === 'markdown') {
        counts.markdown++;
        blocks.push(src.trim());
      } else if (cell.cell_type === 'code') {
        counts.code++;
        blocks.push('### Cell ' + (idx + 1) + ' (code)\n\n' + U.mdFence(src.replace(/\s+$/, ''), 'python'));
        var outs = cell.outputs || [];
        var rendered = [];
        outs.forEach(function (o) {
          if (o.text) rendered.push(Array.isArray(o.text) ? o.text.join('') : o.text);
          else if (o.data && o.data['text/plain']) {
            var v = o.data['text/plain'];
            rendered.push(Array.isArray(v) ? v.join('') : v);
          } else if (o.ename) {
            rendered.push(o.ename + ': ' + (o.evalue || ''));
          }
        });
        if (rendered.length) {
          counts.outputs++;
          blocks.push('**Output:**\n\n' + U.mdFence(rendered.join('\n').replace(/\s+$/, ''), 'text'));
        }
      } else if (cell.cell_type === 'raw') {
        blocks.push(U.mdFence(src, 'text'));
      }
    });

    return {
      kind: 'ipynb',
      title: nb.metadata && nb.metadata.title ? nb.metadata.title : '',
      markdown: U.collapseBlankLines(blocks.join('\n\n')),
      meta: { cells: cells.length, codeCells: counts.code, markdownCells: counts.markdown, kernel: nb.metadata && nb.metadata.kernelspec ? nb.metadata.kernelspec.name : '' },
      warnings: []
    };
  }

  /* ---------- e-mail (.eml) ---------- */

  function decodeQuotedPrintable(s) {
    return s
      .replace(/=\r?\n/g, '')
      .replace(/=([0-9A-Fa-f]{2})/g, function (_, hex) { return String.fromCharCode(parseInt(hex, 16)); });
  }

  function bytesFromBinaryString(str) {
    var out = new Uint8Array(str.length);
    for (var i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
    return out;
  }

  function decodeBody(body, encoding) {
    var enc = (encoding || '').toLowerCase();
    if (enc.indexOf('base64') >= 0) {
      try {
        var bin = typeof atob === 'function' ? atob(body.replace(/\s+/g, '')) : Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('binary');
        return U.decodeText(bytesFromBinaryString(bin));
      } catch (e) {
        return body;
      }
    }
    if (enc.indexOf('quoted-printable') >= 0) {
      return U.decodeText(bytesFromBinaryString(decodeQuotedPrintable(body)));
    }
    return body;
  }

  async function eml(bytes) {
    var text = U.decodeText(bytes);
    var split = text.search(/\r?\n\r?\n/);
    var headerText = split < 0 ? text : text.slice(0, split);
    var body = split < 0 ? '' : text.slice(split).replace(/^\r?\n\r?\n/, '');

    var headers = {};
    headerText.split(/\r?\n/).forEach(function (line) {
      if (/^\s/.test(line) && headers.__last) {
        headers[headers.__last] += ' ' + line.trim();
        return;
      }
      var m = line.match(/^([A-Za-z0-9-]+):\s*(.*)$/);
      if (m) {
        headers[m[1].toLowerCase()] = m[2];
        headers.__last = m[1].toLowerCase();
      }
    });
    delete headers.__last;

    var ctype = headers['content-type'] || 'text/plain';
    var encoding = headers['content-transfer-encoding'] || '';
    var plainBody = body;

    if (/multipart/i.test(ctype)) {
      var bMatch = ctype.match(/boundary="?([^";]+)"?/i);
      if (bMatch) {
        var boundary = '--' + bMatch[1];
        var parts = body.split(boundary);
        var chosen = null;
        parts.forEach(function (part) {
          if (chosen) return;
          var pm = part.match(/content-type:\s*([^;\r\n]+)/i);
          if (pm && /text\/plain/i.test(pm[1])) chosen = part;
        });
        if (!chosen) {
          parts.forEach(function (part) {
            if (chosen) return;
            var pm = part.match(/content-type:\s*([^;\r\n]+)/i);
            if (pm && /text\/html/i.test(pm[1])) chosen = part;
          });
        }
        if (chosen) {
          var hb = chosen.search(/\r?\n\r?\n/);
          var ph = chosen.slice(0, hb);
          var em = ph.match(/content-transfer-encoding:\s*([^\r\n]+)/i);
          plainBody = chosen.slice(hb).replace(/^\r?\n\r?\n/, '');
          encoding = em ? em[1] : encoding;
        }
      }
    }
    plainBody = decodeBody(plainBody, encoding);

    var md = [];
    var title = headers.subject || '';
    md.push('**From:** ' + (headers.from || ''));
    md.push('**To:** ' + (headers.to || ''));
    if (headers.cc) md.push('**Cc:** ' + headers.cc);
    md.push('**Date:** ' + (headers.date || ''));
    md.push('**Subject:** ' + (headers.subject || ''));
    md.push('');
    md.push('---');
    md.push('');
    md.push(U.collapseBlankLines(plainBody));

    return {
      kind: 'eml',
      title: title,
      markdown: md.join('\n'),
      meta: { from: headers.from || '', to: headers.to || '', date: headers.date || '', subject: headers.subject || '' },
      warnings: []
    };
  }

  /* ---------- SVG (text) ---------- */

  async function svg(bytes, name) {
    var text = U.decodeText(bytes);
    var warnings = ['Vector image: only the markup and any embedded text were captured, not the rendered picture.'];
    return {
      kind: 'svg',
      title: '',
      markdown: U.mdFence(text.replace(/\s+$/, ''), 'xml'),
      meta: { characters: text.length },
      warnings: warnings
    };
  }

  D2A.converters = D2A.converters || {};
  D2A.converters.markdown = markdown;
  D2A.converters.text = plain;
  D2A.converters.csv = csv;
  D2A.converters.json = json;
  D2A.converters.code = code;
  D2A.converters.ipynb = ipynb;
  D2A.converters.eml = eml;
  D2A.converters.svg = svg;
  D2A.converters.LANGS = LANGS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
