import { describe, expect, it, vi } from 'vitest';
import {
  asNodeId,
  configureTrace,
  createNode,
  type LayoutItem,
  type LayoutStrategy,
  type Rect,
  Store,
} from '../index.js';
import { type AcceptContext, DragEngine, type DropTarget } from './DragEngine.js';

/** Refuses anything past 2 items — stands in for a strip at its maxItems cap. */
const exactlyTwoStrategy: LayoutStrategy<unknown, string, unknown> = {
  name: 'exactly-two',
  canAccept: (items) => items.length <= 2,
  layout: () => ({ placements: new Map(), affordances: [] }),
};

const SQUARE: Rect = { x: 0, y: 0, z: 0, w: 100, h: 100 };

function at(rect: Rect, extra: Partial<DropTarget> = {}): DropTarget {
  return { bounds: () => rect, ...extra };
}

/** z2 already holds two panels, so the strategy refuses a third. */
function fullStore(): Store {
  const s = new Store();
  for (const z of ['z1', 'z2']) {
    s.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'exactly-two', config: {} },
        id: asNodeId(z),
      }),
    );
  }
  for (const [p, parent] of [
    ['p', 'z1'],
    ['a', 'z2'],
    ['b', 'z2'],
  ] as const) {
    s.registerNode(
      createNode({ kind: 'panel', focus: true, id: asNodeId(p), parentId: asNodeId(parent) }),
    );
  }
  return s;
}

/** z2 is empty, so the strategy accepts the drop on its own. */
function openStore(): Store {
  const s = new Store();
  for (const z of ['z1', 'z2']) {
    s.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'exactly-two', config: {} },
        id: asNodeId(z),
      }),
    );
  }
  s.registerNode(
    createNode({ kind: 'panel', focus: true, id: asNodeId('p'), parentId: asNodeId('z1') }),
  );
  return s;
}

function engineWith(s: Store, target: Partial<DropTarget>): DragEngine {
  const e = new DragEngine(s, { getStrategy: () => exactlyTwoStrategy });
  e.addDropTarget(asNodeId('z2'), at(SQUARE, target));
  e.tryBegin(asNodeId('p'));
  e.updateHoverByPoint(50, 50);
  return e;
}

