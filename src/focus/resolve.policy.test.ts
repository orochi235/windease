import { describe, expect, it } from 'vitest';
import { createNode } from '../constructors.js';
import type { LayoutStrategy } from '../layout-types.js';
import { resolveMove } from '../move.js';
import { asNodeId, type NodeId } from '../node.js';
import { Store } from '../store.js';
import type { NavigationPolicy } from './resolve.js';
import { resolveNavigation } from './resolve.js';
import type { GeometrySource } from './types.js';

function id(s: string): NodeId {
  return asNodeId(s);
}

/** Three panels in a row: a | b | c. The strategy always answers 'c'. */
function scene(policy?: NavigationPolicy) {
  const store = new Store(policy ? { resolveNavigation: policy } : {});
  store.registerNode(
    createNode({ kind: 'zone', container: { strategyId: 'custom', config: {} }, id: id('z') }),
  );
  store.showNode(id('z'));
  for (const c of ['a', 'b', 'c']) {
    store.registerNode(createNode({ kind: 'panel', focus: true, id: id(c), parentId: id('z') }));
    store.showNode(id(c));
  }
  const map: Record<string, { x: number; y: number; w: number; h: number }> = {
    a: { x: 0, y: 0, w: 100, h: 100 },
    b: { x: 110, y: 0, w: 100, h: 100 },
    c: { x: 220, y: 0, w: 100, h: 100 },
  };
  const geometry: GeometrySource = { rectOf: (nid) => map[nid] ?? null };
  const strategy: LayoutStrategy = {
    name: 'custom',
    layout: () => ({ placements: new Map(), affordances: [] }),
    navigate: () => 'c',
  };
  const strategies = new Map([['custom', strategy]]);
  return { store, geometry, strategies };
}

describe('resolveNavigation — consumer policy', () => {
  it('pre-empts strategy.navigate', () => {
    const { store, geometry, strategies } = scene(() => id('a'));
    expect(resolveNavigation({ store, from: id('a'), intent: 'right', geometry, strategies })).toBe(
      id('a'),
    );
  });

  it('undefined falls through to strategy.navigate', () => {
    const { store, geometry, strategies } = scene(() => undefined);
    expect(resolveNavigation({ store, from: id('a'), intent: 'right', geometry, strategies })).toBe(
      id('c'),
    );
  });

  it('null stops the search before the strategy is asked', () => {
    const { store, geometry, strategies } = scene(() => null);
    expect(
      resolveNavigation({ store, from: id('a'), intent: 'right', geometry, strategies }),
    ).toBeNull();
  });

  it('with no strategy, undefined falls through to geometry', () => {
    const { store, geometry } = scene(() => undefined);
    expect(resolveNavigation({ store, from: id('a'), intent: 'right', geometry })).toBe(id('b'));
  });

  it('sees the whole ResolveInput, including the intent', () => {
    const intents: string[] = [];
    const { store, geometry } = scene((input) => {
      intents.push(input.intent);
      return undefined;
    });
    resolveNavigation({ store, from: id('a'), intent: 'cycleNext', geometry });
    expect(intents).toEqual(['cycleNext']);
  });

  it('a policy that calls resolveNavigation terminates instead of recursing', () => {
    let depth = 0;
    const { store, geometry } = scene((input) => {
      depth++;
      // The re-entrant call must skip the policy and answer from the built-in.
      return resolveNavigation(input);
    });
    expect(resolveNavigation({ store, from: id('a'), intent: 'right', geometry })).toBe(id('b'));
    expect(depth).toBe(1);
  });

  it('the flag resets after a policy throws, so the next call is consulted', () => {
    let calls = 0;
    const { store, geometry } = scene(() => {
      calls++;
      if (calls === 1) throw new Error('boom');
      return id('c');
    });
    expect(resolveNavigation({ store, from: id('a'), intent: 'right', geometry })).toBe(id('b'));
    expect(resolveNavigation({ store, from: id('a'), intent: 'right', geometry })).toBe(id('c'));
  });

  it('an id for a node that does not exist falls through to the built-in', () => {
    const { store, geometry } = scene(() => id('nope'));
    expect(resolveNavigation({ store, from: id('a'), intent: 'right', geometry })).toBe(id('b'));
  });

  it('an id for a node that cannot take focus falls through to the built-in', () => {
    const { store, geometry } = scene(() => id('z'));
    expect(resolveNavigation({ store, from: id('a'), intent: 'right', geometry })).toBe(id('b'));
  });

  it('resolveMove honors the policy without being changed to', () => {
    const { store, geometry } = scene(() => id('c'));
    const plan = resolveMove({ store, from: id('a'), direction: 'right', geometry });
    expect(plan).toEqual({ kind: 'reorder', id: id('a'), parentId: id('z'), at: 2 });
  });
});
