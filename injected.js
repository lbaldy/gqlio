(function () {
  // Array of { id, operationName, variables, response, enabled }.
  // Preserve any value the panel's eval set before this script loaded.
  window.__gqlOverrides = window.__gqlOverrides || [];

  // Secondary channel: content script pushes overrides from storage via postMessage
  // as a fallback for when the panel's eval misses the navigation.
  window.addEventListener('message', (event) => {
    if (event.source === window && event.data?.type === 'GQL_UPDATE_OVERRIDES') {
      window.__gqlOverrides = event.data.overrides ?? [];
    }
  });

  function deepEqual(a, b) {
    if (a === b) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => deepEqual(a[k], b[k]));
  }

  function extractOperationName(query) {
    if (!query) return null;
    const m = query.match(/(?:query|mutation|subscription)\s+(\w+)/);
    return m ? m[1] : null;
  }

  function findOverride(body) {
    if (typeof body !== 'string') return null;
    let parsed;
    try { parsed = JSON.parse(body); } catch { return null; }

    const op = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!op?.query && !op?.operationName) return null;

    const opName = op.operationName || extractOperationName(op.query) || 'anonymous';
    const reqVars = op.variables ?? {};

    const candidates = window.__gqlOverrides.filter(
      (ov) => ov.enabled && ov.operationName === opName
    );
    if (!candidates.length) return null;

    // Prefer exact variable match; fall back to wildcard (empty variables = any).
    const exact = candidates.find((ov) => {
      const ovVars = ov.variables ?? {};
      return Object.keys(ovVars).length > 0 && deepEqual(ovVars, reqVars);
    });
    if (exact) return exact;

    return candidates.find((ov) => !ov.variables || Object.keys(ov.variables).length === 0) ?? null;
  }

  // ── Patch fetch ──────────────────────────────────────────────────────────────
  const originalFetch = window.fetch;
  window.fetch = async function (resource, init) {
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

  // ── Patch XMLHttpRequest ─────────────────────────────────────────────────────
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._gqlMethod = method;
    this._gqlUrl = url;
    return origOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (body) {
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
})();
