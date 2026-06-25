(function () {
  // Map of operationName -> { enabled, response }
  window.__gqlOverrides = {};

  window.addEventListener('message', (event) => {
    if (event.source === window && event.data?.type === 'GQL_UPDATE_OVERRIDES') {
      window.__gqlOverrides = event.data.overrides || {};
    }
  });

  function extractOperationName(query) {
    if (!query) return null;
    const m = query.match(/(?:query|mutation|subscription)\s+(\w+)/);
    return m ? m[1] : null;
  }

  function findOverride(body) {
    if (typeof body !== 'string') return null;
    let parsed;
    try { parsed = JSON.parse(body); } catch { return null; }

    // Handle batch requests — use the first operation's name.
    const op = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!op?.query && !op?.operationName) return null;

    const key = op.operationName || extractOperationName(op.query) || 'anonymous';
    const override = window.__gqlOverrides[key];
    return override?.enabled ? override : null;
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
        Object.defineProperty(xhr, 'readyState',   { get: () => 4, configurable: true });
        Object.defineProperty(xhr, 'status',        { get: () => 200, configurable: true });
        Object.defineProperty(xhr, 'statusText',    { get: () => 'OK', configurable: true });
        Object.defineProperty(xhr, 'responseText',  { get: () => text, configurable: true });
        Object.defineProperty(xhr, 'response',      { get: () => text, configurable: true });
        Object.defineProperty(xhr, 'responseURL',   { get: () => this._gqlUrl ?? '', configurable: true });
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
