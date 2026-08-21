import { describe, expect, it } from 'vitest';
import { createNode } from './constructors.js';
import { NodeNotFoundError } from './errors.js';
import { asNodeId } from './node.js';
import { deserialize, serialize } from './snapshot.js';
import { Store } from './store.js';

/** root `z` → `a` (container, holds `a1`, `a2`) and `b`. */
function buildTree(): Store {
  const s = new Store();
  s.registerNode(
    createNode({
      id: asNodeId('z'),
      kind: 'zone',
      container: { strategyId: 'strip', config: { axis: 'x' } },
    }),
  );
  s.registerNode(
    createNode({
      id: asNodeId('a'),
      kind: 'group',
      parentId: asNodeId('z'),
      placement: { size: { w: 300 } },
      container: { strategyId: 'strip', config: { axis: 'y' } },
    }),
  );
  s.registerNode(
    createNode({
      id: asNodeId('a1'),
      kind: 'panel',
      parentId: asNodeId('a'),
      meta: { title: 'one' },
    }),
  );
  s.registerNode(createNode({ id: asNodeId('a2'), kind: 'panel', parentId: asNodeId('a') }));
  s.registerNode(createNode({ id: asNodeId('b'), kind: 'panel', parentId: asNodeId('z') }));
  return s;
}

describe('serialize with { root }', () => {
  it('includes only the named node and its descendants', () => {
    const snap = serialize(buildTree(), { root: asNodeId('a') });
    expect(snap.nodes.map((n) => n.id).sort()).toEqual(['a', 'a1', 'a2']);
    expect(snap.rootIds).toEqual(['a']);
    expect(snap.version).toBe(5);
  });

  it('drops the root membership and records its placement separately', () => {
    const snap = serialize(buildTree(), { root: asNodeId('a') });
    const root = snap.nodes.find((n) => n.id === 'a');
    expect(root?.membership).toBeUndefined();
    expect(snap.rootPlacement).toEqual({ size: { w: 300 } });
  });

  it('keeps descendant membership intact', () => {
    const snap = serialize(buildTree(), { root: asNodeId('a') });
    expect(snap.nodes.find((n) => n.id === 'a1')?.membership?.parentId).toBe('a');
  });

  it('throws when the named root does not exist', () => {
    expect(() => serialize(buildTree(), { root: asNodeId('nope') })).toThrow(NodeNotFoundError);
  });

  it('is unchanged when no root is given', () => {
    const s = buildTree();
    expect(serialize(s)).toEqual(serialize(s, {}));
    expect(serialize(s).nodes).toHaveLength(5);
  });

  it('carries focusedId when the focused node is inside the subtree', () => {
    const s = buildTree();
    s.registerNode(
      createNode({ id: asNodeId('f'), kind: 'panel', parentId: asNodeId('a'), focus: true }),
    );
    s.focusNode(asNodeId('f'));
    expect(serialize(s, { root: asNodeId('a') }).focusedId).toBe('f');
  });

  it('drops focusedId when the focused node is outside the subtree', () => {
    const s = buildTree();
    s.registerNode(
      createNode({ id: asNodeId('g'), kind: 'panel', parentId: asNodeId('z'), focus: true }),
    );
    s.focusNode(asNodeId('g'));
    expect(serialize(s, { root: asNodeId('a') }).focusedId).toBeNull();
  });

  it('opens as a standalone store via deserialize', () => {
    const snap = serialize(buildTree(), { root: asNodeId('a') });
    const standalone = deserialize(snap);
    expect(standalone.getChildren(asNodeId('a')).map((n) => n.id)).toEqual(['a1', 'a2']);
    expect(standalone.getParent(asNodeId('a'))).toBeUndefined();
  });

  it('throws rather than crashing when the subtree root is destroyed', () => {
    const s = buildTree();
    const node = s.getNodeTruth(asNodeId('a'));
    node?.lifecycle.send('destroy');
    expect(() => serialize(s, { root: asNodeId('a') })).toThrow(NodeNotFoundError);
  });
});
