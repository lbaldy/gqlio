// ── State ─────────────────────────────────────────────────────────────────────
const state = {
  requests:        [],
  selectedId:      null,
  overrides:       [], // [{ id, operationName, variables, response, enabled }]
  overridesPaused: false,
  recording:       true,
  filter:          '',
  activeDetailTab: 'query',
};

let modalViewMode    = 'tree'; // 'tree' | 'edit'
let currentModalId   = null;   // null = new override, string = editing existing
let currentModalVars = {};     // variables captured when opening the modal

// ── Helpers ───────────────────────────────────────────────────────────────────

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual(a[k], b[k]));
}

// Empty stored variables = wildcard (matches any request variables).
function matchesVariables(ovVars, reqVars) {
  const ov = ovVars ?? {};
  if (Object.keys(ov).length === 0) return true;
  return deepEqual(ov, reqVars ?? {});
}

// ── DOM refs ──────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const el = {
  // toolbar
  tabs:             document.querySelectorAll('.tab'),
  tabPanes:         document.querySelectorAll('.tab-pane'),
  search:           $('search'),
  btnPauseAll:      $('btn-pause-all'),
  btnClear:         $('btn-clear'),
  btnRecord:        $('btn-record'),
  // request list
  reqList:          $('req-list'),
  reqEmpty:         $('req-empty'),
  // detail
  detailPlaceholder:$('detail-placeholder'),
  detailBody:       $('detail-body'),
  detailTabs:       document.querySelectorAll('.detail-tab'),
  btnExpandAll:     $('btn-expand-all'),
  btnCollapseAll:   $('btn-collapse-all'),
  // detail find bar
  detailFindBar:    $('detail-find-bar'),
  detailFindInput:  $('detail-find-input'),
  detailFindCount:  $('detail-find-count'),
  detailFindPrev:   $('detail-find-prev'),
  detailFindNext:   $('detail-find-next'),
  detailFindClose:  $('detail-find-close'),
  // detail views
  dQuery:           $('d-query'),
  dVariables:       $('d-variables'),
  dResponse:        $('d-response'),
  dHeaders:         $('d-headers'),
  // override bar
  overrideOpLabel:  $('override-op-label'),
  overrideActiveBadge: $('override-active-badge'),
  btnSaveOverride:  $('btn-save-override'),
  // overrides tab
  overridesEmpty:   $('overrides-empty'),
  overridesList:    $('overrides-list'),
  // modal
  modal:            $('modal'),
  modalTitle:       $('modal-title'),
  modalClose:       $('modal-close'),
  modalOpName:      $('modal-op-name'),
  modalVarsWrap:    $('modal-vars-wrap'),
  // modal find bar
  modalFindBar:     $('modal-find-bar'),
  modalFindInput:   $('modal-find-input'),
  modalFindCount:   $('modal-find-count'),
  modalFindPrev:    $('modal-find-prev'),
  modalFindNext:    $('modal-find-next'),
  modalFindClose:   $('modal-find-close'),
  // modal editor
  modalTreeWrap:    $('modal-tree-wrap'),
  modalModeBtns:    document.querySelectorAll('.modal-mode-btn'),
  modalResponse:    $('modal-response'),
  modalError:       $('modal-error'),
  modalCancel:      $('modal-cancel'),
  modalSave:        $('modal-save'),
};

// ── JSON Tree builder ─────────────────────────────────────────────────────────

function buildJsonTree(value, expandDepth = 2) {
  const wrap = document.createElement('div');
  wrap.className = 'jtree';
  appendTreeNode(wrap, null, value, false, 0, expandDepth);
  return wrap;
}

