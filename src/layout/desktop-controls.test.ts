import { describe, expect, it } from 'vitest';
import { createNode } from '../constructors.js';
import { nodeToLayoutItem } from '../layout-node-adapter.js';
import type { Affordance, LayoutItem, Size } from '../layout-types.js';
import { asNodeId } from '../node.js';
import { Store } from '../store.js';
import { checkStrategyConfig } from './config-check.js';
import { desktopStrategy } from './desktop.js';
import { shelfStrategy } from './shelf.js';

const Z = asNodeId('z');
const CONTAINER = { w: 400, h: 300 };

interface Win {
  id: string;
  placement?: Record<string, unknown>;
  maxSize?: Size;
}

function desktop(config: Record<string, unknown>, wins: Win[]): Store {
  const s = new Store();
  s.registerNode(createNode({ kind: 'zone', id: Z, container: { strategyId: 'desktop', config } }));
  for (const { id, placement = {}, maxSize } of wins) {
    const nid = asNodeId(id);
    const hints: Record<string, Size> = { preferredSize: { w: 100, h: 80 } };
    if (maxSize) hints.maxSize = maxSize;
    s.registerNode(createNode({ kind: 'window', id: nid, parentId: Z, placement, hints }));
    s.showNode(nid);
  }
  return s;
}

const strategy = desktopStrategy();
const itemsOf = (s: Store): LayoutItem[] => s.getChildren(Z).map((n) => nodeToLayoutItem(n));
const optionsOf = (s: Store) => (s.getNode(Z)?.container?.config ?? {}) as Record<string, unknown>;
const layoutOf = (s: Store) => {
  const items = itemsOf(s);
  const options = optionsOf(s);
  return strategy.layout({
    items,
    container: CONTAINER,
    state: strategy.initialState(items, options),
    options,
  });
};
const clicks = (s: Store) => layoutOf(s).affordances.filter((a) => a.kind === 'click');
const affordance = (s: Store, id: string): Affordance => {
  const aff = layoutOf(s).affordances.find((a) => a.id === id);
  if (!aff) throw new Error(`no affordance ${id}`);
  return aff;
};
const send = (s: Store, id: string, kind: 'click' | 'drag', payload = {}) =>
  strategy.dispatchAffordance?.({
    event: { affordanceId: id, kind, payload },
    affordance: affordance(s, id),
    store: s,
    parentId: Z,
    container: CONTAINER,
    options: optionsOf(s),
    items: itemsOf(s),
  });
const placementOf = (s: Store, id: string) => s.getNode(asNodeId(id))?.membership?.placement ?? {};

