import { act, render } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GeometrySource } from '../index.js';
import { asNodeId, createNode, Store, stripStrategy } from '../index.js';
import { captureTrace } from '../test-utils/capture-trace.js';
import { Container } from './Container.js';
import { GeometryProvider, useGeometrySource } from './focus/useGeometrySource.js';
import { Provider } from './Provider.js';
import { StrategyRegistryProvider } from './strategies.js';

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

let boxes: Record<string, Box | Box[]> = {};
let measures: Record<string, number> = {};
/** Which box of a list a given element answers with — assigned in mount
 *  order, so two containers sharing one id can sit in different places. */
let slots = new WeakMap<HTMLElement, number>();
let nextSlot: Record<string, number> = {};

/** A measure loop would otherwise hang the run instead of failing it. */
const RUNAWAY_MEASURES = 200;

/** jsdom reports every element at the page origin, so each root's box is
 *  stubbed by the `data-node-container` id its own div carries. Call again to
 *  move an element after mount. */
function stubRects(next: Record<string, Box | Box[]>) {
  boxes = next;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const id = this.getAttribute('data-node-container') ?? '';
    if (id) {
      measures[id] = (measures[id] ?? 0) + 1;
      if (measures[id] > RUNAWAY_MEASURES) throw new Error(`runaway measurement of ${id}`);
    }
    const spec = boxes[id];
    let b: Box = { x: 0, y: 0, w: 0, h: 0 };
    if (Array.isArray(spec)) {
      let slot = slots.get(this);
      if (slot === undefined) {
        slot = nextSlot[id] ?? 0;
        nextSlot[id] = slot + 1;
        slots.set(this, slot);
      }
      b = spec[Math.min(slot, spec.length - 1)] ?? b;
    } else if (spec) {
      b = spec;
    }
    return {
      x: b.x,
      y: b.y,
      left: b.x,
      top: b.y,
      right: b.x + b.w,
      bottom: b.y + b.h,
      width: b.w,
      height: b.h,
      toJSON: () => ({}),
    } as DOMRect;
  });
}

function stubScroll(x: number, y: number) {
  Object.defineProperty(window, 'scrollX', { value: x, configurable: true });
  Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
}

function makeStore(rootIds: string[]): Store {
  const s = new Store();
  for (const rid of rootIds) {
    const zone = asNodeId(rid);
    s.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'strip', config: { axis: 'y', fill: true } },
        id: zone,
      }),
    );
    s.showNode(zone);
    for (const suffix of ['a', 'b']) {
      const nid = asNodeId(`${rid}-${suffix}`);
      s.registerNode(createNode({ kind: 'panel', focus: true, id: nid, parentId: zone }));
      s.showNode(nid);
    }
  }
  return s;
}

function Probe({ onSource }: { onSource: (g: GeometrySource) => void }) {
  onSource(useGeometrySource());
  return null;
}

interface Mounted {
  geometry: GeometrySource;
  /** Re-render with a fresh element; React bails out of an identical one. */
  rerender: () => void;
  unmount: () => void;
}

function mountStore(
  store: Store,
  containerIds: string[],
  opts: { strict?: boolean } = {},
): Mounted {
  let geometry: GeometrySource | null = null;
  // Ids can repeat — one root rendered twice is a case under test — so a key
  // needs the occurrence too.
  const entries = containerIds.map((cid, i) => ({ key: `${cid}#${i}`, id: cid }));
  const tree = () => {
    const inner = (
      <Provider store={store}>
        <StrategyRegistryProvider strategies={{ strip: stripStrategy as never }}>
          <GeometryProvider>
            {entries.map((entry) => (
              <Container
                key={entry.key}
                parentId={asNodeId(entry.id)}
                chrome={{}}
                viewport={{ w: 100, h: 200 }}
              />
            ))}
            <Probe
              onSource={(g) => {
                geometry = g;
              }}
            />
          </GeometryProvider>
        </StrategyRegistryProvider>
      </Provider>
    );
    return opts.strict ? <StrictMode>{inner}</StrictMode> : inner;
  };
  const view = render(tree());
  if (!geometry) throw new Error('Probe never rendered');
  return {
    geometry: geometry as GeometrySource,
    rerender: () => view.rerender(tree()),
    unmount: view.unmount,
  };
}

function mount(rootIds: string[], opts: { strict?: boolean } = {}): Mounted {
  return mountStore(makeStore(rootIds), rootIds, opts);
}

beforeEach(() => {
  measures = {};
  slots = new WeakMap();
  nextSlot = {};
  stubScroll(0, 0);
});

/** The viewport re-measure is coalesced into a frame, which jsdom runs on a
 *  timer. Fake them only around the dispatch so nothing else in the file
 *  has to reason about a faked clock. */