function appendTreeNode(parent, key, value, addComma, depth, expandDepth) {
  const isComplex = value !== null && typeof value === 'object';

  if (!isComplex) {
    parent.appendChild(makePrimitiveRow(key, value, addComma));
    return;
  }

  const isArray = Array.isArray(value);
  const entries = isArray ? value : Object.entries(value);

  // Render empty objects/arrays inline — no toggle needed
  if (entries.length === 0) {
    const row = document.createElement('div');
    row.className = 'jtree-row';
    row.appendChild(mkSpan('jtree-spacer'));
    if (key !== null) {
      row.appendChild(mkSpan('jtree-key', `"${key}"`));
      row.appendChild(mkSpan('jtree-punct', ': '));
    }
    row.appendChild(mkSpan('jtree-brace', isArray ? '[]' : '{}'));
    if (addComma) row.appendChild(mkSpan('jtree-comma', ','));
    parent.appendChild(row);
    return;
  }

  // Opening row
  const openRow = document.createElement('div');
  openRow.className = 'jtree-row';

  const toggle = mkSpan('jtree-toggle', '▼');
  toggle.dataset.expanded = 'true';
  openRow.appendChild(toggle);

  if (key !== null) {
    openRow.appendChild(mkSpan('jtree-key', `"${key}"`));
    openRow.appendChild(mkSpan('jtree-punct', ': '));
  }

  openRow.appendChild(mkSpan('jtree-brace', isArray ? '[' : '{'));

  const summaryText = isArray
    ? `${entries.length} item${entries.length !== 1 ? 's' : ''}`
    : Object.keys(value).slice(0, 3).join(', ') + (Object.keys(value).length > 3 ? '…' : '');
  const summary   = mkSpan('jtree-summary', summaryText);
  const inlineEnd = mkSpan('jtree-brace', (isArray ? ']' : '}') + (addComma ? ',' : ''));
  summary.classList.add('hidden');
  inlineEnd.classList.add('hidden');
  openRow.appendChild(summary);
  openRow.appendChild(inlineEnd);
  parent.appendChild(openRow);

  // Children container
  const childDiv = document.createElement('div');
  childDiv.className = 'jtree-children';
  if (isArray) {
    entries.forEach((v, i) =>
      appendTreeNode(childDiv, null, v, i < entries.length - 1, depth + 1, expandDepth)
    );
  } else {
    const kvs = Object.entries(value);
    kvs.forEach(([k, v], i) =>
      appendTreeNode(childDiv, k, v, i < kvs.length - 1, depth + 1, expandDepth)
    );
  }
  parent.appendChild(childDiv);

  // Closing row
  const closeRow = document.createElement('div');
  closeRow.className = 'jtree-row';
  closeRow.appendChild(mkSpan('jtree-brace', (isArray ? ']' : '}') + (addComma ? ',' : '')));
  parent.appendChild(closeRow);

  // Apply initial expansion
  const startExpanded = depth < expandDepth;
  setExpansion(toggle, childDiv, closeRow, summary, inlineEnd, startExpanded);

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    setExpansion(toggle, childDiv, closeRow, summary, inlineEnd, toggle.dataset.expanded === 'false');
  });
}

function setExpansion(toggle, childDiv, closeRow, summary, inlineEnd, expanded) {
  toggle.dataset.expanded = expanded ? 'true' : 'false';
  toggle.textContent = expanded ? '▼' : '▶';
  childDiv.classList.toggle('hidden', !expanded);
  closeRow.classList.toggle('hidden', !expanded);
  summary.classList.toggle('hidden', expanded);
  inlineEnd.classList.toggle('hidden', expanded);
}

function makePrimitiveRow(key, value, addComma) {
  const row = document.createElement('div');
  row.className = 'jtree-row';
  row.appendChild(mkSpan('jtree-spacer'));

  if (key !== null) {
    row.appendChild(mkSpan('jtree-key', `"${key}"`));
    row.appendChild(mkSpan('jtree-punct', ': '));
  }

  let cls, text;
  if (value === null)              { cls = 'jtree-null'; text = 'null'; }
  else if (typeof value === 'string')   { cls = 'jtree-str';  text = `"${value}"`; }
  else if (typeof value === 'number')   { cls = 'jtree-num';  text = String(value); }
  else if (typeof value === 'boolean')  { cls = 'jtree-bool'; text = String(value); }
  else                                   { cls = 'jtree-str';  text = String(value); }

  row.appendChild(mkSpan(cls, text));
  if (addComma) row.appendChild(mkSpan('jtree-comma', ','));
  return row;
}

function mkSpan(cls, text = '') {
  const s = document.createElement('span');
  s.className = cls;
  if (text) s.textContent = text;
  return s;
}

function expandAllTree(container) {
  container.querySelectorAll('.jtree-toggle[data-expanded="false"]').forEach((t) => t.click());
}

function collapseAllTree(container) {
  container.querySelectorAll('.jtree-toggle[data-expanded="true"]').forEach((t) => t.click());
}

