import { describe, expect, it } from 'vitest';
import { createNode } from './constructors.js';
import { NoSpaceError, WindeaseError } from './errors.js';
import { asNodeId, type NodeId } from './node.js';
import { columnsShortfall, gridShortfall, rowShortfall } from './split-fit.js';
import { Store } from './store.js';

const id = (s: string) => asNodeId(s);

/** zone `z` (strip on x, gap 4) › panels `a`, `b`; `a` has a 100×50 floor. */
function seeded(zoneConfig: Record<string, unknown> = { axis: 'x', gap: 4 }) {
  const s = new Store();
  s.registerNode(
    createNode({
      kind: 'zone',
      id: id('z'),
      container: { strategyId: 'strip', config: zoneConfig },
    }),
  );
  s.registerNode(
    createNode({
      kind: 'panel',
      focus: true,
      id: id('a'),
      parentId: id('z'),
      hints: { minSize: { w: 100, h: 50 } },
    }),
  );
  s.registerNode(createNode({ kind: 'panel', focus: true, id: id('b'), parentId: id('z') }));
  s.showNode(id('a'));
  s.showNode(id('b'));
  return s;
}

const order = (s: Store, parent: NodeId) => s.getContainerView(parent)?.childOrder ?? [];
const catchIt = (fn: () => void): unknown => {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return undefined;
};

describe('strict split', () => {
  it('refuses a split whose panes cannot all reach their floors, and changes nothing', () => {
    const s = seeded();
    const before = JSON.stringify([...s.nodes.values()]);
    const err = catchIt(() =>
      s.split(id('a'), {
        direction: 'y',
        groupId: id('g'),
        newIds: [id('n')],
        strict: { size: { w: 200, h: 120 }, minSize: { w: 0, h: 80 } },
      }),
    );
    expect(err).toBeInstanceOf(NoSpaceError);
    expect(err).toBeInstanceOf(WindeaseError);
    expect(err).toMatchObject({
      code: 'no-space',
      id: 'a',
      axis: 'y',
      needed: 160,
      available: 120,
    });
    expect((err as Error).message).toMatch(/no space for new pane/i);
    expect(JSON.stringify([...s.nodes.values()])).toBe(before);
  });

  it('lets through a split that fits', () => {
    const s = seeded();
    s.split(id('a'), {
      direction: 'y',
      groupId: id('g'),
      newIds: [id('n')],
      strict: { size: { w: 200, h: 170 }, minSize: { w: 0, h: 80 } },
    });
    expect(order(s, id('g'))).toEqual([id('a'), id('n')]);
  });

  it("counts the new group's gap and padding", () => {
    const s = seeded();
    const split = (h: number) =>
      catchIt(() =>
        s.split(id('a'), {
          direction: 'y',
          groupId: id('g'),
          newIds: [id('n')],
          config: { gap: 6, padding: 2 },
          strict: { size: { w: 200, h }, minSize: { w: 0, h: 50 } },
        }),
      );
    // 50 + 50 + 6 + 2 × 2 = 110.
    expect(split(109)).toBeInstanceOf(NoSpaceError);
    expect(split(110)).toBeUndefined();
  });

  it("reads the split node's own floor even with no minSize given", () => {
    const s = seeded({ axis: 'y' });
    const err = catchIt(() =>
      s.split(id('a'), {
        direction: 'x',
        groupId: id('g'),
        newIds: [id('n')],
        strict: { size: { w: 90, h: 200 } },
      }),
    );
    expect(err).toMatchObject({ axis: 'x', needed: 100, available: 90 });
  });

  it("refuses when the panes' floors do not fit across the split", () => {
    const s = seeded();
    const err = catchIt(() =>
      s.split(id('a'), {
        direction: 'y',
        groupId: id('g'),
        newIds: [id('n')],
        strict: { size: { w: 80, h: 400 } },
      }),
    );
    expect(err).toMatchObject({ axis: 'x', needed: 100, available: 80 });
  });

  it("uses the parent row's gap when the new pane flattens in beside the node", () => {
    const s = seeded();
    const split = (w: number) =>
      catchIt(() =>
        s.split(id('b'), {
          direction: 'x',
          newIds: [id('n')],
          strict: { size: { w, h: 100 }, minSize: { w: 40, h: 0 } },
        }),
      );
    expect(split(83)).toBeInstanceOf(NoSpaceError);
    expect(split(84)).toBeUndefined();
    expect(order(s, id('z'))).toEqual([id('a'), id('b'), id('n')]);
  });

  it('checks each column of a split in both directions', () => {
    const s = seeded();
    const split = (h: number) =>
      catchIt(() =>
        s.split(id('b'), {
          direction: 'both',
          into: [2, 3],
          groupIds: [id('g'), id('c0'), id('c1')],
          newIds: [id('n1'), id('n2'), id('n3'), id('n4'), id('n5')],
          strict: { size: { w: 400, h }, minSize: { w: 10, h: 30 } },
        }),
      );
    expect(split(89)).toMatchObject({ axis: 'y', needed: 90 });
    expect(split(90)).toBeUndefined();
  });

  it('checks a grid split by its cells', () => {
    const s = seeded();
    const err = catchIt(() =>
      s.split(id('b'), {
        direction: 'grid',
        into: 4,
        groupId: id('g'),
        newIds: [id('n1'), id('n2'), id('n3')],
        strict: { size: { w: 150, h: 400 }, minSize: { w: 80, h: 10 } },
      }),
    );
    expect(err).toMatchObject({ axis: 'x', needed: 160, available: 150 });
  });

  it('checks nothing without strict, as before', () => {
    const s = seeded();
    s.split(id('a'), { direction: 'y', groupId: id('g'), newIds: [id('n')] });
    expect(order(s, id('g'))).toEqual([id('a'), id('n')]);
  });

  it('reports a lock ahead of the space it lacks', () => {
    const s = seeded();
    s.setLock(id('z'), { arrange: true });
    const err = catchIt(() =>
      s.split(id('a'), {
        direction: 'y',
        groupId: id('g'),
        newIds: [id('n')],
        strict: { size: { w: 1, h: 1 } },
      }),
    );
    expect(err).not.toBeInstanceOf(NoSpaceError);
  });
});

