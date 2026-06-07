import { afterEach, describe, expect, it } from 'vitest';
import { dragCoordinator } from './dragCoordinator.js';

afterEach(() => dragCoordinator.end());

describe('dragCoordinator', () => {
  it('first tryBegin succeeds, second is rejected until end', () => {
    expect(dragCoordinator.tryBegin('window')).toBe(true);
    expect(dragCoordinator.tryBegin('zone')).toBe(false);
    expect(dragCoordinator.tryBegin('window')).toBe(false);
    dragCoordinator.end();
    expect(dragCoordinator.tryBegin('zone')).toBe(true);
  });

  it('end is a no-op when nothing is active', () => {
    expect(() => dragCoordinator.end()).not.toThrow();
    expect(dragCoordinator.active()).toBeNull();
  });

  it('active() reports the current drag kind', () => {
    expect(dragCoordinator.active()).toBeNull();
    dragCoordinator.tryBegin('window');
    expect(dragCoordinator.active()).toBe('window');
  });
});
