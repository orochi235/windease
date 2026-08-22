import { render, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it } from 'vitest';
import { asNodeId, createNode, Store, stripStrategy } from '../index.js';
import { Container } from './Container.js';
import {
  GeometryProvider,
  type GeometryRegistry,
  useGeometryRegistry,
} from './focus/useGeometrySource.js';
import { Provider } from './Provider.js';
import { StrategyRegistryProvider } from './strategies.js';

const Z = asNodeId('z');

function makeStore(): Store {
  const s = new Store();
  s.registerNode(
    createNode({
      kind: 'zone',
      id: Z,
      container: { strategyId: 'strip', config: { axis: 'y', fill: true } },
    }),
  );
  s.showNode(Z);
  for (const c of ['a', 'b']) {
    const nid = asNodeId(c);
    s.registerNode(createNode({ kind: 'panel', focus: true, id: nid, parentId: Z }));
    s.showNode(nid);
  }
  return s;
}

let captured: GeometryRegistry | null = null;
function Capture() {
  captured = useGeometryRegistry();
  return null;
}

function Scrolling() {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  return (
    <div ref={scrollRef} data-testid="scroller">
      <Container parentId={Z} chrome={{}} viewport={{ w: 200, h: 100 }} scrollRef={scrollRef} />
    </div>
  );
}

function tree(store: Store) {
  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={{ strip: stripStrategy as never }}>
        <GeometryProvider>
          <Capture />
          <Scrolling />
        </GeometryProvider>
      </StrategyRegistryProvider>
    </Provider>
  );
}

const rectOf = (id: string) => captured?.rects.get(id);

describe('<Container> — geometry under scroll', () => {
  it('reports unscrolled positions before anything scrolls', async () => {
    render(tree(makeStore()));
    await waitFor(() => expect(rectOf('a')).toBeDefined());
    expect(rectOf('a')?.y).toBe(0);
    expect(rectOf('b')?.y).toBe(50);
  });

  it('shifts a pane by the scroll offset, so navigation sees where it is', async () => {
    const { getByTestId } = render(tree(makeStore()));
    await waitFor(() => expect(rectOf('a')).toBeDefined());

    const scroller = getByTestId('scroller');
    scroller.scrollTop = 40;
    scroller.dispatchEvent(new Event('scroll'));

    await waitFor(() => expect(rectOf('a')?.y).toBe(-40));
    expect(rectOf('b')?.y).toBe(10);
  });

  it('leaves the rendered placement alone — only the reported position moves', async () => {
    const { getByTestId, container } = render(tree(makeStore()));
    await waitFor(() => expect(rectOf('a')).toBeDefined());
    const scroller = getByTestId('scroller');
    scroller.scrollTop = 40;
    scroller.dispatchEvent(new Event('scroll'));
    await waitFor(() => expect(rectOf('a')?.y).toBe(-40));

    const pane = container.querySelector('[data-node="a"]') as HTMLElement;
    expect(pane.style.top).toBe('0px');
  });
});