describe('DragEngine — acceptPolicy', () => {
  it('true overrides a strategy rejection', () => {
    const e = engineWith(fullStore(), { acceptPolicy: () => true });
    expect(e.state()?.hover?.accepted).toBe(true);
  });

  it('undefined defers to the strategy, which refuses', () => {
    let calls = 0;
    const e = engineWith(fullStore(), {
      acceptPolicy: () => {
        calls += 1;
        return undefined;
      },
    });
    expect(calls).toBe(1);
    expect(e.state()?.hover?.accepted).toBe(false);
  });

  it('undefined defers to the strategy, which accepts', () => {
    const e = engineWith(openStore(), { acceptPolicy: () => undefined });
    expect(e.state()?.hover?.accepted).toBe(true);
  });

  it('false rejects even where the strategy would accept', () => {
    const e = engineWith(openStore(), { acceptPolicy: () => false });
    expect(e.state()?.hover?.accepted).toBe(false);
  });

  it('sees the prospective post-drop child list and the container config', () => {
    const seen: AcceptContext[] = [];
    engineWith(fullStore(), {
      acceptPolicy: (ctx) => {
        seen.push(ctx);
        return true;
      },
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.items.map((i) => i.id)).toEqual(['a', 'b', 'p']);
    expect(seen[0]?.sourceId).toBe('p');
    expect(seen[0]?.options).toEqual({});
  });

  it('lock.accept still refuses, whatever the policy says', () => {
    const s = fullStore();
    s.setLock(asNodeId('z2'), { accept: true });
    const e = engineWith(s, { acceptPolicy: () => true });
    expect(e.state()?.hover?.accepted).toBe(false);
  });

  it('accepts a drop the policy allows', () => {
    const e = engineWith(openStore(), { acceptPolicy: () => true });
    expect(e.state()?.hover?.accepted).toBe(true);
  });

  it('a policy that throws defers to the strategy, which refuses', () => {
    const e = engineWith(fullStore(), {
      acceptPolicy: () => {
        throw new Error('boom');
      },
    });
    expect(e.state()?.hover?.accepted).toBe(false);
  });

  it('a policy that throws defers to the strategy, which accepts', () => {
    const e = engineWith(openStore(), {
      acceptPolicy: () => {
        throw new Error('boom');
      },
    });
    expect(e.state()?.hover?.accepted).toBe(true);
  });

  it('an answer that is neither true nor false defers to the strategy', () => {
    const e = engineWith(fullStore(), { acceptPolicy: () => 0 as never });
    expect(e.state()?.hover?.accepted).toBe(false);
  });

  it('builds no prospective child list when nothing will read it', () => {
    const s = new Store();
    s.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'stack', config: {} },
        id: asNodeId('z1'),
      }),
    );
    s.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'stack', config: {} },
        id: asNodeId('z2'),
      }),
    );
    s.registerNode(
      createNode({ kind: 'panel', focus: true, id: asNodeId('p'), parentId: asNodeId('z1') }),
    );
    const e = new DragEngine(s);
    e.addDropTarget(asNodeId('z2'), at(SQUARE));
    e.tryBegin(asNodeId('p'));
    // Spy after tryBegin: the begin path calls getChildren itself, so a spy
    // installed earlier is already dirty by the time the hover runs.
    const spy = vi.spyOn(s, 'getChildren');
    e.updateHoverByPoint(50, 50);
    expect(e.state()?.hover?.accepted).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('DragEngine — the items canAccept sees', () => {
  /** z2 holds `a` (2×1) and `b`; `p` (1×2) waits in z1. */
  function spannedStore(): Store {
    const s = new Store();
    for (const z of ['z1', 'z2']) {
      s.registerNode(
        createNode({
          kind: 'zone',
          container: { strategyId: 'probe', config: {} },
          id: asNodeId(z),
        }),
      );
    }
    for (const [id, parent, span] of [
      ['p', 'z1', { cols: 1, rows: 2 }],
      ['a', 'z2', { cols: 2, rows: 1 }],
      ['b', 'z2', undefined],
    ] as const) {
      s.registerNode(
        createNode({
          kind: 'panel',
          focus: true,
          id: asNodeId(id),
          parentId: asNodeId(parent),
          ...(span ? { placement: { span } } : {}),
        }),
      );
    }
    return s;
  }

  function probe(s: Store, sourceId: string): LayoutItem[][] {
    const seen: LayoutItem[][] = [];
    const strategy: LayoutStrategy<unknown, string, unknown> = {
      name: 'probe',
      canAccept: (items) => {
        seen.push(items);
        return true;
      },
      layout: () => ({ placements: new Map(), affordances: [] }),
    };
    const e = new DragEngine(s, { getStrategy: () => strategy });
    e.addDropTarget(asNodeId('z2'), at(SQUARE));
    e.tryBegin(asNodeId(sourceId));
    e.updateHoverByPoint(50, 50);
    return seen;
  }

  it('carries each child span and the source span, as layout reads them', () => {
    const [items] = probe(spannedStore(), 'p');
    expect(items?.map((i) => [i.id, i.placement?.span])).toEqual([
      ['a', { cols: 2, rows: 1 }],
      ['b', undefined],
      ['p', { cols: 1, rows: 2 }],
    ]);
  });

  it('lets a parent already over capacity reorder its own children', () => {
    const s = fullStore();
    s.registerNode(
      createNode({ kind: 'panel', focus: true, id: asNodeId('c'), parentId: asNodeId('z2') }),
    );
    const e = new DragEngine(s, { getStrategy: () => exactlyTwoStrategy });
    e.addDropTarget(asNodeId('z2'), at(SQUARE));
    e.tryBegin(asNodeId('a'));
    e.updateHoverByPoint(50, 50);
    expect(e.state()?.hover?.accepted).toBe(true);
  });

  it('still lets acceptPolicy refuse a reorder', () => {
    const s = fullStore();
    const e = new DragEngine(s, { getStrategy: () => exactlyTwoStrategy });
    e.addDropTarget(asNodeId('z2'), at(SQUARE, { acceptPolicy: () => false }));
    e.tryBegin(asNodeId('a'));
    e.updateHoverByPoint(50, 50);
    expect(e.state()?.hover?.accepted).toBe(false);
  });

  it('leaves out hidden children, as layout does', () => {
    const s = spannedStore();
    s.showNode(asNodeId('b'));
    s.hideNode(asNodeId('b'));
    const [items] = probe(s, 'p');
    expect(items?.map((i) => i.id)).toEqual(['a', 'p']);
  });
});

