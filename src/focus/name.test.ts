import { describe, expect, it } from 'vitest';
import { createNode } from '../constructors.js';
import { asNodeId, type NodeId } from '../node.js';
import { Store } from '../store.js';
import { accessibleName } from './name.js';

function id(s: string): NodeId {
  return asNodeId(s);
}

describe('accessibleName', () => {
  it('uses meta.title when present', () => {
    const s = new Store();
    s.registerNode(
      createNode({ kind: 'panel', focus: true, id: id('p'), meta: { title: 'Logs' } }),
    );
    expect(accessibleName(s, id('p'))).toBe('Logs');
  });

  it('falls back to kind plus a one-based index', () => {
    const s = new Store();
    s.registerNode(
      createNode({ kind: 'zone', container: { strategyId: 'strip', config: {} }, id: id('z') }),
    );
    s.registerNode(createNode({ kind: 'panel', focus: true, id: id('a'), parentId: id('z') }));
    s.registerNode(createNode({ kind: 'panel', focus: true, id: id('b'), parentId: id('z') }));
    expect(accessibleName(s, id('b'))).toBe('panel 2');
  });

  it('falls back to the id when there is no kind', () => {
    const s = new Store();
    s.registerNode(createNode({ focus: true, id: id('solo') }));
    expect(accessibleName(s, id('solo'))).toBe('solo');
  });
});
