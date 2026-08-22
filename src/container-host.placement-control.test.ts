import { describe, expect, it, vi } from 'vitest';
import { createNode } from './constructors.js';
import { ContainerHost } from './container-host.js';
import { stripStrategy } from './layout/strip.js';
import type { StrategyRegistry } from './layout-types.js';
import { asNodeId, type NodeId } from './node.js';
import { Store } from './store.js';

const REGISTRY: StrategyRegistry = new Map([['stack', stripStrategy as never]]);
const Z = asNodeId('z');
const P1 = asNodeId('p1');
const P2 = asNodeId('p2');

function build(config: Record<string, unknown> = {}): Store {
  const s = new Store();
  s.registerNode(
    createNode({
      kind: 'zone',
      container: {
        strategyId: 'stack',
        config: { axis: 'y', fill: true, resizable: true, ...config },
      },
      id: Z,
    }),
  );
  for (const id of ['p1', 'p2']) {
    const nid = asNodeId(id);
    s.registerNode(createNode({ kind: 'panel', focus: true, id: nid, parentId: Z }));
    s.showNode(nid);
  }
  return s;
}

function host(store: Store): ContainerHost {
  const h = new ContainerHost(store, Z, REGISTRY);
  h.setViewport({ w: 200, h: 400 });
  return h;
}

const sizeOf = (s: Store, id: NodeId): unknown =>
  (s.getNode(id)?.membership?.placement as { size?: { h?: number } } | undefined)?.size?.h;

/** Drag p1's bottom gutter down by `dy`. */
function drag(h: ContainerHost, dy: number): void {
  h.dispatchAffordance({ affordanceId: 'resize-y-p1', kind: 'drag', payload: { dx: 0, dy } });
}

describe('controlled placement', () => {
  it('hands the host the placement a gutter drag would have written', () => {
    const s = build();
    const h = host(s);
    const commit = vi.fn();
    h.registerPlacementControl(P1, commit);

    drag(h, 50);

    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit.mock.calls[0]?.[0]).toEqual({ size: { h: 250 } });
    expect(commit.mock.calls[0]?.[1]).toEqual({ affordanceId: 'resize-y-p1', parentId: Z });
    h.destroy();
  });

  it('does not write the store, so the host is the only writer', () => {
    const s = build();
    const h = host(s);
    h.registerPlacementControl(P1, () => {});

    drag(h, 50);

    expect(sizeOf(s, P1)).toBeUndefined();
    h.destroy();
  });

  it('still commits normally for an uncontrolled child', () => {
    const s = build();
    const h = host(s);

    drag(h, 50);

    expect(sizeOf(s, P1)).toBe(250);
    h.destroy();
  });

  it('hands the host exactly what an uncontrolled store would have held', () => {
    // A controlled child that disagreed with an uncontrolled one would make the
    // clamped extent depend on who owns placement, which it must not.
    const controlled = build();
    const hc = host(controlled);
    let handed: unknown;
    hc.registerPlacementControl(P1, (next) => {
      handed = next;
    });
    drag(hc, 10_000);

    const uncontrolled = build();
    const hu = host(uncontrolled);
    drag(hu, 10_000);

    expect(handed).toEqual({ size: { h: sizeOf(uncontrolled, P1) } });
    hc.destroy();
    hu.destroy();
  });

  it('notifies both panes of a neighbor-mode drag and writes neither', () => {
    const s = build({ resizeMode: 'neighbor' });
    const h = host(s);
    const one = vi.fn();
    const two = vi.fn();
    h.registerPlacementControl(P1, one);
    h.registerPlacementControl(P2, two);

    drag(h, 50);

    expect(one).toHaveBeenCalledTimes(1);
    expect(two).toHaveBeenCalledTimes(1);
    expect(one.mock.calls[0]?.[0]).toEqual({ size: { h: 250 } });
    expect(two.mock.calls[0]?.[0]).toEqual({ size: { h: 150 } });
    expect(sizeOf(s, P1)).toBeUndefined();
    expect(sizeOf(s, P2)).toBeUndefined();
    h.destroy();
  });

  it('diverts the controlled pane and still writes its uncontrolled sibling', () => {
    const s = build({ resizeMode: 'neighbor' });
    const h = host(s);
    const one = vi.fn();
    h.registerPlacementControl(P1, one);

    drag(h, 50);

    expect(one.mock.calls[0]?.[0]).toEqual({ size: { h: 250 } });
    expect(sizeOf(s, P1)).toBeUndefined();
    expect(sizeOf(s, P2)).toBe(150);
    h.destroy();
  });

  it('a drag that changes nothing notifies nobody', () => {
    const s = build();
    const h = host(s);
    const commit = vi.fn();
    h.registerPlacementControl(P1, commit);

    drag(h, 0);

    expect(commit).not.toHaveBeenCalled();
    h.destroy();
  });

  it('unregistering restores uncontrolled commits', () => {
    const s = build();
    const h = host(s);
    const commit = vi.fn();
    const off = h.registerPlacementControl(P1, commit);
    off();

    drag(h, 50);

    expect(commit).not.toHaveBeenCalled();
    expect(sizeOf(s, P1)).toBe(250);
    h.destroy();
  });

  it('reverts a key the gesture added rather than leaving it behind', () => {
    // `writeSize` adds `size` to a bag that had none. Restoring the prior bag
    // means deleting the key, not writing a stale value over it.
    const s = build();
    s.patchPlacement(P1, { tag: 'keep' });
    const h = host(s);
    h.registerPlacementControl(P1, () => {});

    drag(h, 50);

    expect(s.getNode(P1)?.membership?.placement).toEqual({ tag: 'keep' });
    h.destroy();
  });
});
