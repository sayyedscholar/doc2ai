# doc2ai

[![tests](https://github.com/sayyedscholar/doc2ai/actions/workflows/test.yml/badge.svg)](https://github.com/sayyedscholar/doc2ai/actions/workflows/test.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/sayyedscholar/doc2ai)

**Turn any document into an AI-ready file — in one click, in your browser.**

AI agents can read text, not `.docx` archives, PDF streams or spreadsheet XML. doc2ai converts whatever you drop on it into clean, structured **Markdown** with a machine-readable **manifest**, so an agent can open the output directly and skip the "I can't parse this attachment" round trip.

Everything runs locally in the browser tab. No uploads, no accounts, no server, no dependencies.

```
document.docx / .pdf / .xlsx / .pptx / .odt / .epub / .html / .csv / …
        ↓  doc2ai
report.ai.md      ← Markdown with YAML front-matter (structure, word count, tokens)
manifest.ai.json  ← index of every document: format, size, structure, warnings
bundle.ai.md      ← all documents concatenated into one file for a single prompt
```

---

## Quick start

| How | What to do |
| --- | --- |
| **Windows** | Double-click `start.bat` — it starts a local server (PHP or Python) and opens the app. |
| **Any OS** | Open `index.html` in Chrome, Edge, Firefox or Safari. The app works from the file system too. |
| **Hosted** | Deploy the folder to any static host (Vercel, Netlify, GitHub Pages) — it is plain HTML/CSS/JS. |

Then: drop files or folders → press **Convert** → copy or download the `.ai.md` files.

## Supported input

| Category | Formats |
| --- | --- |
| Documents | `.docx` `.docm` `.dotx` (Word), `.odt` (OpenDocument), `.rtf`, `.txt`, `.md` |
| PDF | `.pdf` — selectable text, headings, lists, multi-page |
| Spreadsheets | `.xlsx` `.xlsm` (Excel), `.ods`, `.csv`, `.tsv` |
| Presentations | `.pptx` `.ppsx` (PowerPoint, incl. speaker notes), `.odp` |
| Web | `.html` `.htm` `.xhtml`, `.epub` |
| Data | `.json` `.geojson` `.ipynb`, `.xml` `.yaml` `.toml` `.ini` `.env` |
| E-mail | `.eml` |
| Code | 100+ extensions — `.js` `.ts` `.py` `.php` `.java` `.cs` `.go` `.rs` `.sql` `.sh` `.ps1` … |
| Archives | `.zip` containing any of the above |
| Legacy (best effort) | `.doc` `.xls` `.ppt` |
| Images | `.png` `.jpg` `.svg` … — metadata only, no OCR |

`.docx`, `.xlsx` and `.pptx` are detected by content, not just by extension, so mislabelled files still convert.

## What the output looks like

```markdown
---
ai_ready: true
generator: "doc2ai"
schema: "doc2ai/document@1"
source: "reports/q3.docx"
format: "docx"
converted: "2026-11-20T16:29:57+05:30"
title: "Quarterly Operations Report"
words: 812
tokens_est: 1100
source_bytes: 48213
structure:
  paragraphs: 96
  headings: 14
  tables: 3
  listItems: 22
---

# Quarterly Operations Report

## Overview

Revenue grew **18%** year over year, driven by *new markets*.

| Region | Revenue | Growth |
| --- | --- | --- |
| North | 1.2M | 22% |
```

Headings, bold/italic, lists (bullet and numbered), tables, footnotes, speaker notes and page markers are preserved as Markdown. The front-matter tells an agent what the document is, how big it is and how it is structured before it reads a single line.

The **manifest** (`manifest.ai.json`) is the index for agents that need to pick the right file:

```json
{
  "schema": "doc2ai/manifest@1",
  "summary": { "documents": 8, "failed": 0, "words": 168, "tokens_est": 313 },
  "documents": [
    { "source": "q3.docx", "output": "q3.ai.md", "format": "docx", "tokens_est": 79,
      "structure": { "paragraphs": 96, "headings": 14, "tables": 3 } }
  ]
}
```

The **bundle** (`bundle.ai.md`) is every converted document in one file, with a table of contents — paste it into any chat or point a single-file agent at it.

## Features

- **Batch and folders** — drop a whole directory tree; the relative paths are kept in the output names.
- **Nothing leaves the machine** — all parsing happens in the tab. Works offline after the page loads.
- **No dependencies** — no CDN, no npm packages, no build step, no server-side code. ~4,000 lines of vanilla JS.
- **Real parsers, not text scraping** — ZIP/OOXML/ODF container reading, PDF object and object-stream parsing with `ToUnicode` CMaps, XML tree parsing.
- **Honest output** — every document carries warnings when something was approximated (scanned PDF, embedded images, legacy formats, truncated sheets).
- **Download options** — single file, bundle, manifest, or everything as one ZIP.

## Project layout

```
doc2ai/
├── index.html              # the app
├── start.bat               # local launcher (PHP or Python)
├── assets/
│   ├── app.js              # UI controller: queue, conversion, results
│   ├── css/app.css         # theme (dark + light)
│   └── lib/
│       ├── zip.js          # ZIP reader (inflate) + writer (store)
│       ├── xml.js          # small namespace-aware XML parser
│       ├── docx.js         # WordprocessingML → Markdown
│       ├── xlsx.js         # SpreadsheetML → Markdown tables (incl. dates, formulas)
│       ├── pptx.js         # PresentationML → Markdown (incl. notes)
│       ├── odf.js          # ODT / ODS / ODP
│       ├── pdf.js          # PDF text extraction (objects, ObjStm, CMaps, content streams)
│       ├── html.js         # HTML → Markdown
│       ├── text.js         # text, Markdown, CSV/TSV, JSON, code, notebooks, e-mail
│       ├── rtf.js          # RTF
│       └── convert.js      # dispatcher, front-matter, manifest, bundle, ZIP output
├── samples/                # sample documents to try
└── tests/selftest.cjs      # builds documents in memory and converts them
```

## Tests

```bash
node tests/selftest.cjs                  # 17 checks across every supported format
node tests/selftest.cjs --dump           # also print every converted document
node tests/selftest.cjs --write-samples  # regenerate samples/
```

The suite builds real OOXML/ODF/PDF files in memory (including a deflate-compressed PDF and one with object streams + a `ToUnicode` CMap), converts them, asserts on the Markdown, then round-trips the output ZIP.

## Deploy

**Vercel:** import the repository and deploy with the default settings — it is a static site, no build command, no framework preset.

**GitHub Pages:** push the repository, then *Settings → Pages → Deploy from branch → main / root*.

**Netlify / Cloudflare Pages:** drag the folder in, or connect the repo with an empty build command and `.` as the publish directory.

## Limitations

- **No OCR.** Scanned PDFs and images have no text layer; doc2ai says so instead of inventing content.
- **Images inside documents** are marked with `[image]` but not described.
- **PDF layout** is reconstructed from text positions; complex multi-column or magazine layouts may read out of order.
- **Legacy `.doc/.xls/.ppt`** use a best-effort text recovery — re-save as the modern format for a faithful conversion.
- **Encrypted files** cannot be read without the password.
- **Very large sheets** are truncated (3,000 rows / 80 columns per sheet) to keep output usable by an LLM.

## Privacy

Files are read with the browser's File API and parsed in memory. Nothing is sent anywhere; the page makes no network requests at all after loading.

## License

MIT
