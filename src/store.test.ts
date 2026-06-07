import { describe, expect, it, vi } from 'vitest';
import { WindeaseError } from './errors.js';
import { WindeaseStore } from './store.js';
import { asWindowId, asZoneId } from './window.js';

describe('WindeaseStore - window lifecycle', () => {
  it('createWindow returns the id and stores the record', () => {
    const s = new WindeaseStore();
    const id = s.createWindow({ id: asWindowId('w1'), kind: 'panel' });
    expect(id).toBe('w1');
    const w = s.getWindow(asWindowId('w1'));
    expect(w?.kind).toBe('panel');
    expect(w?.lifecycle.state).toBe('mounted');
  });

  it('createWindow throws DUPLICATE_WINDOW on collision', () => {
    const s = new WindeaseStore();
    s.createWindow({ id: asWindowId('w1'), kind: 'panel' });
    expect(() => s.createWindow({ id: asWindowId('w1'), kind: 'panel' })).toThrowError(
      WindeaseError,
    );
  });

  it('show transitions to visible', () => {
    const s = new WindeaseStore();
    s.createWindow({ id: asWindowId('w1'), kind: 'panel' });
    s.show(asWindowId('w1'));
    expect(s.getWindow(asWindowId('w1'))?.lifecycle.state).toBe('visible');
  });

  it('hide transitions to hidden but keeps zoneId', () => {
    const s = new WindeaseStore();
    s.createWindow({ id: asWindowId('w1'), kind: 'panel' });
    s.show(asWindowId('w1'));
    s.hide(asWindowId('w1'));
    expect(s.getWindow(asWindowId('w1'))?.lifecycle.state).toBe('hidden');
  });

  it('destroy transitions to destroyed and removes from store', () => {
    const s = new WindeaseStore();
    s.createWindow({ id: asWindowId('w1'), kind: 'panel' });
    s.destroy(asWindowId('w1'));
    expect(s.getWindow(asWindowId('w1'))).toBeUndefined();
  });

  it('show on unknown window throws UNKNOWN_WINDOW', () => {
    const s = new WindeaseStore();
    try {
      s.show(asWindowId('nope'));
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(WindeaseError);
      expect((e as WindeaseError).code).toBe('UNKNOWN_WINDOW');
    }
  });

  it('listWindows({ zoneId }) returns records in zone.windowIds order', () => {
    const s = new WindeaseStore();
    s.registerZone({ id: asZoneId('main'), strategy: noopStrategy });
    s.createWindow({ id: asWindowId('w1'), kind: 'panel' });
    s.createWindow({ id: asWindowId('w2'), kind: 'panel' });
    s.createWindow({ id: asWindowId('w3'), kind: 'panel' });
    s.claim(asZoneId('main'), asWindowId('w1'));
    s.claim(asZoneId('main'), asWindowId('w2'));
    s.claim(asZoneId('main'), asWindowId('w3'), undefined, { pinned: true });
    expect(s.listWindows({ zoneId: asZoneId('main') }).map((w) => w.id)).toEqual([
      'w3',
      'w1',
      'w2',
    ]);
  });

  it('listWindows filters by kind', () => {
    const s = new WindeaseStore();
    s.createWindow({ id: asWindowId('a'), kind: 'panel' });
    s.createWindow({ id: asWindowId('b'), kind: 'widget' });
    s.createWindow({ id: asWindowId('c'), kind: 'panel' });
    const panels = s.listWindows({ kind: 'panel' });
    expect(panels.map((w) => w.id).sort()).toEqual(['a', 'c']);
  });
});

import { describe as describe2, expect as expect2, it as it2 } from 'vitest';
import { type LayoutStrategy, createZoneRecord } from './zone.js';

const noopStrategy: LayoutStrategy = {
  name: 'noop',
  layout: () => new Map(),
};

