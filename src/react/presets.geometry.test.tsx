import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GeometrySource } from '../index.js';
import { asNodeId, Store, stripStrategy } from '../index.js';
import { FocusProvider } from './focus/FocusProvider.js';
import { GeometryProvider, useGeometrySource } from './focus/useGeometrySource.js';
import { Provider } from './Provider.js';
import { Panel, Zone } from './presets.js';
import { StrategyRegistryProvider } from './strategies.js';

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** jsdom reports every element at the page origin, so each preset's box is
 *  stubbed by the `data-node` id its own div carries. */
function stubRects(boxes: Record<string, Box>) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const id = this.getAttribute('data-node') ?? '';
    const b = boxes[id] ?? { x: 0, y: 0, w: 0, h: 0 };
    return {
      x: b.x,
      y: b.y,
      left: b.x,
      top: b.y,
      right: b.x + b.w,
      bottom: b.y + b.h,
      width: b.w,
      height: b.h,
      toJSON: () => ({}),
    } as DOMRect;
  });
}

function Probe({ onSource }: { onSource: (g: GeometrySource) => void }) {
  onSource(useGeometrySource());
  return null;
}

const ZONE = asNodeId('decl-zone');
const A = asNodeId('decl-a');
const B = asNodeId('decl-b');

function mount(opts: { focus?: boolean } = {}): {
  geometry: GeometrySource;
  container: HTMLElement;
} {
  const store = new Store();
  let geometry: GeometrySource | null = null;
  const wrap = (tree: ReactNode) => (opts.focus ? <FocusProvider>{tree}</FocusProvider> : tree);
  const view = render(
    <Provider store={store}>
      <StrategyRegistryProvider strategies={{ strip: stripStrategy as never }}>
        <GeometryProvider>
          {wrap(
            <>
              <Zone
                id={ZONE}
                strategyId="strip"
                config={{ axis: 'y', fill: true }}
                viewport={{ w: 100, h: 200 }}
              >
                <Panel id={A} />
                <Panel id={B} />
              </Zone>
              <Probe
                onSource={(g) => {
                  geometry = g;
                }}
              />
            </>,
          )}
        </GeometryProvider>
      </StrategyRegistryProvider>
    </Provider>,
  );
  if (!geometry) throw new Error('Probe never rendered');
  return { geometry: geometry as GeometrySource, container: view.container };
}

beforeEach(() => {
  stubRects({ [String(ZONE)]: { x: 40, y: 10, w: 100, h: 200 } });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('preset geometry', () => {
  it('publishes a preset root own rect in document coordinates', () => {
    const { geometry } = mount();
    expect(geometry.rectOf(ZONE)).toEqual({ x: 40, y: 10, w: 100, h: 200 });
  });

  it('composes preset panes against that origin', () => {
    const { geometry } = mount();
    expect(geometry.rectOf(A)).toEqual({ x: 40, y: 10, w: 100, h: 100 });
    expect(geometry.rectOf(B)).toEqual({ x: 40, y: 110, w: 100, h: 100 });
  });

  it('gives the first preset pane the tab stop, so a keyboard user can enter', () => {
    const { container } = mount({ focus: true });
    expect(container.querySelector(`[data-node="${A}"]`)?.getAttribute('tabindex')).toBe('0');
    expect(container.querySelector(`[data-node="${B}"]`)?.getAttribute('tabindex')).toBe('-1');
    // A zone declares no `focus`, so it is not a stop at all.
    expect(container.querySelector(`[data-node="${ZONE}"]`)?.getAttribute('tabindex')).toBeNull();
  });
});
