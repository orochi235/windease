import { asWindowId, asZoneId, gridStrategy, WindeaseStore } from '../../index.js';
import type { Story } from '@ladle/react';
import { useMemo } from 'react';
import { WindeaseProvider } from '../WindeaseProvider.js';
import { Zone } from '../Zone.js';
import { Panel } from './Panel.js';
import './windease.css';

const ZONE_ID = asZoneId('grid');

interface Args {
  cols: number;
  gap: number;
  padding: number;
  panelCount: number;
}

export const Grid: Story<Args> = ({ cols, gap, padding, panelCount }) => {
  const store = useMemo(() => {
    const s = new WindeaseStore();
    s.registerZone({ id: ZONE_ID, strategy: gridStrategy, config: { cols, gap, padding } });
    for (let i = 0; i < panelCount; i++) {
      const id = asWindowId(`panel-${i + 1}`);
      s.createWindow({ id, kind: 'panel' });
      s.show(id);
      s.claim(ZONE_ID, id);
    }
    return s;
    // biome-ignore lint/correctness/useExhaustiveDependencies: rebuild store when controls change
  }, [cols, gap, padding, panelCount]);

  return (
    <WindeaseProvider store={store}>
      <div style={{ width: 480, height: 360 }}>
        <Zone id={ZONE_ID} viewport={{ w: 480, h: 360 }}>
          {(w) => <Panel window={w} label={`Window ${w.id}`} />}
        </Zone>
      </div>
    </WindeaseProvider>
  );
};

Grid.args = {
  cols: 2,
  gap: 8,
  padding: 8,
  panelCount: 4,
};

Grid.argTypes = {
  cols: { control: { type: 'range', min: 1, max: 6, step: 1 } },
  gap: { control: { type: 'range', min: 0, max: 32, step: 1 } },
  padding: { control: { type: 'range', min: 0, max: 32, step: 1 } },
  panelCount: { control: { type: 'range', min: 1, max: 12, step: 1 } },
};
