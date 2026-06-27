// Shared pure utilities loaded by panel.html as a <script> tag before panel.js,
// and imported directly by tests via CommonJS exports below.

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual(a[k], b[k]));
}

// Empty / absent override variables = wildcard (matches any request variables).
function matchesVariables(ovVars, reqVars) {
  const ov = ovVars ?? {};
  if (Object.keys(ov).length === 0) return true;
  return deepEqual(ov, reqVars ?? {});
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { deepEqual, matchesVariables };
}
