/*
 * doc2ai self-test: builds sample documents in memory and converts them.
 * Run with:  node tests/selftest.cjs
 */
'use strict';

const path = require('path');
const zlib = require('zlib');

const LIBS = ['util', 'zip', 'xml', 'docx', 'xlsx', 'pptx', 'odf', 'rtf', 'html', 'text', 'pdf', 'convert'];
for (const lib of LIBS) require(path.join(__dirname, '..', 'assets', 'lib', lib + '.js'));

const D2A = globalThis.D2A;
const { zip, convert } = D2A;

const enc = new TextEncoder();
const fileOf = (name, bytes) => ({
  name,
  path: name,
  size: bytes.length,
  arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
});

/* ------------------------------------------------------------------ docx */

function makeDocx() {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}"><w:body>
  <w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>Quarterly Operations Report</w:t></w:r></w:p>
  <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Overview</w:t></w:r></w:p>
  <w:p><w:r><w:t xml:space="preserve">Revenue grew </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>18%</w:t></w:r><w:r><w:t xml:space="preserve"> year over year, driven by </w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>new markets</w:t></w:r><w:r><w:t>.</w:t></w:r></w:p>
  <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Highlights</w:t></w:r></w:p>
  <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr><w:r><w:t>Opened 4 regional hubs</w:t></w:r></w:p>
  <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr><w:r><w:t>Reduced churn to 3.1%</w:t></w:r></w:p>
  <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="3"/></w:numPr></w:pPr><w:r><w:t>Hire two analysts</w:t></w:r></w:p>
  <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Numbers</w:t></w:r></w:p>
  <w:tbl>
    <w:tr><w:tc><w:p><w:r><w:t>Region</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Revenue</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Growth</w:t></w:r></w:p></w:tc></w:tr>
    <w:tr><w:tc><w:p><w:r><w:t>North</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>1.2M</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>22%</w:t></w:r></w:p></w:tc></w:tr>
    <w:tr><w:tc><w:p><w:r><w:t>South</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>0.9M</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>11%</w:t></w:r></w:p></w:tc></w:tr>
  </w:tbl>
  <w:p><w:r><w:t>Closing note.</w:t></w:r></w:p>
