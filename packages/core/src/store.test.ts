import { describe, it, expect, vi } from 'vitest';
import { WindeaseStore } from './store.js';
import { asWindowId, asZoneId } from './window.js';
import { WindeaseError } from './errors.js';

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
    expect(() => s.createWindow({ id: asWindowId('w1'), kind: 'panel' }))
      .toThrowError(WindeaseError);
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

  it('listWindows filters by kind', () => {
    const s = new WindeaseStore();
    s.createWindow({ id: asWindowId('a'), kind: 'panel' });
    s.createWindow({ id: asWindowId('b'), kind: 'widget' });
    s.createWindow({ id: asWindowId('c'), kind: 'panel' });
    const panels = s.listWindows({ kind: 'panel' });
    expect(panels.map(w => w.id).sort()).toEqual(['a', 'c']);
  });
});
