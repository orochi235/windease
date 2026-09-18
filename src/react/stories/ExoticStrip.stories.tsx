export default { title: 'Exotic / Strip' };

import type { Story } from '@ladle/react';
import { useMemo } from 'react';
import { asNodeId, stripStrategy } from '../../index.js';
import { presetToStore } from '../../test-utils/exotic/preset.js';
import { PRESETS } from '../../test-utils/exotic/strip-scenarios.js';
import { type ChromeMap, Container, Provider, StrategyRegistryProvider } from '../index.js';
import '../styles.css';
import './exotic-strip.css';
import { PresetInfo } from './PresetInfo.js';
import { PresetPicker, usePresetPick } from './PresetPicker.js';
import { PresetCode } from './presetCode.js';

const STRATEGIES = { strip: stripStrategy as never };

const chrome: ChromeMap = {
  group: ({ node }) => (
    <Container parentId={node.id} chrome={chrome} affordances className="xs-group" />
  ),
  panel: ({ node }) => (
    <div className="xs-pane" data-testid={`xs-pane-${node.id}`}>
      <header className="xs-pane__title">{String(node.meta?.title ?? node.id)}</header>
    </div>
  ),
};

interface Args {
  preset: string;
}

/** Each pick is one real-software layout from `strip-scenarios.ts`, built into
 *  a store and rendered with draggable seams. */
export const Presets: Story<Args> = ({ preset: presetId }) => {
  const [preset, pick] = usePresetPick(PRESETS, presetId);
  const store = useMemo(() => presetToStore(preset), [preset]);
  return (
    <Provider key={preset.id} store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <PresetPicker presets={PRESETS} value={preset} onChange={pick} />
        <PresetInfo preset={preset} />
        <div className="xs-frame">
          <Container
            parentId={asNodeId(preset.mechanics.id)}
            chrome={chrome}
            viewport={preset.viewport}
            affordances
            className="windease-zone xs-zone"
          />
        </div>
        <PresetCode preset={preset} />
      </StrategyRegistryProvider>
    </Provider>
  );
};

Presets.args = { preset: PRESETS[0]!.id };

Presets.argTypes = {
  preset: { options: PRESETS.map((p) => p.id), control: { type: 'select' } },
};
