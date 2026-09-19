import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Node } from '../../node.js';
import { PRESETS as GRID } from '../../nuts/grid-scenarios.js';
import { PRESETS as OVERLAP } from '../../nuts/overlap-scenarios.js';
import { PRESETS as PACK, packItemCount } from '../../nuts/pack-scenarios.js';
import { type Preset, presetNodes, presetToStore } from '../../nuts/preset.js';
import { PRESETS as STRIP } from '../../nuts/strip-scenarios.js';
import { PRESETS as TREES } from '../../nuts/tree-scenarios.js';
import { Store } from '../../store.js';
import { Provider } from '../Provider.js';
import { JSX_OWNER_META_KEY } from '../useNodeBinding.js';
import { PresetCode, presetElement, presetJsx, presetLiteral } from './presetCode.js';

afterEach(cleanup);

/** What a preset promises about each node, read back from a store. */
function shape(store: Store, preset: Preset) {
  return presetNodes(preset).map(({ node: { id } }) => {
    const n = store.getNode(id as Node['id'])!;
    const { [JSX_OWNER_META_KEY]: _owner, ...meta } = n.meta ?? {};
    return {
      id,
      parentId: n.membership?.parentId,
      placement: n.membership?.placement ?? {},
      childOrder: n.container?.childOrder,
      strategyId: n.container?.strategyId,
      config: n.container?.config ?? (n.container ? {} : undefined),
      state: n.container?.state,
      hints: n.hints ?? {},
      meta,
      lock: n.lock,
      hidden: n.lifecycle.state === 'hidden',
    };
  });
}

const PRESETS = [...STRIP, ...GRID, ...PACK, ...OVERLAP, ...TREES].filter(
  (p) => presetNodes(p).length <= 400,
);

describe('the generated JSX rebuilds its preset', () => {
  for (const preset of PRESETS) {
    it(preset.id, () => {
      const store = new Store();
      render(<Provider store={store}>{presetElement(preset)}</Provider>);
      expect(shape(store, preset)).toEqual(shape(presetToStore(preset), preset));
    });
  }
});

describe('listings', () => {
  const big = PACK.find((p) => packItemCount(p) > 100)!;

  it('elide a long child list to the first few, a count, and the last', () => {
    const jsx = presetJsx(big);
    const n = packItemCount(big);
    expect(jsx).toContain(`{/* …${n - 8} more like these */}`);
    expect(jsx.split('\n').length).toBeLessThan(40);
    expect(presetLiteral(big.data)).toContain(`/* …${n - 8} more */`);
  });

  it('print every prop the element tree receives', () => {
    const preset = STRIP[0]!;
    const jsx = presetJsx(preset);
    expect(jsx).toMatch(new RegExp(`^<Zone\\s+id="${preset.mechanics.id}"`));
    expect(jsx).toContain(`strategyId="${preset.mechanics.strategy}"`);
    expect(jsx).toContain(`meta={{ title: 'Top bar', className: 'bl-bar' }}`);
  });
});

describe('the Mechanics and Data tabs', () => {
  const open = (preset: Preset, tab: string) => {
    render(
      <Provider store={presetToStore(preset)}>
        <PresetCode preset={preset} />
      </Provider>,
    );
    fireEvent.click(screen.getByRole('tab', { name: tab }));
    return screen.getByTestId('preset-code').textContent ?? '';
  };

  it('show the mechanics without the titles, and the titles as data', () => {
    const preset = STRIP[0]!;
    const mechanics = open(preset, 'Mechanics');
    expect(mechanics).toContain(`id: '${preset.mechanics.id}'`);
    expect(mechanics).not.toContain('Top bar');
    cleanup();
    expect(open(preset, 'Data')).toContain(`title: 'Top bar'`);
  });

  it('say so when a preset has no data', () => {
    const { data: _data, ...bare } = STRIP[0]!;
    expect(open(bare, 'Data')).toBe('No sample data');
  });

  it('show css beside the data', () => {
    const styled: Preset = { ...STRIP[0]!, data: { css: '.x { color: red; }' } };
    expect(open(styled, 'Data')).toBe('.x { color: red; }');
  });
});
