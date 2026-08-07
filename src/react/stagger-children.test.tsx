import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createPanel, createZone } from '../constructors.js';
import { asNodeId } from '../node.js';
import { Store } from '../store.js';
import { FakeClock } from '../test-utils/fake-clock.js';
import { useChildren } from './hooks.js';
import { Provider } from './Provider.js';

const nid = (s: string) => asNodeId(s);
const zone = (id: string) => createZone({ id: nid(id), strategyId: 'grid', config: {} });
const panel = (id: string, parentId: string) =>
  createPanel({ id: nid(id), parentId: nid(parentId) });

function Counter({ id }: { id: string }) {
  const children = useChildren(nid(id));
  return <span data-testid="count">{children.length}</span>;
}

describe('useChildren under partial publishing', () => {
  it('picks up children that publish in later stagger waves', () => {
    const clock = new FakeClock();
    const store = new Store({
      throttle: { notifyMs: 10, stagger: { batch: 3, ms: 40 } },
      clock,
    });
    store.registerNode(zone('z'));
    store.flushNow();

    render(
      <Provider store={store}>
        <Counter id="z" />
      </Provider>,
    );
    expect(screen.getByTestId('count').textContent).toBe('0');

    // Register 12 children in one synchronous burst. The parent's childOrder
    // reaches its final value immediately; the children then publish across
    // several stagger waves while the parent record never changes again.
    act(() => {
      for (let i = 0; i < 12; i++) store.registerNode(panel(`p${i}`, 'z'));
    });

    act(() => {
      clock.advance(10);
    });
    const afterFirstWave = Number(screen.getByTestId('count').textContent);
    expect(afterFirstWave).toBeGreaterThan(0);
    expect(afterFirstWave).toBeLessThan(12);

    // Drain every remaining wave.
    act(() => {
      clock.advance(1000);
    });
    expect(screen.getByTestId('count').textContent).toBe('12');
  });

  it('picks up a child that publishes late because it was dwell-held', () => {
    const clock = new FakeClock();
    const store = new Store({
      throttle: { notifyMs: 10, dwell: { lifecycle: 150 } },
      clock,
    });
    store.registerNode(zone('z'));
    store.registerNode(panel('p', 'z'));
    store.flushNow();

    render(
      <Provider store={store}>
        <Counter id="z" />
      </Provider>,
    );
    expect(screen.getByTestId('count').textContent).toBe('1');

    // Remove and re-add: the parent's childOrder settles immediately, but the
    // re-added child's own publish is gated.
    act(() => {
      store.unregisterNode(nid('p'));
      clock.advance(10);
    });
    expect(screen.getByTestId('count').textContent).toBe('0');

    act(() => {
      store.registerNode(panel('p', 'z'));
      clock.advance(1000);
    });
    expect(screen.getByTestId('count').textContent).toBe('1');
  });
});
