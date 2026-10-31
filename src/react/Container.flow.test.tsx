import { act, render, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { asNodeId, createNode, type NodeHints, Store, stripStrategy } from '../index.js';
import { Container } from './Container.js';
import { GeometryProvider } from './focus/useGeometrySource.js';
import { Provider } from './Provider.js';
import { Panel, Zone } from './presets.js';
import { StrategyRegistryProvider } from './strategies.js';
import { useContainerLayout } from './useContainerLayout.js';

const Z = asNodeId('z');

function makeStore(hints?: NodeHints): Store {
  const s = new Store();
  s.registerNode(
    createNode({
      kind: 'zone',
      id: Z,
      container: { strategyId: 'strip', config: { axis: 'x', fill: true, resizable: true } },
      ...(hints ? { hints } : {}),
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

function tree(store: Store) {
  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={{ strip: stripStrategy as never }}>
        <GeometryProvider>
          <Container parentId={Z} chrome={{}} viewport={{ w: 200, h: 100 }} />
        </GeometryProvider>
      </StrategyRegistryProvider>
    </Provider>
  );
}

const panes = (root: HTMLElement) =>
  Array.from(root.querySelectorAll('[data-node]')).map((el) => el.getAttribute('data-node'));

describe('<Container> — flow mode', () => {
  it('renders every visible child', () => {
    const { container } = render(tree(makeStore({ render: 'flow' })));
    expect(panes(container)).toEqual(['a', 'b']);
  });

  it('leaves the children unpositioned', () => {
    const { container } = render(tree(makeStore({ render: 'flow' })));
    const a = container.querySelector('[data-node="a"]') as HTMLElement;
    expect(a.style.position).toBe('');
    expect(a.style.left).toBe('');
    expect(a.style.width).toBe('');
  });

  it('emits no affordances even from a resizable strategy', () => {
    const { container } = render(tree(makeStore({ render: 'flow' })));
    expect(container.querySelectorAll('[data-affordance]').length).toBe(0);
  });

  it('drops a hidden child from the flow', () => {
    const store = makeStore({ render: 'flow' });
    store.hideNode(asNodeId('a'));
    const { container } = render(tree(store));
    expect(panes(container)).toEqual(['b']);
  });

  it('keeps the container element the drop target', () => {
    const { container } = render(tree(makeStore({ render: 'flow' })));
    expect(container.querySelector('[data-node-container="z"]')).not.toBeNull();
  });

  it('the placed default still positions absolutely', () => {
    const { container } = render(tree(makeStore()));
    const a = container.querySelector('[data-node="a"]') as HTMLElement;
    expect(a.style.position).toBe('absolute');
  });
});

describe('<Zone hints> — flow mode declaratively', () => {
  function declarative(hints?: NodeHints) {
    const store = new Store();
    return render(
      <Provider store={store}>
        <StrategyRegistryProvider strategies={{ strip: stripStrategy as never }}>
          <GeometryProvider>
            <Zone
              id={Z}
              strategyId="strip"
              viewport={{ w: 200, h: 100 }}
              {...(hints ? { hints } : {})}
            >
              <Panel id={asNodeId('a')} />
              <Panel id={asNodeId('b')} />
            </Zone>
          </GeometryProvider>
        </StrategyRegistryProvider>
      </Provider>,
    );
  }

  const zonePanes = (container: HTMLElement) => {
    const box = container.querySelector('[data-node="z"]');
    return box ? Array.from(box.children).map((el) => el.getAttribute('data-node')) : [];
  };

  it('renders children in flow through the preset', async () => {
    const { container } = declarative({ render: 'flow' });
    await waitFor(() => expect(zonePanes(container)).toEqual(['a', 'b']));
    const a = container.querySelector('[data-node="a"]') as HTMLElement;
    expect(a.style.position).toBe('');
    expect(a.style.left).toBe('');
  });

  it('the hint outranks a registered strategy', async () => {
    // Placed wraps each pane in a positioned div, so the zone's direct
    // children carry no data-node; flow attaches the panes straight on.
    const { container } = declarative();
    await waitFor(() => {
      const a = container.querySelector('[data-node="a"]') as HTMLElement | null;
      expect(a?.parentElement?.style.position).toBe('absolute');
    });
    expect(zonePanes(container)).toEqual([null, null]);
  });
});

describe('<Container> — switching between empty, flow, and placed', () => {
  afterEach(() => vi.unstubAllGlobals());

  /** Records which elements are observed, so a test can tell whether the one
   *  being measured is still in the document. */
  function stubObserver() {
    const observed = new Set<Element>();
    class RO {
      observe(el: Element) {
        observed.add(el);
      }
      unobserve(el: Element) {
        observed.delete(el);
      }
      disconnect() {
        observed.clear();
      }
    }
    vi.stubGlobal('ResizeObserver', RO);
    return observed;
  }

  const measured = (store: Store) => (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={{ strip: stripStrategy as never }}>
        <Container parentId={Z} chrome={{}} />
      </StrategyRegistryProvider>
    </Provider>
  );
  const box = (root: HTMLElement) => root.querySelector(`[data-node-container="${Z}"]`);

  it('keeps one box element from flow to placed and back', async () => {
    const observed = stubObserver();
    const store = makeStore({ render: 'flow' });
    const { container } = render(measured(store));
    const first = box(container);
    await act(async () => store.setHints(Z, { render: undefined }));
    expect(box(container)).toBe(first);
    await act(async () => store.setHints(Z, { render: 'flow' }));
    expect(box(container)).toBe(first);
    expect([...observed].every((el) => el.isConnected)).toBe(true);
    expect(observed.has(first as Element)).toBe(true);
  });

  it('keeps one box element when the container node arrives after mount', async () => {
    const observed = stubObserver();
    const store = new Store();
    const { container } = render(measured(store));
    const first = box(container);
    await act(async () => {
      store.registerNode(
        createNode({
          kind: 'zone',
          id: Z,
          container: { strategyId: 'strip', config: { axis: 'x', fill: true } },
        }),
      );
      store.showNode(Z);
    });
    expect(box(container)).toBe(first);
    expect(observed.has(first as Element)).toBe(true);
  });

  it('useContainerLayout follows its ref onto a replacement element', () => {
    const observed = stubObserver();
    function Host({ asSection }: { asSection: boolean }) {
      const ref = useRef<HTMLElement | null>(null);
      useContainerLayout(Z, ref);
      return asSection ? (
        <section ref={ref} data-testid="el" />
      ) : (
        <div
          ref={(el) => {
            ref.current = el;
          }}
          data-testid="el"
        />
      );
    }
    const store = makeStore();
    const tree = (asSection: boolean) => (
      <Provider store={store}>
        <StrategyRegistryProvider strategies={{ strip: stripStrategy as never }}>
          <Host asSection={asSection} />
        </StrategyRegistryProvider>
      </Provider>
    );
    const view = render(tree(false));
    view.rerender(tree(true));
    const el = view.getByTestId('el');
    expect(el.tagName).toBe('SECTION');
    expect(observed.has(el)).toBe(true);
    expect([...observed].every((o) => o.isConnected)).toBe(true);
  });
});
