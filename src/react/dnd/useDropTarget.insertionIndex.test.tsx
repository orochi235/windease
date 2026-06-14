import { cleanup, render } from '@testing-library/react';
import { useEffect, useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Store, asNodeId, createPanel, createZone } from '../../index.js';
import { Provider } from '../Provider.js';
import { DragProvider, useDragController } from './DragProvider.js';
import { useDropTarget } from './useDropTarget.js';

afterEach(cleanup);

function Target({
  nodeId,
  onIndex,
}: {
  nodeId: string;
  onIndex: (p: { x: number; y: number }) => number | undefined;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useDropTarget(asNodeId(nodeId), ref, { getInsertionIndex: onIndex });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 100,
        bottom: 100,
        width: 100,
        height: 100,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
  }, []);
  return <div ref={ref} data-testid={nodeId} style={{ width: 100, height: 100 }} />;
}

function ControllerCapture({
  onReady,
}: {
  onReady: (c: ReturnType<typeof useDragController>) => void;
}) {
  const c = useDragController();
  onReady(c);
  return null;
}

describe('useDropTarget — getInsertionIndex', () => {
  it('passes the insertion index callback through to DragController', async () => {
    const store = new Store();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'stack', config: {} }));
    store.registerNode(createPanel({ id: asNodeId('src'), parentId: asNodeId('z') }));
    store.registerNode(createPanel({ id: asNodeId('tgt'), parentId: asNodeId('z') }));
    const spy = vi.fn(() => 7);
    let controller: ReturnType<typeof useDragController> | null = null;
    render(
      <Provider store={store}>
        <DragProvider>
          <ControllerCapture
            onReady={(c) => {
              controller = c;
            }}
          />
          <Target nodeId="tgt" onIndex={spy} />
        </DragProvider>
      </Provider>,
    );
    expect(controller).not.toBeNull();
    controller!.tryBegin(asNodeId('src'));
    controller!.updateHoverByPoint(10, 10);
    await new Promise((r) => setTimeout(r, 20));
    expect(spy).toHaveBeenCalled();
    expect(controller!.state()?.hover?.insertIndex).toBe(7);
  });
});
