import { render } from '@testing-library/react';
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

function mount(rootIds: string[], opts: { strict?: boolean } = {}): Mounted {
  const store = makeStore(rootIds);
  let geometry: GeometrySource | null = null;
  const tree = () => {
    const inner = (
      <Provider store={store}>
        <StrategyRegistryProvider strategies={{ strip: stripStrategy as never }}>
          <GeometryProvider>
            {rootIds.map((rid) => (
              <Container
                key={rid}
                parentId={asNodeId(rid)}
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

  it('forgets the root rect on unmount', () => {
    stubRects({ left: { x: 40, y: 10, w: 100, h: 200 } });
    const { geometry, unmount } = mount(['left']);
    expect(geometry.rectOf(asNodeId('left'))).not.toBeNull();
    unmount();
    expect(geometry.rectOf(asNodeId('left'))).toBeNull();
  });
});
