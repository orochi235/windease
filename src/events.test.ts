import { describe, expect, it, vi } from 'vitest';
import { TypedEmitter } from './events.js';

type E = { ping: { n: number }; pong: { s: string } };

describe('TypedEmitter', () => {
  it('delivers event to matching listener with payload', () => {
    const em = new TypedEmitter<E>();
    const fn = vi.fn();
    em.on('ping', fn);
    em.emit('ping', { n: 7 });
    expect(fn).toHaveBeenCalledWith({ n: 7 });
  });

  it('does not deliver to listeners of other events', () => {
    const em = new TypedEmitter<E>();
    const fn = vi.fn();
    em.on('pong', fn);
    em.emit('ping', { n: 1 });
    expect(fn).not.toHaveBeenCalled();
  });

  it('off() stops delivery', () => {
    const em = new TypedEmitter<E>();
    const fn = vi.fn();
    const off = em.on('ping', fn);
    off();
    em.emit('ping', { n: 1 });
    expect(fn).not.toHaveBeenCalled();
  });

  it('listener errors do not break other listeners', () => {
    const em = new TypedEmitter<E>();
    const good = vi.fn();
    em.on('ping', () => {
      throw new Error('boom');
    });
    em.on('ping', good);
    expect(() => em.emit('ping', { n: 1 })).not.toThrow();
    expect(good).toHaveBeenCalled();
  });
});
