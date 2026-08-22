import { describe, expect, it } from 'vitest';
import { createNode } from './constructors.js';
import { ContainerHost } from './container-host.js';
import { stripStrategy } from './layout/strip.js';
import type { StrategyRegistry } from './layout-types.js';
import { asNodeId } from './node.js';
import { serialize } from './snapshot.js';
import { Store } from './store.js';

const REGISTRY: StrategyRegistry = new Map([['stack', stripStrategy as never]]);
const Z = asNodeId('z');
const P1 = asNodeId('p1');
const P2 = asNodeId('p2');

/** `p1` asks to be sized by content; `p2` never does. */
function build(): Store {
  const s = new Store();
  s.registerNode(
    createNode({
      kind: 'zone',
      container: { strategyId: 'stack', config: { axis: 'y', fill: true } },
      id: Z,
    }),
  );
  s.registerNode(
    createNode({ kind: 'palette', id: P1, parentId: Z, hints: { sizing: { h: 'content' } } }),
  );
  s.registerNode(createNode({ kind: 'panel', id: P2, parentId: Z }));
  s.showNode(P1);
  s.showNode(P2);
  return s;
}

function host(store: Store): ContainerHost {
  const h = new ContainerHost(store, Z, REGISTRY);
  h.setViewport({ w: 200, h: 400 });
  return h;
}

describe('ContainerHost content sizing', () => {
  it('sizes a pane from a reported measurement, with no DOM', () => {
    const h = host(build());
    h.setNaturalSize(P1, { w: 200, h: 120 });
    expect(h.layout().placements.get(P1)?.h).toBe(120);
    expect(h.layout().placements.get(P2)?.h).toBe(280);
  });

  it('ignores a measurement for a pane that never asked', () => {
    const h = host(build());
    h.setNaturalSize(P2, { w: 200, h: 120 });
    expect(h.layout().placements.get(P2)?.h).toBe(200);
  });

  it('drops a measurement on null and reverts to the share', () => {
    const h = host(build());
    h.setNaturalSize(P1, { w: 200, h: 120 });
    expect(h.layout().placements.get(P1)?.h).toBe(120);
    h.setNaturalSize(P1, null);
    expect(h.layout().placements.get(P1)?.h).toBe(200);
  });

  it('settles in a bounded number of passes', () => {
    // A measurement invalidates the layout, which resizes the measured
    // element, which measures again. Convergence is the claim, and only a
    // count proves it — asserting the final rect looks right would pass just
    // as happily against a loop that never stopped.
    const h = host(build());
    let notifications = 0;
    h.subscribe(() => {
      notifications++;
    });
    h.layout();

    for (let i = 0; i < 20; i++) {
      // Feed back a measurement that drifts by less than the deadband, which
      // is what float churn across the measure/layout cycle looks like.
      h.setNaturalSize(P1, { w: 200, h: 120 + i * 0.01 });
      h.layout();
    }
    expect(notifications).toBe(1);
    expect(h.layout().placements.get(P1)?.h).toBe(120);
  });

  it('notifies again once a change clears the deadband', () => {
    const h = host(build());
    h.setNaturalSize(P1, { w: 200, h: 120 });
    h.layout();
    let notifications = 0;
    h.subscribe(() => {
      notifications++;
    });
    h.setNaturalSize(P1, { w: 200, h: 121 });
    expect(notifications).toBe(1);
    expect(h.layout().placements.get(P1)?.h).toBe(121);
  });

  it('keeps measurements out of the snapshot', () => {
    // `natural` is measured state, not store state. A v5 snapshot carrying it
    // would freeze one viewport's measurement into every later hydrate.
    const store = build();
    const h = host(store);
    h.setNaturalSize(P1, { w: 200, h: 120 });
    h.layout();
    expect(JSON.stringify(serialize(store))).not.toContain('natural');
  });

  it('still declares the request in the snapshot', () => {
    // The request is node state and must survive; only the measurement doesn't.
    const store = build();
    expect(JSON.stringify(serialize(store))).toContain('"sizing"');
  });
});
