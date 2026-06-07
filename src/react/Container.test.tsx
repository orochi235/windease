import { act, render } from '@testing-library/react';
import {
  asNodeId,
  binarySplit,
  createPanel,
  createZone,
  gridStrategy,
  WindeaseStore,
} from '../index.js';
import { describe, expect, it } from 'vitest';
import { Container, type ChromeMap } from './index.js';
import { StrategyRegistryProvider } from './strategies.js';
import { WindeaseProvider } from './WindeaseProvider.js';

const PANEL_CHROME: ChromeMap = {
  panel: ({ node }) => <div data-testid={`p-${node.id}`}>{String(node.id)}</div>,
};

function makeGridStore(): WindeaseStore {
  const s = new WindeaseStore();
  s.registerNode(createZone({ id: asNodeId('z'), strategyId: 'grid', config: { cols: 2 } }));
  s.registerNode(createPanel({ id: asNodeId('a'), parentId: asNodeId('z') }));
  s.registerNode(createPanel({ id: asNodeId('b'), parentId: asNodeId('z') }));
  s.showNode(asNodeId('a'));
  s.showNode(asNodeId('b'));
  return s;
}

function withProviders(store: WindeaseStore, strategies: Record<string, unknown>, ui: React.ReactNode) {
  return (
    <WindeaseProvider store={store}>
      <StrategyRegistryProvider strategies={strategies as never}>
        {ui}
      </StrategyRegistryProvider>
    </WindeaseProvider>
  );
}

describe('Container — overlay callback', () => {
  it('overlay function receives live layout (placements + viewport)', () => {
    const store = makeGridStore();
    let captured: { placementsCount?: number; w?: number; h?: number } = {};
    const overlay = ({
      placements,
      viewport,
    }: { placements: Map<string, unknown>; viewport: { w: number; h: number } | null }) => {
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
    const store = new WindeaseStore();
    store.registerNode(
      createZone({ id: asNodeId('s'), strategyId: 'binarySplit', config: {} }),
    );
    store.registerNode(createPanel({ id: asNodeId('a'), parentId: asNodeId('s') }));
    store.registerNode(createPanel({ id: asNodeId('b'), parentId: asNodeId('s') }));
    store.showNode(asNodeId('a'));
    store.showNode(asNodeId('b'));
    const { container } = render(
      withProviders(
        store,
        { binarySplit },
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
    expect(container.querySelector('[data-testid="custom-split-0"]')).not.toBeNull();
    expect(container.querySelector('[data-affordance-hit]')).toBeNull();
  });

  it('custom affordance dispatch updates persisted container state', () => {
    const store = new WindeaseStore();
    store.registerNode(
      createZone({ id: asNodeId('s'), strategyId: 'binarySplit', config: {} }),
    );
    store.registerNode(createPanel({ id: asNodeId('a'), parentId: asNodeId('s') }));
    store.registerNode(createPanel({ id: asNodeId('b'), parentId: asNodeId('s') }));
    store.showNode(asNodeId('a'));
    store.showNode(asNodeId('b'));
    let capturedDispatch: ((e: import('../index.js').LayoutEvent) => void) | null = null;
    render(
      withProviders(
        store,
        { binarySplit },
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
      capturedDispatch?.({ affordanceId: 'split-0', kind: 'drag', payload: { dx: 40 } });
    });
    expect(store.getContainerState(asNodeId('s'))).toEqual({ ratio: 0.5 + 40 / 200 });
  });
});
