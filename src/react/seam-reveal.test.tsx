import { fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { createNode } from '../constructors.js';
import { stripStrategy } from '../index.js';
import { asNodeId } from '../node.js';
import { Store } from '../store.js';
import { type ChromeMap, Container } from './index.js';
import { Provider } from './Provider.js';
import { StrategyRegistryProvider } from './strategies.js';

const SIDE = asNodeId('side');
const AUX = asNodeId('aux');

/** A 600px row of side, editor and aux, with `hidden` already dragged shut. */
function seed(hidden: string[], axis: 'x' | 'y' = 'x') {
  const store = new Store();
  store.registerNode(
    createNode({
      id: asNodeId('root'),
      kind: 'zone',
      container: {
        strategyId: 'strip',
        config: { axis, resizeMode: 'neighbor', fill: true, overshoot: 'hide' },
      },
    }),
  );
  for (const id of ['side', 'editor', 'aux']) {
    store.registerNode(
      createNode({
        id: asNodeId(id),
        kind: 'panel',
        parentId: asNodeId('root'),
        meta: { title: id === 'side' ? 'Explorer' : id },
        hints: { minSize: { w: 80, h: 80 } },
        ...(id === 'editor' ? {} : { placement: { size: { w: 150, h: 150 } } }),
      }),
    );
    store.showNode(asNodeId(id));
  }
  for (const id of hidden) store.hideNode(asNodeId(id));
  return store;
}

const CHROME: ChromeMap = {
  panel: ({ node }) => <div data-testid={`p-${node.id}`}>{String(node.id)}</div>,
};

function mount(store: Store, id: string, axis: 'x' | 'y' = 'x') {
  const { container } = render(
    <Provider store={store}>
      <StrategyRegistryProvider strategies={{ strip: stripStrategy } as never}>
        <Container
          parentId={asNodeId('root')}
          chrome={CHROME}
          viewport={{ w: 600, h: 600 }}
          affordances
        />
      </StrategyRegistryProvider>
    </Provider>,
  );
  const handle = container.querySelector(`[data-affordance-hit="reveal-${axis}-${id}"]`);
  if (!handle) throw new Error(`no handle for ${id}`);
  return { container, handle: handle as HTMLElement };
}

const down = (el: HTMLElement) =>
  fireEvent.pointerDown(el, { pointerId: 1, clientX: 0, clientY: 0 });
const moveTo = (el: HTMLElement, x: number, y = 0) =>
  fireEvent.pointerMove(el, { pointerId: 1, clientX: x, clientY: y });
const up = (el: HTMLElement, x: number, y = 0) =>
  fireEvent.pointerUp(el, { pointerId: 1, clientX: x, clientY: y });
const armed = (el: HTMLElement) => el.getAttribute('data-reveal-armed');
const stateOf = (store: Store, id: typeof SIDE) => store.getNode(id)?.lifecycle.state;

describe('reveal handle — pointer', () => {
  let store: Store;
  beforeEach(() => {
    store = seed(['side']);
  });

  it('shows the pane when released past the threshold, at the size it had', () => {
    const { container, handle } = mount(store, 'side');
    down(handle);
    moveTo(handle, 30);
    expect(armed(handle)).toBe('true');
    up(handle, 30);
    expect(stateOf(store, SIDE)).toBe('visible');
    expect(container.querySelector('[data-node="side"]')).not.toBeNull();
    expect((store.getPlacement(SIDE).size as { w: number }).w).toBe(150);
  });

  it('leaves the pane hidden when released inside the threshold', () => {
    const { handle } = mount(store, 'side');
    down(handle);
    moveTo(handle, 20);
    expect(armed(handle)).toBeNull();
    up(handle, 20);
    expect(stateOf(store, SIDE)).toBe('hidden');
  });

  it('disarms when dragged back, and then shows nothing', () => {
    const { handle } = mount(store, 'side');
    down(handle);
    moveTo(handle, 60);
    moveTo(handle, 5);
    expect(armed(handle)).toBeNull();
    up(handle, 5);
    expect(stateOf(store, SIDE)).toBe('hidden');
  });

  it('shows nothing when the gesture is canceled while armed', () => {
    const { handle } = mount(store, 'side');
    down(handle);
    moveTo(handle, 60);
    fireEvent.pointerCancel(handle, { pointerId: 1 });
    expect(armed(handle)).toBeNull();
    expect(stateOf(store, SIDE)).toBe('hidden');
  });

  it('shows nothing when Escape is pressed while armed', () => {
    const { handle } = mount(store, 'side');
    down(handle);
    moveTo(handle, 60);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(armed(handle)).toBeNull();
    up(handle, 60);
    expect(stateOf(store, SIDE)).toBe('hidden');
  });

  it('writes no size while it is dragged', () => {
    const { handle } = mount(store, 'side');
    const sizes = () =>
      JSON.stringify(store.getChildren(asNodeId('root')).map((n) => store.getPlacement(n.id)));
    const before = sizes();
    down(handle);
    moveTo(handle, 60);
    expect(sizes()).toBe(before);
    up(handle, 60);
  });

  it('says the pane will show while armed', () => {
    const { container, handle } = mount(store, 'side');
    down(handle);
    moveTo(handle, 60);
    expect(container.querySelector('[data-reveal-live]')?.textContent).toBe(
      'Explorer will show. Release to confirm, Escape to cancel.',
    );
    up(handle, 60);
  });
});

describe('reveal handle — direction', () => {
  it('opens a pane hidden at the end of a full row by dragging back from the end', () => {
    const store = seed(['aux']);
    const { handle } = mount(store, 'aux');
    down(handle);
    moveTo(handle, 60);
    expect(armed(handle)).toBeNull();
    moveTo(handle, -30);
    expect(armed(handle)).toBe('true');
    up(handle, -30);
    expect(stateOf(store, AUX)).toBe('visible');
  });

  it('reads vertical travel in a column', () => {
    const store = seed(['side'], 'y');
    const { handle } = mount(store, 'side', 'y');
    down(handle);
    moveTo(handle, 60, 0);
    expect(armed(handle)).toBeNull();
    moveTo(handle, 60, 30);
    expect(armed(handle)).toBe('true');
    up(handle, 60, 30);
    expect(stateOf(store, SIDE)).toBe('visible');
  });
});

describe('reveal handle — hit area', () => {
  // Focusing a box that overhangs the zone scrolls the zone, clipped or not.
  it.each([
    ['side', 'the head'],
    ['aux', 'the end'],
  ])('keeps the handle for %s inside the container at %s of the row', (id) => {
    const { handle } = mount(seed([id]), id);
    const left = Number.parseFloat(handle.style.left);
    const width = Number.parseFloat(handle.style.width);
    expect(width).toBeGreaterThan(4);
    expect(left).toBeGreaterThanOrEqual(0);
    expect(left + width).toBeLessThanOrEqual(600);
  });
});

describe('reveal handle — keyboard', () => {
  it('is a button named for the pane it shows', () => {
    const { handle } = mount(seed(['side']), 'side');
    expect(handle.tagName).toBe('BUTTON');
    expect(handle.getAttribute('aria-label')).toBe('show Explorer');
    expect(handle.getAttribute('tabindex')).toBe('0');
  });

  it.each(['Enter', ' '])('shows the pane on %j', (key) => {
    const store = seed(['side']);
    const { handle } = mount(store, 'side');
    fireEvent.keyDown(handle, { key });
    expect(stateOf(store, SIDE)).toBe('visible');
  });

  it('does nothing on a pointer click', () => {
    const store = seed(['side']);
    const { handle } = mount(store, 'side');
    fireEvent.click(handle);
    expect(stateOf(store, SIDE)).toBe('hidden');
  });

  it('leaves other keys to the host', () => {
    const store = seed(['side']);
    const { handle } = mount(store, 'side');
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(stateOf(store, SIDE)).toBe('hidden');
  });
});
