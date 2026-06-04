import { Machine } from '../fsm.js';

export type TransitState = 'idle' | 'claiming' | 'releasing';
export type TransitEvent = 'beginClaim' | 'beginRelease' | 'settle';

export function createTransitMachine(): Machine<TransitState, TransitEvent> {
  return new Machine<TransitState, TransitEvent>({
    initial: 'idle',
    transitions: {
      idle:      { beginClaim: 'claiming', beginRelease: 'releasing' },
      claiming:  { settle: 'idle' },
      releasing: { settle: 'idle' },
    },
  });
}
