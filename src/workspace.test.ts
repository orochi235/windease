import { describe, expect, it } from 'vitest';
import { createNode } from './constructors.js';
import { captureSeam, commitJoin, commitReveal } from './layout/seam-join.js';
import type { Rect } from './layout-types.js';
import { asNodeId, type NodeHints, type NodeId } from './node.js';
import { deserialize, serialize } from './snapshot.js';
import { Store } from './store.js';
import {
  arrangeWorkspace,
  dispatchWorkspaceSeam,
  type WorkspaceInput,
  type WorkspaceSeam,
} from './workspace.js';

const SIDE = asNodeId('side');
const MAIN = asNodeId('main');
const DOCK = asNodeId('dock');

const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, z: 0, w, h });

/** Three root zones: `side` beside `main`, `dock` under both. */
function build(hints: Partial<Record<string, NodeHints>> = {}): Store {
  const s = new Store();
  for (const id of [SIDE, MAIN, DOCK]) {
    const h = hints[id];
    s.registerNode(
      createNode({
        kind: 'zone',
        id,
        container: { strategyId: 'strip', config: {} },
        meta: { title: id },
        ...(h ? { hints: h } : {}),
      }),
    );
    s.showNode(id);
  }
  return s;
}

/** side 200 wide, an 8px gap, main 592 wide; dock 100 tall under an 8px gap. */
const RECTS = new Map<NodeId, Rect>([
  [SIDE, rect(0, 0, 200, 400)],
  [MAIN, rect(208, 0, 592, 400)],
  [DOCK, rect(0, 408, 800, 100)],
]);

const SIDE_SEAM: WorkspaceSeam = { before: SIDE, after: MAIN, axis: 'x' };

function input(store: Store, over: Partial<WorkspaceInput> = {}): WorkspaceInput {
  return { store, roots: [SIDE, MAIN, DOCK], seams: [SIDE_SEAM], rects: RECTS, ...over };
}

const drag = (id: string, dx: number, dy = 0) =>
  ({ affordanceId: id, kind: 'drag', payload: { dx, dy } }) as const;

describe('a workspace seam beside a root with lock.resize', () => {
  it.each([SIDE, MAIN])('is not drawn when %s is locked', (locked) => {
    const s = build();
    s.setLock(locked, { resize: true });
    expect(arrangeWorkspace(input(s)).affordances).toEqual([]);
  });

  it('refuses a drag from a renderer that kept the handle', () => {
    const s = build();
    s.setLock(MAIN, { resize: true });
    dispatchWorkspaceSeam(input(s), drag('workspace-seam-side-main', 40));
    expect(s.getNode(SIDE)?.hints?.size).toBeUndefined();
  });

  it('still holds the size the seam was dragged to before the lock', () => {
    const s = build();
    dispatchWorkspaceSeam(input(s), drag('workspace-seam-side-main', 40));
    s.setLock(SIDE, { resize: true });
    expect(arrangeWorkspace(input(s)).roots.get(SIDE)?.size).toEqual({ w: 240 });
  });

  it('is what lock: true means on a root', () => {
    const s = build();
    s.setLock(SIDE, true);
    expect(s.isLocked(SIDE, 'resize')).toBe(true);
  });
});

describe('arrangeWorkspace — seams', () => {
  it('puts a seam in the gap between two roots, over the extent they share', () => {
    const { affordances } = arrangeWorkspace(input(build()));
    expect(affordances).toHaveLength(1);
    const seam = affordances[0]!;
    expect(seam.id).toBe('workspace-seam-side-main');
    expect(seam.kind).toBe('resize-x');
    expect(seam.rect).toEqual({ x: 202, y: 0, z: 0, w: 4, h: 400 });
    expect(seam.affects).toEqual([SIDE, MAIN]);
    expect(seam.childId).toBe(SIDE);
  });

  it('runs a y seam across the width the two roots share', () => {
    const { affordances } = arrangeWorkspace(
      input(build(), { seams: [{ before: MAIN, after: DOCK, axis: 'y', sizes: 'after' }] }),
    );
    expect(affordances[0]!.kind).toBe('resize-y');
    expect(affordances[0]!.rect).toEqual({ x: 208, y: 402, z: 0, w: 592, h: 4 });
    expect(affordances[0]!.childId).toBe(DOCK);
  });

  it('reports the range both roots allow, as the seam position', () => {
    const store = build({
      side: { minSize: { w: 120, h: 0 }, maxSize: { w: 500, h: 0 } },
      main: { minSize: { w: 300, h: 0 } },
    });
    const bounds = arrangeWorkspace(input(store)).affordances[0]!.bounds!;
    expect(bounds).toEqual({
      orientation: 'horizontal',
      valueNow: 200,
      valueMin: 120,
      // 792 of extent between them, less main's 300 floor, under side's 500 cap.
      valueMax: 492,
      atMin: false,
      atMax: false,
    });
  });

  it('measures a seam that sizes the root after it from the same end', () => {
    const store = build({ dock: { minSize: { w: 0, h: 60 } } });
    const bounds = arrangeWorkspace(
      input(store, { seams: [{ before: MAIN, after: DOCK, axis: 'y', sizes: 'after' }] }),
    ).affordances[0]!.bounds!;
    expect(bounds.valueNow).toBe(400);
    expect(bounds.valueMax).toBe(440);
  });

  it('draws no seam between roots that share no extent', () => {
    const { affordances } = arrangeWorkspace(
      input(build(), { seams: [{ before: SIDE, after: DOCK, axis: 'x' }] }),
    );
    expect(affordances).toEqual([]);
  });

  it('draws no seam for a root nothing has measured', () => {
    const rects = new Map(RECTS);
    rects.delete(MAIN);
    expect(arrangeWorkspace(input(build(), { rects })).affordances).toEqual([]);
  });
});

