import { asWindowId, asZoneId, stackStrategy, WindeaseStore } from '@windease/core';
import type { Story } from '@ladle/react';
import { useMemo } from 'react';
import { WindeaseProvider } from '../WindeaseProvider.js';
import { Zone } from '../Zone.js';
import { Panel } from './Panel.js';
import './windease.css';

const ZONE_ID = asZoneId('stack');

interface Args {
  gap: number;
  padding: number;
}

export const Stack: Story<Args> = ({ gap, padding }) => {
  const store = useMemo(() => {
    const s = new WindeaseStore();
    s.registerZone({ id: ZONE_ID, strategy: stackStrategy, config: { gap, padding } });
    const heights = [80, 140, 200];
    heights.forEach((h, i) => {
      const id = asWindowId(`stack-${i + 1}`);
      s.createWindow({
        id,
        kind: 'stack-item',
        hints: { preferredSize: { w: 0, h } },
      });
      s.show(id);
      s.claim(ZONE_ID, id);
    });
    return s;
    // biome-ignore lint/correctness/useExhaustiveDependencies: rebuild on control change
  }, [gap, padding]);

  return (
    <WindeaseProvider store={store}>
      <div style={{ width: 260, height: 500 }}>
        <Zone id={ZONE_ID} viewport={{ w: 260, h: 500 }}>
          {(w) => <Panel window={w} label={`Item (h=${w.hints.preferredSize?.h}px)`} />}
        </Zone>
      </div>
    </WindeaseProvider>
  );
};

Stack.args = {
  gap: 8,
  padding: 8,
};

Stack.argTypes = {
  gap: { control: { type: 'range', min: 0, max: 32, step: 1 } },
  padding: { control: { type: 'range', min: 0, max: 32, step: 1 } },
};
