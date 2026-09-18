import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { asNodeId, createNode, desktopStrategy, Store } from '../index.js';
import { type ChromeMap, Container } from './index.js';
import { Provider } from './Provider.js';
import { StrategyRegistryProvider } from './strategies.js';

afterEach(cleanup);

const ZONE = asNodeId('z');
const CHROME: ChromeMap = { window: ({ node }) => <div>{String(node.id)}</div> };
const STRATEGIES = { desktop: desktopStrategy() as never };

function renderDesktop(
  config: Record<string, unknown>,
  props: { affordanceTabStops?: boolean } = {},
) {
  const store = new Store();
  store.registerNode(
    createNode({ kind: 'zone', id: ZONE, container: { strategyId: 'desktop', config } }),
  );
  for (const [id, x] of [
    ['a', 0],
    ['b', 20],
  ] as const) {
    store.registerNode(
      createNode({
        kind: 'window',
        id: asNodeId(id),
        parentId: ZONE,
        placement: { x, y: 0 },
        hints: { preferredSize: { w: 50, h: 50 } },
        meta: { title: id },
      }),
    );
    store.showNode(asNodeId(id));
  }
  const view = render(
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <Container
          parentId={ZONE}
          chrome={CHROME}
          viewport={{ w: 200, h: 100 }}
          affordances
          {...props}
        />
      </StrategyRegistryProvider>
    </Provider>,
  );
  const hit = (id: string) =>
    view.container.querySelector(`[data-affordance-hit="${id}"]`) as HTMLElement;
  return { store, hit };
}

const placementOf = (store: Store, id: string) =>
  store.getNode(asNodeId(id))?.membership?.placement ?? {};

describe('desktop affordances in <Container>', () => {
  it("draws each window's drag band at that window's depth", () => {
    const { hit } = renderDesktop({ drag: true });
    expect(hit('desktop:drag:a').style.zIndex).toBe('1');
    expect(hit('desktop:drag:b').style.zIndex).toBe('2');
  });

  it('moves a window by a pointer drag on its band', () => {
    const { store, hit } = renderDesktop({ drag: true });
    const band = hit('desktop:drag:b');
    fireEvent.pointerDown(band, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(band, { clientX: 25, clientY: 18, pointerId: 1 });
    fireEvent.pointerUp(band, { clientX: 25, clientY: 18, pointerId: 1 });
    expect(placementOf(store, 'b')).toMatchObject({ x: 35, y: 8 });
  });

  it('renders the minimize toggle as a named button that a click flips', () => {
    const { store, hit } = renderDesktop({ minimizable: true });
    const box = hit('desktop:minimize:a');
    expect(box.tagName).toBe('BUTTON');
    expect(box.getAttribute('aria-label')).toBe('minimize a');
    fireEvent.click(box);
    expect(placementOf(store, 'a').minimized).toBe(true);
    expect(hit('desktop:minimize:a').getAttribute('aria-label')).toBe('restore a');
  });

  it('keeps the toggle out of the tab order when affordance tab stops are off', () => {
    const { hit } = renderDesktop({ minimizable: true }, { affordanceTabStops: false });
    expect(hit('desktop:minimize:a').tabIndex).toBe(-1);
  });
});
