import { act, cleanup, render } from '@testing-library/react';
import { type CSSProperties, useRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { asNodeId, createNode, desktopStrategy, Store, stripStrategy } from '../index.js';
import { Container } from './Container.js';
import { Provider } from './Provider.js';
import { Panel, Zone } from './presets.js';
import { StrategyRegistryProvider } from './strategies.js';

afterEach(cleanup);

const Z = asNodeId('z');

function storeWith(mode: string | undefined, h: number): Store {
  const s = new Store();
  s.registerNode(
    createNode({
      kind: 'zone',
      container: {
        strategyId: 'strip',
        config: { axis: 'y', ...(mode ? { overflowMode: mode } : {}) },
      },
      id: Z,
    }),
  );
  s.showNode(Z);
  for (const c of ['a', 'b', 'c']) {
    const nid = asNodeId(c);
    s.registerNode(createNode({ kind: 'panel', id: nid, parentId: Z }));
    s.showNode(nid);
    s.patchPlacement(nid, { size: { h } });
  }
  return s;
}

function container(store: Store) {
  return render(
    <Provider store={store}>
      <StrategyRegistryProvider strategies={{ strip: stripStrategy as never }}>
        <Container parentId={Z} chrome={{}} viewport={{ w: 200, h: 400 }} data-testid="box" />
      </StrategyRegistryProvider>
    </Provider>,
  );
}

const box = (c: HTMLElement) => c.firstElementChild as HTMLElement;

describe('scroll-mode extent', () => {
  it('grows the box to the intrinsic extent so a wrapper can scroll it', () => {
    const { container: c } = container(storeWith('scroll', 200));
    // 3 panes of 200 in a 400 viewport: the box must be 600 tall.
    expect(box(c).style.height).toBe('600px');
  });

  it('leaves the box at the viewport when nothing overflows', () => {
    const { container: c } = container(storeWith('scroll', 100));
    expect(box(c).style.height).toBe('400px');
  });

  it('does not grow the box under the default squeeze mode', () => {
    const { container: c } = container(storeWith(undefined, 200));
    expect(box(c).style.height).toBe('400px');
  });

  it('grows on the main axis only', () => {
    const { container: c } = container(storeWith('scroll', 200));
    expect(box(c).style.width).toBe('200px');
  });

  it('lets an explicit style prop override the grown extent', () => {
    const store = storeWith('scroll', 200);
    const { container: c } = render(
      <Provider store={store}>
        <StrategyRegistryProvider strategies={{ strip: stripStrategy as never }}>
          <Container
            parentId={Z}
            chrome={{}}
            viewport={{ w: 200, h: 400 }}
            style={{ height: 500 }}
          />
        </StrategyRegistryProvider>
      </Provider>,
    );
    expect(box(c).style.height).toBe('500px');
  });

  it('grows a declarative Zone the same way', () => {
    const store = new Store();
    const { container: c } = render(
      <Provider store={store}>
        <StrategyRegistryProvider strategies={{ strip: stripStrategy as never }}>
          <Zone
            id={Z}
            strategyId="strip"
            config={{ axis: 'y', overflowMode: 'scroll' }}
            viewport={{ w: 200, h: 400 }}
          >
            <Panel id={asNodeId('a')} placement={{ size: { h: 200 } }} />
            <Panel id={asNodeId('b')} placement={{ size: { h: 200 } }} />
            <Panel id={asNodeId('c')} placement={{ size: { h: 200 } }} />
          </Zone>
        </StrategyRegistryProvider>
      </Provider>,
    );
    expect(box(c).style.height).toBe('600px');
  });
});

describe('scroll extent past the left and top edges', () => {
  const W = asNodeId('w');

  function desktopAt(x: number, y: number): Store {
    const s = new Store();
    s.registerNode(
      createNode({ kind: 'zone', id: Z, container: { strategyId: 'desktop', config: {} } }),
    );
    s.registerNode(
      createNode({
        kind: 'window',
        id: W,
        parentId: Z,
        placement: { x, y },
        hints: { preferredSize: { w: 50, h: 50 } },
      }),
    );
    s.showNode(W);
    return s;
  }

  function Scrolled() {
    const scrollRef = useRef<HTMLDivElement | null>(null);
    return (
      <div ref={scrollRef} data-testid="scroller">
        <Container parentId={Z} chrome={{}} viewport={{ w: 200, h: 100 }} scrollRef={scrollRef} />
      </div>
    );
  }

  function mount(store: Store) {
    return render(
      <Provider store={store}>
        <StrategyRegistryProvider strategies={{ desktop: desktopStrategy() as never }}>
          <Scrolled />
        </StrategyRegistryProvider>
      </Provider>,
    );
  }

  it('puts a margin before the box for content at negative coordinates', () => {
    const { getByTestId } = mount(desktopAt(-100, -30));
    const el = getByTestId('scroller').firstElementChild as HTMLElement;
    expect(el.style.marginLeft).toBe('100px');
    expect(el.style.marginTop).toBe('30px');
  });

  it('scrolls to the origin on mount, and keeps it still as the margin changes', () => {
    const store = desktopAt(-100, 0);
    const { getByTestId } = mount(store);
    const scroller = getByTestId('scroller');
    expect(scroller.scrollLeft).toBe(100);
    act(() => store.patchPlacement(W, { x: -160 }));
    expect(scroller.scrollLeft).toBe(160);
    act(() => store.patchPlacement(W, { x: 10 }));
    expect(scroller.scrollLeft).toBe(0);
  });
});

describe('overflow origin against a scroller that clamps', () => {
  const W = asNodeId('w');
  const CLIENT_W = 150;
  let topWrites: number[] = [];

  function desktopAt(x: number, y: number): Store {
    const s = new Store();
    s.registerNode(
      createNode({ kind: 'zone', id: Z, container: { strategyId: 'desktop', config: {} } }),
    );
    s.registerNode(
      createNode({
        kind: 'window',
        id: W,
        parentId: Z,
        placement: { x, y },
        hints: { preferredSize: { w: 50, h: 50 } },
      }),
    );
    s.showNode(W);
    return s;
  }

  /**
   * jsdom neither lays out nor clamps a scroll offset. A browser holds it inside
   * `[0, scrollWidth - clientWidth]` and re-clamps as soon as the extent shrinks,
   * which this models with the extent as the box's left margin plus its width.
   * Nothing extends below the box, so there is no vertical range at all.
   */
  function clampLikeABrowser(scroller: HTMLElement) {
    let left = 0;
    const box = () => scroller.firstElementChild as HTMLElement | null;
    const extent = () => {
      const b = box();
      if (!b) return CLIENT_W;
      const w = (Number.parseFloat(b.style.marginLeft) || 0) + Number.parseFloat(b.style.width);
      return Math.max(CLIENT_W, w);
    };
    const maxLeft = () => extent() - CLIENT_W;
    const clamp = (v: number, max: number) => Math.min(Math.max(0, v), max);
    Object.defineProperty(scroller, 'clientWidth', { configurable: true, get: () => CLIENT_W });
    Object.defineProperty(scroller, 'scrollWidth', { configurable: true, get: extent });
    Object.defineProperty(scroller, 'scrollLeft', {
      configurable: true,
      get: () => {
        left = clamp(left, maxLeft());
        return left;
      },
      set: (v: number) => {
        left = clamp(v, maxLeft());
      },
    });
    Object.defineProperty(scroller, 'scrollTop', {
      configurable: true,
      get: () => 0,
      set: (v: number) => {
        topWrites.push(v);
      },
    });
  }

  function Scrolled({ style }: { style?: CSSProperties }) {
    const scrollRef = useRef<HTMLDivElement | null>(null);
    return (
      <div
        ref={(el) => {
          if (el && scrollRef.current !== el) clampLikeABrowser(el);
          scrollRef.current = el;
        }}
        data-testid="scroller"
      >
        <Container
          parentId={Z}
          chrome={{}}
          viewport={{ w: 200, h: 100 }}
          scrollRef={scrollRef}
          {...(style ? { style } : {})}
        />
      </div>
    );
  }

  function mount(store: Store, style?: CSSProperties) {
    topWrites = [];
    return render(
      <Provider store={store}>
        <StrategyRegistryProvider strategies={{ desktop: desktopStrategy() as never }}>
          <Scrolled {...(style ? { style } : {})} />
        </StrategyRegistryProvider>
      </Provider>,
    );
  }

  it('keeps the origin still when the margin shrinks under a scroll at its far end', () => {
    // A 100px margin before a 200px box, in a 150px window: 150px of scroll.
    const store = desktopAt(-100, 0);
    const scroller = mount(store).getByTestId('scroller');
    expect(scroller.scrollLeft).toBe(100);
    scroller.scrollLeft = 150;
    scroller.dispatchEvent(new Event('scroll'));
    const origin = () =>
      (Number.parseFloat((scroller.firstElementChild as HTMLElement).style.marginLeft) || 0) -
      scroller.scrollLeft;
    expect(origin()).toBe(-50);

    // The margin goes and the range drops to 50, so the browser has clamped
    // the scroll to 50 before the hook can read it.
    act(() => store.patchPlacement(W, { x: 10 }));
    expect(origin()).toBe(-50);
    expect(scroller.scrollLeft).toBe(50);
  });

  it('does not scroll for a margin the style prop overrides', () => {
    const store = desktopAt(0, -30);
    const scroller = mount(store, { marginTop: 0 }).getByTestId('scroller');
    expect((scroller.firstElementChild as HTMLElement).style.marginTop).toBe('0px');
    act(() => store.patchPlacement(W, { y: -80 }));
    act(() => store.patchPlacement(W, { y: 0 }));
    expect(topWrites).toEqual([]);
  });
});
