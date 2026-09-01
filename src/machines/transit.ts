import { Machine } from '../fsm.js';

/** Where a node is in a move between parents. Deliberately not serialized —
 *  a move in flight does not survive a reload. */
export type TransitState = 'idle' | 'claiming' | 'releasing';
/** Events driving {@link TransitState}. */
export type TransitEvent = 'beginClaim' | 'beginRelease' | 'settle';

/** Build the transit machine carried on `membership`, starting `idle`. */
export function createTransitMachine(): Machine<TransitState, TransitEvent> {
  return new Machine<TransitState, TransitEvent>({
    initial: 'idle',
    transitions: {
      idle: { beginClaim: 'claiming', beginRelease: 'releasing' },
      claiming: { settle: 'idle' },
      releasing: { settle: 'idle' },
    },
  });
}
