import { trace } from '@windease/core';

export type DragKind = 'window' | 'zone';

let current: DragKind | null = null;

export const dragCoordinator = {
  tryBegin(kind: DragKind): boolean {
    if (current !== null) {
      trace('dnd', `coordinator: tryBegin(${kind}) REJECTED (${current} active)`);
      return false;
    }
    current = kind;
    trace('dnd', `coordinator: begin ${kind}`);
    return true;
  },
  end(): void {
    if (current) trace('dnd', `coordinator: end ${current}`);
    current = null;
  },
  active(): DragKind | null {
    return current;
  },
};
