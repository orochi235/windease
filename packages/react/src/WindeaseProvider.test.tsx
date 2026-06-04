import { renderHook } from '@testing-library/react';
import { WindeaseStore, asZoneId, gridStrategy } from '@windease/core';
import { describe, expect, it } from 'vitest';
import { WindeaseProvider } from './WindeaseProvider.js';
import { useWindease } from './hooks.js';

describe('WindeaseProvider', () => {
  it('exposes a passed store via useWindease', () => {
    const store = new WindeaseStore();
    const { result } = renderHook(() => useWindease(), {
      wrapper: ({ children }) => <WindeaseProvider store={store}>{children}</WindeaseProvider>,
    });
    expect(result.current).toBe(store);
  });

  it('constructs a store from zones prop when none is given', () => {
    const { result } = renderHook(() => useWindease(), {
      wrapper: ({ children }) => (
        <WindeaseProvider
          zones={[{ id: asZoneId('main'), strategy: gridStrategy, config: { cols: 2 } }]}
        >
          {children}
        </WindeaseProvider>
      ),
    });
    expect(result.current.getZone(asZoneId('main'))?.strategy.name).toBe('grid');
  });

  it('useWindease throws helpful error outside provider', () => {
    expect(() => renderHook(() => useWindease())).toThrow(/WindeaseProvider/);
  });
});
