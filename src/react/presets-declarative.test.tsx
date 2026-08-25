import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { asNodeId, Store } from '../index.js';
import { Provider } from './Provider.js';
import { Panel, Zone } from './presets.js';

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
    expect((store.getNode(asNodeId('p1'))!.meta as Record<string, unknown>).title).toBe('one');
    rerender(<Tree title="two" />);
    expect((store.getNode(asNodeId('p1'))!.meta as Record<string, unknown>).title).toBe('two');
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

  it('reconciles config prop changes on Zone', () => {
    const store = new Store();
    const Tree = ({ cols }: { cols: number }) => (
      <Provider store={store}>
        <Zone id={asNodeId('z')} strategyId="grid" config={{ cols }}>
          <Panel id={asNodeId('p1')} />
        </Zone>
      </Provider>
    );
    const { rerender } = render(<Tree cols={1} />);
    expect(store.getNode(asNodeId('z'))?.container?.config).toMatchObject({ cols: 1 });
    rerender(<Tree cols={3} />);
    expect(store.getNode(asNodeId('z'))?.container?.config).toMatchObject({ cols: 3 });
  });

  it('deletes a config key the prop stops declaring', () => {
    const store = new Store();
    const Tree = ({ gap }: { gap?: number }) => (
      <Provider store={store}>
        <Zone
          id={asNodeId('z')}
          strategyId="grid"
          config={gap === undefined ? { cols: 2 } : { cols: 2, gap }}
        />
      </Provider>
    );
    const { rerender } = render(<Tree gap={8} />);
    expect(store.getNode(asNodeId('z'))?.container?.config).toEqual({ cols: 2, gap: 8 });
    rerender(<Tree />);
    expect(store.getNode(asNodeId('z'))?.container?.config).toEqual({ cols: 2 });
  });

  it('leaves a key a gesture wrote alone when the prop has not moved', () => {
    const store = new Store();
    const Tree = () => (
      <Provider store={store}>
        <Zone id={asNodeId('z')} strategyId="stack" config={{ headerSize: 24 }}>
          <Panel id={asNodeId('p1')} />
          <Panel id={asNodeId('p2')} />
        </Zone>
      </Provider>
    );
    const { rerender } = render(<Tree />);
    store.setActiveChild(asNodeId('z'), asNodeId('p2'));
    rerender(<Tree />);
    expect(store.getNode(asNodeId('z'))?.container?.config).toEqual({
      headerSize: 24,
      activeId: asNodeId('p2'),
    });
  });

  it('reconciles config prop changes on a Panel that is a container', () => {
    const store = new Store();
    const Tree = ({ cols }: { cols: number }) => (
      <Provider store={store}>
        <Zone id={asNodeId('z')} strategyId="grid" config={{ cols: 1 }}>
          <Panel id={asNodeId('p1')} container={{ strategyId: 'grid', config: { cols } }} />
        </Zone>
      </Provider>
    );
    const { rerender } = render(<Tree cols={1} />);
    expect(store.getNode(asNodeId('p1'))?.container?.config).toMatchObject({ cols: 1 });
    rerender(<Tree cols={4} />);
    expect(store.getNode(asNodeId('p1'))?.container?.config).toMatchObject({ cols: 4 });
  });

  it('skips the config reconcile while the container is arrange-locked', () => {
    const store = new Store();
    const Tree = ({ cols }: { cols: number }) => (
      <Provider store={store}>
        <Zone id={asNodeId('z')} strategyId="grid" config={{ cols }} lock={{ arrange: true }} />
      </Provider>
    );
    const { rerender } = render(<Tree cols={1} />);
    rerender(<Tree cols={3} />);
    expect(store.getNode(asNodeId('z'))?.container?.config).toMatchObject({ cols: 1 });
  });

  it('names a focusable pane for a screen reader that lands on it', () => {
    const store = new Store();
    const { getByTestId } = render(
      <Provider store={store}>
        <Zone id={asNodeId('z')} strategyId="grid" config={{ cols: 1 }} data-testid="z">
          <Panel id={asNodeId('p1')} data-testid="p1" meta={{ title: 'Alpha' }} />
        </Zone>
      </Provider>,
    );
    // The pane is a tab stop, so arriving there has to say what it is.
    expect(getByTestId('p1').getAttribute('role')).toBe('group');
    expect(getByTestId('p1').getAttribute('aria-label')).toBe('Alpha');
    // A zone declares no focus, takes no tab stop, and gets neither.
    expect(getByTestId('z').getAttribute('role')).toBeNull();
    expect(getByTestId('z').getAttribute('aria-label')).toBeNull();
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
