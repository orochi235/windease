import { describe, expect, it } from 'vitest';
import { createNode } from './constructors.js';
import {
  DuplicateNodeError,
  InvariantViolationError,
  LockedError,
  NodeNotFoundError,
} from './errors.js';
import { asNodeId } from './node.js';
import { deserialize, graft, serialize } from './snapshot.js';
import { Store } from './store.js';
import { recordEvents } from './test-utils/record-events.js';

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

describe('graft validation', () => {
  it('rejects a colliding id and leaves the store completely untouched', () => {
    const s = buildTree();
    const snap = serialize(s, { root: asNodeId('a') });
    const rec = recordEvents(s, 'node.registered', 'node.unregistered', 'node.reordered');

    expect(() => graft(s, snap, asNodeId('z'))).toThrow(DuplicateNodeError);

    expect(rec.log).toHaveLength(0);
    expect(s.getChildren(asNodeId('z')).map((n) => n.id)).toEqual(['a', 'b']);
    rec.stop();
  });

  it('throws when the target parent does not exist', () => {
    const s = buildTree();
    const snap = serialize(s, { root: asNodeId('a') });
    s.unregisterNode(asNodeId('a'));
    expect(() => graft(s, snap, asNodeId('nope'))).toThrow(NodeNotFoundError);
  });

  it('throws when the target parent has no container', () => {
    const s = buildTree();
    const snap = serialize(s, { root: asNodeId('a') });
    s.unregisterNode(asNodeId('a'));
    expect(() => graft(s, snap, asNodeId('b'))).toThrow(InvariantViolationError);
  });

  it('throws when the snapshot has more than one root', () => {
    const s = buildTree();
    const two = new Store();
    two.registerNode(
      createNode({ id: asNodeId('r1'), container: { strategyId: 'strip', config: {} } }),
    );
    two.registerNode(createNode({ id: asNodeId('r2') }));
    const snap = serialize(two);
    expect(snap.rootIds).toEqual(['r1', 'r2']);

    expect(() => graft(s, snap, asNodeId('z'))).toThrow(InvariantViolationError);
  });

  it('refuses an accept-locked parent, and force overrides', () => {
    const s = buildTree();
    const snap = serialize(s, { root: asNodeId('a') });
    s.unregisterNode(asNodeId('a'));
    s.setLock(asNodeId('z'), { accept: true });

    expect(() => graft(s, snap, asNodeId('z'))).toThrow(LockedError);
    expect(graft(s, snap, asNodeId('z'), { force: true })).toBe('a');
  });

  it('rejects a deep colliding id without partially grafting', () => {
    const s = buildTree();
    const snap = serialize(s, { root: asNodeId('a') });
    s.unregisterNode(asNodeId('a'));
    // Re-take 'a2' only, so the collision is on a non-root node the walk
    // would reach after 'a' and 'a1' had already registered.
    s.registerNode(createNode({ id: asNodeId('a2'), kind: 'panel', parentId: asNodeId('z') }));

    const rec = recordEvents(s, 'node.registered', 'node.reordered');
    expect(() => graft(s, snap, asNodeId('z'))).toThrow(DuplicateNodeError);

    expect(rec.log).toHaveLength(0);
    expect(s.getNode(asNodeId('a'))).toBeUndefined();
    expect(s.getNode(asNodeId('a1'))).toBeUndefined();
    expect(s.getChildren(asNodeId('z')).map((n) => n.id)).toEqual(['b', 'a2']);
    rec.stop();
  });
});

describe('graft attaches', () => {
  it('round-trips a subtree back under the same parent', () => {
    const s = buildTree();
    const before = serialize(s, { root: asNodeId('a') });
    s.unregisterNode(asNodeId('a'));
    expect(s.getChildren(asNodeId('z')).map((n) => n.id)).toEqual(['b']);

    const id = graft(s, before, asNodeId('z'));

    expect(id).toBe('a');
    expect(s.getChildren(asNodeId('z')).map((n) => n.id)).toEqual(['b', 'a']);
    expect(s.getChildren(asNodeId('a')).map((n) => n.id)).toEqual(['a1', 'a2']);
    expect(s.getMeta(asNodeId('a1'))).toEqual({ title: 'one' });
    expect(serialize(s, { root: asNodeId('a') })).toEqual(before);
  });

  it('restores the root placement it was serialized with', () => {
    const s = buildTree();
    const snap = serialize(s, { root: asNodeId('a') });
    s.unregisterNode(asNodeId('a'));
    graft(s, snap, asNodeId('z'));
    expect(s.getPlacement(asNodeId('a'))).toEqual({ size: { w: 300 } });
  });

  it('grafts into a different parent, and into a second store', () => {
    const s = buildTree();
    const snap = serialize(s, { root: asNodeId('a') });
    s.unregisterNode(asNodeId('a'));

    const fresh = new Store();
    fresh.registerNode(
      createNode({ id: asNodeId('host'), container: { strategyId: 'grid', config: {} } }),
    );
    expect(graft(fresh, snap, asNodeId('host'))).toBe('a');
    expect(fresh.getChildren(asNodeId('host')).map((n) => n.id)).toEqual(['a']);
    expect(fresh.getChildren(asNodeId('a')).map((n) => n.id)).toEqual(['a1', 'a2']);
  });

  it('is a single transaction', () => {
    const s = buildTree();
    const snap = serialize(s, { root: asNodeId('a') });
    s.unregisterNode(asNodeId('a'));
    const rec = recordEvents(s, 'transaction.begin', 'transaction.end', 'node.registered');

    graft(s, snap, asNodeId('z'));

    expect(rec.of('transaction.begin')).toHaveLength(1);
    expect(rec.of('transaction.end')).toHaveLength(1);
    expect(rec.of('node.registered')).toHaveLength(3);
    expect(rec.log[0]?.name).toBe('transaction.begin');
    expect(rec.log.at(-1)?.name).toBe('transaction.end');
    rec.stop();
  });
});