</w:body></w:document>`;

  const styles = `<?xml version="1.0"?><w:styles xmlns:w="${W}">
    <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style>
    <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>
    <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style>
  </w:styles>`;

  const numbering = `<?xml version="1.0"?><w:numbering xmlns:w="${W}">
    <w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="â€¢"/></w:lvl></w:abstractNum>
    <w:abstractNum w:abstractNumId="2"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:start w:val="1"/></w:lvl></w:abstractNum>
    <w:num w:numId="2"><w:abstractNumId w:val="2"/></w:num>
    <w:num w:numId="3"><w:abstractNumId w:val="1"/></w:num>
  </w:numbering>`;

  const core = `<?xml version="1.0"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Quarterly Operations Report</dc:title><dc:creator>QA Team</dc:creator></cp:coreProperties>`;

  const ct = `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
    <Default Extension="xml" ContentType="application/xml"/>
    <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  </Types>`;

  return zip.writeZip([
    { name: '[Content_Types].xml', data: ct },
    { name: 'word/document.xml', data: doc },
    { name: 'word/styles.xml', data: styles },
    { name: 'word/numbering.xml', data: numbering },
    { name: 'docProps/core.xml', data: core }
  ]);
}

/* ------------------------------------------------------------------ xlsx */

function makeXlsx() {
  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const wb = `<?xml version="1.0"?><workbook xmlns="${NS}" xmlns:r="${R}"><sheets>
    <sheet name="Sales" sheetId="1" r:id="rId1"/><sheet name="Notes" sheetId="2" r:id="rId2"/>
  </sheets></workbook>`;
  const rels = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="rId1" Type="${R}/worksheet" Target="worksheets/sheet1.xml"/>
    <Relationship Id="rId2" Type="${R}/worksheet" Target="worksheets/sheet2.xml"/>
  </Relationships>`;
  const shared = `<?xml version="1.0"?><sst xmlns="${NS}" count="6" uniqueCount="6">
    <si><t>Product</t></si><si><t>Units</t></si><si><t>Revenue</t></si>
    <si><t>Widget</t></si><si><t>Gadget</t></si><si><t>Notes for the team</t></si>
  </sst>`;
  const sheet1 = `<?xml version="1.0"?><worksheet xmlns="${NS}"><sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" s="1"><v>45658</v></c></row>
    <row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2"><v>120</v></c><c r="C2"><v>2400.5</v></c><c r="D2" s="1"><v>45660</v></c></row>
    <row r="3"><c r="A3" t="s"><v>4</v></c><c r="B3"><v>80</v></c><c r="C3"><v>1600</v></c><c r="D3" s="1"><v>45662</v></c></row>
    <row r="4"><c r="A4" t="inlineStr"><is><t>Total</t></is></c><c r="B4"><f>SUM(B2:B3)</f><v>200</v></c></row>
  </sheetData></worksheet>`;
  const sheet2 = `<?xml version="1.0"?><worksheet xmlns="${NS}"><sheetData>
    <row r="1"><c r="A1" t="s"><v>5</v></c></row>
    <row r="2"><c r="A2" t="str"><v>Ship by Friday.</v></c></row>
  </sheetData></worksheet>`;
  const styles = `<?xml version="1.0"?><styleSheet xmlns="${NS}"><cellXfs count="2">
    <xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/>
  </cellXfs></styleSheet>`;
  const ct = `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
    <Default Extension="xml" ContentType="application/xml"/>
    <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  </Types>`;

  return zip.writeZip([
    { name: '[Content_Types].xml', data: ct },
    { name: 'xl/workbook.xml', data: wb },
    { name: 'xl/_rels/workbook.xml.rels', data: rels },
    { name: 'xl/sharedStrings.xml', data: shared },
    { name: 'xl/styles.xml', data: styles },
    { name: 'xl/worksheets/sheet1.xml', data: sheet1 },
    { name: 'xl/worksheets/sheet2.xml', data: sheet2 }
  ]);
}

/* ------------------------------------------------------------------ pptx */

function makePptx() {
  const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

  const pres = `<?xml version="1.0"?><p:presentation xmlns:p="${P}" xmlns:a="${A}" xmlns:r="${R}">
    <p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst>
  </p:presentation>`;
  const presRels = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="rId1" Type="${R}/slide" Target="slides/slide1.xml"/>
    <Relationship Id="rId2" Type="${R}/slide" Target="slides/slide2.xml"/>
  </Relationships>`;
  const slide1 = `<?xml version="1.0"?><p:sld xmlns:p="${P}" xmlns:a="${A}"><p:cSld><p:spTree>
    <p:sp><p:nvSpPr><p:cNvPr id="1" name="Title"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
      <p:txBody><a:p><a:r><a:t>Launch Plan</a:t></a:r></a:p></p:txBody></p:sp>
    <p:sp><p:nvSpPr><p:cNvPr id="2" name="Body"/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>
      <p:txBody>
        <a:p><a:pPr lvl="0"/><a:r><a:t>Ship the beta in March</a:t></a:r></a:p>
        <a:p><a:pPr lvl="1"/><a:r><a:t>Invite 50 users</a:t></a:r></a:p>
      </p:txBody></p:sp>
  </p:spTree></p:cSld></p:sld>`;
  const slide2 = `<?xml version="1.0"?><p:sld xmlns:p="${P}" xmlns:a="${A}"><p:cSld><p:spTree>
    <p:sp><p:nvSpPr><p:cNvPr id="1" name="Title"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
      <p:txBody><a:p><a:r><a:t>Metrics</a:t></a:r></a:p></p:txBody></p:sp>
    <p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="3" name="Table"/></p:nvGraphicFramePr>
      <a:graphic><a:graphicData><a:tbl><a:tr><a:tc><a:txBody><a:p><a:r><a:t>Metric</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>Value</a:t></a:r></a:p></a:txBody></a:tc></a:tr>
      <a:tr><a:tc><a:txBody><a:p><a:r><a:t>MAU</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>12,400</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>
  </p:spTree></p:cSld></p:sld>`;
  const notes1 = `<?xml version="1.0"?><p:notes xmlns:p="${P}" xmlns:a="${A}"><p:cSld><p:spTree>
    <p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes"/><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr>
    <p:txBody><a:p><a:r><a:t>Mention the March deadline twice.</a:t></a:r></a:p></p:txBody></p:sp>
  </p:spTree></p:cSld></p:notes>`;
  const slideRels = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="rId9" Type="${R}/notesSlide" Target="../notesSlides/notesSlide1.xml"/>
  </Relationships>`;

  return zip.writeZip([
    { name: 'ppt/presentation.xml', data: pres },
    { name: 'ppt/_rels/presentation.xml.rels', data: presRels },
    { name: 'ppt/slides/slide1.xml', data: slide1 },
    { name: 'ppt/slides/slide2.xml', data: slide2 },
    { name: 'ppt/slides/_rels/slide1.xml.rels', data: slideRels },
    { name: 'ppt/notesSlides/notesSlide1.xml', data: notes1 }
  ]);
}

