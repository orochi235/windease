import { describe, expect, it } from 'vitest';
import { createPanel, createZone } from '../constructors.js';
import { asNodeId } from '../node.js';
import { Store } from '../store.js';
import { recordEvents } from './record-events.js';

const nid = (s: string) => asNodeId(s);
const zone = (id: string) => createZone({ id: nid(id), strategyId: 'grid', config: {} });
const panel = (id: string, parentId: string) =>
  createPanel({ id: nid(id), parentId: nid(parentId) });

describe('recordEvents', () => {
  it('collects payloads for one event in emission order', () => {
    const store = new Store();
    const rec = recordEvents(store, 'node.registered');

    store.registerNode(zone('z'));
    store.registerNode(panel('a', 'z'));

    expect(rec.of('node.registered').map((p) => p.id)).toEqual(['z', 'a']);
  });

  it('interleaves several events into one ordered log', () => {
    const store = new Store();
    store.registerNode(zone('z'));
    store.registerNode(panel('a', 'z'));
    const rec = recordEvents(store, 'node.registered', 'node.unregistered');

    store.registerNode(panel('b', 'z'));
    store.unregisterNode(nid('a'));

    expect(rec.log.map((e) => `${e.name}:${(e.payload as { id: string }).id}`)).toEqual([
      'node.registered:b',
      'node.unregistered:a',
    ]);
  });

  it('stops recording once stopped', () => {
    const store = new Store();
    const rec = recordEvents(store, 'node.registered');

    store.registerNode(zone('z'));
    rec.stop();
    store.registerNode(panel('a', 'z'));

    expect(rec.of('node.registered')).toHaveLength(1);
  });

  it('starts each event with an empty list so absence is assertable', () => {
    const store = new Store();
    const rec = recordEvents(store, 'node.registered', 'node.moved');

    store.registerNode(zone('z'));

    expect(rec.of('node.moved')).toEqual([]);
  });
});
