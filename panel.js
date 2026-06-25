// ── State ─────────────────────────────────────────────────────────────────────
const state = {
  requests:        [],   // [{id, operationName, url, query, variables, response, status, time, reqHeaders, resHeaders}]
  selectedId:      null,
  overrides:       {},   // operationName -> {enabled, response}
  recording:       true,
  filter:          '',
  activeDetailTab: 'query',
};

// ── DOM refs ──────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const el = {
  tabs:            document.querySelectorAll('.tab'),
  tabPanes:        document.querySelectorAll('.tab-pane'),
  reqList:         $('req-list'),
  reqEmpty:        $('req-empty'),
  search:          $('search'),
  btnClear:        $('btn-clear'),
  btnRecord:       $('btn-record'),
  detailPlaceholder: $('detail-placeholder'),
  detailBody:      $('detail-body'),
  detailTabs:      document.querySelectorAll('.detail-tab'),
  dQuery:          $('d-query'),
  dVariables:      $('d-variables'),
  dResponse:       $('d-response'),
  dHeaders:        $('d-headers'),
  overrideBar:     $('override-bar'),
  overrideOpLabel: $('override-op-label'),
  overrideActiveBadge: $('override-active-badge'),
  btnSaveOverride: $('btn-save-override'),
  overridesEmpty:  $('overrides-empty'),
  overridesList:   $('overrides-list'),
  modal:           $('modal'),
  modalTitle:      $('modal-title'),
  modalClose:      $('modal-close'),
  modalOpName:     $('modal-op-name'),
  modalResponse:   $('modal-response'),
  modalError:      $('modal-error'),
  modalCancel:     $('modal-cancel'),
  modalSave:       $('modal-save'),
};

// ── Initialise ────────────────────────────────────────────────────────────────
function init() {
  loadOverrides();
  wireEvents();
  chrome.devtools.network.onRequestFinished.addListener(onRequestFinished);
}

