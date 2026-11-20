/* doc2ai — RTF converter (best effort text + basic emphasis) */
(function (g) {
  'use strict';
  var D2A = (g.D2A = g.D2A || {});
  var U = D2A.util;

  var SKIP_DESTS = {
    fonttbl: 1, colortbl: 1, stylesheet: 1, info: 1, pict: 1, header: 1, footer: 1,
    object: 1, themedata: 1, datastore: 1, listtable: 1, listoverridetable: 1,
    rsidtbl: 1, generator: 1, xmlnstbl: 1, mmathPr: 1, fldinst: 1, filetbl: 1,
    revtbl: 1, latentstyles: 1, panose: 1, bkmkstart: 1, bkmkend: 1, footnote: 1,
    field: 0, colorschememapping: 1, mmath: 1, shpinst: 1, sp: 1, sn: 1, sv: 1
  };

  var cp1252 = new TextDecoder('windows-1252');

  function hexByte(hex) {
    var b = new Uint8Array([parseInt(hex, 16) & 0xff]);
    return cp1252.decode(b);
  }

  function rtfToMarkdown(rtf) {
    var s = String(rtf);
    var out = [];
    var stack = [];
    var state = { skip: false, uc: 1, bold: false, italic: false, underline: false };
    var boldOpen = false;
    var italicOpen = false;
    var pendingSkip = 0;
    var i = 0;
    var n = s.length;

    function push(marker) { out.push(marker); }

    function syncEmphasis() {
      if (state.bold && !boldOpen) { push('**'); boldOpen = true; }
      else if (!state.bold && boldOpen) { push('**'); boldOpen = false; }
      if (state.italic && !italicOpen) { push('*'); italicOpen = true; }
      else if (!state.italic && italicOpen) { push('*'); italicOpen = false; }
    }

    while (i < n) {
      var ch = s[i];
      if (ch === '{') {
        stack.push({ skip: state.skip, uc: state.uc, bold: state.bold, italic: state.italic, boldOpen: boldOpen, italicOpen: italicOpen });
        i++;
        if (s[i] === '\\' && s[i + 1] === '*') {
          state.skip = true;
          i += 2;
        }
        continue;
      }
      if (ch === '}') {
        var prev = stack.pop();
        if (prev) {
          state.skip = prev.skip;
          state.uc = prev.uc;
          state.bold = prev.bold;
          state.italic = prev.italic;
          // close any emphasis that was opened inside the group
          if (boldOpen && !prev.boldOpen) { push('**'); boldOpen = false; }
          if (italicOpen && !prev.italicOpen) { push('*'); italicOpen = false; }
        }
        i++;
        continue;
      }
      if (ch === '\\') {
        var next = s[i + 1];
        if (next === '\\' || next === '{' || next === '}') {
          if (!state.skip && !pendingSkip) { syncEmphasis(); push(next); }
          else if (pendingSkip) pendingSkip--;
          i += 2;
          continue;
        }
        if (next === "'") {
          var hex = s.substr(i + 2, 2);
          if (pendingSkip > 0) pendingSkip--;
          else if (!state.skip) { syncEmphasis(); push(hexByte(hex)); }
          i += 4;
          continue;
        }
        if (next === '~') { if (!state.skip) push('\u00a0'); i += 2; continue; }
        if (next === '-') { if (!state.skip) push('\u00ad'); i += 2; continue; }
        if (next === '_') { if (!state.skip) push('\u2011'); i += 2; continue; }
        if (next === '*') { state.skip = true; i += 2; continue; }
        if (next === '\n' || next === '\r') { if (!state.skip) push('\n'); i += 2; continue; }

        // control word
        var m = /^([a-zA-Z]+)(-?\d+)? ?/.exec(s.slice(i + 1, i + 40));
        if (!m) { i += 2; continue; }
        var word = m[1];
        var param = m[2] !== undefined ? parseInt(m[2], 10) : null;
        i += 1 + m[0].length;

        if (SKIP_DESTS[word]) {
          if (SKIP_DESTS[word] === 1) state.skip = true;
          continue;
        }
        if (word === 'uc') { state.uc = param == null ? 1 : param; continue; }
        if (word === 'u') {
          if (pendingSkip > 0) { pendingSkip--; continue; }
          if (!state.skip) {
            syncEmphasis();
            var code = param;
            if (code != null && code < 0) code += 65536;
            try { push(String.fromCharCode(code)); } catch (e) { /* ignore */ }
            pendingSkip = state.uc;
          }
          continue;
        }
        if (state.skip) continue;

        switch (word) {
          case 'par': case 'sect': case 'page': push('\n\n'); break;
          case 'line': push('\n'); break;
          case 'tab': push('\t'); break;
          case 'cell': push(' | '); break;
          case 'row': push('\n'); break;
          case 'emdash': push('\u2014'); break;
          case 'endash': push('\u2013'); break;
          case 'lquote': push('\u2018'); break;
          case 'rquote': push('\u2019'); break;
          case 'ldblquote': push('\u201c'); break;
          case 'rdblquote': push('\u201d'); break;
          case 'bullet': push('\u2022'); break;
          case 'b': state.bold = param !== 0; syncEmphasis(); break;
          case 'i': state.italic = param !== 0; syncEmphasis(); break;
          case 'plain': state.bold = false; state.italic = false; syncEmphasis(); break;
          default: break;
        }
        continue;
      }
      if (ch === '\r' || ch === '\n') { i++; continue; }
      if (pendingSkip > 0) { pendingSkip--; i++; continue; }
      if (!state.skip) {
        syncEmphasis();
        out.push(ch);
      }
      i++;
    }

    if (boldOpen) out.push('**');
    if (italicOpen) out.push('*');

    var text = out.join('')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return text;
  }

  async function convert(bytes) {
    var text = U.decodeText(bytes);
    var md = rtfToMarkdown(text);
    return {
      kind: 'rtf',
      title: '',
      markdown: md,
      meta: { characters: text.length },
      warnings: ['RTF is converted as plain text with basic bold/italic only; complex layout, tables and images are flattened.']
    };
  }

  D2A.converters = D2A.converters || {};
  D2A.converters.rtf = convert;
  D2A.converters.rtfToMarkdown = rtfToMarkdown;
})(typeof globalThis !== 'undefined' ? globalThis : this);
