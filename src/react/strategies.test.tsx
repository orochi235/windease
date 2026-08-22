import { act, cleanup, render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { asNodeId, ContainerHost, createNode, gridStrategy, Store } from '../index.js';
import { type ChromeMap, Container } from './index.js';
import { Provider } from './Provider.js';
import { StrategyRegistryProvider, useStrategyRegistry } from './strategies.js';

afterEach(cleanup);

const CHROME: ChromeMap = {
  panel: ({ node }) => <div data-testid={`p-${node.id}`}>{String(node.id)}</div>,
};
const ZONE = asNodeId('z');

function makeStore(): Store {
  const s = new Store();
  s.registerNode(
    createNode({ kind: 'zone', id: ZONE, container: { strategyId: 'grid', config: { cols: 2 } } }),
  );
  for (const name of ['a', 'b']) {
    const id = asNodeId(name);
    s.registerNode(createNode({ kind: 'panel', focus: true, id, parentId: ZONE }));
    s.showNode(id);
  }
  return s;
}

/** The idiomatic call site passes an object literal, so `strategies` is a new
 *  object on every render. Keying the registry on its identity rebuilt every
 *  ContainerHost underneath — silent, because everything still rendered. */
describe('StrategyRegistryProvider', () => {
  it('keeps one registry across renders that rebuild the strategies object', () => {
    const seen: unknown[] = [];
    let bump = () => {};
    function Probe() {
      seen.push(useStrategyRegistry());
      return null;
    }
    function Host() {
      const [n, setN] = useState(0);
      bump = () => setN(n + 1);
      return (
        <StrategyRegistryProvider strategies={{ grid: gridStrategy as never }}>
          <Probe />
        </StrategyRegistryProvider>
      );
    }
    render(<Host />);
    act(() => bump());

    expect(seen).toHaveLength(2);
    expect(seen[1]).toBe(seen[0]);
  });

  it('mints a new registry when the strategies actually change', () => {
    const seen: unknown[] = [];
    let swap = () => {};
    function Probe() {
      seen.push(useStrategyRegistry());
      return null;
    }
    function Host() {
      const [alt, setAlt] = useState(false);
      swap = () => setAlt(true);
      return (
        <StrategyRegistryProvider
          strategies={alt ? { tiles: gridStrategy as never } : { grid: gridStrategy as never }}
        >
          <Probe />
        </StrategyRegistryProvider>
      );
    }
    render(<Host />);
    act(() => swap());

    expect(seen).toHaveLength(2);
    expect(seen[1]).not.toBe(seen[0]);
  });

  it('does not destroy the container host when an ancestor re-renders', () => {
    const store = makeStore();
    let bump = () => {};
    function Host() {
      const [n, setN] = useState(0);
      bump = () => setN(n + 1);
      return (
        <Provider store={store}>
          <StrategyRegistryProvider strategies={{ grid: gridStrategy as never }}>
            <Container parentId={ZONE} chrome={CHROME} viewport={{ w: 400, h: 300 }} />
          </StrategyRegistryProvider>
        </Provider>
      );
    }
    const destroy = vi.spyOn(ContainerHost.prototype, 'destroy');
    render(<Host />);
    destroy.mockClear();

    act(() => bump());

    expect(destroy).not.toHaveBeenCalled();
    destroy.mockRestore();
  });
});
