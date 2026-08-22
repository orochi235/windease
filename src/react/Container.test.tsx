import { act, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { asNodeId, createNode, gridStrategy, Store, stripStrategy } from '../index.js';
import { type ChromeMap, Container } from './index.js';
import { Provider } from './Provider.js';
import { StrategyRegistryProvider } from './strategies.js';

const PANEL_CHROME: ChromeMap = {
  panel: ({ node }) => <div data-testid={`p-${node.id}`}>{String(node.id)}</div>,
};

function makeGridStore(): Store {
  const s = new Store();
  s.registerNode(
    createNode({
      kind: 'zone',
      container: { strategyId: 'grid', config: { cols: 2 } },
      id: asNodeId('z'),
    }),
  );
  s.registerNode(
    createNode({
      kind: 'panel',
      focus: true,
      id: asNodeId('a'),
      parentId: asNodeId('z'),
    }),
  );
  s.registerNode(
    createNode({
      kind: 'panel',
      focus: true,
      id: asNodeId('b'),
      parentId: asNodeId('z'),
    }),
  );
  s.showNode(asNodeId('a'));
  s.showNode(asNodeId('b'));
  return s;
}

function withProviders(store: Store, strategies: Record<string, unknown>, ui: React.ReactNode) {
  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={strategies as never}>{ui}</StrategyRegistryProvider>
    </Provider>
  );
}

describe('Container — overlay callback', () => {
  it('overlay function receives live layout (placements + viewport)', () => {
    const store = makeGridStore();
    let captured: { placementsCount?: number; w?: number | undefined; h?: number | undefined } = {};
    const overlay = ({
      placements,
      viewport,
    }: {
      placements: Map<string, unknown>;
      viewport: { w: number; h: number } | null;
    }) => {
      captured = {
        placementsCount: placements.size,
        w: viewport?.w,
        h: viewport?.h,
      };
      return null;
    };
    render(
      withProviders(
        store,
        { grid: gridStrategy },
        <Container
          parentId={asNodeId('z')}
          chrome={PANEL_CHROME}
          viewport={{ w: 200, h: 100 }}
          overlay={overlay}
        />,
      ),
    );
    expect(captured.placementsCount).toBe(2);
    expect(captured.w).toBe(200);
    expect(captured.h).toBe(100);
  });

  it('overlay function exposes draggingAffordanceId (null at rest)', () => {
    const store = makeGridStore();
    let seenId: string | null | undefined;
    render(
      withProviders(
        store,
        { grid: gridStrategy },
        <Container
          parentId={asNodeId('z')}
          chrome={PANEL_CHROME}
          viewport={{ w: 200, h: 100 }}
          overlay={(ctx) => {
            seenId = ctx.draggingAffordanceId;
            return null;
          }}
        />,
      ),
    );
    expect(seenId).toBeNull();
  });
});

describe('Container — affordances callback', () => {
  it('custom affordance renderer replaces the default per affordance', () => {
    const store = new Store();
    store.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'strip', config: { axis: 'x' } },
        id: asNodeId('s'),
      }),
    );
    store.registerNode(
      createNode({
        kind: 'panel',
        focus: true,
        id: asNodeId('a'),
        parentId: asNodeId('s'),
      }),
    );
    store.registerNode(
      createNode({
        kind: 'panel',
        focus: true,
        id: asNodeId('b'),
        parentId: asNodeId('s'),
      }),
    );
    store.showNode(asNodeId('a'));
    store.showNode(asNodeId('b'));
    const { container } = render(
      withProviders(
        store,
        { strip: stripStrategy },
        <Container
          parentId={asNodeId('s')}
          chrome={PANEL_CHROME}
          viewport={{ w: 200, h: 100 }}
          affordances={({ affordance }) => (
            <div data-testid={`custom-${affordance.id}`} data-kind={affordance.kind} />
          )}
        />,
      ),
    );
    // Custom marker present; the default [data-affordance-hit] outer div is not.
    expect(container.querySelector('[data-testid="custom-resize-x-a"]')).not.toBeNull();
    expect(container.querySelector('[data-affordance-hit]')).toBeNull();
  });

  it('custom affordance dispatch updates persisted placement size', () => {
    const store = new Store();
    store.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'strip', config: { axis: 'x', fill: true } },
        id: asNodeId('s'),
      }),
    );
    store.registerNode(
      createNode({
        kind: 'panel',
        focus: true,
        id: asNodeId('a'),
        parentId: asNodeId('s'),
      }),
    );
    store.registerNode(
      createNode({
        kind: 'panel',
        focus: true,
        id: asNodeId('b'),
        parentId: asNodeId('s'),
      }),
    );
    store.showNode(asNodeId('a'));
    store.showNode(asNodeId('b'));
    let capturedDispatch: ((e: import('../index.js').LayoutEvent) => void) | null = null;
    render(
      withProviders(
        store,
        { strip: stripStrategy },
        <Container
          parentId={asNodeId('s')}
          chrome={PANEL_CHROME}
          viewport={{ w: 200, h: 100 }}
          affordances={({ affordance, dispatch }) => {
            capturedDispatch = dispatch;
            return <div data-id={affordance.id} />;
          }}
        />,
      ),
    );
    expect(capturedDispatch).not.toBeNull();
    act(() => {
      capturedDispatch?.({ affordanceId: 'resize-x-a', kind: 'drag', payload: { dx: 40 } });
    });
    expect(store.getPlacement(asNodeId('a')).size).toMatchObject({ w: 140 });
  });
});

describe('Container declarative children', () => {
  it('renders provided children directly', () => {
    const store = new Store();
    store.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'grid', config: { cols: 1 } },
        id: asNodeId('z'),
      }),
    );
    const { getByText } = render(
      <Provider store={store}>
        <Container parentId={asNodeId('z')}>
          <span>hello</span>
        </Container>
      </Provider>,
    );
    expect(getByText('hello').textContent).toBe('hello');
  });
});
