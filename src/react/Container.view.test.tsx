import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  asNodeId,
  createNode,
  desktopStrategy,
  type GeometrySource,
  Store,
  stripStrategy,
  type View,
} from '../index.js';
import { GeometryProvider, useGeometrySource } from './focus/useGeometrySource.js';
import { type ChromeMap, Container, Zone } from './index.js';
import { Provider } from './Provider.js';
import { StrategyRegistryProvider } from './strategies.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ZONE = asNodeId('z');
const CHROME: ChromeMap = { window: ({ node }) => <div>{String(node.id)}</div> };
const STRATEGIES = { desktop: desktopStrategy() as never, strip: stripStrategy as never };

/**
 * jsdom lays nothing out, so a CSS transform changes nothing it reports. Give
 * `el` the boxes a browser would: its own size in layout pixels, its
 * on-screen rect at `scale` times that.
 */
function fakeScaled(el: HTMLElement, scale: number, at = { x: 0, y: 0 }) {
  const w = Number.parseFloat(el.style.width) || 0;
  const h = Number.parseFloat(el.style.height) || 0;
  Object.defineProperty(el, 'offsetWidth', { configurable: true, value: w });
  Object.defineProperty(el, 'offsetHeight', { configurable: true, value: h });
  el.getBoundingClientRect = () =>
    ({
      left: at.x,
      top: at.y,
      x: at.x,
      y: at.y,
      width: w * scale,
      height: h * scale,
      right: at.x + w * scale,
      bottom: at.y + h * scale,
    }) as DOMRect;
}

function renderDesktop(view?: View) {
  const store = new Store();
  store.registerNode(
    createNode({
      kind: 'zone',
      id: ZONE,
      container: { strategyId: 'desktop', config: { drag: true } },
    }),
  );
  store.registerNode(
    createNode({
      kind: 'window',
      id: asNodeId('a'),
      parentId: ZONE,
      placement: { x: 20, y: 20 },
      hints: { preferredSize: { w: 100, h: 80 } },
    }),
  );
  store.showNode(asNodeId('a'));
  const out = render(
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <Container
          parentId={ZONE}
          chrome={CHROME}
          viewport={{ w: 400, h: 300 }}
          affordances
          {...(view ? { view } : {})}
        />
      </StrategyRegistryProvider>
    </Provider>,
  );
  const box = out.container.querySelector('[data-node-container="z"]') as HTMLElement;
  const hit = (id: string) =>
    out.container.querySelector(`[data-affordance-hit="${id}"]`) as HTMLElement;
  return { store, box, hit, out };
}

const placementOf = (store: Store, id: string) =>
  store.getNode(asNodeId(id))?.membership?.placement ?? {};

