import { cleanup, fireEvent, render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asNodeId, type NodeId, Store, stripStrategy } from '../index.js';
import { Provider } from './Provider.js';
import { Panel, Zone } from './presets.js';
import { StrategyRegistryProvider } from './strategies.js';

afterEach(cleanup);

/**
 * The case the whole wishlist section exists for, assembled: a dock of
 * content-sized palettes, declared as static JSX, with draggable seams
 * between them and a scroll policy when they stop fitting.
 *
 * Each half is covered on its own elsewhere. This asserts they compose —
 * which is what the two consumers actually asked for, and the thing that
 * per-feature tests are least likely to catch.
 */
const DOCK = asNodeId('dock');
const IDS = [asNodeId('layers'), asNodeId('colors'), asNodeId('brushes')];

function installRO(heights: Record<string, number>) {
  class RO {
    #cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) {
      this.#cb = cb;
    }
    observe(el: Element) {
      const owner = el.closest('[data-node]')?.getAttribute('data-node') ?? '';
      this.#cb(
        [
          {
            target: el,
            contentRect: { width: 200, height: heights[owner] ?? 0 },
          } as ResizeObserverEntry,
        ],
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

function Dock({ store, onSize }: { store: Store; onSize?: (id: NodeId, h: number) => void }) {
  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={{ strip: stripStrategy as never }}>
        <div className="dock-scroll">
          <Zone
            id={DOCK}
            strategyId="strip"
            config={{ axis: 'y', resizable: true, resizeMode: 'neighbor', overflowMode: 'scroll' }}
            viewport={{ w: 200, h: 300 }}
            affordances
          >
            {IDS.map((id) => (
              <Panel
                key={id}
                id={id}
                meta={{ title: id }}
                hints={{ sizing: { h: 'content' }, minSize: { w: 0, h: 40 } }}
                {...(onSize
                  ? {
                      onPlacementChange: (next: Record<string, unknown>) =>
                        onSize(id, (next.size as { h: number }).h),
                    }
                  : {})}
              >
                <div>{id} contents</div>
              </Panel>
            ))}
          </Zone>
        </div>
      </StrategyRegistryProvider>
    </Provider>
  );
}

const paneBox = (id: NodeId) =>
  document.querySelector(`[data-node="${id}"]`)?.parentElement as HTMLElement;
const zoneBox = () => document.querySelector('.dock-scroll')?.firstElementChild as HTMLElement;
const seams = () => [...document.querySelectorAll('[role="separator"]')] as HTMLElement[];

describe('a palette dock, end to end', () => {
  it('sizes every palette to its own contents', () => {
    installRO({ layers: 150, colors: 90, brushes: 60 });
    render(<Dock store={new Store()} />);
    expect(paneBox(IDS[0]!).style.height).toBe('150px');
    expect(paneBox(IDS[1]!).style.height).toBe('90px');
    expect(paneBox(IDS[2]!).style.height).toBe('60px');
  });

  it('grows the dock past its viewport instead of crushing the palettes', () => {
    // 150 + 90 + 60 = 300 fits exactly; 200 each does not.
    installRO({ layers: 200, colors: 200, brushes: 200 });
    render(<Dock store={new Store()} />);
    expect(zoneBox().style.height).toBe('600px');
    for (const id of IDS) expect(paneBox(id).style.height).toBe('200px');
  });

  it('puts a seam between palettes but not after the last one', () => {
    installRO({ layers: 100, colors: 100, brushes: 100 });
    render(<Dock store={new Store()} />);
    expect(seams()).toHaveLength(2);
  });

  it('a seam drag pins its palette and stops it tracking contents', () => {
    installRO({ layers: 100, colors: 100, brushes: 100 });
    const store = new Store();
    render(<Dock store={store} />);
    fireEvent.keyDown(seams()[0]!, { key: 'ArrowDown' });
    expect(paneBox(IDS[0]!).style.height).toBe('108px');
    expect(paneBox(IDS[1]!).style.height).toBe('92px');
  });

  it('hands a controlled dock the size instead of writing it', () => {
    installRO({ layers: 100, colors: 100, brushes: 100 });
    const store = new Store();
    const onSize = vi.fn();
    render(<Dock store={store} onSize={onSize} />);
    fireEvent.keyDown(seams()[0]!, { key: 'ArrowDown' });
    expect(onSize).toHaveBeenCalledWith(IDS[0], 108);
    expect(store.getNode(IDS[0]!)?.membership?.placement?.size).toBeUndefined();
  });

  it('renders the dock a host drives from its own state', () => {
    installRO({ layers: 100, colors: 100, brushes: 100 });
    function Host() {
      const [sizes, setSizes] = useState<Record<string, number>>({});
      const store = useState(() => new Store())[0];
      return (
        <Provider store={store}>
          <StrategyRegistryProvider strategies={{ strip: stripStrategy as never }}>
            <Zone
              id={DOCK}
              strategyId="strip"
              config={{ axis: 'y', resizable: true, resizeMode: 'neighbor' }}
              viewport={{ w: 200, h: 300 }}
              affordances
            >
              {IDS.map((id) => (
                <Panel
                  key={id}
                  id={id}
                  hints={{ sizing: { h: 'content' }, minSize: { w: 0, h: 40 } }}
                  {...(sizes[id] !== undefined ? { placement: { size: { h: sizes[id] } } } : {})}
                  onPlacementChange={(next) =>
                    setSizes((s) => ({ ...s, [id]: (next.size as { h: number }).h }))
                  }
                />
              ))}
            </Zone>
          </StrategyRegistryProvider>
        </Provider>
      );
    }
    render(<Host />);
    fireEvent.keyDown(seams()[0]!, { key: 'ArrowDown' });
    expect(paneBox(IDS[0]!).style.height).toBe('108px');
  });

  it('survives with no ResizeObserver, at the fallback rather than not at all', () => {
    expect(globalThis.ResizeObserver).toBeUndefined();
    expect(() => render(<Dock store={new Store()} />)).not.toThrow();
    expect(seams()).toHaveLength(2);
  });
});
