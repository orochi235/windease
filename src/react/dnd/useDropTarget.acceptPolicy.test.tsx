import { cleanup, render } from '@testing-library/react';
import { useEffect, useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AcceptContext } from '../../dnd/DragEngine.js';
import { asNodeId, createNode, Store } from '../../index.js';
import { Provider } from '../Provider.js';
import { DragProvider, useDragController } from './DragProvider.js';
import { useDropTarget } from './useDropTarget.js';

afterEach(cleanup);

function Target({
  nodeId,
  acceptPolicy,
}: {
  nodeId: string;
  acceptPolicy: (ctx: AcceptContext) => boolean | undefined;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useDropTarget(asNodeId(nodeId), ref, { acceptPolicy });
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
  return <div ref={ref} data-testid={nodeId} />;
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

function storeWithZone(): Store {
  const store = new Store();
  store.registerNode(
    createNode({
      kind: 'zone',
      container: { strategyId: 'stack', config: {} },
      id: asNodeId('z'),
    }),
  );
  store.registerNode(
    createNode({ kind: 'panel', focus: true, id: asNodeId('src'), parentId: asNodeId('z') }),
  );
  return store;
}

async function hover(
  policy: (ctx: AcceptContext) => boolean | undefined,
): Promise<ReturnType<typeof useDragController>> {
  let controller: ReturnType<typeof useDragController> | null = null;
  render(
    <Provider store={storeWithZone()}>
      <DragProvider>
        <ControllerCapture
          onReady={(c) => {
            controller = c;
          }}
        />
        <Target nodeId="z" acceptPolicy={policy} />
      </DragProvider>
    </Provider>,
  );
  expect(controller).not.toBeNull();
  const c = controller as unknown as ReturnType<typeof useDragController>;
  c.tryBegin(asNodeId('src'));
  c.updateHoverByPoint(10, 10);
  await new Promise((r) => setTimeout(r, 20));
  return c;
}

describe('useDropTarget — acceptPolicy', () => {
  it('a refusing policy reaches the engine', async () => {
    const spy = vi.fn((_ctx: AcceptContext) => false);
    const c = await hover(spy);
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls[0]?.[0]).toMatchObject({ sourceId: 'src' });
    expect(c.state()?.hover?.accepted).toBe(false);
  });

  it('deferring leaves the drop accepted', async () => {
    const c = await hover(() => undefined);
    expect(c.state()?.hover?.accepted).toBe(true);
  });
});