function expandAncestors(node, root) {
  let p = node.parentElement;
  while (p && p !== root) {
    if (p.classList.contains('jtree-children') && p.classList.contains('hidden')) {
      const prevRow = p.previousElementSibling;
      const toggle = prevRow?.querySelector('.jtree-toggle[data-expanded="false"]');
      if (toggle) toggle.click();
    }
    p = p.parentElement;
  }
}

// ── Detail-pane search ────────────────────────────────────────────────────────

let detailMatches = [];
let detailMatchIdx = -1;

function openDetailSearch() {
  el.detailFindBar.classList.remove('hidden');
  el.detailFindInput.focus();
  el.detailFindInput.select();
}

function closeDetailSearch() {
  clearDetailHighlights();
  el.detailFindBar.classList.add('hidden');
  el.detailFindInput.value = '';
  el.detailFindInput.classList.remove('no-match');
  el.detailFindCount.textContent = '';
  detailMatches = [];
  detailMatchIdx = -1;
}

function runDetailSearch(query) {
  clearDetailHighlights();
  detailMatches = [];
  detailMatchIdx = -1;

  if (!query.trim()) {
    el.detailFindCount.textContent = '';
    el.detailFindInput.classList.remove('no-match');
    return;
  }

  const view = activeDetailView();
  if (!view) return;
  const lq = query.toLowerCase();

  if (view.tagName === 'PRE') {
    const orig = view.dataset.origText ?? view.textContent;
    view.dataset.origText = orig;
    const escaped = escHtml(orig);
    const regex = new RegExp(`(${escRegex(escHtml(query))})`, 'gi');
    let n = 0;
    view.innerHTML = escaped.replace(regex, (m) => `<mark class="smatch" data-midx="${n++}">${m}</mark>`);
    detailMatches = Array.from(view.querySelectorAll('.smatch'));
  } else {
    const spans = view.querySelectorAll('.jtree-str,.jtree-num,.jtree-bool,.jtree-null,.jtree-key');
    spans.forEach((span) => {
      if (!span.textContent.toLowerCase().includes(lq)) return;
      const escaped = escHtml(span.textContent);
      const regex = new RegExp(`(${escRegex(escHtml(query))})`, 'gi');
      span.innerHTML = escaped.replace(regex, (m) => `<mark class="smatch">${m}</mark>`);
      expandAncestors(span, view);
      detailMatches.push(...span.querySelectorAll('.smatch'));
    });
  }

  const found = detailMatches.length > 0;
  el.detailFindInput.classList.toggle('no-match', !found && query.trim().length > 0);
  if (found) { detailMatchIdx = 0; applyDetailMatch(0); }
  updateDetailCount();
}

function navigateDetail(dir) {
  if (!detailMatches.length) return;
  detailMatchIdx = posMod(detailMatchIdx + dir, detailMatches.length);
  applyDetailMatch(detailMatchIdx);
  updateDetailCount();
}

