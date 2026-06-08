import { render, cleanup, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Provider } from '../Provider.js';
import { Store, asNodeId, createPanel, createZone } from '../../index.js';
import { Container } from '../Container.js';
import { DragProvider, useDragController } from './DragProvider.js';
import { StrategyRegistryProvider } from '../strategies.js';
import { stackStrategy } from '../../layout/stack.js';
import { gridStrategy } from '../../layout/grid.js';

afterEach(cleanup);

function Handle({ onReady }: { onReady: (c: ReturnType<typeof useDragController>) => void }) {
  const c = useDragController();
  onReady(c);
  return null;
}

describe('Container — live drop preview', () => {
  it('passes preview to strategy when hovered + accepted and stamps data-preview', async () => {
    const store = new Store();
    store.registerNode(createZone({ id: asNodeId('src-parent'), strategyId: 'stack', config: {} }));
    store.registerNode(createZone({ id: asNodeId('tgt'), strategyId: 'stack', config: {} }));
    store.registerNode(
      createPanel({ id: asNodeId('src'), parentId: asNodeId('src-parent'), meta: { title: 'S' } }),
    );
    store.registerNode(createPanel({ id: asNodeId('a'), parentId: asNodeId('tgt') }));
    store.registerNode(createPanel({ id: asNodeId('b'), parentId: asNodeId('tgt') }));
    store.showNode(asNodeId('src'));
    store.showNode(asNodeId('a'));
    store.showNode(asNodeId('b'));
    let controller: ReturnType<typeof useDragController> | null = null;
    const { container } = render(
      <Provider store={store}>
        <StrategyRegistryProvider strategies={{ stack: stackStrategy }}>
          <DragProvider>
            <Handle onReady={(c) => (controller = c)} />
            <Container
              parentId={asNodeId('tgt')}
              viewport={{ w: 200, h: 600 }}
              chrome={() => <div data-testid="chrome" />}
            />
          </DragProvider>
        </StrategyRegistryProvider>
      </Provider>,
    );
    const tgtElPre = container.querySelector('[data-node-container="tgt"]')!;
    tgtElPre.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 200, bottom: 600, width: 200, height: 600, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    await act(async () => {
      controller!.tryBegin(asNodeId('src'));
      controller!.updateHoverByPoint(50, 300);
      await new Promise((r) => setTimeout(r, 20));
    });
    const containerEl = container.querySelector('[data-node-container="tgt"]')!;
    expect(containerEl.getAttribute('data-preview')).toBe('true');
  });

  it('reverts to real layout on rejection (canAccept=false)', async () => {
    const store = new Store();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'stack', config: {} }));
    store.registerNode(
      createZone({ id: asNodeId('tgt'), strategyId: 'grid', config: { maxItems: 1 } }),
    );
    store.registerNode(createPanel({ id: asNodeId('src'), parentId: asNodeId('z') }));
    store.registerNode(createPanel({ id: asNodeId('occupant'), parentId: asNodeId('tgt') }));
    store.showNode(asNodeId('src'));
    store.showNode(asNodeId('occupant'));
    let controller: ReturnType<typeof useDragController> | null = null;
    const { container } = render(
      <Provider store={store}>
        <StrategyRegistryProvider strategies={{ grid: gridStrategy }}>
          <DragProvider>
            <Handle onReady={(c) => (controller = c)} />
            <Container
              parentId={asNodeId('tgt')}
              viewport={{ w: 200, h: 200 }}
              chrome={(args) => <div data-testid={`chrome-${args.node.id}`} />}
            />
          </DragProvider>
        </StrategyRegistryProvider>
      </Provider>,
    );
    const tgtElPre = container.querySelector('[data-node-container="tgt"]')!;
    tgtElPre.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 200, bottom: 200, width: 200, height: 200, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    await act(async () => {
      controller!.tryBegin(asNodeId('src'));
      controller!.updateHoverByPoint(50, 50);
      await new Promise((r) => setTimeout(r, 20));
    });
    const tgtEl = container.querySelector('[data-node-container="tgt"]')!;
    expect(tgtEl.getAttribute('data-drop-rejected')).toBe('true');
    expect(tgtEl.getAttribute('data-preview')).not.toBe('true');
  });

  it("suppresses the source's chrome during preview (rendered as ghost only)", async () => {
    const store = new Store();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'stack', config: {} }));
    store.registerNode(createZone({ id: asNodeId('tgt'), strategyId: 'stack', config: {} }));
    // Source is already a child of tgt — same-parent preview.
    store.registerNode(
      createPanel({ id: asNodeId('src'), parentId: asNodeId('tgt'), meta: { title: 'S' } }),
    );
    store.registerNode(createPanel({ id: asNodeId('a'), parentId: asNodeId('tgt') }));
    store.showNode(asNodeId('src'));
    store.showNode(asNodeId('a'));
    let controller: ReturnType<typeof useDragController> | null = null;
    const { queryByTestId, container } = render(
      <Provider store={store}>
        <StrategyRegistryProvider strategies={{ stack: stackStrategy }}>
          <DragProvider>
            <Handle onReady={(c) => (controller = c)} />
            <Container
              parentId={asNodeId('tgt')}
              viewport={{ w: 200, h: 600 }}
              chrome={(args) => <div data-testid={`chrome-${args.node.id}`} />}
            />
          </DragProvider>
        </StrategyRegistryProvider>
      </Provider>,
    );
    const tgtElPre = container.querySelector('[data-node-container="tgt"]')!;
    tgtElPre.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 200, bottom: 600, width: 200, height: 600, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    await act(async () => {
      controller!.tryBegin(asNodeId('src'));
      controller!.updateHoverByPoint(50, 500);
      await new Promise((r) => setTimeout(r, 20));
    });
    // Source's chrome is rendered (so DragHandle pointer capture survives)
    // but visually hidden via its wrapper. The data-preview-source attribute
    // marks the wrapper.
    expect(queryByTestId('chrome-src')).not.toBeNull();
    expect(queryByTestId('chrome-a')).not.toBeNull();
    const previewWrapper = container.querySelector('[data-preview-source="true"]');
    expect(previewWrapper).not.toBeNull();
    expect((previewWrapper as HTMLElement).style.visibility).toBe('hidden');
  });
});

