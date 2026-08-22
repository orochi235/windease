import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { asNodeId, createNode, Store, stripStrategy } from '../index.js';
import { Container } from './Container.js';
import { Provider } from './Provider.js';
import { Panel, Zone } from './presets.js';
import { StrategyRegistryProvider } from './strategies.js';

afterEach(cleanup);

const Z = asNodeId('z');

function storeWith(mode: string | undefined, h: number): Store {
  const s = new Store();
  s.registerNode(
    createNode({
      kind: 'zone',
      container: {
        strategyId: 'strip',
        config: { axis: 'y', ...(mode ? { overflowMode: mode } : {}) },
      },
      id: Z,
    }),
  );
  s.showNode(Z);
  for (const c of ['a', 'b', 'c']) {
    const nid = asNodeId(c);
    s.registerNode(createNode({ kind: 'panel', id: nid, parentId: Z }));
    s.showNode(nid);
    s.patchPlacement(nid, { size: { h } });
  }
  return s;
}

function container(store: Store) {
  return render(
    <Provider store={store}>
      <StrategyRegistryProvider strategies={{ strip: stripStrategy as never }}>
        <Container parentId={Z} chrome={{}} viewport={{ w: 200, h: 400 }} data-testid="box" />
      </StrategyRegistryProvider>
    </Provider>,
  );
}

const box = (c: HTMLElement) => c.firstElementChild as HTMLElement;

describe('scroll-mode extent', () => {
  it('grows the box to the intrinsic extent so a wrapper can scroll it', () => {
    const { container: c } = container(storeWith('scroll', 200));
    // 3 panes of 200 in a 400 viewport: the box must be 600 tall.
    expect(box(c).style.height).toBe('600px');
  });

  it('leaves the box at the viewport when nothing overflows', () => {
    const { container: c } = container(storeWith('scroll', 100));
    expect(box(c).style.height).toBe('400px');
  });

  it('does not grow the box under the default squeeze mode', () => {
    const { container: c } = container(storeWith(undefined, 200));
    expect(box(c).style.height).toBe('400px');
  });

  it('grows on the main axis only', () => {
    const { container: c } = container(storeWith('scroll', 200));
    expect(box(c).style.width).toBe('200px');
  });

  it('lets an explicit style prop override the grown extent', () => {
    const store = storeWith('scroll', 200);
    const { container: c } = render(
      <Provider store={store}>
        <StrategyRegistryProvider strategies={{ strip: stripStrategy as never }}>
          <Container
            parentId={Z}
            chrome={{}}
            viewport={{ w: 200, h: 400 }}
            style={{ height: 500 }}
          />
        </StrategyRegistryProvider>
      </Provider>,
    );
    expect(box(c).style.height).toBe('500px');
  });

  it('grows a declarative Zone the same way', () => {
    const store = new Store();
    const { container: c } = render(
      <Provider store={store}>
        <StrategyRegistryProvider strategies={{ strip: stripStrategy as never }}>
          <Zone
            id={Z}
            strategyId="strip"
            config={{ axis: 'y', overflowMode: 'scroll' }}
            viewport={{ w: 200, h: 400 }}
          >
            <Panel id={asNodeId('a')} placement={{ size: { h: 200 } }} />
            <Panel id={asNodeId('b')} placement={{ size: { h: 200 } }} />
            <Panel id={asNodeId('c')} placement={{ size: { h: 200 } }} />
          </Zone>
        </StrategyRegistryProvider>
      </Provider>,
    );
    expect(box(c).style.height).toBe('600px');
  });
});
