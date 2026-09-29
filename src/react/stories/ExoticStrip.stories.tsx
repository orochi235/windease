export default { title: 'Exotic / Strip' };

import type { Story } from '@ladle/react';
import { useMemo, useRef, useSyncExternalStore } from 'react';
import { asNodeId, type Node, stripStrategy } from '../../index.js';
import { type Preset, presetNodes, presetToStore } from '../../nuts/preset.js';
import { PRESETS } from '../../nuts/strip-scenarios.js';
import {
  type ChromeMap,
  Container,
  Provider,
  StrategyRegistryProvider,
  useStore,
} from '../index.js';
import '../styles.css';
import './exotic-strip.css';
import { PresetInfo } from './PresetInfo.js';
import { PresetPicker, usePresetPick } from './PresetPicker.js';
import { PresetStyle, presetClass, withMetaClass } from './PresetStyle.js';
import { PresetCode } from './presetCode.js';

const STRATEGIES = { strip: stripStrategy as never };

const titleOf = (node: Node) => String(node.meta?.title ?? node.id);

const chrome: ChromeMap = {
  group: ({ node }) => (
    <Container
      parentId={node.id}
      chrome={chrome}
      affordances
      className={withMetaClass('xs-group', node)}
    />
  ),
  panel: ({ node }) => (
    <div className={withMetaClass('xs-pane', node)} data-testid={`xs-pane-${node.id}`}>
      <header className="xs-pane__title">{titleOf(node)}</header>
    </div>
  ),
};

/** Panes a seam hid under `overshoot: 'hide'`. The handle each one leaves in the row shows it again. */
function Hidden({ preset }: { preset: Preset }) {
  const store = useStore();
  const ids = useMemo(() => presetNodes(preset).map(({ node }) => asNodeId(node.id)), [preset]);
  const key = useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => ids.filter((id) => store.getNode(id)?.lifecycle.state === 'hidden').join(' '),
  );
  return (
    <p className="xs-hidden">
      Hidden: <output data-testid="xs-hidden">{key || '(nothing)'}</output>
    </p>
  );
}

function PresetView({ preset }: { preset: Preset }) {
  const store = useMemo(() => presetToStore(preset), [preset]);
  const frameRef = useRef<HTMLDivElement | null>(null);
  return (
    <Provider store={store}>
      <PresetStyle preset={preset} />
      <div ref={frameRef} className={`xs-frame ${presetClass(preset)}`} data-testid="xs-frame">
        <Container
          parentId={asNodeId(preset.mechanics.id)}
          chrome={chrome}
          viewport={preset.viewport}
          scrollRef={frameRef}
          affordances
          className="windease-zone xs-zone"
        />
      </div>
      <Hidden preset={preset} />
      <PresetCode preset={preset} />
    </Provider>
  );
}

interface Args {
  preset: string;
}

/** Each pick is one real-software layout from `strip-scenarios.ts`, built into
 *  a store and rendered with draggable seams. */
export const Presets: Story<Args> = ({ preset: presetId }) => {
  const [preset, pick, run] = usePresetPick(PRESETS, presetId);
  return (
    <StrategyRegistryProvider strategies={STRATEGIES}>
      <PresetPicker presets={PRESETS} value={preset} onChange={pick} onReset={run.reset} />
      <PresetInfo preset={preset} />
      <PresetView key={run.key} preset={preset} />
    </StrategyRegistryProvider>
  );
};

Presets.args = { preset: PRESETS[0]!.id };

Presets.argTypes = {
  preset: { options: PRESETS.map((p) => p.id), control: { type: 'select' } },
};