describe('desktop window controls', () => {
  it('draws no boxes unless asked, and leaves the band alone', () => {
    const s = desktop({ drag: true }, [{ id: 'a', placement: { x: 10, y: 20 } }]);
    expect(clicks(s)).toEqual([]);
    expect(affordance(s, 'desktop:drag:a').rect).toEqual({ x: 10, y: 20, z: 1, w: 100, h: 22 });
  });

  it('keeps minimizable as one minimize box at the band end', () => {
    const s = desktop({ minimizable: true }, [{ id: 'a', placement: { x: 10, y: 20 } }]);
    expect(clicks(s)).toEqual([
      {
        id: 'desktop:minimize:a',
        kind: 'click',
        rect: { x: 88, y: 20, z: 1, w: 22, h: 22 },
        cursor: 'pointer',
        label: 'minimize',
        childId: 'a',
      },
    ]);
  });

  it('packs the listed boxes against the end in order', () => {
    const s = desktop({ controls: ['close', 'minimize', 'zoom'] }, [
      { id: 'a', placement: { x: 10, y: 20 } },
    ]);
    expect(clicks(s).map((a) => [a.id, a.rect.x, a.label])).toEqual([
      ['desktop:close:a', 44, 'close'],
      ['desktop:minimize:a', 66, 'minimize'],
      ['desktop:zoom:a', 88, 'zoom'],
    ]);
  });

  it("packs them against the start with controlsSide: 'start'", () => {
    const s = desktop({ controls: ['close', 'minimize', 'zoom'], controlsSide: 'start' }, [
      { id: 'a', placement: { x: 10, y: 20 } },
    ]);
    expect(clicks(s).map((a) => a.rect.x)).toEqual([10, 32, 54]);
  });

  it("lets a window's placement.controls override the config, and [] turn them off", () => {
    const s = desktop({ minimizable: true }, [
      { id: 'a', placement: { x: 0, y: 0, controls: [] } },
      { id: 'b', placement: { x: 0, y: 100, controls: ['zoom'] } },
      { id: 'c', placement: { x: 200, y: 0 } },
    ]);
    expect(clicks(s).map((a) => a.id)).toEqual(['desktop:zoom:b', 'desktop:minimize:c']);
  });

  it('drops unknown and repeated entries', () => {
    const s = desktop({ controls: ['zoom', 'shut', 'zoom'] }, [{ id: 'a', placement: {} }]);
    expect(clicks(s).map((a) => a.id)).toEqual(['desktop:zoom:a']);
  });

  it('shares a narrow band between the boxes', () => {
    const s = desktop({ controls: ['close', 'zoom'] }, [
      { id: 'a', placement: { x: 0, y: 0, size: { w: 30, h: 80 } } },
    ]);
    expect(clicks(s).map((a) => a.rect)).toEqual([
      { x: 0, y: 0, z: 1, w: 15, h: 15 },
      { x: 15, y: 0, z: 1, w: 15, h: 15 },
    ]);
  });

  it('restores an iconified window from its icon when controls lists minimize', () => {
    const iconic = desktopStrategy(shelfStrategy);
    const s = desktop({ minimize: 'icon', controls: ['minimize'] }, [
      { id: 'a', placement: { minimized: true } },
    ]);
    const items = itemsOf(s);
    const options = optionsOf(s);
    const r = iconic.layout({
      items,
      container: CONTAINER,
      state: iconic.initialState(items, options),
      options,
    });
    expect(r.affordances.find((a) => a.id === 'desktop:minimize:a')?.label).toBe('restore');
  });

  it('validates controls and controlsSide, and notes that controls outranks minimizable', () => {
    const check = (config: Record<string, unknown>) =>
      checkStrategyConfig('desktop', config, strategy.configSpec ?? {}, strategy.configConflicts);
    expect(check({ controls: ['close'], controlsSide: 'start' })).toEqual([]);
    expect(check({ controls: ['clsoe'] })[0]).toContain('"clsoe"');
    expect(check({ controlsSide: 'left' })[0]).toContain("'start' | 'end'");
    expect(check({ controls: ['zoom'], minimizable: true })).toEqual([
      "desktop: config 'minimizable' is ignored when 'controls' is set",
    ]);
  });
});

describe('desktop close box', () => {
  const closing = (lock?: Record<string, boolean>) => {
    const s = desktop({ controls: ['close'] }, [{ id: 'a', placement: { x: 0, y: 0 } }]);
    if (lock) s.setLock(asNodeId('a'), lock);
    const heard: unknown[] = [];
    s.events.on('node.closeRequested', (e) => heard.push(e));
    send(s, 'desktop:close:a', 'click');
    return { s, heard };
  };

  it('asks the host to close the window, and changes nothing itself', () => {
    const { s, heard } = closing();
    expect(heard).toEqual([{ id: 'a', parentId: 'z' }]);
    expect(s.getNode(asNodeId('a'))?.lifecycle.state).toBe('visible');
  });

  it('refuses under lock.destroy or lock.hide', () => {
    expect(closing({ destroy: true }).heard).toEqual([]);
    expect(closing({ hide: true }).heard).toEqual([]);
  });
});