describe('<Container view>', () => {
  it('carries no transform at the identity', () => {
    const { box } = renderDesktop();
    expect(box.style.transform).toBe('');
  });

  it('draws the laid-out box translated and scaled about its top-left', () => {
    const { box } = renderDesktop({ x: 10, y: 4, scale: 0.5 });
    expect(box.style.transform).toBe('translate(10px, 4px) scale(0.5)');
    expect(box.style.transformOrigin).toBe('0 0');
    expect(box.style.width).toBe('400px');
  });

  it('leaves placements in layout pixels', () => {
    const { out } = renderDesktop({ x: 0, y: 0, scale: 0.5 });
    const win = out.container.querySelector('[data-node="a"]') as HTMLElement;
    expect(win.style.left).toBe('20px');
    expect(win.style.width).toBe('100px');
  });

  it('divides a window drag by the scale, so it follows the pointer', () => {
    const { store, hit } = renderDesktop({ x: 0, y: 0, scale: 0.5 });
    const band = hit('desktop:drag:a');
    fakeScaled(band, 0.5);
    fireEvent.pointerDown(band, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(band, { clientX: 60, clientY: 30, pointerId: 1 });
    fireEvent.pointerUp(band, { clientX: 60, clientY: 30, pointerId: 1 });
    expect(placementOf(store, 'a')).toMatchObject({ x: 120, y: 60 });
  });

  it('leaves the same drag undivided when nothing is scaled', () => {
    const { store, hit } = renderDesktop();
    const band = hit('desktop:drag:a');
    fireEvent.pointerDown(band, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(band, { clientX: 60, clientY: 30, pointerId: 1 });
    fireEvent.pointerUp(band, { clientX: 60, clientY: 30, pointerId: 1 });
    expect(placementOf(store, 'a')).toMatchObject({ x: 70, y: 40 });
  });
});

function renderStrip(scale: number) {
  const store = new Store();
  store.registerNode(
    createNode({
      kind: 'zone',
      id: ZONE,
      container: { strategyId: 'strip', config: { axis: 'x', fill: true } },
    }),
  );
  for (const id of ['a', 'b']) {
    store.registerNode(
      createNode({ kind: 'panel', focus: true, id: asNodeId(id), parentId: ZONE }),
    );
    store.showNode(asNodeId(id));
  }
  const out = render(
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <Container
          parentId={ZONE}
          chrome={{}}
          viewport={{ w: 400, h: 100 }}
          view={{ x: 0, y: 0, scale }}
          affordances
        />
      </StrategyRegistryProvider>
    </Provider>,
  );
  const seam = out.container.querySelector('[role="separator"]') as HTMLElement;
  const widthOf = (id: string) =>
    Number.parseFloat(
      (out.container.querySelector(`[data-node="${id}"]`) as HTMLElement).style.width,
    );
  return { seam, widthOf };
}

describe('seams under a view', () => {
  it('a seam drag moves by the pointer distance over the scale', () => {
    const { seam, widthOf } = renderStrip(0.5);
    const before = widthOf('a');
    fakeScaled(seam, 0.5);
    fireEvent.pointerDown(seam, { clientX: 100, clientY: 5, pointerId: 1 });
    fireEvent.pointerMove(seam, { clientX: 120, clientY: 5, pointerId: 1 });
    fireEvent.pointerUp(seam, { clientX: 120, clientY: 5, pointerId: 1 });
    expect(widthOf('a')).toBeCloseTo(before + 40);
  });

  it('nested scales compose: the handle measures every transform above it', () => {
    const { seam, widthOf } = renderStrip(0.5);
    const before = widthOf('a');
    // An outer 0.5 around this container's own 0.5.
    fakeScaled(seam, 0.25);
    fireEvent.pointerDown(seam, { clientX: 100, clientY: 5, pointerId: 1 });
    fireEvent.pointerMove(seam, { clientX: 110, clientY: 5, pointerId: 1 });
    fireEvent.pointerUp(seam, { clientX: 110, clientY: 5, pointerId: 1 });
    expect(widthOf('a')).toBeCloseTo(before + 40);
  });

  it('keyboard steps stay in layout pixels whatever the scale', () => {
    const { seam, widthOf } = renderStrip(0.25);
    const before = widthOf('a');
    fakeScaled(seam, 0.25);
    fireEvent.keyDown(seam, { key: 'ArrowRight' });
    expect(widthOf('a')).toBeCloseTo(before + 8);
  });
});

describe('<Zone view>', () => {
  it('applies the same transform to the zone box', () => {
    const store = new Store();
    const out = render(
      <Provider store={store}>
        <StrategyRegistryProvider strategies={STRATEGIES}>
          <Zone
            id={asNodeId('zz')}
            strategyId="strip"
            config={{ axis: 'x', fill: true }}
            viewport={{ w: 300, h: 100 }}
            view={{ x: 5, y: 6, scale: 2 }}
          />
        </StrategyRegistryProvider>
      </Provider>,
    );
    const box = out.container.querySelector('[data-node-container="zz"]') as HTMLElement;
    expect(box.style.transform).toBe('translate(5px, 6px) scale(2)');
  });

  it('fit wraps the zone in a clipping frame and pulls the box out of its flow', () => {
    const store = new Store();
    const out = render(
      <Provider store={store}>
        <StrategyRegistryProvider strategies={STRATEGIES}>
          <Zone
            id={asNodeId('zz')}
            strategyId="strip"
            config={{ axis: 'x', fill: true }}
            viewport={{ w: 300, h: 100 }}
            fit="contain"
          />
        </StrategyRegistryProvider>
      </Provider>,
    );
    const box = out.container.querySelector('[data-node-container="zz"]') as HTMLElement;
    const frame = box.parentElement as HTMLElement;
    expect(frame.className).toBe('windease-view-frame');
    expect(frame.style.overflow).toBe('hidden');
    expect(box.style.position).toBe('absolute');
  });
});

describe('focus geometry under a view', () => {
  it('publishes children where they are on screen, not where layout put them', () => {
    // The root box sits at (100, 50) and is drawn at half size.
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return Number.parseFloat(this.style.width) || 0;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return Number.parseFloat(this.style.height) || 0;
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const root = this.getAttribute('data-node-container') === 'z';
      const w = (Number.parseFloat(this.style.width) || 0) * (root ? 0.5 : 1);
      const h = (Number.parseFloat(this.style.height) || 0) * (root ? 0.5 : 1);
      const x = root ? 100 : 0;
      const y = root ? 50 : 0;
      return { x, y, left: x, top: y, width: w, height: h, right: x + w, bottom: y + h } as DOMRect;
    });
    const store = new Store();
    store.registerNode(
      createNode({
        kind: 'zone',
        id: ZONE,
        container: { strategyId: 'strip', config: { axis: 'x', fill: true } },
      }),
    );
    for (const id of ['a', 'b']) {
      store.registerNode(
        createNode({ kind: 'panel', focus: true, id: asNodeId(id), parentId: ZONE }),
      );
      store.showNode(asNodeId(id));
    }
    let geometry: GeometrySource | null = null;
    function Probe() {
      geometry = useGeometrySource();
      return null;
    }
    render(
      <Provider store={store}>
        <StrategyRegistryProvider strategies={STRATEGIES}>
          <GeometryProvider>
            <Container
              parentId={ZONE}
              chrome={{}}
              viewport={{ w: 400, h: 100 }}
              view={{ x: 0, y: 0, scale: 0.5 }}
            />
            <Probe />
          </GeometryProvider>
        </StrategyRegistryProvider>
      </Provider>,
    );
    const b = (geometry as GeometrySource | null)?.rectOf(asNodeId('b'));
    expect(b).toMatchObject({ x: 200, y: 50, w: 100, h: 50 });
  });
});
