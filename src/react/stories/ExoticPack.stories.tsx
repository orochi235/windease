export default { title: 'Exotic / Pack' };

import type { Story } from '@ladle/react';
import { useMemo } from 'react';
import { asNodeId, columnStrategy, shelfStrategy, skylineStrategy } from '../../index.js';
import type { LayoutStrategy } from '../../layout-types.js';
import { runScenario } from '../../test-utils/exotic/invariants.js';
import {
  PACKERS,
  type PackerId,
  packScenario,
  STORY_PRESETS,
  withStrategy,
} from '../../test-utils/exotic/pack-scenarios.js';
import { presetToStore } from '../../test-utils/exotic/preset.js';
import { type ChromeMap, Container, Provider, StrategyRegistryProvider } from '../index.js';
import './exotic-pack.css';
import './windease.css';
import { PresetInfo } from './PresetInfo.js';
import { PresetPicker, usePresetPick } from './PresetPicker.js';
import { PresetStyle, presetClass, withMetaClass } from './PresetStyle.js';
import { PresetCode } from './presetCode.js';

const PACK: Record<PackerId, LayoutStrategy<void, string>> = {
  shelf: shelfStrategy,
  skyline: skylineStrategy,
  column: columnStrategy,
};

const STRATEGIES = {
  shelf: shelfStrategy as never,
  column: columnStrategy as never,
  skyline: skylineStrategy as never,
};

interface Args {
  scenario: string;
  strategy: PackerId;
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

export const Scenarios: Story<Args> = ({ scenario, strategy, width }) => {
  const [preset, pick] = usePresetPick(STORY_PRESETS, scenario);
  const vw = width > 0 ? width : preset.viewport.w;
  const vh = preset.viewport.h;
  const store = useMemo(() => presetToStore(withStrategy(preset, strategy)), [preset, strategy]);

  const stats = useMemo(() => {
    const flat = packScenario(preset, strategy);
    const result = runScenario(PACK[strategy], { ...flat, container: { w: vw, h: vh } });
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
      fill: right > 0 && bottom > 0 ? (area / (right * bottom)) * 100 : 0,
    };
  }, [preset, strategy, vw, vh]);

  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <section className="exotic-pack" aria-label="Exotic pack scenario">
          <PresetPicker presets={STORY_PRESETS} value={preset} onChange={pick} />
          <PresetInfo preset={preset}>
            <p className="preset-info__live">
              <strong>Packed:</strong>{' '}
              <span data-testid="exotic-stats">
                {stats.placed} placed, {stats.unplaced} unplaced, {vw}px wide, fill{' '}
                <span className="exotic-pack__number">{stats.fill.toFixed(1)}%</span>
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
            />
          </div>
          <PresetCode preset={preset} viewport={{ w: vw, h: vh }} />
        </section>
      </StrategyRegistryProvider>
    </Provider>
  );
};

Scenarios.args = { scenario: 'pinterest-home-feed', strategy: 'column', width: 0 };

Scenarios.argTypes = {
  scenario: { options: STORY_PRESETS.map((p) => p.id), control: { type: 'select' } },
  strategy: { options: [...PACKERS], control: { type: 'radio' } },
  width: { control: { type: 'range', min: 0, max: 2400, step: 10 } },
};