describe('dispatchWorkspaceSeam', () => {
  it('writes the dragged size to the root the seam sizes', () => {
    const store = build();
    dispatchWorkspaceSeam(input(store), drag('workspace-seam-side-main', 40));
    expect(store.getNode(SIDE)?.hints?.size).toEqual({ w: 240 });
    expect(store.getNode(MAIN)?.hints?.size).toBeUndefined();
  });

  it('accumulates across moves made before anything is measured again', () => {
    const store = build();
    dispatchWorkspaceSeam(input(store), drag('workspace-seam-side-main', 40));
    dispatchWorkspaceSeam(input(store), drag('workspace-seam-side-main', 40));
    expect(store.getNode(SIDE)?.hints?.size?.w).toBe(280);
  });

  it("accumulates inside a throttled store's publish window", () => {
    const store = new Store({ throttle: { notifyMs: 16 } });
    for (const id of [SIDE, MAIN]) {
      store.registerNode(
        createNode({ kind: 'zone', id, container: { strategyId: 'strip', config: {} } }),
      );
    }
    store.flushNow();
    dispatchWorkspaceSeam(input(store), drag('workspace-seam-side-main', 40));
    dispatchWorkspaceSeam(input(store), drag('workspace-seam-side-main', 40));
    expect(store.getNodeTruth(SIDE)?.hints?.size?.w).toBe(280);
  });

  it('stops at the floor of the root it sizes', () => {
    const store = build({ side: { minSize: { w: 120, h: 0 } } });
    dispatchWorkspaceSeam(input(store), drag('workspace-seam-side-main', -500));
    expect(store.getNode(SIDE)?.hints?.size?.w).toBe(120);
  });

  it('stops at the floor of the root across the seam', () => {
    const store = build({ main: { minSize: { w: 300, h: 0 } } });
    dispatchWorkspaceSeam(input(store), drag('workspace-seam-side-main', 900));
    expect(store.getNode(SIDE)?.hints?.size?.w).toBe(492);
  });

  it('sizes the root after the seam when told to, against the drag', () => {
    const store = build();
    const seams: WorkspaceSeam[] = [{ before: MAIN, after: DOCK, axis: 'y', sizes: 'after' }];
    dispatchWorkspaceSeam(input(store, { seams }), drag('workspace-seam-main-dock', 0, -30));
    expect(store.getNode(DOCK)?.hints?.size).toEqual({ h: 130 });
  });

  it('keeps the other axis of a size it already holds', () => {
    const store = build({ side: { size: { w: 200, h: 320 } } });
    dispatchWorkspaceSeam(input(store), drag('workspace-seam-side-main', 10));
    expect(store.getNode(SIDE)?.hints?.size).toEqual({ w: 210, h: 320 });
  });

  it('ignores a NaN delta and an affordance it does not own', () => {
    const store = build();
    dispatchWorkspaceSeam(input(store), drag('workspace-seam-side-main', Number.NaN));
    dispatchWorkspaceSeam(input(store), drag('gutter-0', 40));
    expect(store.getNode(SIDE)?.hints?.size).toBeUndefined();
  });

  it('writes nothing while a root is zoomed', () => {
    const store = build();
    dispatchWorkspaceSeam(input(store, { zoom: MAIN }), drag('workspace-seam-side-main', 40));
    expect(store.getNode(SIDE)?.hints?.size).toBeUndefined();
  });
});

