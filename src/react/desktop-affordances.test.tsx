import { act, cleanup, fireEvent, render } from '@testing-library/react';
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

  it('renders close and zoom as named buttons, and none for a window with controls: []', () => {
    const { store, hit } = renderDesktop({ controls: ['close', 'zoom'], controlsSide: 'start' });
    act(() => store.patchPlacement(asNodeId('b'), { controls: [] }));
    const heard: unknown[] = [];
    store.events.on('node.closeRequested', (e) => heard.push(e));
    expect(hit('desktop:close:a').tagName).toBe('BUTTON');
    expect(hit('desktop:close:a').getAttribute('aria-label')).toBe('close a');
    expect(hit('desktop:close:b')).toBeNull();
    fireEvent.click(hit('desktop:close:a'));
    expect(heard).toEqual([{ id: 'a', parentId: 'z' }]);
    fireEvent.click(hit('desktop:zoom:a'));
    expect(placementOf(store, 'a')).toMatchObject({ x: 0, y: 0, size: { w: 200, h: 100 } });
    expect(hit('desktop:zoom:a').getAttribute('aria-label')).toBe('restore size a');
  });

  it('raises a clicked window by z-index, leaving the DOM order alone', () => {
    const { store } = renderDesktop({ raise: 'click' });
    const nodes = () =>
      [...document.querySelectorAll<HTMLElement>('[data-node]')].map((el) => el.dataset.node);
    const zOf = (id: string) =>
      document.querySelector<HTMLElement>(`[data-node="${id}"]`)?.style.zIndex;
    expect(nodes()).toEqual(['a', 'b']);
    const a = document.querySelector<HTMLElement>('[data-node="a"]') as HTMLElement;
    fireEvent.click(a);
    expect(store.getNode(ZONE)?.container?.childOrder).toEqual(['b', 'a']);
    // The same element, still in its slot: a press that raises must not move
    // the node it is pressing.
    expect(document.querySelector('[data-node="a"]')).toBe(a);
    expect(nodes()).toEqual(['a', 'b']);
    expect(Number(zOf('a'))).toBeGreaterThan(Number(zOf('b')));
  });

  it('moves a window with the arrow keys on its focused band', () => {
    const { store, hit } = renderDesktop({ drag: true });
    const band = hit('desktop:drag:b');
    expect(band.tabIndex).toBe(0);
    expect(band.getAttribute('aria-label')).toBe('move b');
    expect(band.getAttribute('role')).toBe('button');
    fireEvent.keyDown(band, { key: 'ArrowRight' });
    fireEvent.keyDown(hit('desktop:drag:b'), { key: 'ArrowDown' });
    expect(placementOf(store, 'b')).toMatchObject({ x: 28, y: 8 });
    fireEvent.keyDown(hit('desktop:drag:b'), { key: 'ArrowLeft' });
    fireEvent.keyDown(hit('desktop:drag:b'), { key: 'ArrowUp' });
    expect(placementOf(store, 'b')).toMatchObject({ x: 20, y: 0 });
  });

  it('leaves the arrows of an axis the window cannot move on to bubble', () => {
    const { store, hit } = renderDesktop({ drag: 'x' });
    const down = fireEvent.keyDown(hit('desktop:drag:b'), { key: 'ArrowDown' });
    expect(down).toBe(true);
    expect(placementOf(store, 'b')).toMatchObject({ x: 20, y: 0 });
    const right = fireEvent.keyDown(hit('desktop:drag:b'), { key: 'ArrowRight' });
    expect(right).toBe(false);
    expect(placementOf(store, 'b')).toMatchObject({ x: 28 });
  });

  it('says where a window landed after a key moved it', () => {
    const { hit } = renderDesktop({ drag: true });
    fireEvent.keyDown(hit('desktop:drag:b'), { key: 'ArrowRight' });
    expect(hit('desktop:drag:b').nextElementSibling?.textContent).toBe('b at 28, 0');
    expect(hit('desktop:drag:a').nextElementSibling?.textContent).toBe('');
  });

  it('keeps a band out of the tab order when affordance tab stops are off', () => {
    const { hit } = renderDesktop({ drag: true }, { affordanceTabStops: false });
    expect(hit('desktop:drag:a').tabIndex).toBe(-1);
  });

  it('keeps the toggle out of the tab order when affordance tab stops are off', () => {
    const { hit } = renderDesktop({ minimizable: true }, { affordanceTabStops: false });
    expect(hit('desktop:minimize:a').tabIndex).toBe(-1);
  });
});
