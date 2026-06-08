import { render, cleanup, act } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useEffect, useRef } from 'react';
import { Provider } from '../Provider.js';
import { Store, asNodeId, createPanel, createZone } from '../../index.js';
import { DragProvider, useDragController } from './DragProvider.js';
import { useDropTarget } from './useDropTarget.js';
import type { NodeId } from '../../index.js';

afterEach(cleanup);

function TgtBox({ nodeId, canAccept }: { nodeId: string; canAccept?: (s: NodeId) => boolean }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useDropTarget(asNodeId(nodeId), ref, canAccept);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  }, []);
  return <div ref={ref} data-testid={nodeId} style={{ width: 100, height: 100 }} />;
}

function ControllerHandle({ onReady }: { onReady: (c: ReturnType<typeof useDragController>) => void }) {
  const c = useDragController();
  onReady(c);
  return null;
}

describe('DragProvider overlay', () => {
  it('renders the default overlay during drag with the node title', async () => {
    const store = new Store();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'stack', config: {} }));
    store.registerNode(createPanel({ id: asNodeId('src'), parentId: asNodeId('z'), meta: { title: 'My Panel' } }));
    store.registerNode(createPanel({ id: asNodeId('tgt'), parentId: asNodeId('z') }));
    let controller: ReturnType<typeof useDragController> | null = null;
    const { queryByTestId, findByTestId } = render(
      <Provider store={store}>
        <DragProvider>
          <ControllerHandle onReady={(c) => (controller = c)} />
          <TgtBox nodeId="tgt" />
        </DragProvider>
      </Provider>,
    );
    expect(queryByTestId('windease-drag-overlay')).toBeNull();
    await act(async () => {
      controller!.tryBegin(asNodeId('src'));
      controller!.updateHoverByPoint(10, 10);
      await new Promise((r) => setTimeout(r, 20));
    });
    const overlay = await findByTestId('windease-drag-overlay');
    expect(overlay.textContent).toBe('My Panel');
    expect(overlay.getAttribute('data-rejected')).toBe('false');
  });

  it('passes rejected=true when the hover is rejected', async () => {
    const store = new Store();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'stack', config: {} }));
    store.registerNode(createPanel({ id: asNodeId('src'), parentId: asNodeId('z'), meta: { title: 'S' } }));
    store.registerNode(createPanel({ id: asNodeId('tgt'), parentId: asNodeId('z') }));
    let controller: ReturnType<typeof useDragController> | null = null;
    const { findByTestId } = render(
      <Provider store={store}>
        <DragProvider>
          <ControllerHandle onReady={(c) => (controller = c)} />
          <TgtBox nodeId="tgt" canAccept={() => false} />
        </DragProvider>
      </Provider>,
    );
    await act(async () => {
      controller!.tryBegin(asNodeId('src'));
      controller!.updateHoverByPoint(10, 10);
      await new Promise((r) => setTimeout(r, 20));
    });
    const overlay = await findByTestId('windease-drag-overlay');
    expect(overlay.getAttribute('data-rejected')).toBe('true');
  });

  it('accepts a custom dragOverlay renderer', async () => {
    const store = new Store();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'stack', config: {} }));
    store.registerNode(createPanel({ id: asNodeId('src'), parentId: asNodeId('z'), meta: { title: 'Custom' } }));
    store.registerNode(createPanel({ id: asNodeId('tgt'), parentId: asNodeId('z') }));
    let controller: ReturnType<typeof useDragController> | null = null;
    const { findByTestId } = render(
      <Provider store={store}>
        <DragProvider dragOverlay={(ctx) => <div data-testid="my-overlay">drag:{ctx.draggingId}</div>}>
          <ControllerHandle onReady={(c) => (controller = c)} />
          <TgtBox nodeId="tgt" />
        </DragProvider>
      </Provider>,
    );
    await act(async () => {
      controller!.tryBegin(asNodeId('src'));
      controller!.updateHoverByPoint(10, 10);
      await new Promise((r) => setTimeout(r, 20));
    });
    const el = await findByTestId('my-overlay');
    expect(el.textContent).toBe('drag:src');
  });
});