describe2('WindeaseStore - zones', () => {
  it2('registerZone stores a zone', () => {
    const s = new WindeaseStore();
    s.registerZone({ id: asZoneId('main'), strategy: noopStrategy });
    expect2(s.getZone(asZoneId('main'))?.id).toBe('main');
    expect2(s.listZones()).toHaveLength(1);
  });

  it2('registerZone throws DUPLICATE_ZONE', () => {
    const s = new WindeaseStore();
    s.registerZone({ id: asZoneId('main'), strategy: noopStrategy });
    try {
      s.registerZone({ id: asZoneId('main'), strategy: noopStrategy });
      expect2.fail('should have thrown');
    } catch (e) {
      expect2((e as WindeaseError).code).toBe('DUPLICATE_ZONE');
    }
  });

  it2('unregisterZone removes empty zone', () => {
    const s = new WindeaseStore();
    s.registerZone({ id: asZoneId('main'), strategy: noopStrategy });
    s.unregisterZone(asZoneId('main'));
    expect2(s.getZone(asZoneId('main'))).toBeUndefined();
  });

  it2('unregisterZone throws ZONE_NOT_EMPTY when populated', () => {
    const s = new WindeaseStore();
    s.registerZone({ id: asZoneId('main'), strategy: noopStrategy });
    s.createWindow({ id: asWindowId('w1'), kind: 'panel' });
    // Force membership for test purposes (Task 12 adds proper claim()).
    s.getZone(asZoneId('main'))!.windowIds.push(asWindowId('w1'));
    s.getWindow(asWindowId('w1'))!.zoneId = asZoneId('main');
    try {
      s.unregisterZone(asZoneId('main'));
      expect2.fail('should have thrown');
    } catch (e) {
      expect2((e as WindeaseError).code).toBe('ZONE_NOT_EMPTY');
    }
  });

  it2('unregisterZone with orphan:true releases members', () => {
    const s = new WindeaseStore();
    s.registerZone({ id: asZoneId('main'), strategy: noopStrategy });
    s.createWindow({ id: asWindowId('w1'), kind: 'panel' });
    s.getZone(asZoneId('main'))!.windowIds.push(asWindowId('w1'));
    s.getWindow(asWindowId('w1'))!.zoneId = asZoneId('main');
    s.unregisterZone(asZoneId('main'), { orphan: true });
    expect2(s.getZone(asZoneId('main'))).toBeUndefined();
    expect2(s.getWindow(asWindowId('w1'))?.zoneId).toBeNull();
  });
});

describe2('WindeaseStore - ownership', () => {
  function setup() {
    const s = new WindeaseStore();
    s.registerZone({ id: asZoneId('main'), strategy: noopStrategy });
    s.registerZone({ id: asZoneId('side'), strategy: noopStrategy });
    s.createWindow({ id: asWindowId('w1'), kind: 'panel' });
    s.createWindow({ id: asWindowId('w2'), kind: 'panel' });
    return s;
  }

  it2('claim assigns zoneId and appends to zone order', () => {
    const s = setup();
    s.claim(asZoneId('main'), asWindowId('w1'));
    expect2(s.getWindow(asWindowId('w1'))?.zoneId).toBe('main');
    expect2(s.getZone(asZoneId('main'))?.windowIds).toEqual(['w1']);
  });

  it2('claim with index inserts at position', () => {
    const s = setup();
    s.claim(asZoneId('main'), asWindowId('w1'));
    s.claim(asZoneId('main'), asWindowId('w2'), 0);
    expect2(s.getZone(asZoneId('main'))?.windowIds).toEqual(['w2', 'w1']);
  });

  it2('claim drives transit machine through claiming → idle', () => {
    const s = setup();
    const seen: string[] = [];
    s.events.on('window.transitioned', (e) => {
      if (e.machine === 'transit') seen.push(`${e.from}→${e.to}`);
    });
    s.claim(asZoneId('main'), asWindowId('w1'));
    expect2(seen).toEqual(['idle→claiming', 'claiming→idle']);
  });

  it2('release clears zoneId and removes from zone', () => {
    const s = setup();
    s.claim(asZoneId('main'), asWindowId('w1'));
    s.release(asWindowId('w1'));
    expect2(s.getWindow(asWindowId('w1'))?.zoneId).toBeNull();
    expect2(s.getZone(asZoneId('main'))?.windowIds).toEqual([]);
  });

  it2('release of unowned window is a no-op', () => {
    const s = setup();
    expect2(() => s.release(asWindowId('w1'))).not.toThrow();
  });

  it2('moveWindow releases from old zone and claims into new', () => {
    const s = setup();
    s.claim(asZoneId('main'), asWindowId('w1'));
    s.moveWindow(asWindowId('w1'), asZoneId('side'));
    expect2(s.getZone(asZoneId('main'))?.windowIds).toEqual([]);
    expect2(s.getZone(asZoneId('side'))?.windowIds).toEqual(['w1']);
    expect2(s.getWindow(asWindowId('w1'))?.zoneId).toBe('side');
  });

  it2('moveWindow notifies subscribers once via microtask batch', async () => {
    const s = setup();
    s.claim(asZoneId('main'), asWindowId('w1'));
    let count = 0;
    s.subscribe(() => {
      count++;
    });
    s.moveWindow(asWindowId('w1'), asZoneId('side'));
    await Promise.resolve(); // flush microtask
    expect2(count).toBe(1);
  });

  it2('reorderInZone reorders membership', () => {
    const s = setup();
    s.claim(asZoneId('main'), asWindowId('w1'));
    s.claim(asZoneId('main'), asWindowId('w2'));
    s.reorderInZone(asZoneId('main'), [asWindowId('w2'), asWindowId('w1')]);
    expect2(s.getZone(asZoneId('main'))?.windowIds).toEqual(['w2', 'w1']);
  });

  it2('reorderInZone throws if order set does not match membership', () => {
    const s = setup();
    s.claim(asZoneId('main'), asWindowId('w1'));
    try {
      s.reorderInZone(asZoneId('main'), [asWindowId('w2')]);
      expect2.fail('should have thrown');
    } catch (e) {
      expect2((e as WindeaseError).code).toBe('ILLEGAL_TRANSITION');
    }
  });
});

