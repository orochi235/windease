import { act, render, screen } from '@testing-library/react';
import {
  HistoryController,
  type SerializedStore,
  WindeaseStore,
  asWindowId,
  asZoneId,
  gridStrategy,
} from '@windease/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dragCoordinator } from './dnd/dragCoordinator.js';
import { firePointer, installPointerCaptureShim } from './dnd/firePointer.js';
import { WindeaseProvider } from './WindeaseProvider.js';
import { Zone } from './Zone.js';

installPointerCaptureShim();

// jsdom lacks elementsFromPoint; install a stubbable placeholder so vi.spyOn works.
if (!(document as unknown as { elementsFromPoint?: unknown }).elementsFromPoint) {
  Object.defineProperty(document, 'elementsFromPoint', {
    configurable: true,
    writable: true,
    value: () => [] as Element[],
  });
}

function stubRect(el: Element, r: { left: number; top: number; width: number; height: number }): void {
  const rect: DOMRect = {
    left: r.left,
    top: r.top,
    right: r.left + r.width,
    bottom: r.top + r.height,
    width: r.width,
    height: r.height,
    x: r.left,
    y: r.top,
    toJSON: () => ({}),
  } as DOMRect;
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(rect);
}

function mkStore() {
  const s = new WindeaseStore();
  s.registerZone({ id: asZoneId('main'), strategy: gridStrategy, config: { cols: 2 } });
  s.createWindow({ id: asWindowId('a'), kind: 'panel' });
  s.createWindow({ id: asWindowId('b'), kind: 'panel' });
  s.show(asWindowId('a'));
  s.show(asWindowId('b'));
  s.claim(asZoneId('main'), asWindowId('a'));
  s.claim(asZoneId('main'), asWindowId('b'));
  return s;
}

