import { describe, expect, it } from 'vitest';
import { createNode } from './constructors.js';
import { gridStrategy } from './layout/grid.js';
import { stripStrategy } from './layout/strip.js';
import { runStrategyForContainer } from './layout-node-adapter.js';
import { asNodeId, type NodeId } from './node.js';
import { Store } from './store.js';

/**
 * 0.8's `splitStrategy` kept a tree in `container.state` describing what the
 * node tree already described, and a panel the former did not know about was
 * dropped from layout with no error. Its removal in 1.0.0 was meant to end
 * that class of bug by leaving one tree; this pins that it did.
 */
describe('a child the container state predates is still laid out', () => {
  const build = () => {
    const s = new Store();
    const root = asNodeId('root');
    s.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'strip', config: { axis: 'x', fill: true } },
        id: root,
      }),
    );
    const p1 = asNodeId('p1');
    s.registerNode(createNode({ kind: 'panel', focus: true, id: p1, parentId: root }));
    s.showNode(p1);
    return { s, root, p1 };
  };

  const placedIds = (s: Store, parent: NodeId, strategy = stripStrategy) => {
    const r = runStrategyForContainer(s, parent, { w: 600, h: 400 }, strategy, undefined);
    return { placed: [...r.placements.keys()].sort(), unplaced: r.unplaced ?? [] };
  };

  it('places a panel registered after store.split built the tree', () => {
    const { s, root, p1 } = build();
    s.split(p1, { direction: 'x', into: 2, groupId: asNodeId('g'), newIds: [asNodeId('p2')] });

    const parent = s.getNode(p1)?.membership?.parentId as NodeId;
    const late = asNodeId('late');
    s.registerNode(createNode({ kind: 'panel', focus: true, id: late, parentId: parent }));
    s.showNode(late);

    const { placed, unplaced } = placedIds(s, parent);
    expect(placed).toContain('late');
    expect(unplaced).not.toContain('late');
  });

  it('places a panel added after container state was already seeded', () => {
    const { s, root, p1 } = build();
    // Seed stale state, the shape 0.8's splitStrategy persisted a tree into.
    s.setContainerState(root, { tree: { id: p1, children: [] } });

    const late = asNodeId('late');
    s.registerNode(createNode({ kind: 'panel', focus: true, id: late, parentId: root }));
    s.showNode(late);

    const { placed, unplaced } = placedIds(s, root);
    expect(placed).toEqual(['late', 'p1']);
    expect(unplaced).toEqual([]);
  });

  it('places a panel the grid strategy never saw seeded either', () => {
    const { s, root, p1 } = build();
    s.setStrategy(root, 'grid');
    const late = asNodeId('late');
    s.registerNode(createNode({ kind: 'panel', focus: true, id: late, parentId: root }));
    s.showNode(late);

    const { placed, unplaced } = placedIds(s, root, gridStrategy);
    expect(placed).toEqual(['late', 'p1']);
    expect(unplaced).toEqual([]);
  });
});
