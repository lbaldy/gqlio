import { describe, it, expect } from 'vitest';
import { deepEqual, matchesVariables } from '../utils.js';

describe('deepEqual (utils.js)', () => {
  it('handles identical and differing primitives', () => {
    expect(deepEqual(42, 42)).toBe(true);
    expect(deepEqual('x', 'x')).toBe(true);
    expect(deepEqual(null, null)).toBe(true);
    expect(deepEqual(42, 43)).toBe(false);
    expect(deepEqual(null, 0)).toBe(false);
    expect(deepEqual('a', 'b')).toBe(false);
  });

  it('compares objects by value', () => {
    expect(deepEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  it('compares nested objects recursively', () => {
    expect(deepEqual({ a: { b: 1 } }, { a: { b: 1 } })).toBe(true);
    expect(deepEqual({ a: { b: 1 } }, { a: { b: 2 } })).toBe(false);
  });

  it('compares arrays', () => {
    expect(deepEqual([1, 2], [1, 2])).toBe(true);
    expect(deepEqual([1, 2], [1, 3])).toBe(false);
  });
});

describe('matchesVariables', () => {
  it('empty override variables is a wildcard — matches anything', () => {
    expect(matchesVariables({}, { id: 1, name: 'Alice' })).toBe(true);
    expect(matchesVariables({}, {})).toBe(true);
    expect(matchesVariables({}, null)).toBe(true);
  });

  it('null / undefined override variables is also a wildcard', () => {
    expect(matchesVariables(null, { id: 1 })).toBe(true);
    expect(matchesVariables(undefined, { id: 1 })).toBe(true);
    expect(matchesVariables(undefined, {})).toBe(true);
  });

  it('matches when override and request variables are identical', () => {
    expect(matchesVariables({ id: 1 }, { id: 1 })).toBe(true);
    expect(matchesVariables({ id: 1, page: 2 }, { id: 1, page: 2 })).toBe(true);
  });

  it('does not match when variables differ', () => {
    expect(matchesVariables({ id: 1 }, { id: 2 })).toBe(false);
    expect(matchesVariables({ id: 1 }, { id: 1, extra: true })).toBe(false);
  });

  it('matches deeply nested variable objects', () => {
    const ov  = { filter: { active: true, role: 'admin' } };
    const req = { filter: { active: true, role: 'admin' } };
    expect(matchesVariables(ov, req)).toBe(true);
  });

  it('does not match when nested variables differ', () => {
    expect(
      matchesVariables({ filter: { role: 'admin' } }, { filter: { role: 'user' } })
    ).toBe(false);
  });

  it('non-empty override does not match empty request variables', () => {
    expect(matchesVariables({ id: 1 }, {})).toBe(false);
    expect(matchesVariables({ id: 1 }, null)).toBe(false);
  });
});
