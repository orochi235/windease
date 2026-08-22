import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { asNodeId, createNode, Store, stripStrategy } from '../index.js';
import { Container } from './Container.js';
import { Provider } from './Provider.js';
import { StrategyRegistryProvider } from './strategies.js';

const Z = asNodeId('z');

function makeStore(titles = true): Store {
  const s = new Store();
  s.registerNode(
    createNode({
      kind: 'zone',
      container: { strategyId: 'strip', config: { axis: 'y', resizeMode: 'neighbor' } },
      id: Z,
    }),
  );
  s.showNode(Z);
  for (const [i, c] of ['a', 'b'].entries()) {
    const nid = asNodeId(c);
    s.registerNode(
      createNode({
        kind: 'palette',
        id: nid,
        parentId: Z,
        ...(titles ? { meta: { title: `Palette ${i + 1}` } } : {}),
        hints: { minSize: { w: 0, h: 20 } },
      }),
    );
    s.showNode(nid);
    s.patchPlacement(nid, { size: { h: 100 } });
  }
  return s;
}

function tree(store: Store, props: Record<string, unknown> = {}) {
  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={{ strip: stripStrategy as never }}>
        <Container parentId={Z} chrome={{}} viewport={{ w: 200, h: 400 }} affordances {...props} />
      </StrategyRegistryProvider>
    </Provider>
  );
}

const gutter = (c: HTMLElement) => c.querySelector('[role="separator"]') as HTMLElement;

const sizeH = (store: Store, id: string) =>
  (store.getNode(asNodeId(id))?.membership?.placement?.size as { h?: number } | undefined)?.h;

describe('gutter keyboard resize', () => {
  it('exposes the ARIA a splitter needs', () => {
    const { container } = render(tree(makeStore()));
    const g = gutter(container);
    expect(g).not.toBeNull();
    expect(g.getAttribute('aria-orientation')).toBe('vertical');
    expect(g.getAttribute('aria-valuenow')).toBe('100');
    expect(g.getAttribute('tabindex')).toBe('0');
  });

  it('names itself from the panes it moves', () => {
    const { container } = render(tree(makeStore()));
    expect(gutter(container).getAttribute('aria-label')).toBe('resize Palette 1 and Palette 2');
  });

  it('falls back to the focus system naming when no title is set', () => {
    const { container } = render(tree(makeStore(false)));
    expect(gutter(container).getAttribute('aria-label')).toBe('resize palette 1 and palette 2');
  });

  it('steps the pane on the arrow key along its orientation', () => {
    const store = makeStore();
    const { container } = render(tree(store));
    fireEvent.keyDown(gutter(container), { key: 'ArrowDown' });
    expect(store.getNode(asNodeId('a'))?.membership?.placement?.size).toEqual({ h: 108 });
  });

  it('honors a custom step', () => {
    const store = makeStore();
    const { container } = render(tree(store, { affordanceKeyStep: 25 }));
    fireEvent.keyDown(gutter(container), { key: 'ArrowUp' });
    expect(store.getNode(asNodeId('a'))?.membership?.placement?.size).toEqual({ h: 75 });
  });

  it('ignores the perpendicular arrows so pane navigation still works', () => {
    const store = makeStore();
    const { container } = render(tree(store));
    const before = store.getNode(asNodeId('a'))?.membership?.placement?.size;
    fireEvent.keyDown(gutter(container), { key: 'ArrowLeft' });
    fireEvent.keyDown(gutter(container), { key: 'ArrowRight' });
    expect(store.getNode(asNodeId('a'))?.membership?.placement?.size).toEqual(before);
  });

  it('jumps to the reported bounds on Home and End', () => {
    const store = makeStore();
    const { container } = render(tree(store));
    const max = Number(gutter(container).getAttribute('aria-valuemax'));
    fireEvent.keyDown(gutter(container), { key: 'End' });
    expect(sizeH(store, 'a')).toBe(max);
    fireEvent.keyDown(gutter(container), { key: 'Home' });
    expect(sizeH(store, 'a')).toBe(20);
  });

  it('keeps the ARIA but drops the tab stop when asked', () => {
    const { container } = render(tree(makeStore(), { affordanceTabStops: false }));
    const g = gutter(container);
    expect(g.getAttribute('aria-orientation')).toBe('vertical');
    expect(g.getAttribute('tabindex')).toBeNull();
  });

  it('renders no separator for a resize-locked pane', () => {
    // The host filters locked affordances out of the layout, so there is no
    // handle to focus — the keyboard path inherits the suppression instead of
    // re-checking the lock.
    const store = makeStore();
    store.setLock(asNodeId('a'), { resize: true });
    const { container } = render(tree(store));
    expect(container.querySelector('[role="separator"]')).toBeNull();
  });
});