async function inFrame(fire: () => void) {
  vi.useFakeTimers();
  try {
    act(() => {
      fire();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(32);
    });
  } finally {
    vi.useRealTimers();
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('root container origins', () => {
  it('publishes the root own rect in document coordinates', () => {
    stubRects({ left: { x: 40, y: 10, w: 100, h: 200 } });
    stubScroll(20, 30);
    const { geometry } = mount(['left']);
    expect(geometry.rectOf(asNodeId('left'))).toEqual({ x: 60, y: 40, z: 0, w: 100, h: 200 });
  });

  it('composes a root children against that origin', () => {
    stubRects({ left: { x: 40, y: 10, w: 100, h: 200 } });
    const { geometry } = mount(['left']);
    expect(geometry.rectOf(asNodeId('left-a'))).toEqual({ x: 40, y: 10, z: 0, w: 100, h: 100 });
    expect(geometry.rectOf(asNodeId('left-b'))).toEqual({ x: 40, y: 110, z: 0, w: 100, h: 100 });
  });

  it('moves children with a root that moved without resizing', () => {
    stubRects({ left: { x: 40, y: 10, w: 100, h: 200 } });
    const { geometry, rerender } = mount(['left']);
    expect(geometry.rectOf(asNodeId('left-a'))).toEqual({ x: 40, y: 10, z: 0, w: 100, h: 100 });

    stubRects({ left: { x: 200, y: 300, w: 100, h: 200 } });
    rerender();

    expect(geometry.rectOf(asNodeId('left'))).toEqual({ x: 200, y: 300, z: 0, w: 100, h: 200 });
    expect(geometry.rectOf(asNodeId('left-a'))).toEqual({ x: 200, y: 300, z: 0, w: 100, h: 100 });
  });

  it('survives a StrictMode double mount', () => {
    stubRects({ left: { x: 40, y: 10, w: 100, h: 200 } });
    const { geometry } = mount(['left'], { strict: true });
    expect(geometry.rectOf(asNodeId('left'))).toEqual({ x: 40, y: 10, z: 0, w: 100, h: 200 });
    expect(geometry.rectOf(asNodeId('left-a'))).toEqual({ x: 40, y: 10, z: 0, w: 100, h: 100 });
  });

  it('keeps two sibling roots in disjoint coordinate ranges', () => {
    stubRects({
      left: { x: 0, y: 0, w: 100, h: 200 },
      right: { x: 300, y: 0, w: 100, h: 200 },
    });
    const { geometry } = mount(['left', 'right']);

    expect(geometry.rectOf(asNodeId('left-a'))).toEqual({ x: 0, y: 0, z: 0, w: 100, h: 100 });
    expect(geometry.rectOf(asNodeId('left-b'))).toEqual({ x: 0, y: 100, z: 0, w: 100, h: 100 });
    expect(geometry.rectOf(asNodeId('right-a'))).toEqual({ x: 300, y: 0, z: 0, w: 100, h: 100 });
    expect(geometry.rectOf(asNodeId('right-b'))).toEqual({ x: 300, y: 100, z: 0, w: 100, h: 100 });
  });

  it('leaves a parented container unplaced when no one renders its parent', () => {
    const store = new Store();
    const root = asNodeId('root');
    const nested = asNodeId('nested');
    store.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'strip', config: { axis: 'y', fill: true } },
        id: root,
      }),
    );
    store.showNode(root);
    store.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'strip', config: { axis: 'y', fill: true } },
        id: nested,
        parentId: root,
      }),
    );
    store.showNode(nested);

    stubRects({ nested: { x: 40, y: 10, w: 100, h: 200 } });
    const { geometry } = mountStore(store, ['nested']);

    expect(geometry.rectOf(nested)).toBeNull();
  });

  it('forgets the root rect on unmount', () => {
    stubRects({ left: { x: 40, y: 10, w: 100, h: 200 } });
    const { geometry, unmount } = mount(['left']);
    expect(geometry.rectOf(asNodeId('left'))).not.toBeNull();
    unmount();
    expect(geometry.rectOf(asNodeId('left'))).toBeNull();
  });

  it('re-measures a root on a page scroll', async () => {
    stubRects({ left: { x: 40, y: 10, w: 100, h: 200 } });
    const { geometry } = mount(['left']);
    expect(geometry.rectOf(asNodeId('left'))).toEqual({ x: 40, y: 10, z: 0, w: 100, h: 200 });

    // A scroll moves the element up in viewport coordinates while its document
    // position holds; the height changes too so a stale entry cannot coincide.
    stubRects({ left: { x: 40, y: -20, w: 100, h: 150 } });
    stubScroll(0, 30);
    await inFrame(() => {
      window.dispatchEvent(new Event('scroll'));
    });

    expect(geometry.rectOf(asNodeId('left'))).toEqual({ x: 40, y: 10, z: 0, w: 100, h: 150 });
  });

  it('re-measures a root on a window resize', async () => {
    stubRects({ left: { x: 40, y: 10, w: 100, h: 200 } });
    const { geometry } = mount(['left']);

    stubRects({ left: { x: 20, y: 5, w: 60, h: 150 } });
    await inFrame(() => {
      window.dispatchEvent(new Event('resize'));
    });

    expect(geometry.rectOf(asNodeId('left'))).toEqual({ x: 20, y: 5, z: 0, w: 60, h: 150 });
  });

  it('stops listening once the root unmounts', () => {
    // React nulls the ref on unmount, so a leaked listener would still measure
    // nothing — the removal itself is what has to be asserted.
    const added = vi.spyOn(window, 'addEventListener');
    const removed = vi.spyOn(window, 'removeEventListener');
    stubRects({ left: { x: 40, y: 10, w: 100, h: 200 } });
    const { unmount } = mount(['left']);

    const listening = (spy: typeof added) =>
      spy.mock.calls.filter(([type]) => type === 'scroll' || type === 'resize').length;
    expect(listening(added)).toBe(2);
    expect(listening(removed)).toBe(0);

    unmount();
    expect(listening(removed)).toBe(2);
  });

  it('re-measures a root on a scroll in an inner scroller', async () => {
    stubRects({ left: { x: 40, y: 10, w: 100, h: 200 } });
    const { geometry } = mount(['left']);
    // An element's scroll event does not bubble, so only the capture-phase
    // listener sees it.
    const inner = document.createElement('div');
    document.body.appendChild(inner);

    stubRects({ left: { x: 40, y: -20, w: 100, h: 150 } });
    stubScroll(0, 30);
    await inFrame(() => {
      inner.dispatchEvent(new Event('scroll'));
    });

    expect(geometry.rectOf(asNodeId('left'))).toEqual({ x: 40, y: 10, z: 0, w: 100, h: 150 });
  });

  it('measures once for a burst of scroll events', async () => {
    stubRects({ left: { x: 40, y: 10, w: 100, h: 200 } });
    const { geometry } = mount(['left']);
    const before = measures.left ?? 0;

    vi.useFakeTimers();
    try {
      act(() => {
        for (let i = 1; i <= 5; i++) {
          stubScroll(0, i);
          window.dispatchEvent(new Event('scroll'));
        }
      });
      // Nothing measured yet: the burst is holding one frame, not five.
      expect(measures.left).toBe(before);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(32);
      });
    } finally {
      vi.useRealTimers();
    }

    // One coalesced measure, plus the re-measure the resulting commit runs.
    expect((measures.left ?? 0) - before).toBeLessThanOrEqual(2);
    expect(geometry.rectOf(asNodeId('left'))).toEqual({ x: 40, y: 15, z: 0, w: 100, h: 200 });
  });

  it('drops a pending frame when the root unmounts', async () => {
    stubRects({ left: { x: 40, y: 10, w: 100, h: 200 } });
    const { geometry, unmount } = mount(['left']);

    vi.useFakeTimers();
    let unmounted = false;
    let ranAfterUnmount = false;
    try {
      const schedule = window.requestAnimationFrame.bind(window);
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) =>
        schedule((t) => {
          if (unmounted) ranAfterUnmount = true;
          cb(t);
        }),
      );
      act(() => {
        stubScroll(0, 30);
        window.dispatchEvent(new Event('scroll'));
      });
      unmount();
      unmounted = true;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(32);
      });
    } finally {
      vi.useRealTimers();
    }

    expect(ranAfterUnmount).toBe(false);
    expect(geometry.rectOf(asNodeId('left'))).toBeNull();
  });

  it('holds the published rect through a sub-pixel change', async () => {
    stubRects({ left: { x: 40, y: 10, w: 100, h: 200 } });
    const { geometry } = mount(['left']);

    // What a rect rounded one way and a scroll offset rounded the other
    // produce — a move no reader can act on.
    stubRects({ left: { x: 40.4, y: 9.7, w: 100.3, h: 199.6 } });
    await inFrame(() => {
      window.dispatchEvent(new Event('scroll'));
    });

    expect(geometry.rectOf(asNodeId('left'))).toEqual({ x: 40, y: 10, z: 0, w: 100, h: 200 });
  });

  it('settles when two containers render the same root id', () => {
    const traces = captureTrace('zone');
    // Two elements, two positions, one id: each guards against its own last
    // write, so neither answers the other's. A runaway measure throws out of
    // the render rather than spinning — see RUNAWAY_MEASURES.
    stubRects({
      left: [
        { x: 40, y: 10, w: 100, h: 200 },
        { x: 400, y: 10, w: 100, h: 200 },
      ],
    });
    const { geometry } = mountStore(makeStore(['left']), ['left', 'left']);

    expect(measures.left ?? 0).toBeLessThan(20);
    expect(geometry.rectOf(asNodeId('left'))).not.toBeNull();
    expect(traces.matching(/overwriting another container's rect/).length).toBeGreaterThan(0);
  });
});