/* ------------------------------------------------------------------ pdf */

function makePdf(compress) {
  const content = `BT /F1 22 Tf 72 720 Td (Annual Summary) Tj ET
BT /F1 11 Tf 72 690 Td (This PDF was generated for the doc2ai self test.) Tj ET
BT /F1 11 Tf 72 675 Td (It contains two paragraphs of body text.) Tj ET
BT /F1 14 Tf 72 640 Td (Key Findings) Tj ET
BT /F1 11 Tf 72 620 Td (Revenue increased by eighteen percent this year.) Tj ET
BT /F1 11 Tf 72 605 Td [(Bullet one) -300 (with a gap) -600 (and another)] TJ ET`;

  let streamBytes;
  let dict;
  if (compress) {
    streamBytes = zlib.deflateSync(Buffer.from(content, 'latin1'));
    dict = `<< /Length ${streamBytes.length} /Filter /FlateDecode >>`;
  } else {
    streamBytes = Buffer.from(content, 'latin1');
    dict = `<< /Length ${streamBytes.length} >>`;
  }

  const head = Buffer.from(`%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >> endobj
4 0 obj ${dict}
stream
`, 'latin1');
  const tail = Buffer.from(`
endstream
endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >> endobj
trailer << /Size 6 /Root 1 0 R >>
%%EOF
`, 'latin1');
  return new Uint8Array(Buffer.concat([head, streamBytes, tail]));
}

/* ------------------------------------------------------------------ odt */

function makeOdt() {
  const T = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';
  const TB = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0';
  const content = `<?xml version="1.0"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="${T}" xmlns:table="${TB}">
  <office:body><office:text>
    <text:h text:outline-level="1">Project Charter</text:h>
    <text:p>This document defines the scope.</text:p>
    <text:list><text:list-item><text:p>Goal one</text:p></text:list-item><text:list-item><text:p>Goal two</text:p></text:list-item></text:list>
    <table:table><table:table-row><table:table-cell><text:p>Owner</text:p></table:table-cell><table:table-cell><text:p>Role</text:p></table:table-cell></table:table-row>
    <table:table-row><table:table-cell><text:p>Sam</text:p></table:table-cell><table:table-cell><text:p>Lead</text:p></table:table-cell></table:table-row></table:table>
  </office:text></office:body></office:document-content>`;
  return zip.writeZip([
    { name: 'mimetype', data: 'application/vnd.oasis.opendocument.text' },
    { name: 'content.xml', data: content }
  ]);
}

/* ------------------------------------------------------------------ modern pdf (object streams + ToUnicode) */

