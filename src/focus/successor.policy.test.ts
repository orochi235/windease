import { describe, expect, it } from 'vitest';
import { createNode } from '../constructors.js';
import { asNodeId, type NodeId } from '../node.js';
import { Store } from '../store.js';
import type { SuccessorInput } from './successor.js';

function id(s: string): NodeId {
  return asNodeId(s);
}

function row(children: string[], policy?: (ctx: SuccessorInput) => NodeId | null | undefined) {
  const s = new Store(policy ? { chooseSuccessor: policy } : {});
  s.registerNode(
    createNode({ kind: 'zone', container: { strategyId: 'strip', config: {} }, id: id('z') }),
  );
  for (const c of children) {
    s.registerNode(createNode({ kind: 'panel', focus: true, id: id(c), parentId: id('z') }));
    s.showNode(id(c));
  }
  return s;
}

describe('successor policy', () => {
  it('an id returned by the policy wins over the built-in', () => {
    // Built-in would take the next sibling, 'c'.
    const s = row(['a', 'b', 'c'], () => id('a'));
    s.focusNode(id('b'));
    s.unregisterNode(id('b'));
    expect(s.focusedId).toBe(id('a'));
  });

  it('undefined falls through to the built-in', () => {
    const s = row(['a', 'b', 'c'], () => undefined);
    s.focusNode(id('b'));
    s.unregisterNode(id('b'));
    expect(s.focusedId).toBe(id('c'));
  });

  it('null focuses nobody, deliberately', () => {
    const s = row(['a', 'b', 'c'], () => null);
    s.focusNode(id('b'));
    s.unregisterNode(id('b'));
    expect(s.focusedId).toBeNull();
  });

  it('receives the departing node and the reason', () => {
    const seen: SuccessorInput[] = [];
    const s = row(['a', 'b'], (ctx) => {
      seen.push(ctx);
      return undefined;
    });
    s.focusNode(id('a'));
    s.hideNode(id('a'));
    expect(seen).toHaveLength(1);
    expect(seen[0]?.departing).toBe(id('a'));
    expect(seen[0]?.reason).toBe('hidden');
    expect(seen[0]?.store).toBe(s);
  });

  it('reports destroyed when the node is unregistered', () => {
    const reasons: string[] = [];
    const s = row(['a', 'b'], (ctx) => {
      reasons.push(ctx.reason);
      return undefined;
    });
    s.focusNode(id('a'));
    s.unregisterNode(id('a'));
    expect(reasons).toEqual(['destroyed']);
  });

  it('a throwing policy falls through to the built-in and the destroy still completes', () => {
    const s = row(['a', 'b', 'c'], () => {
      throw new Error('boom');
    });
    s.focusNode(id('b'));
    s.unregisterNode(id('b'));
    expect(s.getNode(id('b'))).toBeUndefined();
    expect(s.focusedId).toBe(id('c'));
  });

  it('an id for a node that does not exist falls through to the built-in', () => {
    const s = row(['a', 'b', 'c'], () => id('does-not-exist'));
    s.focusNode(id('b'));
    s.unregisterNode(id('b'));
    expect(s.getNode(id('b'))).toBeUndefined();
    expect(s.focusedId).toBe(id('c'));
  });

  it('null is honored, not overridden by the unusable-answer guard', () => {
    const s = row(['a', 'b', 'c'], () => null);
    s.focusNode(id('b'));
    s.unregisterNode(id('b'));
    expect(s.getNode(id('b'))).toBeUndefined();
    expect(s.focusedId).toBeNull();
  });
});