function applyDetailMatch(idx) {
  detailMatches.forEach((m, i) => m.classList.toggle('current', i === idx));
  detailMatches[idx]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function clearDetailHighlights() {
  const view = activeDetailView();
  if (!view) return;

  if (view.tagName === 'PRE') {
    const orig = view.dataset.origText;
    if (orig !== undefined) { view.textContent = orig; delete view.dataset.origText; }
  } else {
    const parents = new Set();
    view.querySelectorAll('.smatch').forEach((m) => { if (m.parentElement) parents.add(m.parentElement); });
    parents.forEach((span) => { span.textContent = span.textContent; });
  }
}

function updateDetailCount() {
  el.detailFindCount.textContent = detailMatches.length
    ? `${detailMatchIdx + 1} / ${detailMatches.length}`
    : (el.detailFindInput.value ? '0 / 0' : '');
}

function activeDetailView() {
  return { query: el.dQuery, variables: el.dVariables, response: el.dResponse, headers: el.dHeaders }[state.activeDetailTab];
}

// ── Modal textarea search ─────────────────────────────────────────────────────

let modalMatches = [];
let modalMatchIdx = -1;

function openModalSearch() {
  el.modalFindBar.classList.remove('hidden');
  el.modalFindInput.focus();
  el.modalFindInput.select();
}

function closeModalSearch() {
  clearModalHighlights();
  el.modalFindBar.classList.add('hidden');
  el.modalFindInput.value = '';
  el.modalFindInput.classList.remove('no-match');
  el.modalFindCount.textContent = '';
  modalMatches = [];
  modalMatchIdx = -1;
}

function clearModalHighlights() {
  if (modalViewMode === 'tree') {
    const parents = new Set();
    el.modalTreeWrap.querySelectorAll('.smatch').forEach((m) => { if (m.parentElement) parents.add(m.parentElement); });
    parents.forEach((span) => { span.textContent = span.textContent; });
  }
}

function runModalSearch(query) {
  clearModalHighlights();
  modalMatches = [];
  modalMatchIdx = -1;

  if (!query.trim()) {
    el.modalFindInput.classList.remove('no-match');
    el.modalFindCount.textContent = '';
    return;
  }

  if (modalViewMode === 'tree') {
    const lq = query.toLowerCase();
    const spans = el.modalTreeWrap.querySelectorAll('.jtree-str,.jtree-num,.jtree-bool,.jtree-null,.jtree-key');
    spans.forEach((span) => {
      if (!span.textContent.toLowerCase().includes(lq)) return;
      const escaped = escHtml(span.textContent);
      const regex = new RegExp(`(${escRegex(escHtml(query))})`, 'gi');
      span.innerHTML = escaped.replace(regex, (m) => `<mark class="smatch">${m}</mark>`);
      expandAncestors(span, el.modalTreeWrap);
      modalMatches.push(...span.querySelectorAll('.smatch'));
    });
    const found = modalMatches.length > 0;
    el.modalFindInput.classList.toggle('no-match', !found && query.trim().length > 0);
    if (found) { modalMatchIdx = 0; applyModalMatch(0); }
  } else {
    const text = el.modalResponse.value;
    const lq = query.toLowerCase();
    let i = 0;
    while (true) {
      const idx = text.toLowerCase().indexOf(lq, i);
      if (idx === -1) break;
      modalMatches.push({ start: idx, end: idx + query.length });
      i = idx + 1;
    }
    const found = modalMatches.length > 0;
    el.modalFindInput.classList.toggle('no-match', !found);
    if (found) { modalMatchIdx = 0; applyModalMatch(0); }
  }

  updateModalCount();
}

function navigateModal(dir) {
  if (!modalMatches.length) return;
  modalMatchIdx = posMod(modalMatchIdx + dir, modalMatches.length);
  applyModalMatch(modalMatchIdx);
  updateModalCount();
}

function applyModalMatch(idx) {
  if (modalViewMode === 'tree') {
    modalMatches.forEach((m, i) => m.classList.toggle('current', i === idx));
    modalMatches[idx]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  } else {
    const m = modalMatches[idx];
    if (!m) return;
    el.modalResponse.focus();
    el.modalResponse.setSelectionRange(m.start, m.end);
    const linesBefore = el.modalResponse.value.substring(0, m.start).split('\n').length;
    el.modalResponse.scrollTop = Math.max(0, (linesBefore - 4) * 18);
    el.modalFindInput.focus();
  }
}

function updateModalCount() {
  el.modalFindCount.textContent = modalMatches.length
    ? `${modalMatchIdx + 1} / ${modalMatches.length}`
    : (el.modalFindInput.value ? '0 / 0' : '');
}

// ── Modal view mode (tree ↔ edit) ─────────────────────────────────────────────

function switchModalMode(mode) {
  if (mode === 'tree') {
    let val;
    try { val = JSON.parse(el.modalResponse.value); }
    catch (e) {
      el.modalError.textContent = `Fix JSON before switching to tree: ${e.message}`;
      el.modalError.classList.remove('hidden');
      return;
    }
    el.modalError.classList.add('hidden');
    el.modalTreeWrap.innerHTML = '';
    el.modalTreeWrap.appendChild(buildJsonTree(val, 2));
    el.modalTreeWrap.classList.remove('hidden');
    el.modalResponse.classList.add('hidden');
  } else {
    clearModalHighlights();
    el.modalTreeWrap.classList.add('hidden');
    el.modalResponse.classList.remove('hidden');
    el.modalResponse.focus();
  }

  modalViewMode = mode;
  el.modalModeBtns.forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));

  const q = el.modalFindInput.value;
  if (q && !el.modalFindBar.classList.contains('hidden')) runModalSearch(q);
}

