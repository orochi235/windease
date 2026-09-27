import { describe, expect, it } from 'vitest';
import { type CollapseDrag, type CollapsePolicy, collapse } from './collapse.js';
import { createNode } from './constructors.js';
import { ContainerHost } from './container-host.js';
import { stripStrategy } from './layout/strip.js';
import { asNodeId } from './node.js';
import { Store } from './store.js';

const ROOT = asNodeId('root');
const SIDE = asNodeId('side');
const MAIN = asNodeId('main');
const TOOL = asNodeId('tool');
const DOC = asNodeId('doc');
const REGISTRY = new Map([['strip', stripStrategy as never]]);

/** root ▸ [side ▸ [tool], main ▸ [doc]], with `side` dragged to 240 wide. */
function scene(policy?: CollapsePolicy) {
  const store = new Store(policy ? { collapsePolicy: policy } : {});
  store.registerNode(
    createNode({
      kind: 'zone',
      id: ROOT,
      container: { strategyId: 'strip', config: { axis: 'x', fill: true } },
    }),
  );
  for (const id of [SIDE, MAIN]) {
    store.registerNode(
      createNode({
        kind: 'group',
        id,
        parentId: ROOT,
        container: { strategyId: 'strip', config: { axis: 'y', fill: true } },
      }),
    );
  }
  store.registerNode(createNode({ kind: 'panel', focus: true, id: TOOL, parentId: SIDE }));
  store.registerNode(createNode({ kind: 'panel', focus: true, id: DOC, parentId: MAIN }));
  for (const id of [ROOT, SIDE, MAIN, TOOL, DOC]) store.showNode(id);
  store.patchPlacement(SIDE, { size: { w: 240 } });
  const host = new ContainerHost(store, ROOT, REGISTRY);
  host.setViewport({ w: 1000, h: 600 });
  return { store, host };
}

const widths = (host: ContainerHost) => [
  host.layout().placements.get(SIDE)?.w,
  host.layout().placements.get(MAIN)?.w,
];

const dragging = (taken: boolean): CollapseDrag => ({ ids: [DOC], accepts: () => taken });

describe('ContainerHost with a collapse policy', () => {
  it('leaves an empty child at its extent with no policy', () => {
    const { store, host } = scene();
    store.moveNode(TOOL, MAIN);
    expect(widths(host)).toEqual([240, 760]);
  });

  it('collapses a child when its last pane leaves, and restores it on return', () => {
    const { store, host } = scene(collapse());
    expect(widths(host)).toEqual([240, 760]);

    store.moveNode(TOOL, MAIN);
    expect(widths(host)).toEqual([0, 1000]);
    expect(store.getNode(SIDE)?.membership?.placement?.size).toEqual({ w: 240 });

    store.moveNode(TOOL, SIDE);
    expect(widths(host)).toEqual([240, 760]);
  });

  it.each([
    ['is hidden', (store: Store) => store.hideNode(TOOL)],
    ['is destroyed', (store: Store) => store.unregisterNode(TOOL)],
  ])('collapses a child when its last pane %s', (_, leave) => {
    const { store, host } = scene(collapse({ to: 24 }));
    host.layout();
    leave(store);
    expect(widths(host)).toEqual([24, 976]);
  });

  it('tells a listener that already read the layout', () => {
    const { store, host } = scene(collapse());
    host.layout();
    let told = 0;
    host.subscribe(() => told++);
    store.moveNode(TOOL, MAIN);
    expect(told).toBeGreaterThan(0);
  });

  it('opens a collapsed child while a drag it would take is in flight', () => {
    const { store, host } = scene(collapse({ dragTo: 200 }));
    store.moveNode(TOOL, MAIN);
    expect(widths(host)).toEqual([0, 1000]);

    host.setDrag(dragging(true));
    expect(widths(host)).toEqual([200, 800]);

    host.setDrag(null);
    expect(widths(host)).toEqual([0, 1000]);
  });

  it('stays shut for a drag the child would refuse', () => {
    const { store, host } = scene(collapse({ dragTo: 200 }));
    store.moveNode(TOOL, MAIN);
    host.setDrag(dragging(false));
    expect(widths(host)).toEqual([0, 1000]);
  });

  it('does not re-run the layout for a drag that changes no answer', () => {
    const { host } = scene(collapse({ dragTo: 200 }));
    const before = host.layout();
    host.setDrag(dragging(true));
    expect(host.layout()).toBe(before);
  });

  it('draws no seam against a collapsed child', () => {
    const { store, host } = scene(collapse({ to: 24 }));
    expect(host.layout().affordances).toHaveLength(1);
    store.moveNode(TOOL, MAIN);
    expect(host.layout().affordances).toHaveLength(0);
  });
});
