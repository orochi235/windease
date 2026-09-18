import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Node } from '../../node.js';
import { Store } from '../../store.js';
import { PRESETS as GRID } from '../../test-utils/exotic/grid-scenarios.js';
import { PRESETS as OVERLAP } from '../../test-utils/exotic/overlap-scenarios.js';
import { PRESETS as PACK } from '../../test-utils/exotic/pack-scenarios.js';
import { type Preset, presetNodes, presetToStore } from '../../test-utils/exotic/preset.js';
import { PRESETS as STRIP } from '../../test-utils/exotic/strip-scenarios.js';
import { PRESETS as TREES } from '../../test-utils/exotic/tree-scenarios.js';
import { Provider } from '../Provider.js';
import { JSX_OWNER_META_KEY } from '../useNodeBinding.js';
import { presetElement, presetJsx, presetLiteral } from './presetCode.js';

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
  const big = PACK.find((p) => (p.root.children?.length ?? 0) > 100)!;

  it('elide a long child list to the first few, a count, and the last', () => {
    const jsx = presetJsx(big);
    const n = big.root.children!.length;
    expect(jsx).toContain(`{/* …${n - 8} more like these */}`);
    expect(jsx.split('\n').length).toBeLessThan(40);
    expect(presetLiteral(big)).toContain(`/* …${n - 8} more */`);
  });

  it('print every prop the element tree receives', () => {
    const preset = STRIP[0]!;
    const jsx = presetJsx(preset);
    expect(jsx).toMatch(new RegExp(`^<Zone\\s+id="${preset.root.id}"`));
    expect(jsx).toContain(`strategyId="${preset.root.strategy}"`);
    expect(presetLiteral(preset)).toContain(`id: '${preset.id}'`);
  });
});
