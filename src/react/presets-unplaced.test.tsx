import { act, cleanup, render } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { asNodeId, Store, stackStrategy, stripStrategy } from '../index.js';
import { Provider } from './Provider.js';
import { Panel, Zone } from './presets.js';
import { StrategyRegistryProvider } from './strategies.js';

afterEach(cleanup);

const STRATEGIES = { stack: stackStrategy as never, strip: stripStrategy as never };

/** Whether `el` or an ancestor is taken out of rendering. */
const displayed = (el: HTMLElement | null) => {
  for (let at = el; at; at = at.parentElement) if (at.style.display === 'none') return false;
  return el !== null;
};

describe('a child a strategy withheld', () => {
  it('is not displayed', () => {
    const { queryByTestId } = render(
      <Provider store={new Store()}>
        <StrategyRegistryProvider strategies={STRATEGIES}>
          <Zone
            id={asNodeId('z')}
            strategyId="stack"
            config={{ activeId: 'b', headerSize: 24 }}
            viewport={{ w: 300, h: 200 }}
          >
            <Panel id={asNodeId('a')} data-testid="a" />
            <Panel id={asNodeId('b')} data-testid="b" />
            <Panel id={asNodeId('c')} data-testid="c" />
          </Zone>
        </StrategyRegistryProvider>
      </Provider>,
    );
    expect(displayed(queryByTestId('b'))).toBe(true);
    expect(displayed(queryByTestId('a'))).toBe(false);
    expect(displayed(queryByTestId('c'))).toBe(false);
  });

  it('follows activeId when the store changes it', () => {
    const store = new Store();
    const { queryByTestId } = render(
      <Provider store={store}>
        <StrategyRegistryProvider strategies={STRATEGIES}>
          <Zone
            id={asNodeId('z')}
            strategyId="stack"
            config={{ activeId: 'a', headerSize: 24 }}
            viewport={{ w: 300, h: 200 }}
          >
            <Panel id={asNodeId('a')} data-testid="a" />
            <Panel id={asNodeId('b')} data-testid="b" />
          </Zone>
        </StrategyRegistryProvider>
      </Provider>,
    );
    expect(displayed(queryByTestId('a'))).toBe(true);
    expect(displayed(queryByTestId('b'))).toBe(false);
    act(() => {
      store.updateContainerConfig(asNodeId('z'), { activeId: 'b' });
    });
    expect(displayed(queryByTestId('b'))).toBe(true);
    expect(displayed(queryByTestId('a'))).toBe(false);
  });

  it('keeps its content mounted across a switch away and back', () => {
    const store = new Store();
    const mounts: string[] = [];
    function Probe({ name }: { name: string }) {
      useEffect(() => {
        mounts.push(`mount ${name}`);
        return () => {
          mounts.push(`unmount ${name}`);
        };
      }, [name]);
      return null;
    }
    render(
      <Provider store={store}>
        <StrategyRegistryProvider strategies={STRATEGIES}>
          <Zone
            id={asNodeId('z')}
            strategyId="stack"
            config={{ activeId: 'a', headerSize: 24 }}
            viewport={{ w: 300, h: 200 }}
          >
            <Panel id={asNodeId('a')}>
              <Probe name="a" />
            </Panel>
            <Panel id={asNodeId('b')}>
              <Probe name="b" />
            </Panel>
          </Zone>
        </StrategyRegistryProvider>
      </Provider>,
    );
    act(() => store.updateContainerConfig(asNodeId('z'), { activeId: 'b' }));
    act(() => store.updateContainerConfig(asNodeId('z'), { activeId: 'a' }));
    expect(mounts).toEqual(['mount a', 'mount b']);
  });
});

