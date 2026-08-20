import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createNode } from '../constructors.js';
import { asNodeId } from '../node.js';
import { Store } from '../store.js';
import { FakeClock } from '../test-utils/fake-clock.js';
import { useChildren, useNode } from './hooks.js';
import { Provider } from './Provider.js';

const nid = (s: string) => asNodeId(s);
const zone = (id: string) =>
  createNode({
    kind: 'zone',
    container: { strategyId: 'grid', config: {} },
    id: nid(id),
  });
const panel = (id: string, parentId: string) =>
  createNode({
    kind: 'panel',
    focus: true,
    id: nid(id),
    parentId: nid(parentId),
  });

function Probe({ id }: { id: string }) {
  const node = useNode(nid(id));
  const children = useChildren(nid(id));
  return (
    <div>
      <span data-testid="present">{node ? 'yes' : 'no'}</span>
      <span data-testid="children">{children.length}</span>
    </div>
  );
}

describe('React under throttling', () => {
  it('does not loop useSyncExternalStore and reflects the flush', () => {
    const clock = new FakeClock();
    const store = new Store({ throttle: { notifyMs: 32 }, clock });
    store.registerNode(zone('z'));
    store.flushNow();

    render(
      <Provider store={store}>
        <Probe id="z" />
      </Provider>,
    );
    expect(screen.getByTestId('present').textContent).toBe('yes');
    expect(screen.getByTestId('children').textContent).toBe('0');

    act(() => {
      store.registerNode(panel('p', 'z'));
    });
    // Still inside the window — the layout must not have moved yet.
    expect(screen.getByTestId('children').textContent).toBe('0');

    act(() => {
      clock.advance(32);
    });
    expect(screen.getByTestId('children').textContent).toBe('1');
  });

  it('renders an un-throttled store exactly as before', async () => {
    const store = new Store();
    store.registerNode(zone('z'));

    render(
      <Provider store={store}>
        <Probe id="z" />
      </Provider>,
    );
    expect(screen.getByTestId('present').textContent).toBe('yes');

    await act(async () => {
      store.registerNode(panel('p', 'z'));
      await Promise.resolve();
    });
    expect(screen.getByTestId('children').textContent).toBe('1');
  });
});
