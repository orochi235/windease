import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import {
  WindeaseStore, gridStrategy, asWindowId, asZoneId,
} from '@windease/core';
import { WindeaseProvider } from './WindeaseProvider.js';
import { Zone } from './Zone.js';

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
  it('renders visible windows via render prop with CSS custom props', async () => {
    const store = mkStore();
    render(
      <WindeaseProvider store={store}>
        <div style={{ width: 400, height: 400 }}>
          <Zone id={asZoneId('main')} viewport={{ w: 400, h: 400 }}>
            {(w) => <div data-testid={`w-${w.id}`} data-kind={w.kind}>{w.id}</div>}
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
});
