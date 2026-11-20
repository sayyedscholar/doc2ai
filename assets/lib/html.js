/* doc2ai — HTML / XHTML converter */
(function (g) {
  'use strict';
  var D2A = (g.D2A = g.D2A || {});
  var U = D2A.util;
  var X = D2A.xml;

  var SKIP = { script: 1, style: 1, noscript: 1, head: 1, nav: 1, footer: 1, iframe: 1, svg: 1, template: 1, form: 1, button: 1, select: 1, option: 1, input: 1 };
  var BLOCK = {
    p: 1, div: 1, section: 1, article: 1, header: 1, main: 1, aside: 1, figure: 1, figcaption: 1,
    address: 1, dl: 1, dt: 1, dd: 1, details: 1, summary: 1, fieldset: 1, center: 1, body: 1
  };

  function tidy(s) {
    return String(s)
      .replace(/\u00a0/g, ' ')
      .replace(/[\u200b-\u200d\ufeff]/g, '')
      .replace(/[ \t]{2,}/g, ' ');
  }

  function hasDom() {
    return typeof DOMParser === 'function' && typeof document !== 'undefined';
  }

  /* ---------------- DOM based conversion ---------------- */

  function inline(node, ctx) {
    if (node.nodeType === 3) return tidy(node.nodeValue);
    if (node.nodeType !== 1) return '';
    var tag = node.tagName.toLowerCase();
    if (SKIP[tag]) return '';
    if (tag === 'br') return '\n';
    if (tag === 'img') {
      var alt = node.getAttribute('alt') || '';
      var src = node.getAttribute('src') || '';
      if (!src && !alt) return '';
      return '![' + tidy(alt) + '](' + src + ')';
    }
    var inner = '';
    for (var i = 0; i < node.childNodes.length; i++) inner += inline(node.childNodes[i], ctx);
    switch (tag) {
      case 'strong': case 'b':
        return inner.trim() ? '**' + inner.trim() + '**' : inner;
      case 'em': case 'i':
        return inner.trim() ? '*' + inner.trim() + '*' : inner;
      case 'code': case 'kbd': case 'samp': case 'tt':
        return inner.trim() ? '`' + inner.trim() + '`' : inner;
      case 'a': {
        var href = node.getAttribute('href') || '';
        var text = inner.trim();
        if (!text) return '';
        if (!href || href.charAt(0) === '#' || /^javascript:/i.test(href)) return text;
        return '[' + text + '](' + href + ')';
      }
      case 'sup': return '^' + inner.trim();
      case 'sub': return '~' + inner.trim();
      case 'del': case 's': case 'strike':
        return inner.trim() ? '~~' + inner.trim() + '~~' : inner;
      default:
        return inner;
    }
  }

  function renderBlocks(node, out) {
    out = out || [];
    for (var i = 0; i < node.childNodes.length; i++) {
      var child = node.childNodes[i];
      if (child.nodeType === 3) {
        var t = tidy(child.nodeValue);
        if (t.trim()) out.push(U.mdParagraph(t));
        continue;
      }
      if (child.nodeType !== 1) continue;
      var tag = child.tagName.toLowerCase();
      if (SKIP[tag]) continue;

      if (/^h[1-6]$/.test(tag)) {
        var lvl = parseInt(tag.charAt(1), 10);
        var htext = inline(child, {}).trim();
        if (htext) out.push(U.mdHeading(htext, lvl));
        continue;
      }
      if (tag === 'p' || tag === 'pre' || tag === 'blockquote' || tag === 'table' || tag === 'ul' || tag === 'ol' || tag === 'hr' || tag === 'figure' || tag === 'dl') {
        renderSpecial(child, tag, out);
        continue;
      }
      if (BLOCK[tag]) {
        renderBlocks(child, out);
        continue;
      }
      var inlineText = inline(child, {}).trim();
      if (inlineText) out.push(U.mdParagraph(inlineText));
    }
    return out;
  }

  function renderSpecial(el, tag, out) {
    if (tag === 'pre') {
      var codeEl = el.querySelector('code');
      var target = codeEl || el;
      var text = target.textContent || '';
      var cls = (target.getAttribute && target.getAttribute('class')) || '';
      var lm = cls.match(/language-([\w+#-]+)/);
      out.push(U.mdFence(text.replace(/\s+$/, ''), lm ? lm[1] : ''));
      return;
    }
    if (tag === 'blockquote') {
      var inner = renderBlocks(el, []).join('\n\n');
      if (inner.trim()) {
        out.push(inner.split('\n').map(function (l) { return '> ' + l; }).join('\n'));
      }
      return;
    }
    if (tag === 'ul' || tag === 'ol') {
      var ordered = tag === 'ol';
      var items = [];
      for (var i = 0; i < el.children.length; i++) {
        var li = el.children[i];
        if (li.tagName.toLowerCase() !== 'li') continue;
        var nested = [];
        var own = '';
        for (var j = 0; j < li.childNodes.length; j++) {
          var c = li.childNodes[j];
          if (c.nodeType === 1 && /^(ul|ol)$/i.test(c.tagName)) {
            renderSpecial(c, c.tagName.toLowerCase(), nested);
          } else {
            own += inline(c, {});
          }
        }
        own = own.replace(/\s+/g, ' ').trim();
        items.push(own);
        if (nested.length) items.push(nested.join('\n'));
      }
      items = items.filter(function (s) { return s.trim(); });
      if (items.length) {
        out.push(items.map(function (s, k) {
          if (/^\s*[-*] |^\s*\d+\. /.test(s)) return s.replace(/^(\s*)([-*]) /, '$1  - ');
          return (ordered ? k + 1 + '. ' : '- ') + s;
        }).join('\n'));
      }
      return;
    }
    if (tag === 'table') {
      var rows = [];
      var trs = el.querySelectorAll('tr');
      for (var r = 0; r < trs.length; r++) {
        var cells = [];
        var tds = trs[r].querySelectorAll('th,td');
        for (var c = 0; c < tds.length; c++) {
          cells.push((tds[c].textContent || '').replace(/\s+/g, ' ').trim());
        }
        rows.push(cells);
      }
      if (rows.length) out.push(U.mdTable(rows));
      return;
    }
    if (tag === 'hr') {
      out.push('---');
      return;
    }
    if (tag === 'figure') {
      renderBlocks(el, out);
      return;
    }
    if (tag === 'dl') {
      var lines = [];
      for (var k = 0; k < el.children.length; k++) {
        var d = el.children[k];
        var dt = d.tagName.toLowerCase();
        if (dt === 'dt') lines.push('**' + (d.textContent || '').trim() + '**');
        else if (dt === 'dd') lines.push(': ' + (d.textContent || '').trim());
      }
      if (lines.length) out.push(lines.join('\n'));
      return;
    }
    // default: treat as block container
    renderBlocks(el, out);
  }

  function fromDom(html) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var title = doc.title || '';
    var root = doc.body || doc.documentElement;
    var blocks = renderBlocks(root, []);
    if (!title) {
      var h1 = doc.querySelector('h1');
      if (h1) title = h1.textContent.trim();
    }
    return { markdown: blocks.join('\n\n'), title: title };
  }

  /* ---------------- fallback (no DOM) ---------------- */

  function fromRegex(html) {
    var s = String(html);
    var title = '';
    var tm = s.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (tm) title = X.decodeEntities(tm[1]).trim();
    s = s.replace(/<!--[\s\S]*?-->/g, '');
    s = s.replace(/<(script|style|noscript|head|nav|footer|iframe|svg|form|button|select|template)[\s\S]*?<\/\1>/gi, '');
    s = s.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, function (_, body) {
      return '\n\n```\n' + X.decodeEntities(body.replace(/<[^>]+>/g, '')) + '\n```\n\n';
    });
    s = s.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, function (_, body) {
      var rows = [];
      body.replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, function (__, rowHtml) {
        var cells = [];
        rowHtml.replace(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi, function (___, c) {
          cells.push(X.decodeEntities(c.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim());
          return '';
        });
        if (cells.length) rows.push(cells);
        return '';
      });
      return rows.length ? '\n\n' + U.mdTable(rows) + '\n\n' : '';
    });
    s = s.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, function (_, lv, body) {
      return '\n\n' + new Array(parseInt(lv, 10) + 1).join('#') + ' ' + X.decodeEntities(body.replace(/<[^>]+>/g, '')).trim() + '\n\n';
    });
    s = s.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, function (_, tag, body) {
      return '**' + body.replace(/<[^>]+>/g, '').trim() + '**';
    });
    s = s.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, function (_, tag, body) {
      return '*' + body.replace(/<[^>]+>/g, '').trim() + '*';
    });
    s = s.replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, function (_, href, body) {
      var txt = X.decodeEntities(body.replace(/<[^>]+>/g, '')).trim();
      if (!txt) return '';
      return /^(#|javascript:)/i.test(href) ? txt : '[' + txt + '](' + href + ')';
    });
    s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, function (_, body) {
      return '\n- ' + X.decodeEntities(body.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
    });
    s = s.replace(/<br\s*\/?>/gi, '\n');
    s = s.replace(/<\/(p|div|section|article|table|ul|ol|blockquote|figure|dd)>/gi, '\n\n');
    s = s.replace(/<[^>]+>/g, '');
    s = X.decodeEntities(s);
    s = s.replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n');
    return { markdown: U.collapseBlankLines(s), title: title };
  }

  function convertHtmlString(html) {
    var res;
    if (hasDom()) {
      try {
        res = fromDom(html);
      } catch (e) {
        res = fromRegex(html);
      }
    } else {
      res = fromRegex(html);
    }
    res.markdown = U.collapseBlankLines(res.markdown);
    return res;
  }

  async function html(bytes) {
    var text = U.decodeText(bytes);
    var res = convertHtmlString(text);
    return {
      kind: 'html',
      title: res.title,
      markdown: res.markdown,
      meta: { characters: text.length, blocks: res.markdown.split(/\n\n+/).length },
      warnings: []
    };
  }

  D2A.converters = D2A.converters || {};
  D2A.converters.html = html;
  D2A.converters.htmlString = convertHtmlString;
})(typeof globalThis !== 'undefined' ? globalThis : this);