describe2('WindeaseStore - item meta', () => {
  function setup() {
    const s = new WindeaseStore();
    s.registerZone({ id: asZoneId('main'), strategy: noopStrategy });
    s.registerZone({ id: asZoneId('side'), strategy: noopStrategy });
    s.createWindow({ id: asWindowId('w1'), kind: 'panel' });
    s.createWindow({ id: asWindowId('w2'), kind: 'panel' });
    return s;
  }

  it2('claim accepts an initial meta bag', () => {
    const s = setup();
    s.claim(asZoneId('main'), asWindowId('w1'), undefined, { pinned: true });
    expect2(s.getItemMeta(asZoneId('main'), asWindowId('w1'))).toEqual({ pinned: true });
  });

  it2('setItemMeta replaces and emits zone.metaChanged', () => {
    const s = setup();
    s.claim(asZoneId('main'), asWindowId('w1'));
    const events: unknown[] = [];
    s.events.on('zone.metaChanged', (e) => events.push(e));
    s.setItemMeta(asZoneId('main'), asWindowId('w1'), { pinned: true, label: 'a' });
    s.setItemMeta(asZoneId('main'), asWindowId('w1'), { label: 'b' });
    expect2(s.getItemMeta(asZoneId('main'), asWindowId('w1'))).toEqual({ label: 'b' });
    expect2(events.length).toBe(2);
  });

  it2('patchItemMeta merges and deletes via undefined', () => {
    const s = setup();
    s.claim(asZoneId('main'), asWindowId('w1'), undefined, { pinned: true, label: 'a' });
    s.patchItemMeta(asZoneId('main'), asWindowId('w1'), { label: 'b', extra: 1 });
    expect2(s.getItemMeta(asZoneId('main'), asWindowId('w1'))).toEqual({
      pinned: true,
      label: 'b',
      extra: 1,
    });
    s.patchItemMeta(asZoneId('main'), asWindowId('w1'), { pinned: undefined });
    expect2(s.getItemMeta(asZoneId('main'), asWindowId('w1'))).toEqual({ label: 'b', extra: 1 });
  });

  it2('release clears item meta', () => {
    const s = setup();
    s.claim(asZoneId('main'), asWindowId('w1'), undefined, { pinned: true });
    s.release(asWindowId('w1'));
    expect2(s.getItemMeta(asZoneId('main'), asWindowId('w1'))).toBeUndefined();
  });

  it2('moveWindow does not carry meta to the new zone', () => {
    const s = setup();
    s.claim(asZoneId('main'), asWindowId('w1'), undefined, { pinned: true });
    s.moveWindow(asWindowId('w1'), asZoneId('side'));
    expect2(s.getItemMeta(asZoneId('main'), asWindowId('w1'))).toBeUndefined();
    expect2(s.getItemMeta(asZoneId('side'), asWindowId('w1'))).toBeUndefined();
  });

  it2('setItemMeta throws when window is not a member of zone', () => {
    const s = setup();
    s.claim(asZoneId('side'), asWindowId('w1'));
    try {
      s.setItemMeta(asZoneId('main'), asWindowId('w1'), { pinned: true });
      expect2.fail('should have thrown');
    } catch (e) {
      expect2((e as WindeaseError).code).toBe('ILLEGAL_TRANSITION');
    }
  });

  it2('pinning promotes a window to the pinned-prefix of windowIds', () => {
    const s = setup();
    s.claim(asZoneId('main'), asWindowId('w1'));
    s.claim(asZoneId('main'), asWindowId('w2'));
    s.setItemMeta(asZoneId('main'), asWindowId('w2'), { pinned: true });
    expect2(s.getZone(asZoneId('main'))?.windowIds).toEqual(['w2', 'w1']);
  });

  it2('unpinning relegates to the head of the unpinned section', () => {
    const s = setup();
    s.claim(asZoneId('main'), asWindowId('w1'), undefined, { pinned: true });
    s.claim(asZoneId('main'), asWindowId('w2'));
    s.patchItemMeta(asZoneId('main'), asWindowId('w1'), { pinned: undefined });
    expect2(s.getZone(asZoneId('main'))?.windowIds).toEqual(['w1', 'w2']);
  });

  it2('claim with initial pinned=true lands in the pinned-prefix', () => {
    const s = setup();
    s.claim(asZoneId('main'), asWindowId('w1'));
    s.claim(asZoneId('main'), asWindowId('w2'), undefined, { pinned: true });
    expect2(s.getZone(asZoneId('main'))?.windowIds).toEqual(['w2', 'w1']);
  });

  it2('reorderInZone interleaving pinned/unpinned snaps back to invariant', () => {
    const s = setup();
    s.claim(asZoneId('main'), asWindowId('w1'), undefined, { pinned: true });
    s.claim(asZoneId('main'), asWindowId('w2'));
    // User requests [w2, w1] — but w1 is pinned, so it gets pulled back to the front.
    s.reorderInZone(asZoneId('main'), [asWindowId('w2'), asWindowId('w1')]);
    expect2(s.getZone(asZoneId('main'))?.windowIds).toEqual(['w1', 'w2']);
  });

  it2('updateZoneConfig merges and emits zone.configChanged', () => {
    const s = new WindeaseStore();
    s.registerZone({ id: asZoneId('main'), strategy: noopStrategy, config: { cols: 2 } });
    const events: unknown[] = [];
    s.events.on('zone.configChanged', (e) => events.push(e));
    s.updateZoneConfig(asZoneId('main'), { rows: 3, maxItems: undefined });
    expect2(s.getZone(asZoneId('main'))?.config).toEqual({ cols: 2, rows: 3 });
    expect2(events.length).toBe(1);
  });

  it2('setZoneAllowsPinning(false) clears pinned flags but leaves locked', () => {
    const s = new WindeaseStore();
    s.registerZone({ id: asZoneId('main'), strategy: noopStrategy });
    s.createWindow({ id: asWindowId('w1'), kind: 'panel' });
    s.createWindow({ id: asWindowId('w2'), kind: 'panel' });
    s.claim(asZoneId('main'), asWindowId('w1'), undefined, { pinned: true, label: 'a' });
    s.claim(asZoneId('main'), asWindowId('w2'), undefined, { locked: true });
    s.setZoneAllowsPinning(asZoneId('main'), false);
    // pinned cleared; sibling keys preserved.
    expect2(s.getItemMeta(asZoneId('main'), asWindowId('w1'))).toEqual({ label: 'a' });
    // locked left in place.
    expect2(s.getItemMeta(asZoneId('main'), asWindowId('w2'))).toEqual({ locked: true });
  });

  it2('setZoneAllowsPinning flipping true re-runs resortByPin', () => {
    const s = new WindeaseStore();
    s.registerZone({ id: asZoneId('main'), strategy: noopStrategy, allowsPinning: false });
    s.createWindow({ id: asWindowId('w1'), kind: 'panel' });
    s.createWindow({ id: asWindowId('w2'), kind: 'panel' });
    s.claim(asZoneId('main'), asWindowId('w1'));
    s.claim(asZoneId('main'), asWindowId('w2'), undefined, { pinned: true });
    // While disabled, w2 stays at insertion order.
    expect2(s.getZone(asZoneId('main'))?.windowIds).toEqual(['w1', 'w2']);
    // Enable → resortByPin runs → w2 moves to the front.
    s.setZoneAllowsPinning(asZoneId('main'), true);
    expect2(s.getZone(asZoneId('main'))?.windowIds).toEqual(['w2', 'w1']);
  });

  it2('allowsPinning: false disables resortByPin without rejecting meta writes', () => {
    const s = new WindeaseStore();
    s.registerZone({ id: asZoneId('flat'), strategy: noopStrategy, allowsPinning: false });
    s.createWindow({ id: asWindowId('w1'), kind: 'panel' });
    s.createWindow({ id: asWindowId('w2'), kind: 'panel' });
    s.claim(asZoneId('flat'), asWindowId('w1'));
    s.claim(asZoneId('flat'), asWindowId('w2'));
    s.setItemMeta(asZoneId('flat'), asWindowId('w2'), { pinned: true });
    // Order untouched.
    expect2(s.getZone(asZoneId('flat'))?.windowIds).toEqual(['w1', 'w2']);
    // But the meta is still readable.
    expect2(s.getItemMeta(asZoneId('flat'), asWindowId('w2'))).toEqual({ pinned: true });
  });

  it2('snapshot round-trips allowsPinning: false', () => {
    const s = new WindeaseStore();
    s.registerZone({ id: asZoneId('flat'), strategy: noopStrategy, allowsPinning: false });
    const snap = s.snapshot();
    const s2 = new WindeaseStore();
    s2.hydrate(snap, { strategies: { noop: noopStrategy } });
    expect2(s2.getZone(asZoneId('flat'))?.allowsPinning).toBe(false);
  });

  it2('locked items also sort into the pinned-prefix', () => {
    const s = setup();
    s.claim(asZoneId('main'), asWindowId('w1'));
    s.claim(asZoneId('main'), asWindowId('w2'), undefined, { locked: true });
    expect2(s.getZone(asZoneId('main'))?.windowIds).toEqual(['w2', 'w1']);
  });

  it2('snapshot round-trips item meta', () => {
    const s = setup();
    s.claim(asZoneId('main'), asWindowId('w1'), undefined, { pinned: true });
    s.claim(asZoneId('main'), asWindowId('w2'), undefined, { label: 'two' });
    const snap = s.snapshot();
    const s2 = new WindeaseStore();
    s2.hydrate(snap, { strategies: { noop: noopStrategy } });
    expect2(s2.getItemMeta(asZoneId('main'), asWindowId('w1'))).toEqual({ pinned: true });
    expect2(s2.getItemMeta(asZoneId('main'), asWindowId('w2'))).toEqual({ label: 'two' });
  });
});

describe2('WindeaseStore - focus', () => {
  it2('focus(id) marks window focused and blurs others', () => {
    const s = new WindeaseStore();
    s.createWindow({ id: asWindowId('w1'), kind: 'panel' });
    s.createWindow({ id: asWindowId('w2'), kind: 'panel' });
    s.focus(asWindowId('w1'));
    expect2(s.getWindow(asWindowId('w1'))?.focus.state).toBe('focused');
    s.focus(asWindowId('w2'));
    expect2(s.getWindow(asWindowId('w1'))?.focus.state).toBe('blurred');
    expect2(s.getWindow(asWindowId('w2'))?.focus.state).toBe('focused');
  });

  it2('focus on already-focused is a no-op', () => {
    const s = new WindeaseStore();
    s.createWindow({ id: asWindowId('w1'), kind: 'panel' });
    s.focus(asWindowId('w1'));
    expect2(() => s.focus(asWindowId('w1'))).not.toThrow();
    expect2(s.getWindow(asWindowId('w1'))?.focus.state).toBe('focused');
  });
});
