import { act, render } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GeometrySource } from '../index.js';
import { asNodeId, createNode, Store, stripStrategy } from '../index.js';
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

let boxes: Record<string, Box> = {};

/** jsdom reports every element at the page origin, so each root's box is
 *  stubbed by the `data-node-container` id its own div carries. Call again to
 *  move an element after mount. */
function stubRects(next: Record<string, Box>) {
  boxes = next;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const id = this.getAttribute('data-node-container') ?? '';
    const b = boxes[id] ?? { x: 0, y: 0, w: 0, h: 0 };
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
  const tree = () => {
    const inner = (
      <Provider store={store}>
        <StrategyRegistryProvider strategies={{ strip: stripStrategy as never }}>
          <GeometryProvider>
            {containerIds.map((cid) => (
              <Container
                key={cid}
                parentId={asNodeId(cid)}
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
  stubScroll(0, 0);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('root container origins', () => {
  it('publishes the root own rect in document coordinates', () => {
    stubRects({ left: { x: 40, y: 10, w: 100, h: 200 } });
    stubScroll(20, 30);
    const { geometry } = mount(['left']);
    expect(geometry.rectOf(asNodeId('left'))).toEqual({ x: 60, y: 40, w: 100, h: 200 });
  });

  it('composes a root children against that origin', () => {
    stubRects({ left: { x: 40, y: 10, w: 100, h: 200 } });
    const { geometry } = mount(['left']);
    expect(geometry.rectOf(asNodeId('left-a'))).toEqual({ x: 40, y: 10, w: 100, h: 100 });
    expect(geometry.rectOf(asNodeId('left-b'))).toEqual({ x: 40, y: 110, w: 100, h: 100 });
  });

  it('moves children with a root that moved without resizing', () => {
    stubRects({ left: { x: 40, y: 10, w: 100, h: 200 } });
    const { geometry, rerender } = mount(['left']);
    expect(geometry.rectOf(asNodeId('left-a'))).toEqual({ x: 40, y: 10, w: 100, h: 100 });

    stubRects({ left: { x: 200, y: 300, w: 100, h: 200 } });
    rerender();

    expect(geometry.rectOf(asNodeId('left'))).toEqual({ x: 200, y: 300, w: 100, h: 200 });
    expect(geometry.rectOf(asNodeId('left-a'))).toEqual({ x: 200, y: 300, w: 100, h: 100 });
  });

  it('survives a StrictMode double mount', () => {
    stubRects({ left: { x: 40, y: 10, w: 100, h: 200 } });
    const { geometry } = mount(['left'], { strict: true });
    expect(geometry.rectOf(asNodeId('left'))).toEqual({ x: 40, y: 10, w: 100, h: 200 });
    expect(geometry.rectOf(asNodeId('left-a'))).toEqual({ x: 40, y: 10, w: 100, h: 100 });
  });

  it('keeps two sibling roots in disjoint coordinate ranges', () => {
    stubRects({
      left: { x: 0, y: 0, w: 100, h: 200 },
      right: { x: 300, y: 0, w: 100, h: 200 },
    });
    const { geometry } = mount(['left', 'right']);

    expect(geometry.rectOf(asNodeId('left-a'))).toEqual({ x: 0, y: 0, w: 100, h: 100 });
    expect(geometry.rectOf(asNodeId('left-b'))).toEqual({ x: 0, y: 100, w: 100, h: 100 });
    expect(geometry.rectOf(asNodeId('right-a'))).toEqual({ x: 300, y: 0, w: 100, h: 100 });
    expect(geometry.rectOf(asNodeId('right-b'))).toEqual({ x: 300, y: 100, w: 100, h: 100 });
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

  it('re-measures a root on a page scroll', () => {
    stubRects({ left: { x: 40, y: 10, w: 100, h: 200 } });
    const { geometry } = mount(['left']);
    expect(geometry.rectOf(asNodeId('left'))).toEqual({ x: 40, y: 10, w: 100, h: 200 });

    // A scroll moves the element up in viewport coordinates while its document
    // position holds; the height changes too so a stale entry cannot coincide.
    stubRects({ left: { x: 40, y: -20, w: 100, h: 150 } });
    stubScroll(0, 30);
    act(() => {
      window.dispatchEvent(new Event('scroll'));
    });

    expect(geometry.rectOf(asNodeId('left'))).toEqual({ x: 40, y: 10, w: 100, h: 150 });
  });

  it('re-measures a root on a window resize', () => {
    stubRects({ left: { x: 40, y: 10, w: 100, h: 200 } });
    const { geometry } = mount(['left']);

    stubRects({ left: { x: 20, y: 5, w: 60, h: 150 } });
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });

    expect(geometry.rectOf(asNodeId('left'))).toEqual({ x: 20, y: 5, w: 60, h: 150 });
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

  it('re-measures a root on a scroll in an inner scroller', () => {
    stubRects({ left: { x: 40, y: 10, w: 100, h: 200 } });
    const { geometry } = mount(['left']);
    // An element's scroll event does not bubble, so only the capture-phase
    // listener sees it.
    const inner = document.createElement('div');
    document.body.appendChild(inner);

    stubRects({ left: { x: 40, y: -20, w: 100, h: 150 } });
    stubScroll(0, 30);
    act(() => {
      inner.dispatchEvent(new Event('scroll'));
    });

    expect(geometry.rectOf(asNodeId('left'))).toEqual({ x: 40, y: 10, w: 100, h: 150 });
  });
});
