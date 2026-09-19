import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Node } from '../../node.js';
import { PRESETS as GRID } from '../../nuts/grid-scenarios.js';
import { PRESETS as OVERLAP } from '../../nuts/overlap-scenarios.js';
import { STORY_PRESETS as PACK } from '../../nuts/pack-scenarios.js';
import type { Preset } from '../../nuts/preset.js';
import { PRESETS as STRIP } from '../../nuts/strip-scenarios.js';
import { PRESETS as TREES } from '../../nuts/tree-scenarios.js';
import { PresetStyle, presetClass, withMetaClass } from './PresetStyle.js';

afterEach(cleanup);

const bare: Preset = {
  id: 'gimp-2.8:x',
  source: 's',
  stress: 's',
  description: 'd',
  viewport: { w: 1, h: 1 },
  mechanics: { id: 'root' },
};

describe('PresetStyle', () => {
  it('nests data.css under the preset class, made safe for a selector', () => {
    const preset = { ...bare, data: { css: '.bar { color: red; }' } };
    expect(presetClass(preset)).toBe('preset-gimp-2-8-x');
    const { container } = render(<PresetStyle preset={preset} />);
    expect(container.querySelector('style')?.textContent).toBe(
      '.preset-gimp-2-8-x {\n.bar { color: red; }\n}',
    );
  });

  it('renders nothing without css', () => {
    const { container } = render(<PresetStyle preset={bare} />);
    expect(container.innerHTML).toBe('');
  });

  it('appends a node class name from meta', () => {
    const node = { meta: { className: 'hot' } } as unknown as Node;
    expect(withMetaClass('pane', node)).toBe('pane hot');
    expect(withMetaClass('pane', undefined)).toBe('pane');
  });

  it('gives every Exotic story preset a product look', () => {
    const bare = [...OVERLAP, ...GRID, ...PACK, ...STRIP, ...TREES].filter((p) => !p.data?.css);
    expect(bare.map((p) => p.id)).toEqual([]);
  });
});