describe('arrangeWorkspace — sizes', () => {
  it('hands back the axis a seam sizes, and no other', () => {
    const store = build({ side: { size: { w: 260, h: 320 } } });
    const { roots } = arrangeWorkspace(input(store));
    expect(roots.get(SIDE)).toEqual({ state: 'placed', size: { w: 260 } });
    expect(roots.get(MAIN)).toEqual({ state: 'placed' });
  });

  it('holds a stored size to the room there is, without rewriting it', () => {
    const store = build({
      side: { size: { w: 700 } },
      main: { minSize: { w: 300, h: 0 } },
    });
    const layout = arrangeWorkspace(input(store));
    expect(layout.roots.get(SIDE)?.size).toEqual({ w: 492 });
    expect(layout.affordances[0]!.bounds!.atMax).toBe(true);
    expect(store.getNode(SIDE)?.hints?.size?.w).toBe(700);
  });

  it('keeps a root dragged down to nothing at nothing', () => {
    const store = build();
    dispatchWorkspaceSeam(input(store), drag('workspace-seam-side-main', -500));
    expect(store.getNode(SIDE)?.hints?.size).toEqual({ w: 0 });
    expect(arrangeWorkspace(input(store)).roots.get(SIDE)?.size).toEqual({ w: 0 });
  });

  it('ignores a size that is not a finite number', () => {
    const store = build({ side: { size: { w: Number.NaN } } });
    expect(arrangeWorkspace(input(store)).roots.get(SIDE)).toEqual({ state: 'placed' });
  });

  it('round-trips a dragged size through a snapshot', () => {
    const store = build();
    dispatchWorkspaceSeam(input(store), drag('workspace-seam-side-main', 40));
    const restored = deserialize(JSON.parse(JSON.stringify(serialize(store))));
    expect(arrangeWorkspace(input(restored)).roots.get(SIDE)?.size).toEqual({ w: 240 });
  });
});

describe('arrangeWorkspace — hiding a root', () => {
  const HIDE: WorkspaceSeam = { ...SIDE_SEAM, overshoot: 'hide' };

  it('declares no join unless the seam asks for one', () => {
    expect(arrangeWorkspace(input(build())).affordances[0]!.join).toBeUndefined();
  });

  it('names the root at each end of the range as what an overshoot hides', () => {
    const { affordances } = arrangeWorkspace(input(build(), { seams: [HIDE] }));
    expect(affordances[0]!.join).toEqual({
      atMin: SIDE,
      atMax: MAIN,
      threshold: 24,
      action: 'hide',
    });
  });

  it('leaves a hide-locked root out of the join', () => {
    const store = build();
    store.setLock(MAIN, { hide: true });
    const { affordances } = arrangeWorkspace(input(store, { seams: [HIDE] }));
    expect(affordances[0]!.join).toEqual({ atMin: SIDE, threshold: 24, action: 'hide' });
  });

  it('reports a hidden root and swaps its seam for a handle on its neighbor', () => {
    const store = build();
    store.hideNode(SIDE);
    const rects = new Map<NodeId, Rect>([
      [MAIN, rect(0, 0, 800, 400)],
      [DOCK, rect(0, 408, 800, 100)],
    ]);
    const layout = arrangeWorkspace(input(store, { seams: [HIDE], rects }));
    expect(layout.roots.get(SIDE)).toEqual({ state: 'hidden' });
    expect(layout.affordances).toHaveLength(1);
    const handle = layout.affordances[0]!;
    expect(handle.id).toBe('workspace-reveal-side');
    expect(handle.rect).toEqual({ x: 0, y: 0, z: 0, w: 4, h: 400 });
    expect(handle.reveal).toEqual({ id: SIDE, threshold: 24, direction: 1 });
  });

  it('opens a root hidden after its neighbor back from the far edge', () => {
    const store = build();
    store.hideNode(DOCK);
    const rects = new Map<NodeId, Rect>([[MAIN, rect(208, 0, 592, 508)]]);
    const seams: WorkspaceSeam[] = [
      { before: MAIN, after: DOCK, axis: 'y', sizes: 'after', overshoot: 'hide' },
    ];
    const handle = arrangeWorkspace(input(store, { seams, rects })).affordances[0]!;
    expect(handle.rect).toEqual({ x: 208, y: 504, z: 0, w: 592, h: 4 });
    expect(handle.reveal?.direction).toBe(-1);
  });

  it('offers no handle for a hidden root whose seam does not hide', () => {
    const store = build();
    store.hideNode(SIDE);
    expect(arrangeWorkspace(input(store)).affordances).toEqual([]);
  });

  it('a committed hide puts back the size the gesture found', () => {
    const store = build({ side: { size: { w: 240 }, minSize: { w: 120, h: 0 } } });
    const seam = arrangeWorkspace(input(store, { seams: [HIDE] })).affordances[0]!;
    const before = captureSeam(store, seam);
    dispatchWorkspaceSeam(input(store, { seams: [HIDE] }), drag(seam.id, -500));
    expect(store.getNode(SIDE)?.hints?.size?.w).toBe(120);
    commitJoin(store, seam, SIDE, before);
    expect(store.getNode(SIDE)?.lifecycle.state).toBe('hidden');
    expect(store.getNode(SIDE)?.hints?.size).toEqual({ w: 240 });
  });

  it('a committed hide clears a size the gesture was first to write', () => {
    const store = build();
    const seam = arrangeWorkspace(input(store, { seams: [HIDE] })).affordances[0]!;
    const before = captureSeam(store, seam);
    dispatchWorkspaceSeam(input(store, { seams: [HIDE] }), drag(seam.id, -500));
    commitJoin(store, seam, SIDE, before);
    expect(store.getNode(SIDE)?.hints?.size).toBeUndefined();
  });

  it('a committed reveal shows the root again', () => {
    const store = build();
    store.hideNode(SIDE);
    const rects = new Map<NodeId, Rect>([[MAIN, rect(0, 0, 800, 400)]]);
    const handle = arrangeWorkspace(input(store, { seams: [HIDE], rects })).affordances[0]!;
    commitReveal(store, handle);
    expect(store.getNode(SIDE)?.lifecycle.state).toBe('visible');
  });
});