describe('desktop zoom box', () => {
  it('fills the desktop and saves the rect it replaced; a second press restores it', () => {
    const s = desktop({ controls: ['zoom'] }, [{ id: 'a', placement: { x: 30, y: 40 } }]);
    send(s, 'desktop:zoom:a', 'click');
    expect(placementOf(s, 'a')).toEqual({
      x: 0,
      y: 0,
      size: { w: 400, h: 300 },
      zoomRecord: {
        wrote: { x: 0, y: 0, size: { w: 400, h: 300 } },
        prior: { x: 30, y: 40, size: null },
      },
    });
    expect(layoutOf(s).placements.get('a')).toEqual({ x: 0, y: 0, z: 1, w: 400, h: 300 });
    expect(affordance(s, 'desktop:zoom:a').label).toBe('restore size');
    send(s, 'desktop:zoom:a', 'click');
    expect(placementOf(s, 'a')).toEqual({ x: 30, y: 40 });
    expect(affordance(s, 'desktop:zoom:a').label).toBe('zoom');
  });

  it('gives back a stored size, and saves where a cascaded window showed', () => {
    const s = desktop({ controls: ['zoom'], cascade: 24 }, [
      { id: 'a', placement: { x: 0, y: 0 } },
      { id: 'b', placement: { size: { w: 150, h: 90 } } },
    ]);
    send(s, 'desktop:zoom:b', 'click');
    send(s, 'desktop:zoom:b', 'click');
    expect(placementOf(s, 'b')).toEqual({ x: 0, y: 0, size: { w: 150, h: 90 } });
  });

  it("stops at the window's maxSize", () => {
    const s = desktop({ controls: ['zoom'] }, [
      { id: 'a', placement: { x: 30, y: 40 }, maxSize: { w: 250, h: 1000 } },
    ]);
    send(s, 'desktop:zoom:a', 'click');
    expect(placementOf(s, 'a').size).toEqual({ w: 250, h: 300 });
  });

  it('refuses under lock.move or lock.resize', () => {
    for (const lock of [{ move: true }, { resize: true }]) {
      const s = desktop({ controls: ['zoom'] }, [{ id: 'a', placement: { x: 30, y: 40 } }]);
      s.setLock(asNodeId('a'), lock);
      send(s, 'desktop:zoom:a', 'click');
      expect(placementOf(s, 'a')).toEqual({ x: 30, y: 40 });
    }
  });

  it('unshades a minimized window it zooms', () => {
    const s = desktop({ controls: ['zoom'] }, [
      { id: 'a', placement: { x: 30, y: 40, minimized: true } },
    ]);
    send(s, 'desktop:zoom:a', 'click');
    expect(placementOf(s, 'a').minimized).toBeUndefined();
    expect(layoutOf(s).placements.get('a')?.h).toBe(300);
  });

  it('counts a window resized since as unzoomed, so the next press zooms again', () => {
    const s = desktop({ controls: ['zoom'] }, [{ id: 'a', placement: { x: 30, y: 40 } }]);
    send(s, 'desktop:zoom:a', 'click');
    s.patchPlacement(asNodeId('a'), { size: { w: 200, h: 100 } });
    expect(affordance(s, 'desktop:zoom:a').label).toBe('zoom');
    send(s, 'desktop:zoom:a', 'click');
    expect(placementOf(s, 'a').zoomRecord).toMatchObject({
      prior: { x: 0, y: 0, size: { w: 200, h: 100 } },
    });
  });

  it('restores the size when the title band is dragged, keeping the pointer on the band', () => {
    const s = desktop({ controls: ['zoom'], drag: true }, [
      { id: 'a', placement: { x: 30, y: 40 } },
    ]);
    send(s, 'desktop:zoom:a', 'click');
    // The pointer at the middle of the 400px band, 5 below where it was pressed.
    send(s, 'desktop:drag:a', 'drag', { dx: 10, dy: 5, point: { x: 200, y: 15 } });
    expect(placementOf(s, 'a')).toEqual({ x: 150, y: 5 });
  });

  it('restores from the band corner on a keyboard drag, which has no pointer', () => {
    const s = desktop({ controls: ['zoom'], drag: true }, [
      { id: 'a', placement: { x: 30, y: 40 } },
    ]);
    send(s, 'desktop:zoom:a', 'click');
    send(s, 'desktop:drag:a', 'drag', { dx: 8, dy: 0 });
    expect(placementOf(s, 'a')).toEqual({ x: 8, y: 0 });
  });

  it('only moves a zoomed window under lock.resize', () => {
    const s = desktop({ controls: ['zoom'], drag: true }, [
      { id: 'a', placement: { x: 30, y: 40 } },
    ]);
    send(s, 'desktop:zoom:a', 'click');
    s.setLock(asNodeId('a'), { resize: true });
    send(s, 'desktop:drag:a', 'drag', { dx: 8, dy: 0 });
    expect(placementOf(s, 'a')).toMatchObject({ x: 8, y: 0, size: { w: 400, h: 300 } });
  });

  it('drops the record when the window is resized by an edge', () => {
    const s = desktop({ controls: ['zoom'], resize: true }, [
      { id: 'a', placement: { x: 30, y: 40 } },
    ]);
    send(s, 'desktop:zoom:a', 'click');
    send(s, 'desktop:resize:e:a', 'drag', { dx: -100, dy: 0 });
    expect(placementOf(s, 'a').zoomRecord).toBeUndefined();
    expect(affordance(s, 'desktop:zoom:a').label).toBe('zoom');
  });

  it('drops a stale record on the next drag', () => {
    const s = desktop({ controls: ['zoom'], drag: true }, [
      { id: 'a', placement: { x: 30, y: 40 } },
    ]);
    send(s, 'desktop:zoom:a', 'click');
    s.patchPlacement(asNodeId('a'), { size: { w: 200, h: 100 } });
    send(s, 'desktop:drag:a', 'drag', { dx: 8, dy: 0 });
    expect(placementOf(s, 'a')).toEqual({ x: 8, y: 0, size: { w: 200, h: 100 } });
  });
});
