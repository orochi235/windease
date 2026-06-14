import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Store, asNodeId } from '../index.js';
import { Provider } from './Provider.js';
import { Group, Panel, Zone } from './presets.js';

afterEach(cleanup);

describe('nested declarative presets', () => {
  it('Zone > Group > Panel produces the correct parent chain', () => {
    const store = new Store();
    render(
      <Provider store={store}>
        <Zone id={asNodeId('z')} strategyId="grid" config={{ cols: 1 }}>
          <Group id={asNodeId('mid')} strategyId="stack" config={{}}>
            <Panel id={asNodeId('inner')} />
          </Group>
        </Zone>
      </Provider>,
    );
    expect(store.getNode(asNodeId('z'))?.container).toBeTruthy();
    expect(store.getNode(asNodeId('mid'))?.slot?.parentId).toBe(asNodeId('z'));
    expect(store.getNode(asNodeId('inner'))?.slot?.parentId).toBe(asNodeId('mid'));
  });

  it('Panel with container prop hosts nested presets', () => {
    const store = new Store();
    render(
      <Provider store={store}>
        <Zone id={asNodeId('z')} strategyId="grid" config={{ cols: 1 }}>
          <Panel id={asNodeId('outer')} container={{ strategyId: 'stack', config: {} }}>
            <Panel id={asNodeId('inner')} />
          </Panel>
        </Zone>
      </Provider>,
    );
    expect(store.getNode(asNodeId('outer'))?.container).toBeTruthy();
    expect(store.getNode(asNodeId('inner'))?.slot?.parentId).toBe(asNodeId('outer'));
  });

  it('unmounting a parent cascades unregister to JSX children', () => {
    const store = new Store();
    const { unmount } = render(
      <Provider store={store}>
        <Zone id={asNodeId('z')} strategyId="grid" config={{ cols: 1 }}>
          <Panel id={asNodeId('p1')} />
          <Panel id={asNodeId('p2')} />
        </Zone>
      </Provider>,
    );
    expect(store.getNode(asNodeId('p1'))).toBeTruthy();
    unmount();
    expect(store.getNode(asNodeId('z'))).toBeUndefined();
    expect(store.getNode(asNodeId('p1'))).toBeUndefined();
    expect(store.getNode(asNodeId('p2'))).toBeUndefined();
  });
});
