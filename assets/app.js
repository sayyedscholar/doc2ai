/* doc2ai — UI controller */
(function () {
  'use strict';

  var D2A = window.D2A;
  var U = D2A.util;
  var MAX_PREVIEW = 300000;

  var $ = function (id) { return document.getElementById(id); };

  var els = {
    dropzone: $('dropzone'),
    fileInput: $('fileInput'),
    folderInput: $('folderInput'),
    addFilesBtn: $('addFilesBtn'),
    addFolderBtn: $('addFolderBtn'),
    queuePanel: $('queuePanel'),
    queueList: $('queueList'),
    queueCount: $('queueCount'),
    clearBtn: $('clearBtn'),
    convertBtn: $('convertBtn'),
    convertLabel: $('convertLabel'),
    progress: $('progress'),
    progressBar: $('progressBar'),
    resultsPanel: $('resultsPanel'),
    resultCount: $('resultCount'),
    stats: $('stats'),
    tabs: $('tabs'),
    resultPath: $('resultPath'),
    preview: $('preview'),
    previewNote: $('previewNote'),
    warnList: $('warnList'),
    copyBtn: $('copyBtn'),
    downloadBtn: $('downloadBtn'),
    downloadAllBtn: $('downloadAllBtn'),
    copyOneBtn: $('copyOneBtn'),
    downloadOneBtn: $('downloadOneBtn'),
    optFrontMatter: $('optFrontMatter'),
    optBundle: $('optBundle'),
    optManifest: $('optManifest'),
    themeBtn: $('themeBtn'),
    themeIcon: $('themeIcon'),
    toast: $('toast'),
    supportedCount: $('supportedCount')
  };

  var state = {
    queue: [],
    results: [],
    failures: [],
    activeTab: null,
    converting: false,
    startedAt: 0
  };

  var toastTimer = null;

  /* ---------------- helpers ---------------- */

  function toast(message, ms) {
    els.toast.textContent = message;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { els.toast.classList.remove('show'); }, ms || 2400);
  }

  function tick() {
    return new Promise(function (resolve) { setTimeout(resolve, 0); });
  }

  function fmt(n) {
    return Number(n || 0).toLocaleString();
  }

  function stripFrontMatter(md) {
    if (md.slice(0, 4) !== '---\n') return md;
    var end = md.indexOf('\n---\n', 4);
    if (end < 0) return md;
    return md.slice(end + 5).replace(/^\n+/, '');
  }

  function download(filename, data, mime) {
    var blob = data instanceof Uint8Array ? new Blob([data], { type: mime || 'application/octet-stream' }) : new Blob([data], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) { /* fall through */ }
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) {
      return false;
    }
  }

  /* ---------------- queue ---------------- */

  function normalizeFile(file, path) {
    return {
      name: file.name,
      path: path || file.webkitRelativePath || file.name,
      size: file.size || 0,
      raw: file
    };
  }

  function addItems(items) {
    var added = 0;
    var skipped = 0;
    var dupes = 0;

    items.forEach(function (item) {
      if (!item || !item.name) return;
      if (!D2A.convert.isSupported(item.name)) { skipped++; return; }
      var exists = state.queue.some(function (q) {
        return q.path === item.path && q.size === item.size;
      });
      if (exists) { dupes++; return; }

      var kind = D2A.convert.kindFor(item.name) || 'unknown';
      state.queue.push({
        id: 'q_' + Math.random().toString(36).slice(2, 9),
        name: item.name,
        path: item.path || item.name,
        size: item.size || 0,
        kind: kind,
        label: D2A.convert.labels[kind] || kind,
        status: 'queued',
        error: '',
        entry: null,
        raw: item.raw
      });
      added++;
    });

    renderQueue();
    if (added) {
      els.queuePanel.hidden = false;
      var msg = added + ' file' + (added === 1 ? '' : 's') + ' added';
      if (skipped) msg += ' · ' + skipped + ' unsupported skipped';
      if (dupes) msg += ' · ' + dupes + ' duplicate' + (dupes === 1 ? '' : 's');
      toast(msg);
    } else if (skipped) {
      toast('No supported files found (' + skipped + ' skipped).');
    } else if (dupes) {
      toast('Already in the queue.');
    }
  }

  function renderQueue() {
    var total = state.queue.length;
    els.queueCount.textContent = String(total);
    els.queueList.textContent = '';

    if (!total) {
      els.queuePanel.hidden = true;
      return;
    }

    state.queue.forEach(function (item) {
      var li = document.createElement('li');
      li.className = 'queue-item';

      var badge = document.createElement('div');
      badge.className = 'file-badge';
      badge.dataset.kind = item.kind;
      badge.textContent = (U.extOf(item.name) || '?').slice(0, 4);
      li.appendChild(badge);

      var main = document.createElement('div');
      main.className = 'file-main';

      var nameEl = document.createElement('div');
      nameEl.className = 'file-name';
      nameEl.textContent = item.name;
      nameEl.title = item.path;
      main.appendChild(nameEl);

      var metaEl = document.createElement('div');
      metaEl.className = 'file-meta';
      var metaParts = [item.label, U.humanBytes(item.size)];
      if (item.path !== item.name) metaParts.push(U.dirName(item.path));
      if (item.entry) {
        metaParts.push('~' + fmt(item.entry.tokens_est) + ' tokens');
        if (item.entry.format === 'image') metaParts.push('no text layer');
      }
      if (item.error) metaParts.push(item.error);
      metaEl.textContent = metaParts.filter(Boolean).join(' · ');
      main.appendChild(metaEl);
      li.appendChild(main);

      var status = document.createElement('span');
      status.className = 'status';
      status.dataset.s = item.status;
      var labels = { queued: 'Queued', converting: 'Converting', done: 'Ready', error: 'Failed' };
      if (item.status === 'converting') {
        status.textContent = '';
        var sp = document.createElement('span');
        sp.className = 'spinner';
        status.appendChild(sp);
        status.appendChild(document.createTextNode(' Converting'));
      } else {
        status.textContent = labels[item.status] || item.status;
      }
      li.appendChild(status);

      var remove = document.createElement('button');
      remove.className = 'remove-btn';
      remove.type = 'button';
      remove.title = 'Remove';
      remove.setAttribute('aria-label', 'Remove ' + item.name);
      remove.textContent = '×';
      remove.disabled = state.converting;
      remove.addEventListener('click', function () {
        state.queue = state.queue.filter(function (q) { return q.id !== item.id; });
        state.results = state.results.filter(function (r) { return r.queueId !== item.id; });
        renderQueue();
        renderResults();
      });
      li.appendChild(remove);

      els.queueList.appendChild(li);
    });

    var pending = state.queue.filter(function (q) { return q.status !== 'done'; }).length;
    els.convertLabel.textContent = state.converting
      ? 'Converting…'
      : pending === 1 ? 'Convert 1 file' : 'Convert ' + pending + ' files';
    els.convertBtn.disabled = state.converting || pending === 0;
  }

  /* ---------------- conversion ---------------- */

  async function convertAll() {
    if (state.converting) return;
    var pending = state.queue.filter(function (q) { return q.status !== 'done'; });
    if (!pending.length) {
      toast('Everything in the queue is already converted.');
      return;
    }

    state.converting = true;
    state.startedAt = Date.now();
    els.progress.hidden = false;
    els.progressBar.style.width = '0%';
    renderQueue();

    var done = 0;
    for (var i = 0; i < pending.length; i++) {
      var item = pending[i];
      item.status = 'converting';
      renderQueue();
      await tick();

      try {
        var entry = await D2A.convert.convertFile(
          {
            name: item.name,
            path: item.path,
            size: item.size,
            arrayBuffer: function (raw) {
              return raw.arrayBuffer();
            }.bind(null, item.raw)
          },
          {}
        );
        entry.queueId = item.id;
        entry.sourcePath = item.path;
        if (!els.optFrontMatter.checked) entry.aiMarkdown = stripFrontMatter(entry.aiMarkdown);
        item.entry = entry;
        item.status = 'done';
        state.results.push(entry);
      } catch (err) {
        item.status = 'error';
        item.error = err && err.message ? err.message : String(err);
        state.failures.push({ path: item.path, error: item.error });
      }

      done++;
      els.progressBar.style.width = Math.round((done / pending.length) * 100) + '%';
      renderQueue();
      await tick();
    }

    state.converting = false;
    els.progress.hidden = true;
    renderQueue();

    var okCount = state.results.length;
    var failCount = state.failures.length;
    if (okCount) {
      renderResults();
      els.resultsPanel.hidden = false;
      els.resultsPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    if (failCount) {
      toast(okCount + ' converted · ' + failCount + ' failed. See the queue for details.', 4200);
    } else if (okCount) {
      toast('Converted ' + okCount + ' document' + (okCount === 1 ? '' : 's') + ' in ' + ((Date.now() - state.startedAt) / 1000).toFixed(1) + 's');
    }
  }

  /* ---------------- results ---------------- */

  function currentBundle() {
    return D2A.convert.buildBundle(state.results, { name: state.results.length + ' documents' });
  }

  function currentManifest() {
    return JSON.stringify(D2A.convert.buildManifest(state.results, state.failures), null, 2);
  }

  function availableTabs() {
    var tabs = [];
    state.results.forEach(function (entry) {
      tabs.push({ id: 'doc:' + entry.id, label: entry.title || U.baseName(entry.source), kind: 'doc', entry: entry });
    });
    if (state.results.length > 1 && els.optBundle.checked) {
      tabs.push({ id: 'bundle', label: 'Bundle', kind: 'bundle' });
    }
    if (els.optManifest.checked) {
      tabs.push({ id: 'manifest', label: 'Manifest', kind: 'manifest' });
    }
    return tabs;
  }

  function renderResults() {
    if (!state.results.length) {
      els.resultsPanel.hidden = true;
      return;
    }
    els.resultsPanel.hidden = false;

    var words = 0;
    var tokens = 0;
    state.results.forEach(function (e) {
      words += e.words || 0;
      tokens += e.tokens_est || 0;
    });

    els.resultCount.textContent = String(state.results.length);
    els.stats.textContent = '';
    [
      [state.results.length, 'documents'],
      [fmt(words), 'words'],
      ['~' + fmt(tokens), 'tokens'],
      [((Date.now() - state.startedAt) / 1000).toFixed(1) + 's', 'total time']
    ].forEach(function (pair) {
      var div = document.createElement('div');
      div.className = 'stat';
      var b = document.createElement('b');
      b.textContent = String(pair[0]);
      var s = document.createElement('span');
      s.textContent = pair[1];
      div.appendChild(b);
      div.appendChild(s);
      els.stats.appendChild(div);
    });

    var tabs = availableTabs();
    if (!tabs.some(function (t) { return t.id === state.activeTab; })) {
      state.activeTab = tabs.length ? tabs[0].id : null;
    }

    els.tabs.textContent = '';
    tabs.forEach(function (tab) {
      var btn = document.createElement('button');
      btn.className = 'tab' + (tab.id === state.activeTab ? ' active' : '');
      btn.type = 'button';
      var dot = document.createElement('span');
      dot.className = 'tab-dot';
      btn.appendChild(dot);
      btn.appendChild(document.createTextNode(tab.label));
      btn.addEventListener('click', function () {
        state.activeTab = tab.id;
        renderResults();
      });
      els.tabs.appendChild(btn);
    });

    showActive(tabs);
  }

  function showActive(tabs) {
    var tab = tabs.filter(function (t) { return t.id === state.activeTab; })[0] || tabs[0];
    els.previewNote.hidden = true;
    els.warnList.hidden = true;
    els.warnList.textContent = '';

    if (!tab) {
      els.preview.textContent = '—';
      els.resultPath.textContent = '—';
      return;
    }

    var text = '';
    var label = '';
    var warnings = [];

    if (tab.kind === 'doc') {
      text = tab.entry.aiMarkdown;
      label = tab.entry.output;
      warnings = tab.entry.notes || [];
    } else if (tab.kind === 'bundle') {
      text = currentBundle();
      label = 'bundle.ai.md';
    } else {
      text = currentManifest();
      label = 'manifest.ai.json';
    }

    els.resultPath.textContent = label;

    if (text.length > MAX_PREVIEW) {
      els.preview.textContent = text.slice(0, MAX_PREVIEW);
      els.previewNote.hidden = false;
      els.previewNote.textContent = 'Preview truncated at ' + fmt(MAX_PREVIEW) + ' characters. The downloaded file contains the complete output (' + U.humanBytes(text.length) + ').';
    } else {
      els.preview.textContent = text;
    }

    if (warnings.length) {
      els.warnList.hidden = false;
      warnings.forEach(function (w) {
        var li = document.createElement('li');
        li.textContent = w;
        els.warnList.appendChild(li);
      });
    }

    els.preview.scrollTop = 0;
  }

  function activeTabObject() {
    return availableTabs().filter(function (t) { return t.id === state.activeTab; })[0] || null;
  }

  /* ---------------- actions ---------------- */

  function downloadActive() {
    var tab = activeTabObject();
    if (!tab) return;
    if (tab.kind === 'doc') {
      download(U.baseName(tab.entry.output), tab.entry.aiMarkdown, 'text/markdown;charset=utf-8');
    } else if (tab.kind === 'bundle') {
      download('bundle.ai.md', currentBundle(), 'text/markdown;charset=utf-8');
    } else {
      download('manifest.ai.json', currentManifest(), 'application/json;charset=utf-8');
    }
    toast('Download started');
  }

  function downloadAll() {
    if (!state.results.length) return;
    var bytes = D2A.convert.buildOutputZip(state.results, state.failures, {
      name: state.results.length + ' documents',
      includeBundle: els.optBundle.checked,
      includeManifest: els.optManifest.checked
    });
    download('doc2ai-output.zip', bytes, 'application/zip');
    toast('ZIP with ' + state.results.length + ' AI-ready file' + (state.results.length === 1 ? '' : 's') + ' started');
  }

  async function copyActive() {
    var tab = activeTabObject();
    if (!tab) return;
    var text = tab.kind === 'doc' ? tab.entry.aiMarkdown : tab.kind === 'bundle' ? currentBundle() : currentManifest();
    var ok = await copyText(text);
    toast(ok ? 'Copied to clipboard' : 'Copy failed — use Download instead');
  }

  /* ---------------- drag & drop ---------------- */

  function walkEntry(entry, prefix, out) {
    return new Promise(function (resolve) {
      if (!entry) return resolve();
      if (entry.isFile) {
        entry.file(function (file) {
          out.push(normalizeFile(file, prefix + file.name));
          resolve();
        }, function () { resolve(); });
        return;
      }
      if (entry.isDirectory) {
        var reader = entry.createReader();
        var all = [];
        var readBatch = function () {
          reader.readEntries(function (batch) {
            if (!batch.length) {
              Promise.all(all.map(function (child) { return walkEntry(child, prefix + entry.name + '/', out); })).then(function () { resolve(); });
              return;
            }
            all = all.concat(Array.prototype.slice.call(batch));
            readBatch();
          }, function () { resolve(); });
        };
        readBatch();
        return;
      }
      resolve();
    });
  }

  async function handleDrop(event) {
    event.preventDefault();
    event.stopPropagation();
    els.dropzone.classList.remove('dragging');

    var dt = event.dataTransfer;
    if (!dt) return;

    var items = dt.items ? Array.prototype.slice.call(dt.items) : [];
    var entries = items.map(function (item) {
      try { return item.webkitGetAsEntry ? item.webkitGetAsEntry() : null; } catch (e) { return null; }
    }).filter(Boolean);

    if (!entries.length) {
      if (dt.files && dt.files.length) {
        addItems(Array.prototype.map.call(dt.files, function (f) { return normalizeFile(f); }));
      }
      return;
    }

    toast('Reading dropped items…', 1200);
    var files = [];
    for (var i = 0; i < entries.length; i++) {
      await walkEntry(entries[i], '', files);
    }
    addItems(files);
  }

  var dragDepth = 0;

  window.addEventListener('dragenter', function (e) {
    if (!e.dataTransfer || Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') < 0) return;
    dragDepth++;
    els.dropzone.classList.add('dragging');
  });

  window.addEventListener('dragover', function (e) {
    if (e.dataTransfer) e.preventDefault();
  });

  window.addEventListener('dragleave', function () {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) els.dropzone.classList.remove('dragging');
  });

  window.addEventListener('drop', function (e) {
    dragDepth = 0;
    if (!e.dataTransfer) return;
    handleDrop(e);
  });

  /* ---------------- theme ---------------- */

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('doc2ai-theme', theme); } catch (e) { /* ignore */ }
    els.themeIcon.innerHTML = theme === 'dark'
      ? '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'
      : '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>';
  }

  /* ---------------- wiring ---------------- */

  els.addFilesBtn.addEventListener('click', function () { els.fileInput.click(); });
  els.addFolderBtn.addEventListener('click', function () { els.folderInput.click(); });

  els.fileInput.addEventListener('change', function () {
    addItems(Array.prototype.map.call(els.fileInput.files, function (f) { return normalizeFile(f); }));
    els.fileInput.value = '';
  });

  els.folderInput.addEventListener('change', function () {
    addItems(Array.prototype.map.call(els.folderInput.files, function (f) { return normalizeFile(f); }));
    els.folderInput.value = '';
  });

  els.clearBtn.addEventListener('click', function () {
    if (state.converting) return;
    state.queue = [];
    state.results = [];
    state.failures = [];
    state.activeTab = null;
    renderQueue();
    renderResults();
    toast('Cleared');
  });

  els.convertBtn.addEventListener('click', convertAll);
  els.downloadBtn.addEventListener('click', downloadActive);
  els.downloadOneBtn.addEventListener('click', downloadActive);
  els.copyBtn.addEventListener('click', copyActive);
  els.copyOneBtn.addEventListener('click', copyActive);
  els.downloadAllBtn.addEventListener('click', downloadAll);

  [els.optBundle, els.optManifest].forEach(function (el) {
    el.addEventListener('change', function () { renderResults(); });
  });

  els.themeBtn.addEventListener('click', function () {
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  });

  document.addEventListener('keydown', function (e) {
    var mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === 'o' || e.key === 'O')) {
      e.preventDefault();
      els.fileInput.click();
    }
  });

  /* ---------------- boot ---------------- */

  var storedTheme = 'dark';
  try { storedTheme = localStorage.getItem('doc2ai-theme') || 'dark'; } catch (e) { /* ignore */ }
  applyTheme(storedTheme);

  var supported = D2A.convert.supportedList();
  els.supportedCount.textContent = String(supported.length);
  els.supportedCount.title = supported.join(' ');

  renderQueue();
})();
