import { act, cleanup, render, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { createNode } from '../constructors.js';
import { asNodeId, Store, stripStrategy, type View } from '../index.js';
import { Container } from './Container.js';
import { GeometryProvider, useGeometryRegistry } from './focus/useGeometrySource.js';
import type { ChromeMap } from './NodeRenderer.js';
import { Provider } from './Provider.js';
import { Panel, Zone } from './presets.js';
import { StrategyRegistryProvider } from './strategies.js';

afterEach(cleanup);

const Z = asNodeId('z');
const CONFIG = { axis: 'x', overflowMode: 'scroll', gap: 4, padding: 6 };
const TABS: Array<[string, number, boolean]> = [
  ['p', 40, true],
  ['a', 200, false],
  ['b', 200, false],
];

function seeded(): Store {
  const store = new Store();
  store.registerNode(
    createNode({ id: Z, kind: 'zone', container: { strategyId: 'strip', config: CONFIG } }),
  );
  for (const [id, w, sticky] of TABS) {
    store.registerNode(
      createNode({
        id: asNodeId(id),
        kind: 'panel',
        parentId: Z,
        placement: { size: { w }, ...(sticky ? { sticky: true } : {}) },
      }),
    );
    store.showNode(asNodeId(id));
  }
  return store;
}

const chrome: ChromeMap = { panel: ({ node }) => <span>{String(node.id)}</span> };

let registry: ReturnType<typeof useGeometryRegistry> = null;
function Capture() {
  registry = useGeometryRegistry();
  return null;
}

function Scrolled({ store, view }: { store: Store; view?: View }) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={{ strip: stripStrategy as never }}>
        <GeometryProvider>
          <Capture />
          <div ref={scrollRef} data-testid="scroller">
            <Container
              parentId={Z}
              chrome={chrome}
              viewport={{ w: 300, h: 30 }}
              scrollRef={scrollRef}
              affordances
              {...(view ? { view } : {})}
            />
          </div>
        </GeometryProvider>
      </StrategyRegistryProvider>
    </Provider>
  );
}

function scrollTo(el: HTMLElement, x: number) {
  act(() => {
    el.scrollLeft = x;
    el.dispatchEvent(new Event('scroll'));
  });
}

const left = (root: HTMLElement, selector: string) =>
  (root.querySelector(selector) as HTMLElement | null)?.style.left;

describe('<Container> sticky placements', () => {
  it('holds a sticky pane at its inset while the rest scroll', () => {
    const { container, getByTestId } = render(<Scrolled store={seeded()} />);
    expect(left(container, '[data-node="p"]')).toBe('6px');
    scrollTo(getByTestId('scroller'), 120);
    expect(left(container, '[data-node="p"]')).toBe('126px');
    expect(left(container, '[data-node="a"]')).toBe('50px');
  });

  it('holds against the scroll in layout pixels under a scaled view', () => {
    const view = { x: 0, y: 0, scale: 0.5 };
    const { container, getByTestId } = render(<Scrolled store={seeded()} view={view} />);
    // The scroller sits outside the transform: 120 screen pixels is 240 layout.
    scrollTo(getByTestId('scroller'), 120);
    expect(left(container, '[data-node="p"]')).toBe('246px');
    expect(left(container, '[data-affordance-hit="resize-x-p"]')).toBe(`${240 + 6 + 40 - 2 - 4}px`);
  });

  it('carries the sticky pane’s seam with it', () => {
    const { container, getByTestId } = render(<Scrolled store={seeded()} />);
    scrollTo(getByTestId('scroller'), 120);
    expect(left(container, '[data-affordance-hit="resize-x-p"]')).toBe(`${120 + 6 + 40 - 2 - 4}px`);
    expect(left(container, '[data-affordance-hit="resize-x-a"]')).toBe(`${50 + 200 - 2 - 4}px`);
  });

  it('does not ease the sticky pane’s position, which tracks every scroll frame', () => {
    const { container } = render(<Scrolled store={seeded()} />);
    const p = container.querySelector('[data-node="p"]') as HTMLElement;
    const a = container.querySelector('[data-node="a"]') as HTMLElement;
    expect(p.style.transition).not.toContain('left');
    expect(a.style.transition).toContain('left');
  });

  it('reports the held position to keyboard navigation', async () => {
    const { getByTestId } = render(<Scrolled store={seeded()} />);
    scrollTo(getByTestId('scroller'), 120);
    await waitFor(() => expect(registry?.rects.get('a')?.x).toBe(50 - 120));
    expect(registry?.rects.get('p')?.x).toBe(6);
  });
});

describe('<Zone> sticky placements', () => {
  function Preset() {
    const scrollRef = useRef<HTMLDivElement | null>(null);
    return (
      <div ref={scrollRef} data-testid="scroller">
        <Zone
          id={Z}
          strategyId="strip"
          config={CONFIG}
          viewport={{ w: 300, h: 30 }}
          scrollRef={scrollRef}
        >
          {TABS.map(([id, w, sticky]) => (
            <Panel
              key={id}
              id={asNodeId(id)}
              placement={{ size: { w }, ...(sticky ? { sticky: true } : {}) }}
            />
          ))}
        </Zone>
      </div>
    );
  }

  it('holds a sticky panel at its inset while the rest scroll', () => {
    const { container, getByTestId } = render(
      <Provider store={new Store()}>
        <StrategyRegistryProvider strategies={{ strip: stripStrategy as never }}>
          <Preset />
        </StrategyRegistryProvider>
      </Provider>,
    );
    const box = (id: string) =>
      (container.querySelector(`[data-node="${id}"]`) as HTMLElement).parentElement as HTMLElement;
    expect(box('p').style.left).toBe('6px');
    scrollTo(getByTestId('scroller'), 120);
    expect(box('p').style.left).toBe('126px');
    expect(box('a').style.left).toBe('50px');
  });
});