describe('graft at an index', () => {
  it('inserts at the requested index', () => {
    const s = buildTree();
    const snap = serialize(s, { root: asNodeId('a') });
    s.unregisterNode(asNodeId('a'));
    s.registerNode(createNode({ id: asNodeId('c'), kind: 'panel', parentId: asNodeId('z') }));
    expect(s.getChildren(asNodeId('z')).map((n) => n.id)).toEqual(['b', 'c']);

    graft(s, snap, asNodeId('z'), { at: 1 });

    expect(s.getChildren(asNodeId('z')).map((n) => n.id)).toEqual(['b', 'a', 'c']);
  });

  it('lands after a pinned head when asked for index 0', () => {
    const s = buildTree();
    const snap = serialize(s, { root: asNodeId('a') });
    s.unregisterNode(asNodeId('a'));
    s.setPinned(asNodeId('b'), 0);

    graft(s, snap, asNodeId('z'), { at: 0 });

    expect(s.getChildren(asNodeId('z')).map((n) => n.id)).toEqual(['b', 'a']);
  });
});

describe('graft and focus', () => {
  it('does not steal focus from the node that has it', () => {
    const s = buildTree();
    s.registerNode(
      createNode({ id: asNodeId('f'), kind: 'panel', parentId: asNodeId('a'), focus: true }),
    );
    s.focusNode(asNodeId('f'));
    const snap = serialize(s, { root: asNodeId('a') });
    expect(snap.focusedId).toBe('f');

    s.unregisterNode(asNodeId('a'));
    s.registerNode(
      createNode({ id: asNodeId('keeper'), kind: 'panel', parentId: asNodeId('z'), focus: true }),
    );
    s.focusNode(asNodeId('keeper'));

    graft(s, snap, asNodeId('z'));

    expect(s.focusedId).toBe('keeper');
    expect(s.getNode(asNodeId('f'))?.focus?.state).toBe('blurred');
  });

  it('does not claim focus even when the store has none', () => {
    const s = buildTree();
    s.registerNode(
      createNode({ id: asNodeId('f'), kind: 'panel', parentId: asNodeId('a'), focus: true }),
    );
    s.focusNode(asNodeId('f'));
    const snap = serialize(s, { root: asNodeId('a') });

    s.unregisterNode(asNodeId('a'));
    s.blurAll();
    expect(s.focusedId).toBeNull();

    graft(s, snap, asNodeId('z'));

    expect(s.focusedId).toBeNull();
  });
});

describe('graft migrates legacy snapshots', () => {
  it('accepts a v3 subtree snapshot and folds its lock fields', () => {
    const legacy = {
      version: 3,
      rootIds: ['old'],
      focusedId: null,
      nodes: [
        {
          id: 'old',
          kind: 'group',
          lifecycle: 'visible',
          container: {
            strategyId: 'strip',
            config: { axis: 'y' },
            childOrder: ['old1'],
            allowsPinning: true,
            allowsDrop: false,
          },
        },
        {
          id: 'old1',
          kind: 'panel',
          lifecycle: 'visible',
          membership: { parentId: 'old', placement: { locked: true } },
        },
      ],
    };

    const s = buildTree();
    const id = graft(s, legacy, asNodeId('z'));

    expect(id).toBe('old');
    expect(s.getChildren(asNodeId('z')).map((n) => n.id)).toEqual(['a', 'b', 'old']);
    expect(s.isLocked(asNodeId('old'), 'accept')).toBe(true);
    expect(s.isLocked(asNodeId('old1'), 'move')).toBe(true);
    expect(s.getPlacement(asNodeId('old1')).locked).toBeUndefined();
  });
});
