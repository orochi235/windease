import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createNode } from './constructors.js';
import { asNodeId, deserialize, Store, serialize } from './index.js';

const ID = asNodeId('card');

function storeWithCard(): Store {
  const s = new Store();
  s.registerNode(createNode({ kind: 'card', id: ID, hints: { preferredSize: { w: 86, h: 120 } } }));
  s.showNode(ID);
  return s;
}

const turnOf = (s: Store) => s.getNode(ID)?.hints?.turn;

describe('turnTo', () => {
  let store: Store;
  beforeEach(() => {
    store = storeWithCard();
  });

  it('sets the angle outright when given no duration', () => {
    store.turnTo(ID, 90);
    expect(turnOf(store)).toBe(90);
  });

  it('moves nothing until something ticks', () => {
    store.turnTo(ID, 90, { ms: 180 });
    expect(turnOf(store)).toBeUndefined();
  });

  it('gives a turn its whole duration however late the first tick is', () => {
    store.turnTo(ID, 90, { ms: 180, ease: (t) => t });
    store.tick(10_000);
    expect(turnOf(store)).toBe(0);
    store.tick(10_090);
    expect(turnOf(store)).toBeCloseTo(45, 5);
  });

  it('eases with the function it was given', () => {
    store.turnTo(ID, 100, { ms: 100, ease: (t) => t * t });
    store.tick(0);
    store.tick(50);
    expect(turnOf(store)).toBeCloseTo(25, 5);
  });

  it('lands exactly on the target and stops', () => {
    store.turnTo(ID, 90, { ms: 100 });
    store.tick(0);
    expect(store.tick(100)).toBe(false);
    expect(turnOf(store)).toBe(90);
  });

  it('clamps a tick past the end rather than overshooting', () => {
    store.turnTo(ID, 90, { ms: 100 });
    store.tick(0);
    store.tick(10_000);
    expect(turnOf(store)).toBe(90);
  });

  it('reports whether anything is still running', () => {
    expect(store.tick(0)).toBe(false);
    store.turnTo(ID, 90, { ms: 100 });
    expect(store.tick(0)).toBe(true);
    expect(store.tick(50)).toBe(true);
    expect(store.tick(100)).toBe(false);
  });

  it('retimes from where it is when re-targeted mid-turn', () => {
    store.turnTo(ID, 90, { ms: 100, ease: (t) => t });
    store.tick(0);
    store.tick(50);
    const midway = turnOf(store)!;
    expect(midway).toBeCloseTo(45, 5);

    store.turnTo(ID, 0, { ms: 100, ease: (t) => t });
    store.tick(50);
    store.tick(100);
    // Half of the way back from 45, not a jump to 90 or a restart from 0.
    expect(turnOf(store)).toBeCloseTo(midway / 2, 5);
  });

  it('brackets the whole turn in one transaction, not one per frame', () => {
    const begin = vi.fn();
    const end = vi.fn();
    store.events.on('transaction.begin', begin);
    store.events.on('transaction.end', end);

    store.turnTo(ID, 90, { ms: 100 });
    for (const t of [0, 25, 50, 75, 100]) store.tick(t);

    expect(begin).toHaveBeenCalledTimes(1);
    expect(begin).toHaveBeenCalledWith({ label: 'turn' });
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('does not open a second bracket when re-targeted mid-turn', () => {
    const begin = vi.fn();
    const end = vi.fn();
    store.events.on('transaction.begin', begin);
    store.events.on('transaction.end', end);

    store.turnTo(ID, 90, { ms: 100 });
    store.tick(0);
    store.turnTo(ID, 0, { ms: 100 });
    store.tick(50);
    store.tick(200);

    expect(begin).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('closes the bracket when a running turn is cut short by an instant one', () => {
    const end = vi.fn();
    store.events.on('transaction.end', end);
    store.turnTo(ID, 90, { ms: 100 });
    store.tick(0);
    store.turnTo(ID, 45);
    expect(end).toHaveBeenCalledTimes(1);
    expect(turnOf(store)).toBe(45);
    expect(store.tick(50)).toBe(false);
  });

  it('announces a pending turn so a driver knows to schedule frames', () => {
    const started = vi.fn();
    store.events.on('turn.started', started);
    store.turnTo(ID, 90, { ms: 100 });
    expect(started).toHaveBeenCalledWith({ id: ID });
  });

  it('ignores a non-finite target', () => {
    store.turnTo(ID, Number.NaN, { ms: 100 });
    expect(turnOf(store)).toBeUndefined();
    expect(store.tick(0)).toBe(false);
  });

  it('survives a non-finite tick without corrupting the angle', () => {
    store.turnTo(ID, 90, { ms: 100 });
    store.tick(0);
    store.tick(Number.NaN);
    store.tick(100);
    expect(turnOf(store)).toBe(90);
  });

  it('round-trips a settled angle but not the turn that was running', () => {
    store.turnTo(ID, 90, { ms: 100 });
    store.tick(0);
    store.tick(100);

    const snap = JSON.parse(JSON.stringify(serialize(store)));
    const back = deserialize(snap);
    expect(back.getNode(ID)?.hints?.turn).toBe(90);
    // A half-finished turn is not state worth restoring, so nothing about the
    // tween survives the trip.
    expect(back.tick(0)).toBe(false);
  });

  it('restores a mid-turn angle as a settled one', () => {
    store.turnTo(ID, 90, { ms: 100, ease: (t) => t });
    store.tick(0);
    store.tick(50);

    const back = deserialize(JSON.parse(JSON.stringify(serialize(store))));
    expect(back.getNode(ID)?.hints?.turn).toBeCloseTo(45, 5);
    expect(back.tick(1000)).toBe(false);
    expect(back.getNode(ID)?.hints?.turn).toBeCloseTo(45, 5);
  });
});