// ── Misc helpers ──────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function escRegex(str) { return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function posMod(n, m)  { return ((n % m) + m) % m; }

// ── Network capture ───────────────────────────────────────────────────────────

function onRequestFinished(har) {
  if (!state.recording || har.request.method !== 'POST') return;

  const postText = har.request.postData?.text;
  if (!postText) return;

  let body;
  try { body = JSON.parse(postText); } catch { return; }

  const ops = Array.isArray(body) ? body : [body];
  const first = ops[0];
  if (!first?.query && !first?.operationName) return;

  const opName = first.operationName || extractOpName(first.query) || 'anonymous';
  const displayName = Array.isArray(body) ? `[Batch] ${opName}` : opName;

  har.getContent((responseText) => {
    let response;
    try { response = JSON.parse(responseText); } catch { response = responseText; }

    state.requests.unshift({
      id:            uid(),
      operationName: displayName,
      url:           har.request.url,
      query:         first.query ?? '',
      variables:     first.variables ?? {},
      response,
      status:        har.response.status,
      time:          Math.round(har.time),
      reqHeaders:    har.request.headers,
      resHeaders:    har.response.headers,
    });
    renderRequestList();
  });
}

function extractOpName(query) {
  const m = (query ?? '').match(/(?:query|mutation|subscription)\s+(\w+)/);
  return m ? m[1] : null;
}

function uid() { return Math.random().toString(36).slice(2); }

// ── Render: request list ──────────────────────────────────────────────────────

function renderRequestList() {
  const visible = state.requests.filter(
    (r) => !state.filter || r.operationName.toLowerCase().includes(state.filter)
  );

  el.reqEmpty.style.display = visible.length ? 'none' : '';
  el.reqList.innerHTML = '';

  visible.forEach((req) => {
    const div = document.createElement('div');
    div.className = 'req-item';
    if (req.id === state.selectedId) div.classList.add('selected');

    const hasActiveOverride = !state.overridesPaused && state.overrides.some(
      (ov) => ov.enabled && ov.operationName === req.operationName &&
               matchesVariables(ov.variables, req.variables)
    );
    if (hasActiveOverride) div.classList.add('mocked');

    const ok = req.status >= 200 && req.status < 300;
    div.innerHTML =
      `<span class="req-name" title="${req.operationName}">${req.operationName}</span>` +
      `<span class="${ok ? 'req-status-ok' : 'req-status-err'}">${req.status}</span>` +
      `<span class="req-time">${req.time}</span>`;

    div.addEventListener('click', () => selectRequest(req.id));
    el.reqList.appendChild(div);
  });
}

// ── Render: detail pane ───────────────────────────────────────────────────────

function selectRequest(id) {
  state.selectedId = id;
  renderRequestList();
  const req = state.requests.find((r) => r.id === id);
  if (!req) return;

  el.detailPlaceholder.classList.add('hidden');
  el.detailBody.classList.remove('hidden');
  el.overrideOpLabel.textContent = req.operationName;

  const hasOverride = state.overrides.some(
    (ov) => ov.enabled && ov.operationName === req.operationName &&
             matchesVariables(ov.variables, req.variables)
  );
  el.overrideActiveBadge.classList.toggle('hidden', !hasOverride || state.overridesPaused);

  renderDetailContent(req);
}

function renderDetailContent(req) {
  closeDetailSearch();

  el.dQuery.textContent = req.query || '(no query)';

  el.dVariables.innerHTML = '';
  el.dVariables.appendChild(buildJsonTree(req.variables ?? {}));

  el.dResponse.innerHTML = '';
  el.dResponse.appendChild(buildJsonTree(req.response));

  el.dHeaders.textContent = formatHeaders(req.reqHeaders, req.resHeaders);

  showActiveDetailView();
}

function showActiveDetailView() {
  const views = { query: el.dQuery, variables: el.dVariables, response: el.dResponse, headers: el.dHeaders };
  const isTree = ['variables', 'response'].includes(state.activeDetailTab);

  Object.entries(views).forEach(([key, node]) => {
    node.classList.toggle('hidden', key !== state.activeDetailTab);
  });

  el.btnExpandAll.classList.toggle('hidden', !isTree);
  el.btnCollapseAll.classList.toggle('hidden', !isTree);
}