describe('DragEngine — config.accepts', () => {
  /** z1 holds `p` (kind panel) and `t` (kind tool); z2 holds `a` and `b` and
   *  carries `accepts`. No strategy is registered, so nothing else refuses. */
  function acceptsStore(accepts: unknown): Store {
    const s = new Store();
    for (const [z, config] of [
      ['z1', {}],
      ['z2', { accepts }],
    ] as const) {
      s.registerNode(
        createNode({ kind: 'zone', container: { strategyId: 'none', config }, id: asNodeId(z) }),
      );
    }
    for (const [id, kind, parent] of [
      ['p', 'panel', 'z1'],
      ['t', 'tool', 'z1'],
      ['a', 'panel', 'z2'],
      ['b', 'panel', 'z2'],
    ] as const) {
      s.registerNode(
        createNode({ kind, focus: true, id: asNodeId(id), parentId: asNodeId(parent) }),
      );
    }
    return s;
  }

  function hover(s: Store, sourceId: string, target: Partial<DropTarget> = {}): boolean {
    const e = new DragEngine(s);
    e.addDropTarget(asNodeId('z2'), at(SQUARE, target));
    e.tryBegin(asNodeId(sourceId));
    e.updateHoverByPoint(50, 50);
    return e.state()?.hover?.accepted ?? false;
  }

  it('false refuses a drop from another parent', () => {
    expect(hover(acceptsStore(false), 'p')).toBe(false);
  });

  it('false refuses a reorder within the container too', () => {
    expect(hover(acceptsStore(false), 'a')).toBe(false);
  });

  it('an empty rule refuses nothing', () => {
    expect(hover(acceptsStore({}), 'p')).toBe(true);
  });

  it('kinds admits a listed kind', () => {
    expect(hover(acceptsStore({ kinds: ['panel'] }), 'p')).toBe(true);
  });

  it('kinds refuses an unlisted kind', () => {
    expect(hover(acceptsStore({ kinds: ['panel'] }), 't')).toBe(false);
  });

  it('kinds refuses a source with no kind', () => {
    const s = acceptsStore({ kinds: ['panel'] });
    s.registerNode(createNode({ focus: true, id: asNodeId('bare'), parentId: asNodeId('z1') }));
    expect(hover(s, 'bare')).toBe(false);
  });

  it('max admits a drop that reaches it', () => {
    expect(hover(acceptsStore({ max: 3 }), 'p')).toBe(true);
  });

  it('max refuses a drop that would pass it', () => {
    expect(hover(acceptsStore({ max: 2 }), 'p')).toBe(false);
  });

  it('max counts only visible children', () => {
    const s = acceptsStore({ max: 2 });
    s.showNode(asNodeId('b'));
    s.hideNode(asNodeId('b'));
    expect(hover(s, 'p')).toBe(true);
  });

  it('max lets a container already over it reorder its own children', () => {
    expect(hover(acceptsStore({ max: 1 }), 'a')).toBe(true);
  });

  it('kinds and max both have to pass', () => {
    expect(hover(acceptsStore({ kinds: ['tool'], max: 2 }), 't')).toBe(false);
    expect(hover(acceptsStore({ kinds: ['tool'], max: 3 }), 't')).toBe(true);
  });

  it('refuses before acceptPolicy, which cannot override it', () => {
    let calls = 0;
    const accepted = hover(acceptsStore(false), 'p', {
      acceptPolicy: () => {
        calls += 1;
        return true;
      },
    });
    expect(accepted).toBe(false);
    expect(calls).toBe(0);
  });

  it('leaves acceptPolicy free to refuse what accepts admits', () => {
    const accepted = hover(acceptsStore({ kinds: ['panel'] }), 'p', { acceptPolicy: () => false });
    expect(accepted).toBe(false);
  });

  it('lock.accept refuses first', () => {
    const s = acceptsStore({ kinds: ['panel'] });
    s.setLock(asNodeId('z2'), { accept: true });
    expect(hover(s, 'p')).toBe(false);
  });

  it('builds the child list once for max, acceptPolicy and canAccept together', () => {
    const s = acceptsStore({ max: 5 });
    const seen: number[] = [];
    const strategy: LayoutStrategy<unknown, string, unknown> = {
      name: 'probe',
      canAccept: (items) => {
        seen.push(items.length);
        return true;
      },
      layout: () => ({ placements: new Map(), affordances: [] }),
    };
    const e = new DragEngine(s, { getStrategy: () => strategy });
    e.addDropTarget(
      asNodeId('z2'),
      at(SQUARE, {
        acceptPolicy: (ctx) => {
          seen.push(ctx.items.length);
          return undefined;
        },
      }),
    );
    e.tryBegin(asNodeId('p'));
    const spy = vi.spyOn(s, 'getChildren');
    e.updateHoverByPoint(50, 50);
    expect(e.state()?.hover?.accepted).toBe(true);
    expect(seen).toEqual([3, 3]);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('builds no child list for false or kinds alone', () => {
    for (const accepts of [false, { kinds: ['panel'] }]) {
      const s = acceptsStore(accepts);
      const e = new DragEngine(s);
      e.addDropTarget(asNodeId('z2'), at(SQUARE));
      e.tryBegin(asNodeId('p'));
      const spy = vi.spyOn(s, 'getChildren');
      e.updateHoverByPoint(50, 50);
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it('traces which rule refused', () => {
    configureTrace('dnd');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      hover(acceptsStore({ kinds: ['panel'] }), 't');
      hover(acceptsStore({ max: 2 }), 'p');
      const lines = log.mock.calls.map((c) => c.join(' '));
      expect(lines.some((l) => l.includes('accepts.kinds') && l.includes("'tool'"))).toBe(true);
      expect(lines.some((l) => l.includes('accepts.max') && l.includes('3 > 2'))).toBe(true);
    } finally {
      log.mockRestore();
      configureTrace(null);
    }
  });
});