describe('Container — getDropPreview fast path', () => {
  it('uses strategy.getDropPreview when defined', async () => {
    const store = new Store();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'stack', config: {} }));
    store.registerNode(
      createZone({ id: asNodeId('tgt'), parentId: asNodeId('z'), strategyId: 'grid', config: { cols: 2 } }),
    );
    store.registerNode(
      createPanel({ id: asNodeId('src'), parentId: asNodeId('z'), meta: { title: 'S' } }),
    );
    store.registerNode(createPanel({ id: asNodeId('a'), parentId: asNodeId('tgt') }));
    store.showNode(asNodeId('src'));
    store.showNode(asNodeId('a'));

    const spy = vi.spyOn(gridStrategy, 'getDropPreview' as never);
    let controller: ReturnType<typeof useDragController> | null = null;
    const { container } = render(
      <Provider store={store}>
        <StrategyRegistryProvider strategies={{ grid: gridStrategy, stack: stackStrategy }}>
          <DragProvider>
            <Handle onReady={(c) => (controller = c)} />
            <Container
              parentId={asNodeId('tgt')}
              viewport={{ w: 200, h: 200 }}
              chrome={(args) => <div data-testid={`chrome-${args.node.id}`} />}
            />
          </DragProvider>
        </StrategyRegistryProvider>
      </Provider>,
    );
    const tgtElPre = container.querySelector('[data-node-container="tgt"]')!;
    tgtElPre.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 200, bottom: 200, width: 200, height: 200, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    await act(async () => {
      controller!.tryBegin(asNodeId('src'));
      controller!.updateHoverByPoint(50, 50);
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