function formatHeaders(req, res) {
  const fmt = (arr) => (arr ?? []).map((h) => `${h.name}: ${h.value}`).join('\n');
  return `── Request Headers ──\n${fmt(req)}\n\n── Response Headers ──\n${fmt(res)}`;
}

// ── Pause all overrides ───────────────────────────────────────────────────────

function togglePauseAll() {
  state.overridesPaused = !state.overridesPaused;
  persistAndSync();
  updatePauseBtn();
  renderRequestList();
  const req = state.requests.find((r) => r.id === state.selectedId);
  if (req) {
    const hasOverride = state.overrides.some(
      (ov) => ov.enabled && ov.operationName === req.operationName &&
               matchesVariables(ov.variables, req.variables)
    );
    el.overrideActiveBadge.classList.toggle('hidden', !hasOverride || state.overridesPaused);
  }
}

function updatePauseBtn() {
  const anyOverrides = state.overrides.length > 0;
  el.btnPauseAll.disabled = !anyOverrides;
  el.btnPauseAll.classList.toggle('paused', state.overridesPaused);
  el.btnPauseAll.textContent = state.overridesPaused ? '▶ Overrides' : '⏸ Overrides';
  el.btnPauseAll.title = state.overridesPaused ? 'Resume all overrides' : 'Pause all overrides';
}

// ── Overrides: storage + sync ─────────────────────────────────────────────────

function loadOverrides() {
  chrome.storage.local.get(['gqlOverrides', 'gqlOverridesPaused'], (res) => {
    let saved = res.gqlOverrides ?? [];
    // Migrate from old object format { opName: { enabled, response } } to array.
    if (!Array.isArray(saved)) {
      saved = Object.entries(saved).map(([opName, ov]) => ({
        id:            uid(),
        operationName: opName,
        variables:     {},
        response:      ov.response,
        enabled:       ov.enabled ?? true,
      }));
    }
    state.overrides       = saved;
    state.overridesPaused = res.gqlOverridesPaused ?? false;
    renderOverrides();
    updatePauseBtn();
    persistAndSync();
  });
}

function persistAndSync() {
  if (!chrome.runtime?.id) return; // Extension context invalidated — bail silently.
  try {
    chrome.storage.local.set({ gqlOverrides: state.overrides, gqlOverridesPaused: state.overridesPaused });
    const toSync = state.overridesPaused ? [] : state.overrides;
    chrome.devtools.inspectedWindow.eval(
      `window.__gqlOverrides = ${JSON.stringify(toSync)}`,
      (_result, isException) => {
        if (isException) console.warn('GQL DevTools: eval failed — page context may not be ready yet');
      }
    );
  } catch (e) {
    console.warn('GQL DevTools: persistAndSync failed', e.message);
  }
}

// ── Render: overrides tab ─────────────────────────────────────────────────────

function renderOverrides() {
  el.overridesEmpty.style.display = state.overrides.length ? 'none' : '';
  el.overridesList.innerHTML = '';
  updatePauseBtn();

  state.overrides.forEach((ov) => {
    const card = document.createElement('div');
    card.className = `ov-card${ov.enabled ? '' : ' disabled'}`;

    const hasVars = ov.variables && Object.keys(ov.variables).length > 0;
    const varLine = hasVars
      ? `<div class="ov-vars">${escHtml(JSON.stringify(ov.variables)).slice(0, 120)}</div>`
      : `<div class="ov-vars ov-vars-any">(matches any variables)</div>`;
    const preview = escHtml(JSON.stringify(ov.response)).slice(0, 120);

    card.innerHTML =
      `<div class="ov-head">` +
        `<span class="ov-name">${escHtml(ov.operationName)}</span>` +
        `<button class="ov-toggle ${ov.enabled ? 'on' : 'off'}">${ov.enabled ? 'Enabled' : 'Disabled'}</button>` +
        `<button class="ov-edit">Edit</button>` +
        `<button class="ov-del">Delete</button>` +
      `</div>` +
      varLine +
      `<div class="ov-preview">${preview}…</div>`;

    card.querySelector('.ov-toggle').addEventListener('click', () => toggleOverride(ov.id));
    card.querySelector('.ov-edit').addEventListener('click', () =>
      openModal(ov.id, ov.operationName, ov.variables ?? {}, JSON.stringify(ov.response, null, 2))
    );
    card.querySelector('.ov-del').addEventListener('click', () => deleteOverride(ov.id));
    el.overridesList.appendChild(card);
  });
}

