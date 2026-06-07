import { binarySplit, recursiveSplit, type SplitNode, type WindowRecord } from '../../index.js';
import type { Story } from '@ladle/react';
import { useState } from 'react';
import { Workspace } from '../Workspace.js';
import { Panel } from './Panel.js';
import './windease.css';

const items3 = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

function fakeWindow(id: string): WindowRecord {
  return {
    id,
    kind: 'panel',
    lifecycle: { state: 'visible' },
    transit: { state: 'idle' },
    zoneId: undefined,
  } as unknown as WindowRecord;
}

export const BinarySplit: Story = () => (
  <div style={{ width: 600, height: 360 }}>
    <Workspace
      strategy={binarySplit}
      items={[{ id: 'a' }, { id: 'b' }]}
      options={{ direction: 'horizontal' }}
    >
      {(item) => <Panel window={fakeWindow(item.id)} label={`Pane ${item.id}`} />}
    </Workspace>
  </div>
);

export const RecursiveSplit: Story = () => {
  const initialTree: SplitNode = {
    kind: 'split',
    direction: 'horizontal',
    ratio: 0.65,
    a: {
      kind: 'split',
      direction: 'vertical',
      ratio: 0.7,
      a: { kind: 'leaf', id: 'a' },
      b: { kind: 'leaf', id: 'b' },
    },
    b: { kind: 'leaf', id: 'c' },
  };
  const [snap, setSnap] = useState<string>('');

  return (
    <div>
      <div style={{ width: 600, height: 360 }}>
        <Workspace
          strategy={recursiveSplit}
          items={items3}
          initialState={initialTree}
          onStateChange={(s) => setSnap(JSON.stringify(s, null, 2))}
        >
          {(item) => <Panel window={fakeWindow(item.id)} label={`Pane ${item.id}`} />}
        </Workspace>
      </div>
      {snap && (
        <pre className="story-snapshot" style={{ marginTop: 12 }}>
          {snap}
        </pre>
      )}
    </div>
  );
};
