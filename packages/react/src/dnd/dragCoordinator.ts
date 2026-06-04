export type DragKind = 'window' | 'zone';

let current: DragKind | null = null;

export const dragCoordinator = {
  tryBegin(kind: DragKind): boolean {
    if (current !== null) return false;
    current = kind;
    return true;
  },
  end(): void {
    current = null;
  },
  active(): DragKind | null {
    return current;
  },
};