describe('a hidden child of a laid-out zone', () => {
  function Probe({ onMount }: { onMount: (() => void) | undefined }) {
    // biome-ignore lint/correctness/useExhaustiveDependencies: counts mounts, not prop changes.
    useEffect(() => onMount?.(), []);
    return null;
  }
  function tree(store: Store, hidden: boolean, onMount?: () => void) {
    return (
      <Provider store={store}>
        <StrategyRegistryProvider strategies={STRATEGIES}>
          <Zone
            id={asNodeId('z')}
            strategyId="strip"
            config={{ axis: 'x', fill: true }}
            viewport={{ w: 300, h: 200 }}
          >
            <Panel id={asNodeId('a')} data-testid="a" />
            <Panel id={asNodeId('b')} data-testid="b" hidden={hidden}>
              <Probe onMount={onMount} />
            </Panel>
          </Zone>
        </StrategyRegistryProvider>
      </Provider>
    );
  }

  it('is not displayed, so it cannot sit in normal flow over the placed panes', () => {
    const { getByTestId } = render(tree(new Store(), true));
    expect(displayed(getByTestId('a'))).toBe(true);
    expect(displayed(getByTestId('b'))).toBe(false);
  });

  it('keeps its content mounted through a hide and a show', () => {
    const store = new Store();
    let mounts = 0;
    const bump = () => {
      mounts++;
    };
    const view = render(tree(store, false, bump));
    view.rerender(tree(store, true, bump));
    view.rerender(tree(store, false, bump));
    expect(displayed(view.getByTestId('b'))).toBe(true);
    expect(mounts).toBe(1);
  });
});

describe('a leaf placed after its first render', () => {
  it('mounts its content once', () => {
    const store = new Store();
    let mounts = 0;
    function Probe() {
      useEffect(() => {
        mounts++;
      }, []);
      return null;
    }
    // A zone measuring its own box has no viewport on the first pass, so the
    // panel renders unplaced and gains its rect on a later one.
    class RO {
      constructor(private cb: ResizeObserverCallback) {}
      observe(el: Element) {
        this.cb(
          [{ target: el, contentRect: { width: 300, height: 200 } } as ResizeObserverEntry],
          this as never,
        );
      }
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', RO);
    const { getByTestId } = render(
      <Provider store={store}>
        <StrategyRegistryProvider strategies={STRATEGIES}>
          <Zone id={asNodeId('z')} strategyId="strip" config={{ axis: 'x', fill: true }}>
            <Panel id={asNodeId('a')} data-testid="a">
              <Probe />
            </Panel>
          </Zone>
        </StrategyRegistryProvider>
      </Provider>,
    );
    vi.unstubAllGlobals();
    expect(getByTestId('a').parentElement?.style.position).toBe('absolute');
    expect(mounts).toBe(1);
  });
});

describe('a child no strategy withheld', () => {
  // These two are why `unplaced` can carry the signal at all: both report an
  // empty list because no strategy ran, so membership means "withheld" and
  // never "nobody placed me".
  it('still renders under flow mode', () => {
    const { queryByTestId } = render(
      <Provider store={new Store()}>
        <StrategyRegistryProvider strategies={STRATEGIES}>
          <Zone id={asNodeId('z')} hints={{ render: 'flow' }}>
            <Panel id={asNodeId('a')} data-testid="a" />
            <Panel id={asNodeId('b')} data-testid="b" />
          </Zone>
        </StrategyRegistryProvider>
      </Provider>,
    );
    expect(queryByTestId('a')).toBeTruthy();
    expect(queryByTestId('b')).toBeTruthy();
  });

  it('still renders with no strategy registry above it', () => {
    const { queryByTestId } = render(
      <Provider store={new Store()}>
        <Zone id={asNodeId('z')} strategyId="stack">
          <Panel id={asNodeId('a')} data-testid="a" />
          <Panel id={asNodeId('b')} data-testid="b" />
        </Zone>
      </Provider>,
    );
    expect(queryByTestId('a')).toBeTruthy();
    expect(queryByTestId('b')).toBeTruthy();
  });
});