describe('arrangeWorkspace — a zoom stored on the root', () => {
  it('zooms the root whose hints.zoom is set, with no zoom passed', () => {
    const store = build({ [MAIN]: { zoom: true } });
    const layout = arrangeWorkspace(input(store));
    expect(layout.roots.get(MAIN)?.state).toBe('zoomed');
    expect(layout.roots.get(SIDE)?.state).toBe('withheld');
  });

  it('survives a snapshot', () => {
    const store = build();
    store.setHints(MAIN, { zoom: true });
    const restored = deserialize(serialize(store));
    expect(arrangeWorkspace(input(restored)).roots.get(MAIN)?.state).toBe('zoomed');
  });

  it('gives way to a zoom passed in, null included', () => {
    const store = build({ [MAIN]: { zoom: true } });
    expect(arrangeWorkspace(input(store, { zoom: SIDE })).roots.get(SIDE)?.state).toBe('zoomed');
    expect(arrangeWorkspace(input(store, { zoom: null })).roots.get(MAIN)?.state).toBe('placed');
  });

  it('takes the first root in order when two ask', () => {
    const store = build({ [MAIN]: { zoom: true }, [DOCK]: { zoom: true } });
    expect(arrangeWorkspace(input(store)).roots.get(MAIN)?.state).toBe('zoomed');
  });

  it('skips a hidden root that asks, for the next one that does', () => {
    const store = build({ [MAIN]: { zoom: true }, [DOCK]: { zoom: true } });
    store.hideNode(MAIN);
    expect(arrangeWorkspace(input(store)).roots.get(DOCK)?.state).toBe('zoomed');
  });

  it('stops a seam drag like a passed zoom does', () => {
    const store = build({ [MAIN]: { zoom: true } });
    dispatchWorkspaceSeam(input(store), drag('workspace-seam-side-main', 40));
    expect(store.getNode(SIDE)?.hints?.size).toBeUndefined();
  });
});

describe('arrangeWorkspace — zoom', () => {
  it('fills the workspace with one root and withholds the rest', () => {
    const layout = arrangeWorkspace(input(build(), { zoom: MAIN }));
    expect(layout.roots.get(MAIN)).toEqual({ state: 'zoomed' });
    expect(layout.roots.get(SIDE)).toEqual({ state: 'withheld' });
    expect(layout.roots.get(DOCK)).toEqual({ state: 'withheld' });
    expect(layout.affordances).toEqual([]);
  });

  it('leaves a hidden root hidden under a zoom', () => {
    const store = build();
    store.hideNode(DOCK);
    expect(arrangeWorkspace(input(store, { zoom: MAIN })).roots.get(DOCK)).toEqual({
      state: 'hidden',
    });
  });

  it('ignores a zoom naming a hidden root or one outside the workspace', () => {
    const store = build();
    store.hideNode(MAIN);
    expect(arrangeWorkspace(input(store, { zoom: MAIN })).roots.get(SIDE)?.state).toBe('placed');
    expect(
      arrangeWorkspace(input(build(), { zoom: asNodeId('nobody') })).roots.get(SIDE)?.state,
    ).toBe('placed');
  });
});