describe('strict splitInto', () => {
  it("refuses when the two panes' floors do not fit the onto-pane's slot", () => {
    const s = seeded();
    const before = order(s, id('z'));
    const err = catchIt(() =>
      s.splitInto(id('a'), id('b'), {
        id: id('g'),
        axis: 'x',
        edge: 'start',
        strict: { size: { w: 150, h: 100 }, minSize: { w: 60, h: 0 } },
      }),
    );
    expect(err).toMatchObject({ code: 'no-space', id: 'b', axis: 'x', needed: 160 });
    expect(order(s, id('z'))).toEqual(before);
    expect(s.getNode(id('g'))).toBeUndefined();
  });

  it('splits when they fit, counting the gap from its config', () => {
    const s = seeded();
    s.splitInto(id('a'), id('b'), {
      id: id('g'),
      axis: 'x',
      edge: 'start',
      config: { gap: 5 },
      strict: { size: { w: 165, h: 100 }, minSize: { w: 60, h: 0 } },
    });
    expect(order(s, id('g'))).toEqual([id('a'), id('b')]);
  });
});

describe('split-fit', () => {
  const none = { gap: 0, padding: 0 };

  it('rowShortfall fits floors that sum exactly to the extent', () => {
    expect(
      rowShortfall(
        { w: 100, h: 10 },
        'x',
        [
          { w: 60, h: 0 },
          { w: 40, h: 0 },
        ],
        none,
      ),
    ).toBe(null);
  });

  it('columnsShortfall reports the widest column set across the row', () => {
    const cols = [[{ w: 50, h: 10 }], [{ w: 70, h: 10 }]];
    expect(columnsShortfall({ w: 110, h: 100 }, cols, none)).toMatchObject({
      axis: 'x',
      needed: 120,
    });
  });

  it('gridShortfall sizes every cell for the largest floor', () => {
    const floors = [
      { w: 10, h: 10 },
      { w: 10, h: 60 },
      { w: 10, h: 10 },
    ];
    expect(gridShortfall({ w: 100, h: 100 }, 2, floors, none)).toMatchObject({
      axis: 'y',
      needed: 120,
    });
  });
});
