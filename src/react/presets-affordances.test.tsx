import { cleanup, fireEvent, render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { asNodeId, type NodeId, Store, stripStrategy } from '../index.js';
import { Provider } from './Provider.js';
import { Panel, Zone } from './presets.js';
import { StrategyRegistryProvider } from './strategies.js';

afterEach(cleanup);

const Z = asNodeId('z');
const A = asNodeId('a');
const B = asNodeId('b');

const CONFIG = {
  axis: 'y' as const,
  fill: true,
  resizable: true,
  resizeMode: 'neighbor' as const,
};

function tree(store: Store, zoneProps: Record<string, unknown> = {}) {
  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={{ strip: stripStrategy as never }}>
        <Zone
          id={Z}
          strategyId="strip"
          config={CONFIG}
          viewport={{ w: 200, h: 400 }}
          affordances
          {...zoneProps}
        >
          <Panel id={A} meta={{ title: 'Palette 1' }} />
          <Panel id={B} meta={{ title: 'Palette 2' }} />
        </Zone>
      </StrategyRegistryProvider>
    </Provider>
  );
}

const gutter = (c: HTMLElement) => c.querySelector('[role="separator"]') as HTMLElement;
const sizeH = (s: Store, id: NodeId) =>
  (s.getNode(id)?.membership?.placement?.size as { h?: number } | undefined)?.h;

