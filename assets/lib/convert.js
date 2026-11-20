/* doc2ai — dispatcher, front-matter, manifest and bundle builders */
(function (g) {
  'use strict';
  var D2A = (g.D2A = g.D2A || {});
  var U = D2A.util;

  var EXT = {
    docx: 'docx', docm: 'docx', dotx: 'docx', dotm: 'docx',
    xlsx: 'xlsx', xlsm: 'xlsx', xltx: 'xlsx', xltm: 'xlsx',
    pptx: 'pptx', pptm: 'pptx', potx: 'pptx', ppsx: 'pptx',
    pdf: 'pdf',
    odt: 'odf', ods: 'odf', odp: 'odf', ott: 'odf', ots: 'odf', otp: 'odf',
    rtf: 'rtf',
    html: 'html', htm: 'html', xhtml: 'html',
    epub: 'epub',
    md: 'markdown', markdown: 'markdown', mdx: 'markdown',
    txt: 'text', text: 'text', log: 'text', nfo: 'text', me: 'text', rst: 'text',
    csv: 'csv', tsv: 'csv',
    json: 'json', jsonc: 'json', geojson: 'json',
    ipynb: 'ipynb',
    eml: 'eml',
    svg: 'svg',
    doc: 'legacy', xls: 'legacy', ppt: 'legacy', msg: 'legacy',
    zip: 'zip'
  };

  var CODE_EXT = D2A.converters.LANGS;

  var LABELS = {
    docx: 'Word document', xlsx: 'Excel workbook', pptx: 'PowerPoint deck', pdf: 'PDF document',
    odf: 'OpenDocument', rtf: 'Rich Text', html: 'Web page', epub: 'EPUB book',
    markdown: 'Markdown', text: 'Plain text', csv: 'Delimited data', json: 'JSON',
    ipynb: 'Jupyter notebook', eml: 'E-mail', svg: 'SVG image', legacy: 'Legacy Office file',
    zip: 'ZIP archive', code: 'Source code', image: 'Image', unknown: 'Unknown'
  };

  function kindFor(name) {
    var ext = U.extOf(name || '');
    if (EXT[ext]) return EXT[ext];
    if (CODE_EXT[ext]) return 'code';
    if (/^(png|jpe?g|gif|webp|bmp|tiff?|ico|avif|heic)$/.test(ext)) return 'image';
    return '';
  }

  function isSupported(name) {
    return !!kindFor(name);
  }

  function supportedList() {
    var list = Object.keys(EXT).map(function (e) { return '.' + e; });
    Object.keys(CODE_EXT).forEach(function (e) {
      if (list.indexOf('.' + e) < 0) list.push('.' + e);
    });
    return list.sort();
  }

  /* ---------------- magic-byte sniffing ---------------- */

  function sniff(bytes) {
    var n = Math.min(bytes.length, 8);
    if (n >= 4) {
      if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return 'pdf';
      if (bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 3 || bytes[2] === 5) && (bytes[3] === 4 || bytes[3] === 6)) return 'zip';
      if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) return 'ole';
      if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image';
      if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image';
      if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image';
    }
    if (n >= 5 && U.latin1(bytes.subarray(0, 5)) === '{\\rtf') return 'rtf';
    if (n >= 2 && U.latin1(bytes.subarray(0, 2)) === 'BM') return 'image';
    return '';
  }

  /* ---------------- helpers ---------------- */

  function frontMatter(entry) {
    var fm = {
      ai_ready: true,
      generator: 'doc2ai',
      schema: 'doc2ai/document@1',
      source: entry.source,
      format: entry.format,
      converted: entry.converted,
      title: entry.title || undefined,
      words: entry.words,
      tokens_est: entry.tokens_est,
      source_bytes: entry.bytes,
      notes: entry.notes && entry.notes.length ? entry.notes : undefined,
      structure: entry.structure && Object.keys(entry.structure).length ? entry.structure : undefined
    };
    return '---\n' + U.yamlBlock(fm) + '\n---\n';
  }

  function legacyBinaryText(bytes) {
    var s = U.latin1(bytes);
    var runs = s.match(/[\x20-\x7e\r\n\t]{12,}/g) || [];
    var seen = {};
    var lines = [];
    runs.forEach(function (r) {
      var clean = r.replace(/\s+/g, ' ').trim();
      if (clean.length < 12) return;
      if (/^[\x20-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e]+$/.test(clean)) return; // punctuation soup
      if (seen[clean]) return;
      seen[clean] = 1;
      lines.push(clean);
    });
    return lines.join('\n').slice(0, 300000);
  }

  async function convertEpub(bytes) {
    var zip = await D2A.zip.readZip(bytes);
    var containerEntry = D2A.zip.findEntry(zip, 'META-INF/container.xml');
    var opfPath = '';
    if (containerEntry) {
      var containerXml = await containerEntry.text();
      var cm = /full-path="([^"]+)"/.exec(containerXml);
      if (cm) opfPath = cm[1];
    }
    if (!opfPath) {
      var guess = zip.entries.filter(function (e) { return /\.opf$/i.test(e.name); })[0];
      if (guess) opfPath = guess.name;
    }
    if (!opfPath) throw new Error('This EPUB has no package document (.opf).');

    var opfEntry = D2A.zip.findEntry(zip, opfPath);
    if (!opfEntry) throw new Error('EPUB package document not found: ' + opfPath);
    var opf = D2A.xml.parse(await opfEntry.text());
    var baseDir = U.dirName(opfPath);

    var title = '';
    var tNode = opf ? D2A.xml.findAll(opf, 'title')[0] : null;
    if (tNode) title = D2A.xml.textOf(tNode).trim();

    var manifest = {};
    D2A.xml.findAll(opf, 'item').forEach(function (it) {
      manifest[D2A.xml.attr(it, 'id')] = D2A.xml.attr(it, 'href');
    });

    var spineIds = [];
    D2A.xml.findAll(opf, 'itemref').forEach(function (ref) {
      var id = D2A.xml.attr(ref, 'idref');
      if (id) spineIds.push(id);
    });

    var blocks = [];
    for (var i = 0; i < spineIds.length; i++) {
      var href = manifest[spineIds[i]];
      if (!href) continue;
      var path = baseDir ? baseDir + '/' + href : href;
      path = path.replace(/\/\.\//g, '/');
      var entry = D2A.zip.findEntry(zip, decodeURIComponent(path)) || D2A.zip.findEntry(zip, path);
      if (!entry) continue;
      var html = await entry.text();
      var res = D2A.converters.htmlString(html);
      if (!res.markdown.trim()) continue;
      blocks.push('## Chapter ' + (blocks.length + 1) + (res.title ? ' — ' + U.mdInline(res.title) : '') + '\n\n' + res.markdown);
    }

    return {
      kind: 'epub',
      title: title,
      markdown: U.collapseBlankLines(blocks.join('\n\n')),
      meta: { chapters: blocks.length },
      warnings: []
    };
  }

  /* ---------------- main entry ---------------- */

  /**
   * Convert one file to an AI-ready document.
   * file: { name, path, size, async arrayBuffer() }  (browser File or plain object)
   */
  async function convertFile(file, opts) {
    opts = opts || {};
    var started = Date.now();
    var name = file.name || U.baseName(file.path || 'file');
    var path = file.path || name;
    var kind = kindFor(name);
    var warnings = [];
    var bytes = null;

    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch (e) {
      throw new Error('Could not read the file (' + e.message + ').');
    }

    var magic = sniff(bytes);
    var result = null;

    // ZIP-based formats need their container inspected.
    if (kind === '' && magic === 'zip') kind = 'zip';
    if (kind === 'zip' || (magic === 'zip' && kind !== 'docx' && kind !== 'xlsx' && kind !== 'pptx' && kind !== 'odf' && kind !== 'epub')) {
      result = await convertZipArchive(bytes, path, opts);
      if (!result && kind === 'zip') {
        throw new Error('This ZIP archive could not be read (it may be corrupt or use an unsupported compression method).');
      }
    }

    if (!result) {
      if (!kind) {
        if (magic === 'ole') kind = 'legacy';
        else if (magic === 'image') kind = 'image';
        else if (bytes.length && looksTextual(bytes)) kind = 'text';
        else kind = 'unknown';
      }

      switch (kind) {
        case 'docx': result = await D2A.converters.docx(bytes, opts); break;
        case 'xlsx': result = await D2A.converters.xlsx(bytes, opts); break;
        case 'pptx': result = await D2A.converters.pptx(bytes, opts); break;
        case 'pdf': result = await D2A.converters.pdf(bytes, opts); break;
        case 'odf': result = await D2A.converters.odf(bytes, opts); break;
        case 'rtf': result = await D2A.converters.rtf(bytes, opts); break;
        case 'html': result = await D2A.converters.html(bytes, opts); break;
        case 'epub': result = await convertEpub(bytes); break;
        case 'markdown': result = await D2A.converters.markdown(bytes, opts); break;
        case 'text': result = await D2A.converters.text(bytes, name, opts); break;
        case 'csv': result = await D2A.converters.csv(bytes, name, opts); break;
        case 'json': result = await D2A.converters.json(bytes, name, opts); break;
        case 'ipynb': result = await D2A.converters.ipynb(bytes, name, opts); break;
        case 'eml': result = await D2A.converters.eml(bytes, name, opts); break;
        case 'svg': result = await D2A.converters.svg(bytes, name, opts); break;
        case 'code': result = await D2A.converters.code(bytes, name, opts); break;
        case 'image': result = await convertImage(bytes, name); break;
        case 'legacy': result = await convertLegacy(bytes, name); break;
        default:
          throw new Error('Unsupported file type. Supported formats include PDF, Word, Excel, PowerPoint, OpenDocument, RTF, HTML, EPUB, Markdown, CSV, JSON, code and plain text.');
      }
    }

    warnings = warnings.concat(result.warnings || []);
    var body = U.collapseBlankLines(result.markdown || '');
    var title = (result.title || '').trim();

    var entry = {
      id: 'doc_' + Math.random().toString(36).slice(2, 10),
      source: path,
      output: outputPath(path),
      format: result.kind || kind,
      formatLabel: LABELS[result.kind || kind] || (result.kind || kind),
      title: title || U.stripExt(name),
      converted: U.isoNow(),
      bytes: bytes.length,
      words: U.countWords(body),
      tokens_est: U.estimateTokens(body),
      structure: result.meta || {},
      notes: warnings,
      markdown: body,
      ms: Date.now() - started
    };
    entry.aiMarkdown = frontMatter(entry) + '\n' + (bodyStartsWithTitle(body, title) ? '' : title ? '# ' + title + '\n\n' : '') + body + '\n';
    return entry;
  }

  function bodyStartsWithTitle(body, title) {
    if (!title) return true;
    var firstLine = String(body).split('\n')[0].trim();
    var m = firstLine.match(/^#\s+(.+)$/);
    if (!m) return false;
    return m[1].trim().toLowerCase() === String(title).trim().toLowerCase();
  }

  function outputPath(sourcePath) {
    var dir = U.dirName(sourcePath);
    var base = U.stripExt(U.baseName(sourcePath));
    var file = base + '.ai.md';
    return dir ? dir + '/' + file : file;
  }

  function looksTextual(bytes) {
    var probe = Math.min(bytes.length, 2048);
    var suspicious = 0;
    for (var i = 0; i < probe; i++) {
      var b = bytes[i];
      if (b === 0) return false;
      if (b < 9 || (b > 13 && b < 32)) suspicious++;
    }
    return suspicious / probe < 0.05;
  }

  async function convertImage(bytes, name) {
    var ext = U.extOf(name);
    var warnings = ['Images are not OCR-processed: no text was extracted. Provide a text-based source for machine-readable content.'];
    var md = '_Image file — no text layer available for extraction._';
    return {
      kind: 'image',
      title: '',
      markdown: md,
      meta: { imageFormat: ext.toUpperCase(), bytes: bytes.length },
      warnings: warnings
    };
  }

  async function convertLegacy(bytes, name) {
    var text = legacyBinaryText(bytes);
    var ext = U.extOf(name);
    return {
      kind: 'legacy',
      title: '',
      markdown: text
        ? '> **Best-effort extraction from a legacy .' + ext + ' file.** Layout, tables and images are lost. Re-save as .' + (ext === 'xls' ? 'xlsx' : ext === 'ppt' ? 'pptx' : 'docx') + ' for a complete conversion.\n\n' + U.collapseBlankLines(text)
        : '_(No readable text could be recovered from this legacy Office file. Re-save it as .docx/.xlsx/.pptx.)_',
      meta: { legacy: true, recoveredCharacters: text.length },
      warnings: ['Legacy binary Office format: extraction is approximate. Re-save as the modern Office format for a faithful conversion.']
    };
  }

  async function convertZipArchive(bytes, path, opts) {
    var zip;
    try {
      zip = await D2A.zip.readZip(bytes);
    } catch (e) {
      return null;
    }
    var names = zip.entries.map(function (e) { return e.name; });

    // Detect Office / OpenDocument / EPUB containers even when the extension lies.
    if (names.indexOf('word/document.xml') >= 0) return await D2A.converters.docx(bytes, opts);
    if (names.indexOf('xl/workbook.xml') >= 0) return await D2A.converters.xlsx(bytes, opts);
    if (names.indexOf('ppt/presentation.xml') >= 0) return await D2A.converters.pptx(bytes, opts);
    if (names.indexOf('META-INF/container.xml') >= 0) return await convertEpub(bytes);
    if (names.indexOf('content.xml') >= 0 && names.indexOf('mimetype') >= 0) return await D2A.converters.odf(bytes, opts);

    if (U.extOf(path) !== 'zip') return null;

    // Plain archive: convert every supported member.
    var docs = zip.entries.filter(function (e) {
      return !e.dir && !e.name.startsWith('__MACOSX/') && isSupported(e.name) && !/\.zip$/i.test(e.name);
    });
    if (!docs.length) {
      throw new Error('This ZIP archive contains no supported documents (' + zip.entries.length + ' entries checked).');
    }
    var parts = [];
    var warnings = [];
    var limit = Math.min(docs.length, opts.maxArchiveEntries || 40);
    for (var i = 0; i < limit; i++) {
      var e = docs[i];
      var fake = {
        name: U.baseName(e.name),
        path: e.name,
        size: e.size,
        arrayBuffer: async function (entry) {
          var data = await entry.bytes();
          return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
        }.bind(null, e)
      };
      try {
        var sub = await convertFile(fake, Object.assign({}, opts, { maxArchiveEntries: 0 }));
        parts.push('## ' + e.name + '\n\n' + sub.markdown);
      } catch (err) {
        warnings.push(e.name + ': ' + err.message);
      }
    }
    if (docs.length > limit) warnings.push('Only the first ' + limit + ' documents inside the archive were converted.');

    return {
      kind: 'zip',
      title: U.stripExt(U.baseName(path)),
      markdown: U.collapseBlankLines(parts.join('\n\n---\n\n')),
      meta: { archiveEntries: zip.entries.length, documents: docs.length, converted: parts.length },
      warnings: warnings
    };
  }

  /* ---------------- manifest + bundle ---------------- */

  function buildManifest(entries, failures) {
    failures = failures || [];
    var totalWords = 0;
    var totalTokens = 0;
    var totalBytes = 0;
    entries.forEach(function (e) {
      totalWords += e.words || 0;
      totalTokens += e.tokens_est || 0;
      totalBytes += e.bytes || 0;
    });
    return {
      schema: 'doc2ai/manifest@1',
      generated_at: U.isoNow(),
      generator: 'doc2ai 1.0.0',
      summary: {
        documents: entries.length,
        failed: failures.length,
        source_bytes: totalBytes,
        words: totalWords,
        tokens_est: totalTokens,
        formats: entries.reduce(function (acc, e) { acc[e.format] = (acc[e.format] || 0) + 1; return acc; }, {})
      },
      documents: entries.map(function (e) {
        return {
          id: e.id,
          source: e.source,
          output: e.output,
          format: e.format,
          title: e.title,
          words: e.words,
          tokens_est: e.tokens_est,
          source_bytes: e.bytes,
          converted_at: e.converted,
          structure: e.structure || {},
          warnings: e.notes || []
        };
      }),
      failures: failures.map(function (f) {
        return { source: f.path || f.name, error: f.error };
      })
    };
  }

  function buildBundle(entries, opts) {
    opts = opts || {};
    var manifest = buildManifest(entries);
    var lines = [];
    lines.push('# AI Bundle — ' + (opts.name || entries.length + ' document' + (entries.length === 1 ? '' : 's')));
    lines.push('');
    lines.push('> Generated by **doc2ai** on ' + manifest.generated_at + '.');
    lines.push('> Every section below is plain Markdown with preserved structure — no further conversion is required.');
    lines.push('> Total: ' + manifest.summary.documents + ' document(s), ' + manifest.summary.words.toLocaleString() + ' words, ~' + manifest.summary.tokens_est.toLocaleString() + ' tokens.');
    lines.push('');
    lines.push('## Contents');
    lines.push('');
    entries.forEach(function (e, i) {
      lines.push((i + 1) + '. **' + (e.title || U.baseName(e.source)) + '** — `' + e.source + '` (' + e.formatLabel + ', ~' + e.tokens_est.toLocaleString() + ' tokens)');
    });
    lines.push('');
    entries.forEach(function (e, i) {
      lines.push('---');
      lines.push('');
      lines.push('<!-- document ' + (i + 1) + '/' + entries.length + ': ' + e.source + ' -->');
      lines.push('');
      lines.push('# ' + (e.title || U.baseName(e.source)));
      lines.push('');
      lines.push('`source: ' + e.source + '` · `format: ' + e.format + '` · `words: ' + e.words + '`');
      lines.push('');
      lines.push(e.markdown);
      lines.push('');
    });
    return lines.join('\n');
  }

  function buildOutputZip(entries, failures, opts) {
    opts = opts || {};
    var files = [];
    var reserved = { 'manifest.ai.json': 1, 'bundle.ai.md': 1, 'readme.ai.md': 1 };
    var used = Object.assign({}, reserved);
    var finalNames = [];

    entries.forEach(function (e) {
      var name = e.output || 'document.ai.md';
      var lower = name.toLowerCase();
      var n = 1;
      while (used[lower]) {
        var dot = name.lastIndexOf('.');
        var base = dot > 0 ? name.slice(0, dot) : name;
        var ext = dot > 0 ? name.slice(dot) : '';
        name = base + '-' + n++ + ext;
        lower = name.toLowerCase();
      }
      used[lower] = 1;
      finalNames.push(name);
      files.push({ name: name, data: e.aiMarkdown });
    });

    var manifest = null;
    if (opts.includeManifest !== false) {
      manifest = buildManifest(entries, failures);
      manifest.documents.forEach(function (doc, i) {
        if (finalNames[i]) doc.output = finalNames[i];
      });
      files.push({ name: 'manifest.ai.json', data: JSON.stringify(manifest, null, 2) });
    }
    if (opts.includeBundle !== false && entries.length > 1) {
      files.push({ name: 'bundle.ai.md', data: buildBundle(entries, opts) });
    }
    files.push({
      name: 'README.ai.md',
      data: [
        '# doc2ai output',
        '',
        'This archive contains AI-ready Markdown for every converted document.',
        '',
        '- `*.ai.md` — one Markdown file per source document, with YAML front-matter describing the source, format, word count and structure.',
        opts.includeManifest !== false ? '- `manifest.ai.json` — machine-readable index of everything in this archive.' : '',
        opts.includeBundle !== false && entries.length > 1 ? '- `bundle.ai.md` — all documents concatenated into a single file.' : '',
        '',
        'Point any AI agent at these files directly. No further conversion is needed.'
      ].filter(function (l, i, arr) { return l !== '' || arr[i - 1] !== ''; }).join('\n')
    });
    return D2A.zip.writeZip(files);
  }

  D2A.convert = {
    kindFor: kindFor,
    isSupported: isSupported,
    supportedList: supportedList,
    convertFile: convertFile,
    buildManifest: buildManifest,
    buildBundle: buildBundle,
    buildOutputZip: buildOutputZip,
    labels: LABELS,
    extensions: EXT
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