describe('<Zone>', () => {
  afterEach(() => {
    dragCoordinator.end();
    vi.restoreAllMocks();
  });

  it('renders visible windows via render prop with CSS custom props', async () => {
    const store = mkStore();
    render(
      <WindeaseProvider store={store}>
        <div style={{ width: 400, height: 400 }}>
          <Zone id={asZoneId('main')} viewport={{ w: 400, h: 400 }}>
            {(w) => (
              <div data-testid={`w-${w.id}`} data-kind={w.kind}>
                {w.id}
              </div>
            )}
          </Zone>
        </div>
      </WindeaseProvider>,
    );
    expect(screen.getByTestId('w-a')).toBeDefined();
    expect(screen.getByTestId('w-b')).toBeDefined();
  });

  it('omits hidden windows', async () => {
    const store = mkStore();
    await act(async () => {
      store.hide(asWindowId('a'));
      await Promise.resolve();
    });
    render(
      <WindeaseProvider store={store}>
        <Zone id={asZoneId('main')} viewport={{ w: 400, h: 400 }}>
          {(w) => <div data-testid={`w-${w.id}`}>{w.id}</div>}
        </Zone>
      </WindeaseProvider>,
    );
    expect(screen.queryByTestId('w-a')).toBeNull();
    expect(screen.getByTestId('w-b')).toBeDefined();
  });

  it('drag from one zone to another invokes store.moveWindow', () => {
    const store = new WindeaseStore();
    store.registerZone({ id: asZoneId('a'), strategy: gridStrategy, config: {} });
    store.registerZone({ id: asZoneId('b'), strategy: gridStrategy, config: {} });
    const wid = asWindowId('w1');
    store.createWindow({ id: wid, kind: 'panel' });
    store.show(wid);
    store.claim(asZoneId('a'), wid);
    const moveSpy = vi.spyOn(store, 'moveWindow');

    const { container } = render(
      <WindeaseProvider store={store}>
        <div>
          <Zone id={asZoneId('a')} viewport={{ w: 100, h: 100 }}>
            {(w) => <div data-testid={`panel-${w.id}`}>{w.id}</div>}
          </Zone>
          <Zone id={asZoneId('b')} viewport={{ w: 100, h: 100 }}>
            {(w) => <div>{w.id}</div>}
          </Zone>
        </div>
      </WindeaseProvider>,
    );

    const zoneA = container.querySelector('[data-zone-id="a"]') as HTMLElement;
    const zoneB = container.querySelector('[data-zone-id="b"]') as HTMLElement;
    const panel = container.querySelector('[data-window-id="w1"]') as HTMLElement;

    stubRect(zoneA, { left: 0, top: 0, width: 100, height: 100 });
    stubRect(zoneB, { left: 200, top: 0, width: 100, height: 100 });
    stubRect(panel, { left: 0, top: 0, width: 100, height: 100 });

    vi.spyOn(document, 'elementsFromPoint').mockImplementation((x) =>
      x < 150 ? [zoneA] : [zoneB],
    );

    firePointer(panel, 'pointerdown', { clientX: 50, clientY: 50 });
    firePointer(panel, 'pointermove', { clientX: 250, clientY: 50 });
    firePointer(panel, 'pointerup', { clientX: 250, clientY: 50 });

    expect(moveSpy).toHaveBeenCalledWith(wid, asZoneId('b'), 0);
  });

  it('drag within a zone invokes store.reorderInZone with the new order', () => {
    const store = new WindeaseStore();
    store.registerZone({ id: asZoneId('a'), strategy: gridStrategy, config: {} });
    for (const id of ['w1', 'w2'] as const) {
      const w = asWindowId(id);
      store.createWindow({ id: w, kind: 'panel' });
      store.show(w);
      store.claim(asZoneId('a'), w);
    }
    const reorderSpy = vi.spyOn(store, 'reorderInZone');

    const { container } = render(
      <WindeaseProvider store={store}>
        <Zone id={asZoneId('a')} viewport={{ w: 200, h: 100 }}>
          {(w) => <div>{w.id}</div>}
        </Zone>
      </WindeaseProvider>,
    );

    const zoneA = container.querySelector('[data-zone-id="a"]') as HTMLElement;
    const w1 = container.querySelector('[data-window-id="w1"]') as HTMLElement;
    const w2 = container.querySelector('[data-window-id="w2"]') as HTMLElement;

    stubRect(zoneA, { left: 0, top: 0, width: 200, height: 100 });
    stubRect(w1, { left: 0, top: 0, width: 100, height: 100 });
    stubRect(w2, { left: 100, top: 0, width: 100, height: 100 });

    vi.spyOn(document, 'elementsFromPoint').mockReturnValue([zoneA]);

    firePointer(w1, 'pointerdown', { clientX: 50, clientY: 50 });
    firePointer(w1, 'pointermove', { clientX: 180, clientY: 50 });
    firePointer(w1, 'pointerup', { clientX: 180, clientY: 50 });

    expect(reorderSpy).toHaveBeenCalledWith(asZoneId('a'), [asWindowId('w2'), asWindowId('w1')]);
  });

  it('window-drag wraps drop in a single history transaction', () => {
    const store = new WindeaseStore();
    store.registerZone({ id: asZoneId('a'), strategy: gridStrategy, config: {} });
    store.registerZone({ id: asZoneId('b'), strategy: gridStrategy, config: {} });
    const wid = asWindowId('w1');
    store.createWindow({ id: wid, kind: 'panel' });
    store.show(wid);
    store.claim(asZoneId('a'), wid);

    const controller = new HistoryController<SerializedStore>();
    const capture = () => store.snapshot();
    const restore = (snap: SerializedStore) =>
      store.hydrate(snap, { strategies: { grid: gridStrategy } });

    const { container } = render(
      <WindeaseProvider store={store} history={{ controller, capture, restore }}>
        <div>
          <Zone id={asZoneId('a')} viewport={{ w: 100, h: 100 }}>
            {(w) => <div>{w.id}</div>}
          </Zone>
          <Zone id={asZoneId('b')} viewport={{ w: 100, h: 100 }}>
            {(w) => <div>{w.id}</div>}
          </Zone>
        </div>
      </WindeaseProvider>,
    );

    const zoneA = container.querySelector('[data-zone-id="a"]') as HTMLElement;
    const zoneB = container.querySelector('[data-zone-id="b"]') as HTMLElement;
    const panel = container.querySelector('[data-window-id="w1"]') as HTMLElement;

    stubRect(zoneA, { left: 0, top: 0, width: 100, height: 100 });
    stubRect(zoneB, { left: 200, top: 0, width: 100, height: 100 });
    stubRect(panel, { left: 0, top: 0, width: 100, height: 100 });

    vi.spyOn(document, 'elementsFromPoint').mockImplementation((x) =>
      x < 150 ? [zoneA] : [zoneB],
    );

    // Initial state pushed by provider mount
    expect(controller.canUndo()).toBe(false);

    firePointer(panel, 'pointerdown', { clientX: 50, clientY: 50 });
    firePointer(panel, 'pointermove', { clientX: 250, clientY: 50 });
    firePointer(panel, 'pointerup', { clientX: 250, clientY: 50 });

    expect(controller.canUndo()).toBe(true);

    // Undo: should restore window to zone A
    const snap = controller.undo();
    expect(snap).toBeDefined();
    if (snap) restore(snap);
    expect(store.getZone(asZoneId('a'))!.windowIds).toContain(wid);

    // Only one drag-produced entry: undoing again returns undefined
    expect(controller.undo()).toBeUndefined();
    dragCoordinator.end();
  });
});