function makeModernPdf() {
  const objs = [
    [1, '<< /Type /Catalog /Pages 2 0 R >>'],
    [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>']
  ];
  let header = '';
  let body = '';
  for (const [num, src] of objs) {
    header += num + ' ' + body.length + ' ';
    body += src + '\n';
  }
  const objStm = Buffer.from(header + body, 'latin1');
  const objStmZ = zlib.deflateSync(objStm);

  const content = Buffer.from('BT /F1 12 Tf 72 720 Td <0001000200030004> Tj ET\nBT /F1 12 Tf 72 700 Td <0005> Tj ET', 'latin1');
  const contentZ = zlib.deflateSync(content);

  const cmap = Buffer.from(`/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
1 beginbfrange
<0001> <0004> <0041>
endbfrange
1 beginbfchar
<0005> <00660069>
endbfchar
endcmap
end
end`, 'latin1');

  const head = Buffer.from(`%PDF-1.5
6 0 obj << /Type /ObjStm /N 3 /First ${header.length} /Length ${objStmZ.length} /Filter /FlateDecode >>
stream
`, 'latin1');
  const mid1 = Buffer.from(`
endstream
endobj
4 0 obj << /Length ${contentZ.length} /Filter /FlateDecode >>
stream
`, 'latin1');
  const mid2 = Buffer.from(`
endstream
endobj
5 0 obj << /Length ${cmap.length} >>
stream
`, 'latin1');
  const tail = Buffer.from(`
endstream
endobj
7 0 obj << /Type /Font /Subtype /Type0 /BaseFont /Test /Encoding /Identity-H /ToUnicode 5 0 R >> endobj
trailer << /Root 1 0 R >>
%%EOF
`, 'latin1');

  return new Uint8Array(Buffer.concat([head, objStmZ, mid1, contentZ, mid2, cmap, tail]));
}

/* ------------------------------------------------------------------ zip archive of documents */

function makeZipOfDocs() {
  return zip.writeZip([
    { name: 'inner/one.csv', data: 'a,b\n1,2\n' },
    { name: 'inner/two.md', data: '# Inner Doc\n\nbody\n' }
  ]);
}

/* ------------------------------------------------------------------ run */

const CASES = [
  ['report.docx', makeDocx(), ['# Quarterly Operations Report', '# Overview', '**18%**', '1. Opened 4 regional hubs', '| Region | Revenue | Growth |', 'North']],
  ['book.xlsx', makeXlsx(), ['## Sheet: Sales', '| Product | Units | Revenue |', '2025-01-01', 'Widget', '## Sheet: Notes', 'Ship by Friday.']],
  ['deck.pptx', makePptx(), ['## Slide 1 — Launch Plan', '- Ship the beta in March', '  - Invite 50 users', '| Metric | Value |', 'Speaker notes']],
  ['plain.pdf', makePdf(false), ['# Annual Summary', 'eighteen percent', 'Bullet one with a gap']],
  ['zipped.pdf', makePdf(true), ['# Annual Summary', 'eighteen percent']],
  ['modern.pdf', makeModernPdf(), ['ABCD', 'fi']],
  ['bundle.zip', makeZipOfDocs(), ['inner/one.csv', '| a | b |', '# Inner Doc']],
  ['charter.odt', makeOdt(), ['# Project Charter', '- Goal one', '| Owner | Role |']],
  ['table.csv', enc.encode('Name,Role,Score\nAna,"Eng, Sr",9\nBo,Ops,7\n'), ['| Name | Role | Score |', 'Eng, Sr']],
  ['data.json', enc.encode(JSON.stringify({ team: 'ops', members: [{ name: 'Ana', active: true }] })), ['### Structure', '```json']],
  ['notes.md', enc.encode('# Notes\n\n- alpha\n- beta\n'), ['# Notes', '- alpha']],
  ['page.html', enc.encode('<html><head><title>Doc Title</title></head><body><h1>Hello</h1><p>Some <strong>bold</strong> text.</p><ul><li>One</li><li>Two</li></ul><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table></body></html>'), ['# Hello', '**bold**', '- One']],
  ['memo.rtf', enc.encode('{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}\\f0\\fs24 Hello \\b bold\\b0  world.\\par Second line.\\par}'), ['Hello', '**bold**', 'Second line.']],
  ['readme.txt', enc.encode('Plain text file.\nSecond line.\n'), ['Plain text file.']],
  ['notebook.ipynb', enc.encode(JSON.stringify({ cells: [{ cell_type: 'markdown', source: ['# Analysis'] }, { cell_type: 'code', source: ['print(1+1)'], outputs: [{ text: ['2\n'] }] }] })), ['# Analysis', '```python', 'print(1+1)']],
  ['mail.eml', enc.encode('From: a@b.c\nTo: d@e.f\nSubject: Hi there\nContent-Type: text/plain; charset=utf-8\n\nHello from email.\n'), ['**Subject:** Hi there', 'Hello from email.']]
];

(async () => {
  let pass = 0;
  let fail = 0;
  const entries = [];

  for (const [name, bytes, expect] of CASES) {
    try {
      const entry = await convert.convertFile(fileOf(name, bytes), {});
      entries.push(entry);
      const md = entry.aiMarkdown;
      const missing = expect.filter((needle) => md.indexOf(needle) < 0);
      if (missing.length) {
        fail++;
        console.log('FAIL ' + name + ' â€” missing: ' + JSON.stringify(missing));
        console.log('----- output -----\n' + md.slice(0, 1200) + '\n------------------');
      } else {
        pass++;
        console.log('ok   ' + name + '  (' + entry.format + ', ' + entry.words + ' words, ' + entry.ms + 'ms)');
      }
    } catch (err) {
      fail++;
      console.log('ERROR ' + name + ': ' + err.message);
      console.log(err.stack.split('\n').slice(0, 4).join('\n'));
    }
  }

  /* bundle + manifest + zip round trip */
  try {
    const manifest = convert.buildManifest(entries);
    const bundle = convert.buildBundle(entries, { name: 'self test' });
    const zipBytes = convert.buildOutputZip(entries, [], { name: 'self test' });
    const reread = await zip.readZip(zipBytes);
    const names = reread.entries.map((e) => e.name);
    const bundleEntry = reread.entries.find((e) => e.name === 'bundle.ai.md');
    const bundleBack = await bundleEntry.text();
    if (names.indexOf('manifest.ai.json') < 0 || names.indexOf('bundle.ai.md') < 0) throw new Error('zip members missing: ' + names.join(','));
    if (bundleBack !== bundle) {
      const strip = (s) => s.replace(/on \d{4}-\d{2}-\d{2}T[\d:+\-]+\./, 'on <time>.');
      if (strip(bundleBack) !== strip(bundle)) {
        let i = 0;
        while (i < Math.min(bundle.length, bundleBack.length) && bundle[i] === bundleBack[i]) i++;
        throw new Error('bundle round trip mismatch at ' + i + ' of ' + bundle.length + '/' + bundleBack.length + ': ' + JSON.stringify(bundle.slice(Math.max(0, i - 50), i + 50)) + ' VS ' + JSON.stringify(bundleBack.slice(Math.max(0, i - 50), i + 50)));
      }
    }
    if (manifest.summary.documents !== entries.length) throw new Error('manifest count mismatch');
    console.log('ok   manifest + bundle + zip (' + zipBytes.length + ' bytes, ' + names.length + ' files)');
    pass++;
  } catch (err) {
    fail++;
    console.log('ERROR manifest/bundle/zip: ' + err.message);
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (process.argv.includes('--write-samples')) {
    const fs = require('fs');
    const dir = path.join(__dirname, '..', 'samples');
    fs.mkdirSync(dir, { recursive: true });
    const written = [
      ['Quarterly Operations Report.docx', makeDocx()],
      ['Sales Workbook.xlsx', makeXlsx()],
      ['Launch Plan.pptx', makePptx()],
      ['Annual Summary.pdf', makePdf(true)],
      ['Project Charter.odt', makeOdt()],
      ['contacts.csv', enc.encode('Name,Role,Score\nAna,"Eng, Sr",9\nBo,Ops,7\n')],
      ['memo.rtf', enc.encode('{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}\\f0\\fs24 Team memo.\\par Ship on Friday.\\par}')],
      ['page.html', enc.encode('<html><head><title>Doc Title</title></head><body><h1>Hello</h1><p>Some <strong>bold</strong> text.</p></body></html>')]
    ];
    for (const [name, bytes] of written) {
      fs.writeFileSync(path.join(dir, name), Buffer.from(bytes));
      console.log('wrote samples/' + name);
    }
  }
  if (process.argv.includes('--dump')) {
    for (const e of entries) console.log('\n\n===== ' + e.source + ' =====\n' + e.aiMarkdown);
  }
  process.exit(fail ? 1 : 0);
})();
