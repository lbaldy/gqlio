;(function (factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    // Node / Vitest: export pure functions, skip browser side-effects.
    module.exports = factory(null);
  } else {
    // Browser: run normally with the real window.
    factory(typeof window !== 'undefined' ? window : null);
  }
}(function (win) {
  'use strict';

  if (win) {
    // Preserve any override array the panel's eval set before this script loaded.
    win.__gqlOverrides = win.__gqlOverrides || [];

    // Secondary channel: content script pushes overrides from storage via postMessage
    // as a fallback for when the panel's eval misses the navigation.
    win.addEventListener('message', (event) => {
      if (event.source === win && event.data?.type === 'GQL_UPDATE_OVERRIDES') {
        win.__gqlOverrides = event.data.overrides ?? [];
      }
    });
  }

  // ── Pure functions ───────────────────────────────────────────────────────────

  function deepEqual(a, b) {
    if (a === b) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => deepEqual(a[k], b[k]));
  }

  function extractOperationName(query) {
    if (!query) return null;
    const m = query.match(/(?:query|mutation|subscription)\s+(\w+)/);
    return m ? m[1] : null;
  }

  // The optional `overrides` parameter lets tests inject the active list without
  // touching window — in production the browser passes nothing and win.__gqlOverrides is used.
  function findOverride(body, overrides) {
    const active = overrides !== undefined ? overrides : (win?.__gqlOverrides ?? []);

    if (typeof body !== 'string') return null;
    let parsed;
    try { parsed = JSON.parse(body); } catch { return null; }

    const op = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!op?.query && !op?.operationName) return null;

    const opName = op.operationName || extractOperationName(op.query) || 'anonymous';
    const reqVars = op.variables ?? {};

    const candidates = active.filter((ov) => ov.enabled && ov.operationName === opName);
    if (!candidates.length) return null;

    // Prefer exact variable match; fall back to wildcard (empty variables = any).
    const exact = candidates.find((ov) => {
      const ovVars = ov.variables ?? {};
      return Object.keys(ovVars).length > 0 && deepEqual(ovVars, reqVars);
    });
    if (exact) return exact;

    return candidates.find((ov) => !ov.variables || Object.keys(ov.variables).length === 0) ?? null;
  }

  // ── Browser side-effects (fetch + XHR patching) ──────────────────────────────

  if (win) {
    const originalFetch = win.fetch;
    win.fetch = async function (resource, init) {
      const method = (
        init?.method ||
        (resource instanceof Request ? resource.method : 'GET')
      ).toUpperCase();

      if (method === 'POST') {
        let body = init?.body ?? (resource instanceof Request ? await resource.clone().text() : null);
        const override = findOverride(body);
        if (override) {
          return new Response(JSON.stringify(override.response), {
            status: 200,
            statusText: 'OK',
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }

      return originalFetch.call(this, resource, init);
    };

    const origOpen = win.XMLHttpRequest.prototype.open;
    const origSend = win.XMLHttpRequest.prototype.send;

    win.XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this._gqlMethod = method;
      this._gqlUrl = url;
      return origOpen.call(this, method, url, ...rest);
    };

    win.XMLHttpRequest.prototype.send = function (body) {
      if (this._gqlMethod?.toUpperCase() === 'POST') {
        const override = findOverride(typeof body === 'string' ? body : null);
        if (override) {
          const xhr = this;
          const text = JSON.stringify(override.response);
          Object.defineProperty(xhr, 'readyState',  { get: () => 4, configurable: true });
          Object.defineProperty(xhr, 'status',       { get: () => 200, configurable: true });
          Object.defineProperty(xhr, 'statusText',   { get: () => 'OK', configurable: true });
          Object.defineProperty(xhr, 'responseText', { get: () => text, configurable: true });
          Object.defineProperty(xhr, 'response',     { get: () => text, configurable: true });
          Object.defineProperty(xhr, 'responseURL',  { get: () => this._gqlUrl ?? '', configurable: true });
          setTimeout(() => {
            if (typeof xhr.onreadystatechange === 'function') xhr.onreadystatechange();
            if (typeof xhr.onload === 'function') xhr.onload();
            xhr.dispatchEvent(new ProgressEvent('readystatechange'));
            xhr.dispatchEvent(new ProgressEvent('load'));
            xhr.dispatchEvent(new ProgressEvent('loadend'));
          }, 0);
          return;
        }
      }
      return origSend.call(this, body);
    };
  }

  return { deepEqual, extractOperationName, findOverride };
}));
