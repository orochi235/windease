export default { title: 'Exotic / Pack' };

import type { Story } from '@ladle/react';
import { useMemo } from 'react';
import { asNodeId } from '../../index.js';
import { runScenario } from '../../nuts/invariants.js';
import {
  ownStrategy,
  PACK_STRATEGIES,
  PACKERS,
  type PackStrategyId,
  packScenario,
  STORY_PRESETS,
  withStrategy,
} from '../../nuts/pack-scenarios.js';
import { presetToStore } from '../../nuts/preset.js';
import {
  type ChromeMap,
  Container,
  type OverlayContext,
  Provider,
  StrategyRegistryProvider,
} from '../index.js';
import './exotic-pack.css';
import './windease.css';
import { PresetInfo } from './PresetInfo.js';
import { PresetPicker, usePresetPick } from './PresetPicker.js';
import { PresetStyle, presetClass, withMetaClass } from './PresetStyle.js';
import { PresetCode } from './presetCode.js';

const STRATEGIES = PACK_STRATEGIES as Record<PackStrategyId, never>;

/** `'preset'` runs the strategy the preset names; any other value overrides it. */
type StrategyPick = 'preset' | PackStrategyId;

interface Args {
  scenario: string;
  strategy: StrategyPick;
  /** Container width in px; 0 keeps the width the preset was designed for. */
  width: number;
}

const chrome: ChromeMap = {
  panel: ({ node }) => (
    <div className={withMetaClass('exotic-pack__box', node)} data-testid="exotic-box">
      {typeof node.meta?.title === 'string' ? (
        <span className="exotic-pack__label">{node.meta.title}</span>
      ) : null}
    </div>
  ),
};

/** A hatched frame over every box its packer turned, read from the `rotation` channel. */
function TurnedOverlay({ placements, channels }: OverlayContext) {
  if (!channels) return null;
  return [...channels].map(([id, c]) => {
    const rect = c.rotation === 90 ? placements.get(id) : undefined;
    return rect ? (
      <span
        key={id}
        className="exotic-pack__turned"
        data-turned={id}
        title="turned a quarter"
        style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
      />
    ) : null;
  });
}

export const Scenarios: Story<Args> = ({ scenario, strategy: pick, width }) => {
  const [preset, pickPreset] = usePresetPick(STORY_PRESETS, scenario);
  const strategy = pick === 'preset' ? ownStrategy(preset) : pick;
  const vw = width > 0 ? width : preset.viewport.w;
  const vh = preset.viewport.h;
  const store = useMemo(() => presetToStore(withStrategy(preset, strategy)), [preset, strategy]);

  const stats = useMemo(() => {
    const flat = packScenario(preset, strategy);
    const result = runScenario(PACK_STRATEGIES[strategy], { ...flat, container: { w: vw, h: vh } });
    let area = 0;
    let right = 0;
    let bottom = 0;
    for (const r of result.placements.values()) {
      area += r.w * r.h;
      right = Math.max(right, r.x + r.w);
      bottom = Math.max(bottom, r.y + r.h);
    }
    return {
      placed: result.placements.size,
      unplaced: result.unplaced?.length ?? 0,
      turned: [...(result.channels?.values() ?? [])].filter((c) => c.rotation === 90).length,
      fill: right > 0 && bottom > 0 ? (area / (right * bottom)) * 100 : 0,
    };
  }, [preset, strategy, vw, vh]);

  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <section className="exotic-pack" aria-label="Exotic pack scenario">
          <PresetPicker presets={STORY_PRESETS} value={preset} onChange={pickPreset} />
          <PresetInfo preset={preset}>
            <p className="preset-info__live">
              <strong>Packed by {strategy}:</strong>{' '}
              <span data-testid="exotic-stats">
                {stats.placed} placed, {stats.unplaced} unplaced, {stats.turned} turned, {vw}px
                wide, fill <span className="exotic-pack__number">{stats.fill.toFixed(1)}%</span>
              </span>
            </p>
          </PresetInfo>
          <PresetStyle preset={preset} />
          <div className={`exotic-pack__viewport ${presetClass(preset)}`}>
            <Container
              key={`${preset.id}:${strategy}`}
              parentId={asNodeId(preset.mechanics.id)}
              chrome={chrome}
              viewport={{ w: vw, h: vh }}
              settleMs={0}
              className="windease-zone windease-zone--unclipped"
              overlay={TurnedOverlay}
            />
          </div>
          <PresetCode preset={preset} viewport={{ w: vw, h: vh }} />
        </section>
      </StrategyRegistryProvider>
    </Provider>
  );
};

Scenarios.args = { scenario: 'pinterest-home-feed', strategy: 'preset', width: 0 };

Scenarios.argTypes = {
  scenario: { options: STORY_PRESETS.map((p) => p.id), control: { type: 'select' } },
  strategy: { options: ['preset', ...PACKERS, 'justified'], control: { type: 'radio' } },
  width: { control: { type: 'range', min: 0, max: 2400, step: 10 } },
};
