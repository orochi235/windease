import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Store, asNodeId } from '../index.js';
import { Provider } from './Provider.js';
import { Group, Panel, Zone } from './presets.js';

afterEach(cleanup);

describe('declarative presets', () => {
  it('Panel registers and renders DOM', () => {
    const store = new Store();
    const { getByTestId } = render(
      <Provider store={store}>
        <Zone id={asNodeId('root')} strategyId="grid" config={{ cols: 1 }}>
          <Panel id={asNodeId('p1')} data-testid="p1" meta={{ title: 'A' }} />
        </Zone>
      </Provider>,
    );
    expect(store.getNode(asNodeId('p1'))).toBeTruthy();
    expect(getByTestId('p1')).toBeTruthy();
    expect(getByTestId('p1').isConnected).toBe(true);
  });

  it('Zone registers as container and propagates parent context', () => {
    const store = new Store();
    render(
      <Provider store={store}>
        <Zone
          id={asNodeId('z1')}
          strategyId="grid"
          config={{ cols: 2 }}
          viewport={{ w: 200, h: 100 }}
        >
          <Panel id={asNodeId('p1')} />
          <Panel id={asNodeId('p2')} />
        </Zone>
      </Provider>,
    );
    expect(store.getNode(asNodeId('z1'))?.container).toBeTruthy();
    expect(store.getContainerView(asNodeId('z1'))?.childOrder).toEqual([
      asNodeId('p1'),
      asNodeId('p2'),
    ]);
  });

  it('reconciles meta prop changes', () => {
    const store = new Store();
    const Tree = ({ title }: { title: string }) => (
      <Provider store={store}>
        <Zone id={asNodeId('z')} strategyId="grid" config={{ cols: 1 }}>
          <Panel id={asNodeId('p1')} meta={{ title }} />
        </Zone>
      </Provider>
    );
    const { rerender } = render(<Tree title="one" />);
    expect((store.getNode(asNodeId('p1'))?.meta as Record<string, unknown>).title).toBe('one');
    rerender(<Tree title="two" />);
    expect((store.getNode(asNodeId('p1'))?.meta as Record<string, unknown>).title).toBe('two');
  });

  it('hidden prop toggles hideNode/showNode', () => {
    const store = new Store();
    const Tree = ({ hidden }: { hidden: boolean }) => (
      <Provider store={store}>
        <Zone id={asNodeId('z')} strategyId="grid" config={{ cols: 1 }}>
          <Panel id={asNodeId('p1')} hidden={hidden} />
        </Zone>
      </Provider>
    );
    const { rerender } = render(<Tree hidden={false} />);
    expect(store.getNode(asNodeId('p1'))?.lifecycle.state).toBe('visible');
    rerender(<Tree hidden={true} />);
    expect(store.getNode(asNodeId('p1'))?.lifecycle.state).toBe('hidden');
    rerender(<Tree hidden={false} />);
    expect(store.getNode(asNodeId('p1'))?.lifecycle.state).toBe('visible');
  });

  it('unmount unregisters the node', () => {
    const store = new Store();
    const { unmount } = render(
      <Provider store={store}>
        <Zone id={asNodeId('z')} strategyId="grid" config={{ cols: 1 }}>
          <Panel id={asNodeId('p1')} />
        </Zone>
      </Provider>,
    );
    expect(store.getNode(asNodeId('p1'))).toBeTruthy();
    unmount();
    expect(store.getNode(asNodeId('p1'))).toBeUndefined();
  });
});