function toggleOverride(id) {
  const ov = state.overrides.find((o) => o.id === id);
  if (!ov) return;
  ov.enabled = !ov.enabled;
  persistAndSync();
  renderOverrides();
  renderRequestList();
}

function deleteOverride(id) {
  state.overrides = state.overrides.filter((o) => o.id !== id);
  persistAndSync();
  renderOverrides();
  renderRequestList();
}

// ── Override editor modal ─────────────────────────────────────────────────────

function openModal(id, opName, variables, responseJson) {
  currentModalId   = id;        // null = new override
  currentModalVars = variables;

  el.modalTitle.textContent = id ? 'Edit Override' : 'New Override';
  el.modalOpName.value = opName;
  el.modalResponse.value = responseJson;
  el.modalError.classList.add('hidden');
  closeModalSearch();

  // Render the variables this override will match against (read-only).
  el.modalVarsWrap.innerHTML = '';
  const hasVars = variables && Object.keys(variables).length > 0;
  if (hasVars) {
    el.modalVarsWrap.appendChild(buildJsonTree(variables, 2));
  } else {
    const hint = document.createElement('span');
    hint.className = 'ov-vars-any';
    hint.textContent = 'any — matches all requests for this operation';
    el.modalVarsWrap.appendChild(hint);
  }

  // Open in tree mode.
  modalViewMode = 'edit';
  el.modalResponse.classList.remove('hidden');
  el.modalTreeWrap.classList.add('hidden');
  switchModalMode('tree');

  el.modal.classList.remove('hidden');
}

function closeModal() {
  el.modal.classList.add('hidden');
  closeModalSearch();
  currentModalId   = null;
  currentModalVars = {};
}

function saveModal() {
  let parsed;
  try {
    parsed = JSON.parse(el.modalResponse.value);
  } catch (e) {
    el.modalError.textContent = `Invalid JSON: ${e.message}`;
    el.modalError.classList.remove('hidden');
    return;
  }

  if (currentModalId) {
    // Editing an existing override — update only the response.
    const ov = state.overrides.find((o) => o.id === currentModalId);
    if (ov) { ov.response = parsed; ov.enabled = true; }
  } else {
    // New override.
    state.overrides.push({
      id:            uid(),
      operationName: el.modalOpName.value.trim(),
      variables:     currentModalVars,
      response:      parsed,
      enabled:       true,
      savedAt:       Date.now(),
    });
  }

  persistAndSync();
  renderOverrides();
  renderRequestList();

  const req = state.requests.find((r) => r.id === state.selectedId);
  if (req && !state.overridesPaused) {
    const hasOverride = state.overrides.some(
      (ov) => ov.enabled && ov.operationName === req.operationName &&
               matchesVariables(ov.variables, req.variables)
    );
    el.overrideActiveBadge.classList.toggle('hidden', !hasOverride);
  }

  closeModal();
}

// ── Event wiring ──────────────────────────────────────────────────────────────

