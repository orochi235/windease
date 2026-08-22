import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asNodeId, Store, stripStrategy } from '../index.js';
import { Provider } from './Provider.js';
import { Panel, Zone } from './presets.js';
import { StrategyRegistryProvider } from './strategies.js';

afterEach(cleanup);

const Z = asNodeId('dock');
const A = asNodeId('a');
const B = asNodeId('b');

/** jsdom ships no ResizeObserver. This one reports a fixed extent per element
 *  so the measurement path can be driven at all. */
function installRO(heights: Record<string, number>) {
  class RO {
    #cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) {
      this.#cb = cb;
    }
    observe(el: Element) {
      const owner = el.closest('[data-node]')?.getAttribute('data-node') ?? '';
      const height = heights[owner] ?? 0;
      this.#cb(
        [{ target: el, contentRect: { width: 200, height } } as ResizeObserverEntry],
        this as never,
      );
    }
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', RO);
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

function tree(store: Store) {
  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={{ strip: stripStrategy as never }}>
        <Zone
          id={Z}
          strategyId="strip"
          config={{ axis: 'y', fill: true }}
          viewport={{ w: 200, h: 400 }}
        >
          <Panel id={A} hints={{ sizing: { h: 'content' } }} data-testid="a" />
          <Panel id={B} data-testid="b" />
        </Zone>
      </StrategyRegistryProvider>
    </Provider>
  );
}

describe('content sizing in the declarative path', () => {
  it('carries a declared hints prop onto the node', () => {
    const store = new Store();
    render(tree(store));
    expect(store.getNode(A)?.hints).toEqual({ sizing: { h: 'content' } });
  });

  it('reconciles a hints change rather than freezing at registration', () => {
    const store = new Store();
    const Tree = ({ min }: { min: number }) => (
      <Provider store={store}>
        <Zone id={Z} strategyId="strip" config={{ axis: 'y' }}>
          <Panel id={A} hints={{ minSize: { w: 0, h: min } }} />
        </Zone>
      </Provider>
    );
    const { rerender } = render(<Tree min={10} />);
    expect(store.getNode(A)?.hints?.minSize?.h).toBe(10);
    rerender(<Tree min={40} />);
    expect(store.getNode(A)?.hints?.minSize?.h).toBe(40);
  });

  it('wraps a content-sized panel in a measurement box', () => {
    const store = new Store();
    const { getByTestId } = render(tree(store));
    expect(getByTestId('a').querySelector('.windease-measure')).not.toBeNull();
  });

  it('leaves a panel that asked for nothing unwrapped', () => {
    const store = new Store();
    const { getByTestId } = render(tree(store));
    expect(getByTestId('b').querySelector('.windease-measure')).toBeNull();
  });

  it('marks the width-measuring variant so CSS can size the right axis', () => {
    const store = new Store();
    render(
      <Provider store={store}>
        <StrategyRegistryProvider strategies={{ strip: stripStrategy as never }}>
          <Zone id={Z} strategyId="strip" config={{ axis: 'x' }} viewport={{ w: 400, h: 200 }}>
            <Panel id={A} hints={{ sizing: { w: 'content' } }} data-testid="a" />
          </Zone>
        </StrategyRegistryProvider>
      </Provider>,
    );
    const box = document.querySelector('.windease-measure');
    expect(box?.className).toContain('windease-measure--w');
  });

  it('reports the measured extent, so the pane lays out at its content', () => {
    installRO({ a: 120 });
    const store = new Store();
    render(tree(store));
    // 400 viewport, `a` measured at 120, `b` takes the rest under fill. The
    // strategy's extent lands on the absolute wrapper, not the shell div.
    const shell = document.querySelector('[data-node="a"]');
    if (!shell?.parentElement) throw new Error('no pane wrapper');
    expect((shell.parentElement as HTMLElement).style.height).toBe('120px');
  });

  it('renders without a ResizeObserver instead of throwing', () => {
    expect(globalThis.ResizeObserver).toBeUndefined();
    expect(() => render(tree(new Store()))).not.toThrow();
  });
});
