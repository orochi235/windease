import { asWindowId, asZoneId, stripStrategy, WindeaseStore } from '@windease/core';
import type { Story } from '@ladle/react';
import { useMemo } from 'react';
import { WindeaseProvider } from '../WindeaseProvider.js';
import { Zone } from '../Zone.js';
import { Panel } from './Panel.js';
import './windease.css';

function makeStripStore(axis: 'x' | 'y', sizes: number[]): WindeaseStore {
  const s = new WindeaseStore();
  const zoneId = asZoneId(`strip-${axis}`);
  s.registerZone({ id: zoneId, strategy: stripStrategy, config: { axis, gap: 6, padding: 6 } });
  sizes.forEach((size, i) => {
    const id = asWindowId(`tool-${axis}-${i + 1}`);
    const preferredSize = axis === 'x' ? { w: size, h: 0 } : { w: 0, h: size };
    s.createWindow({ id, kind: 'tool', hints: { preferredSize } });
    s.show(id);
    s.claim(zoneId, id);
  });
  return s;
}

export const HorizontalStrip: Story = () => {
  const store = useMemo(() => makeStripStore('x', [80, 120, 160, 100]), []);
  return (
    <WindeaseProvider store={store}>
      <div style={{ width: 600, height: 100 }}>
        <Zone id={asZoneId('strip-x')} viewport={{ w: 600, h: 100 }}>
          {(w) => <Panel window={w} label={`x (w=${w.hints.preferredSize?.w})`} />}
        </Zone>
      </div>
    </WindeaseProvider>
  );
};

export const VerticalStrip: Story = () => {
  const store = useMemo(() => makeStripStore('y', [60, 90, 60, 120]), []);
  return (
    <WindeaseProvider store={store}>
      <div style={{ width: 220, height: 420 }}>
        <Zone id={asZoneId('strip-y')} viewport={{ w: 220, h: 420 }}>
          {(w) => <Panel window={w} label={`y (h=${w.hints.preferredSize?.h})`} />}
        </Zone>
      </div>
    </WindeaseProvider>
  );
};
