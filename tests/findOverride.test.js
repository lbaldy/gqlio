import { describe, it, expect } from 'vitest';
import { deepEqual, extractOperationName, findOverride } from '../injected.js';

function mkOverride(operationName, variables, response, enabled = true) {
  return {
    id: Math.random().toString(36).slice(2),
    operationName,
    variables,
    response,
    enabled,
  };
}

// ── deepEqual ────────────────────────────────────────────────────────────────

describe('deepEqual', () => {
  it('returns true for identical primitives', () => {
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual('hello', 'hello')).toBe(true);
    expect(deepEqual(true, true)).toBe(true);
    expect(deepEqual(null, null)).toBe(true);
  });

  it('returns false for differing primitives', () => {
    expect(deepEqual(1, 2)).toBe(false);
    expect(deepEqual('a', 'b')).toBe(false);
    expect(deepEqual(true, false)).toBe(false);
  });

  it('returns false for mixed types', () => {
    expect(deepEqual(1, '1')).toBe(false);
    expect(deepEqual(null, {})).toBe(false);
    expect(deepEqual(null, undefined)).toBe(false);
    expect(deepEqual(0, false)).toBe(false);
  });

  it('compares flat objects by value', () => {
    expect(deepEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(deepEqual({ a: 1, b: 2 }, { a: 1 })).toBe(false);
  });

  it('compares nested objects recursively', () => {
    expect(deepEqual({ a: { b: { c: 1 } } }, { a: { b: { c: 1 } } })).toBe(true);
    expect(deepEqual({ a: { b: 1 } }, { a: { b: 2 } })).toBe(false);
  });

  it('compares arrays by value', () => {
    expect(deepEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(deepEqual([1, 2], [1, 3])).toBe(false);
    expect(deepEqual([1], [1, 2])).toBe(false);
  });

  it('handles empty objects and arrays', () => {
    expect(deepEqual({}, {})).toBe(true);
    expect(deepEqual([], [])).toBe(true);
    expect(deepEqual({}, [])).toBe(false);
  });
});

// ── extractOperationName ─────────────────────────────────────────────────────

describe('extractOperationName', () => {
  it('extracts name from a query', () => {
    expect(extractOperationName('query GetUser { id name }')).toBe('GetUser');
  });

  it('extracts name from a mutation', () => {
    expect(extractOperationName('mutation UpdateUser($id: ID!) { update(id: $id) { id } }')).toBe('UpdateUser');
  });

  it('extracts name from a subscription', () => {
    expect(extractOperationName('subscription OnMessage { message { text } }')).toBe('OnMessage');
  });

  it('returns null for anonymous operations', () => {
    expect(extractOperationName('{ user { id } }')).toBeNull();
    expect(extractOperationName('query { user { id } }')).toBeNull();
  });

  it('returns null for null / empty / undefined', () => {
    expect(extractOperationName(null)).toBeNull();
    expect(extractOperationName('')).toBeNull();
    expect(extractOperationName(undefined)).toBeNull();
  });
});

// ── findOverride ─────────────────────────────────────────────────────────────

describe('findOverride', () => {
  it('returns null for non-string body', () => {
    expect(findOverride(null, [])).toBeNull();
    expect(findOverride(123, [])).toBeNull();
    expect(findOverride({}, [])).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(findOverride('not-json', [])).toBeNull();
    expect(findOverride('{', [])).toBeNull();
  });

  it('returns null when body has no operationName or query', () => {
    expect(findOverride('{}', [])).toBeNull();
    expect(findOverride('{"variables":{"id":1}}', [])).toBeNull();
  });

  it('returns null when overrides list is empty', () => {
    const body = JSON.stringify({ operationName: 'GetUser', variables: {} });
    expect(findOverride(body, [])).toBeNull();
  });

  it('returns null when no override matches the operation name', () => {
    const overrides = [mkOverride('GetProducts', {}, { data: {} })];
    const body = JSON.stringify({ operationName: 'GetUser', variables: {} });
    expect(findOverride(body, overrides)).toBeNull();
  });

  it('returns null for a disabled override', () => {
    const overrides = [mkOverride('GetUser', {}, { data: {} }, false)];
    const body = JSON.stringify({ operationName: 'GetUser', variables: {} });
    expect(findOverride(body, overrides)).toBeNull();
  });

  it('matches a wildcard override (empty variables) for any request variables', () => {
    const ov   = mkOverride('GetUser', {}, { data: { user: { id: 1 } } });
    const body = JSON.stringify({ operationName: 'GetUser', variables: { id: 99 } });
    expect(findOverride(body, [ov])).toBe(ov);
  });

  it('matches a wildcard override when the override variables field is undefined', () => {
    const ov   = mkOverride('GetUser', undefined, { data: {} });
    const body = JSON.stringify({ operationName: 'GetUser', variables: { id: 1 } });
    expect(findOverride(body, [ov])).toBe(ov);
  });

  it('matches a wildcard override when the override variables field is null', () => {
    const ov   = mkOverride('GetUser', null, { data: {} });
    const body = JSON.stringify({ operationName: 'GetUser', variables: { anything: true } });
    expect(findOverride(body, [ov])).toBe(ov);
  });

  it('matches an override by exact variable object', () => {
    const ov   = mkOverride('GetUser', { id: 42 }, { data: { user: { name: 'Alice' } } });
    const body = JSON.stringify({ operationName: 'GetUser', variables: { id: 42 } });
    expect(findOverride(body, [ov])).toBe(ov);
  });

  it('prefers exact variable match over a wildcard', () => {
    const wildcard = mkOverride('GetUser', {},      { data: 'wildcard result' });
    const exact    = mkOverride('GetUser', { id: 1 }, { data: 'exact result' });
    const body     = JSON.stringify({ operationName: 'GetUser', variables: { id: 1 } });
    expect(findOverride(body, [wildcard, exact])).toBe(exact);
  });

  it('falls back to wildcard when no exact variable match exists', () => {
    const wildcard = mkOverride('GetUser', {},      { data: 'wildcard result' });
    const exact    = mkOverride('GetUser', { id: 1 }, { data: 'exact result' });
    const body     = JSON.stringify({ operationName: 'GetUser', variables: { id: 999 } });
    expect(findOverride(body, [wildcard, exact])).toBe(wildcard);
  });

  it('returns null when variables differ and no wildcard exists', () => {
    const ov   = mkOverride('GetUser', { id: 1 }, { data: {} });
    const body = JSON.stringify({ operationName: 'GetUser', variables: { id: 99 } });
    expect(findOverride(body, [ov])).toBeNull();
  });

  it('uses deep equality for nested variable objects', () => {
    const ov   = mkOverride('GetUser', { filter: { role: 'admin', active: true } }, { data: {} });
    const body = JSON.stringify({
      operationName: 'GetUser',
      variables: { filter: { role: 'admin', active: true } },
    });
    expect(findOverride(body, [ov])).toBe(ov);
  });

  it('does not match when nested variable objects differ', () => {
    const ov   = mkOverride('GetUser', { filter: { role: 'admin' } }, { data: {} });
    const body = JSON.stringify({ operationName: 'GetUser', variables: { filter: { role: 'user' } } });
    expect(findOverride(body, [ov])).toBeNull();
  });

  it('extracts operationName from the query string when field is absent', () => {
    const ov   = mkOverride('GetUser', {}, { data: {} });
    const body = JSON.stringify({ query: 'query GetUser { id name }', variables: {} });
    expect(findOverride(body, [ov])).toBe(ov);
  });

  it('handles batch requests — matches against the first operation', () => {
    const ov   = mkOverride('GetUser', {}, { data: {} });
    const body = JSON.stringify([
      { operationName: 'GetUser',     variables: {} },
      { operationName: 'GetProducts', variables: {} },
    ]);
    expect(findOverride(body, [ov])).toBe(ov);
  });

  it('skips disabled overrides even when operation and variables match', () => {
    const disabled = mkOverride('GetUser', {}, { data: 'disabled' }, false);
    const enabled  = mkOverride('GetUser', {}, { data: 'enabled'  }, true);
    const body     = JSON.stringify({ operationName: 'GetUser', variables: {} });
    expect(findOverride(body, [disabled, enabled])).toBe(enabled);
  });

  it('returns null when all matching overrides are disabled', () => {
    const overrides = [
      mkOverride('GetUser', {},      { data: 'wc' }, false),
      mkOverride('GetUser', { id: 1 }, { data: 'ex' }, false),
    ];
    const body = JSON.stringify({ operationName: 'GetUser', variables: { id: 1 } });
    expect(findOverride(body, overrides)).toBeNull();
  });

  it('does not match a different operation name even with identical variables', () => {
    const ov   = mkOverride('GetProducts', { page: 1 }, { data: [] });
    const body = JSON.stringify({ operationName: 'GetUser', variables: { page: 1 } });
    expect(findOverride(body, [ov])).toBeNull();
  });
});