function wireEvents() {
  // Top-level tabs
  el.tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      el.tabs.forEach((t) => t.classList.toggle('active', t === tab));
      el.tabPanes.forEach((p) => {
        const match = p.id === `tab-${tab.dataset.tab}`;
        p.classList.toggle('active', match);
        p.classList.toggle('hidden', !match);
      });
    });
  });

  // Detail sub-tabs
  el.detailTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      state.activeDetailTab = tab.dataset.detail;
      el.detailTabs.forEach((t) => t.classList.toggle('active', t === tab));
      closeDetailSearch();
      showActiveDetailView();
    });
  });

  // Expand / collapse all tree
  el.btnExpandAll.addEventListener('click', () => {
    const v = activeDetailView();
    if (v) expandAllTree(v);
  });
  el.btnCollapseAll.addEventListener('click', () => {
    const v = activeDetailView();
    if (v) collapseAllTree(v);
  });

  // ── Detail find bar ──
  el.detailFindInput.addEventListener('input', () => runDetailSearch(el.detailFindInput.value));
  el.detailFindInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter')  { e.preventDefault(); navigateDetail(e.shiftKey ? -1 : 1); }
    if (e.key === 'Escape') { e.preventDefault(); closeDetailSearch(); }
  });
  el.detailFindPrev.addEventListener('click',  () => navigateDetail(-1));
  el.detailFindNext.addEventListener('click',  () => navigateDetail(1));
  el.detailFindClose.addEventListener('click', () => closeDetailSearch());

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
      const modalOpen  = !el.modal.classList.contains('hidden');
      const detailOpen = !el.detailBody.classList.contains('hidden');
      if (!modalOpen && detailOpen) { e.preventDefault(); openDetailSearch(); return; }
      if (modalOpen)                { e.preventDefault(); openModalSearch(); }
    }
  });

  // ── Modal find bar ──
  el.modalFindInput.addEventListener('input', () => runModalSearch(el.modalFindInput.value));
  el.modalFindInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter')  { e.preventDefault(); navigateModal(e.shiftKey ? -1 : 1); }
    if (e.key === 'Escape') { e.preventDefault(); closeModalSearch(); }
  });
  el.modalFindPrev.addEventListener('click',  () => navigateModal(-1));
  el.modalFindNext.addEventListener('click',  () => navigateModal(1));
  el.modalFindClose.addEventListener('click', () => closeModalSearch());

  el.modalResponse.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'f') { e.preventDefault(); openModalSearch(); }
    if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); saveModal(); }
  });

  // Search / filter
  el.search.addEventListener('input', () => {
    state.filter = el.search.value.trim().toLowerCase();
    renderRequestList();
  });

  // Pause all overrides
  el.btnPauseAll.addEventListener('click', togglePauseAll);

  // Clear
  el.btnClear.addEventListener('click', () => {
    state.requests = [];
    state.selectedId = null;
    el.detailPlaceholder.classList.remove('hidden');
    el.detailBody.classList.add('hidden');
    closeDetailSearch();
    renderRequestList();
  });

  // Record toggle
  el.btnRecord.addEventListener('click', () => {
    state.recording = !state.recording;
    el.btnRecord.classList.toggle('active', state.recording);
    el.btnRecord.textContent = state.recording ? '● Recording' : '○ Paused';
  });

  // Save as Override — match on both operation name AND variables
  el.btnSaveOverride.addEventListener('click', () => {
    const req = state.requests.find((r) => r.id === state.selectedId);
    if (!req) return;
    const existing = state.overrides.find(
      (ov) => ov.operationName === req.operationName &&
               matchesVariables(ov.variables, req.variables)
    );
    openModal(
      existing?.id ?? null,
      req.operationName,
      req.variables ?? {},
      JSON.stringify(existing ? existing.response : req.response, null, 2)
    );
  });

  // Modal mode toggle (Tree / Edit)
  el.modalModeBtns.forEach((btn) => {
    btn.addEventListener('click', () => switchModalMode(btn.dataset.mode));
  });

  // Modal controls
  el.modalClose.addEventListener('click',  closeModal);
  el.modalCancel.addEventListener('click', closeModal);
  el.modalSave.addEventListener('click',   saveModal);
  el.modal.addEventListener('click', (e) => { if (e.target === el.modal) closeModal(); });
}

// ── Background port ───────────────────────────────────────────────────────────

function connectToBackground() {
  if (!chrome.runtime?.id) return; // Extension context invalidated — give up.
  try {
    const port = chrome.runtime.connect({ name: 'gql-panel' });
    port.postMessage({ type: 'GQL_PANEL_INIT', tabId: chrome.devtools.inspectedWindow.tabId });
    port.onDisconnect.addListener(() => {
      if (!chrome.runtime?.id) return; // Truly invalidated — DevTools needs reload.
      // Service worker was restarted (not a real DevTools close). Reconnect and
      // re-push overrides because background will have cleared them on disconnect.
      setTimeout(() => {
        connectToBackground();
        persistAndSync();
      }, 200);
    });
  } catch (e) {
    console.warn('GQL DevTools: could not connect to background', e.message);
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

function init() {
  connectToBackground();
  loadOverrides();
  wireEvents();
  chrome.devtools.network.onRequestFinished.addListener(onRequestFinished);
  chrome.devtools.network.onNavigated.addListener(() => persistAndSync());
}

init();