// ── Network capture ───────────────────────────────────────────────────────────
function onRequestFinished(har) {
  if (!state.recording) return;
  if (har.request.method !== 'POST') return;

  const postText = har.request.postData?.text;
  if (!postText) return;

  let body;
  try { body = JSON.parse(postText); } catch { return; }

  // Support both single and batched operations.
  const ops = Array.isArray(body) ? body : [body];
  const first = ops[0];
  if (!first?.query && !first?.operationName) return;

  const opName = first.operationName || extractOpName(first.query) || 'anonymous';
  const displayName = Array.isArray(body) ? `[Batch] ${opName}` : opName;

  har.getContent((responseText) => {
    let response;
    try { response = JSON.parse(responseText); } catch { response = responseText; }

    state.requests.unshift({
      id:           uid(),
      operationName: displayName,
      url:          har.request.url,
      query:        first.query ?? '',
      variables:    first.variables ?? {},
      extensions:   first.extensions,
      response,
      status:       har.response.status,
      time:         Math.round(har.time),
      reqHeaders:   har.request.headers,
      resHeaders:   har.response.headers,
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
    const hasOverride = state.overrides[req.operationName]?.enabled;
    if (hasOverride) div.classList.add('mocked');

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

  const hasOverride = !!state.overrides[req.operationName]?.enabled;
  el.overrideActiveBadge.classList.toggle('hidden', !hasOverride);

  renderDetailContent(req);
}

function renderDetailContent(req) {
  const map = {
    query:     JSON.stringify(req.query, null, 2).replace(/^"|"$/g, '').replace(/\\n/g, '\n').replace(/\\t/g, '\t'),
    variables: JSON.stringify(req.variables ?? {}, null, 2),
    response:  JSON.stringify(req.response, null, 2),
    headers:   formatHeaders(req.reqHeaders, req.resHeaders),
  };

  const views = { query: el.dQuery, variables: el.dVariables, response: el.dResponse, headers: el.dHeaders };
  Object.entries(views).forEach(([key, node]) => {
    node.textContent = map[key];
    node.classList.toggle('hidden', key !== state.activeDetailTab);
  });
}

function formatHeaders(req, res) {
  const fmt = (arr) => (arr ?? []).map((h) => `${h.name}: ${h.value}`).join('\n');
  return `── Request Headers ──\n${fmt(req)}\n\n── Response Headers ──\n${fmt(res)}`;
}

// ── Overrides: storage + sync ─────────────────────────────────────────────────
function loadOverrides() {
  chrome.storage.local.get('gqlOverrides', (res) => {
    state.overrides = res.gqlOverrides ?? {};
    renderOverrides();
  });
}

function persistAndSync() {
  chrome.storage.local.set({ gqlOverrides: state.overrides });

  // Push updated overrides into the inspected page via background relay.
  chrome.runtime.sendMessage({
    type: 'GQL_RELAY',
    tabId: chrome.devtools.inspectedWindow.tabId,
    payload: { type: 'GQL_SET_OVERRIDES', overrides: state.overrides },
  });
}

// ── Render: overrides tab ─────────────────────────────────────────────────────
function renderOverrides() {
  const keys = Object.keys(state.overrides);
  el.overridesEmpty.style.display = keys.length ? 'none' : '';
  el.overridesList.innerHTML = '';

  keys.forEach((key) => {
    const ov = state.overrides[key];
    const card = document.createElement('div');
    card.className = `ov-card${ov.enabled ? '' : ' disabled'}`;

    const preview = JSON.stringify(ov.response).slice(0, 120);
    card.innerHTML =
      `<div class="ov-head">` +
        `<span class="ov-name">${key}</span>` +
        `<button class="ov-toggle ${ov.enabled ? 'on' : 'off'}" data-key="${key}">${ov.enabled ? 'Enabled' : 'Disabled'}</button>` +
        `<button class="ov-edit" data-key="${key}">Edit</button>` +
        `<button class="ov-del"  data-key="${key}">Delete</button>` +
      `</div>` +
      `<div class="ov-preview">${preview}…</div>`;

    card.querySelector('.ov-toggle').addEventListener('click', () => toggleOverride(key));
    card.querySelector('.ov-edit').addEventListener('click', () =>
      openModal(key, JSON.stringify(ov.response, null, 2), true)
    );
    card.querySelector('.ov-del').addEventListener('click', () => deleteOverride(key));

    el.overridesList.appendChild(card);
  });
}

function toggleOverride(key) {
  if (!state.overrides[key]) return;
  state.overrides[key].enabled = !state.overrides[key].enabled;
  persistAndSync();
  renderOverrides();
  renderRequestList();
  // Refresh active-override badge if this op is currently selected.
  const req = state.requests.find((r) => r.id === state.selectedId);
  if (req?.operationName === key) {
    el.overrideActiveBadge.classList.toggle('hidden', !state.overrides[key].enabled);
  }
}

function deleteOverride(key) {
  delete state.overrides[key];
  persistAndSync();
  renderOverrides();
  renderRequestList();
}

// ── Modal ─────────────────────────────────────────────────────────────────────
function openModal(opName, responseJson, isEdit) {
  el.modalTitle.textContent = isEdit ? 'Edit Override' : 'New Override';
  el.modalOpName.value = opName;
  el.modalResponse.value = responseJson;
  el.modalError.classList.add('hidden');
  el.modal.classList.remove('hidden');
  el.modalResponse.focus();
}

function closeModal() {
  el.modal.classList.add('hidden');
}

function saveModal() {
  const key = el.modalOpName.value.trim();
  let parsed;
  try {
    parsed = JSON.parse(el.modalResponse.value);
  } catch (e) {
    el.modalError.textContent = `Invalid JSON: ${e.message}`;
    el.modalError.classList.remove('hidden');
    return;
  }

  state.overrides[key] = { enabled: true, response: parsed, savedAt: Date.now() };
  persistAndSync();
  renderOverrides();
  renderRequestList();

  // If the selected request matches this op, update the badge.
  const req = state.requests.find((r) => r.id === state.selectedId);
  if (req?.operationName === key) el.overrideActiveBadge.classList.remove('hidden');

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
      const req = state.requests.find((r) => r.id === state.selectedId);
      if (req) renderDetailContent(req);
    });
  });

  // Search
  el.search.addEventListener('input', () => {
    state.filter = el.search.value.trim().toLowerCase();
    renderRequestList();
  });

  // Clear
  el.btnClear.addEventListener('click', () => {
    state.requests = [];
    state.selectedId = null;
    el.detailPlaceholder.classList.remove('hidden');
    el.detailBody.classList.add('hidden');
    renderRequestList();
  });

  // Record toggle
  el.btnRecord.addEventListener('click', () => {
    state.recording = !state.recording;
    el.btnRecord.classList.toggle('active', state.recording);
    el.btnRecord.textContent = state.recording ? '● Recording' : '○ Paused';
  });

  // Save as Override
  el.btnSaveOverride.addEventListener('click', () => {
    const req = state.requests.find((r) => r.id === state.selectedId);
    if (!req) return;
    const existing = state.overrides[req.operationName];
    const json = existing
      ? JSON.stringify(existing.response, null, 2)
      : JSON.stringify(req.response, null, 2);
    openModal(req.operationName, json, !!existing);
  });

  // Modal controls
  el.modalClose.addEventListener('click',  closeModal);
  el.modalCancel.addEventListener('click', closeModal);
  el.modalSave.addEventListener('click',   saveModal);
  el.modal.addEventListener('click', (e) => { if (e.target === el.modal) closeModal(); });

  // Cmd/Ctrl+S inside modal
  el.modalResponse.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); saveModal(); }
  });
}

init();