describe('affordances in the declarative path', () => {
  it('renders a seam for a Zone that asked for one', () => {
    const { container } = render(tree(new Store()));
    const g = gutter(container);
    expect(g).not.toBeNull();
    expect(g.getAttribute('aria-orientation')).toBe('vertical');
    expect(g.getAttribute('aria-valuenow')).toBe('200');
  });

  it('names the seam from the panes it moves, same as Container', () => {
    const { container } = render(tree(new Store()));
    expect(gutter(container).getAttribute('aria-label')).toBe('resize Palette 1 and Palette 2');
  });

  it('renders no seam by default', () => {
    const { container } = render(tree(new Store(), { affordances: undefined }));
    expect(container.querySelector('[role="separator"]')).toBeNull();
  });

  it('takes arrow keys, so a Zone seam is keyboard-resizable', () => {
    const store = new Store();
    const { container } = render(tree(store));
    fireEvent.keyDown(gutter(container), { key: 'ArrowDown' });
    expect(sizeH(store, A)).toBe(208);
    expect(sizeH(store, B)).toBe(192);
  });

  it('honors affordanceKeyStep', () => {
    const store = new Store();
    const { container } = render(tree(store, { affordanceKeyStep: 25 }));
    fireEvent.keyDown(gutter(container), { key: 'ArrowDown' });
    expect(sizeH(store, A)).toBe(225);
  });

  it('a declared placement with no handler is re-forced, reverting the drag', () => {
    // Documents the collision `onPlacementChange` exists to resolve: declaring
    // `placement` makes the JSX the authority, and reconcile runs every render.
    const store = new Store();
    const { container } = render(
      <Provider store={store}>
        <StrategyRegistryProvider strategies={{ strip: stripStrategy as never }}>
          <Zone id={Z} strategyId="strip" config={CONFIG} viewport={{ w: 200, h: 400 }} affordances>
            <Panel id={A} placement={{ size: { h: 100 } }} />
            <Panel id={B} placement={{ size: { h: 100 } }} />
          </Zone>
        </StrategyRegistryProvider>
      </Provider>,
    );
    fireEvent.keyDown(gutter(container), { key: 'ArrowDown' });
    expect(sizeH(store, A)).toBe(100);
  });

  it('takes a renderer that fully replaces the handle', () => {
    const { container } = render(
      tree(new Store(), {
        affordances: ({ affordance }: { affordance: { id: string } }) => (
          <div data-testid="custom" data-id={affordance.id} />
        ),
      }),
    );
    expect(container.querySelector('[data-testid="custom"]')).not.toBeNull();
    expect(container.querySelector('[role="separator"]')).toBeNull();
  });

  it('renders a seam for a Panel promoted to a container', () => {
    class RO {
      constructor(private cb: ResizeObserverCallback) {}
      observe(el: Element) {
        this.cb(
          [{ target: el, contentRect: { width: 200, height: 400 } } as ResizeObserverEntry],
          this as never,
        );
      }
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', RO);
    const store = new Store();
    const { container } = render(
      <Provider store={store}>
        <StrategyRegistryProvider strategies={{ strip: stripStrategy as never }}>
          <Zone id={Z} strategyId="strip" config={{ axis: 'y' }} viewport={{ w: 200, h: 400 }}>
            <Panel id={A} container={{ strategyId: 'strip', config: CONFIG }} affordances>
              <Panel id={asNodeId('a1')} placement={{ size: { h: 50 } }} />
              <Panel id={asNodeId('a2')} placement={{ size: { h: 50 } }} />
            </Panel>
          </Zone>
        </StrategyRegistryProvider>
      </Provider>,
    );
    expect(gutter(container)).not.toBeNull();
    vi.unstubAllGlobals();
  });

  it('suppresses the seam a resize lock forbids', () => {
    const store = new Store();
    const { container, rerender } = render(tree(store));
    expect(gutter(container)).not.toBeNull();
    store.setLock(A, { resize: true });
    rerender(tree(store));
    expect(container.querySelector('[role="separator"]')).toBeNull();
  });
});

describe('controlled placement in the declarative path', () => {
  function controlledTree(store: Store, onA?: unknown, onB?: unknown) {
    return (
      <Provider store={store}>
        <StrategyRegistryProvider strategies={{ strip: stripStrategy as never }}>
          <Zone id={Z} strategyId="strip" config={CONFIG} viewport={{ w: 200, h: 400 }} affordances>
            <Panel id={A} {...(onA ? { onPlacementChange: onA as never } : {})} />
            <Panel id={B} {...(onB ? { onPlacementChange: onB as never } : {})} />
          </Zone>
        </StrategyRegistryProvider>
      </Provider>
    );
  }

  it('hands a Panel the placement a seam drag would have written', () => {
    const store = new Store();
    const onA = vi.fn();
    const { container } = render(controlledTree(store, onA));

    fireEvent.keyDown(gutter(container), { key: 'ArrowDown' });

    expect(onA).toHaveBeenCalledTimes(1);
    expect(onA.mock.calls[0]?.[0]).toEqual({ size: { h: 208 } });
    expect(onA.mock.calls[0]?.[1]).toEqual({ affordanceId: 'resize-y-a', parentId: Z });
  });

  it('leaves the store untouched, so the host is the only writer', () => {
    const store = new Store();
    const { container } = render(
      controlledTree(
        store,
        () => {},
        () => {},
      ),
    );

    fireEvent.keyDown(gutter(container), { key: 'ArrowDown' });

    expect(sizeH(store, A)).toBeUndefined();
    expect(sizeH(store, B)).toBeUndefined();
  });

  it('a controlled Panel does not stop its uncontrolled sibling committing', () => {
    const store = new Store();
    const onA = vi.fn();
    const { container } = render(controlledTree(store, onA));

    fireEvent.keyDown(gutter(container), { key: 'ArrowDown' });

    expect(onA.mock.calls[0]?.[0]).toEqual({ size: { h: 208 } });
    expect(sizeH(store, A)).toBeUndefined();
    expect(sizeH(store, B)).toBe(192);
  });

  it('a controlled size the host feeds back is what renders', () => {
    // The round trip the pattern exists for: gesture -> host state -> re-render.
    const store = new Store();
    function Host() {
      const [h, setH] = useState(100);
      return (
        <Provider store={store}>
          <StrategyRegistryProvider strategies={{ strip: stripStrategy as never }}>
            <Zone
              id={Z}
              strategyId="strip"
              config={CONFIG}
              viewport={{ w: 200, h: 400 }}
              affordances
            >
              <Panel
                id={A}
                placement={{ size: { h } }}
                onPlacementChange={(next) => setH((next as { size: { h: number } }).size.h)}
              />
              <Panel id={B} placement={{ size: { h: 100 } }} />
            </Zone>
          </StrategyRegistryProvider>
        </Provider>
      );
    }
    const { container } = render(<Host />);
    fireEvent.keyDown(gutter(container), { key: 'ArrowDown' });
    expect(gutter(container).getAttribute('aria-valuenow')).toBe('108');
  });
});
