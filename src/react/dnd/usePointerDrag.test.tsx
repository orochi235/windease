import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { firePointer, installPointerCaptureShim } from './firePointer.js';
import { usePointerDrag } from './usePointerDrag.js';

installPointerCaptureShim();

function Probe(props: {
  onDragStart: (e: PointerEvent) => void;
  onDragMove: (e: PointerEvent, d: { dx: number; dy: number }) => void;
  onDragEnd: (e: PointerEvent, didDrag: boolean) => void;
  threshold?: number;
}) {
  const handlers = usePointerDrag(props);
  return <div data-testid="probe" {...handlers} style={{ width: 100, height: 100 }} />;
}

describe('usePointerDrag', () => {
  it('does not start drag below threshold; onDragEnd reports didDrag=false', () => {
    const start = vi.fn();
    const move = vi.fn();
    const end = vi.fn();
    const { getByTestId } = render(
      <Probe onDragStart={start} onDragMove={move} onDragEnd={end} />,
    );
    const el = getByTestId('probe');
    firePointer(el, 'pointerdown', { clientX: 50, clientY: 50 });
    firePointer(el, 'pointermove', { clientX: 52, clientY: 51 });
    firePointer(el, 'pointerup', { clientX: 52, clientY: 51 });
    expect(start).not.toHaveBeenCalled();
    expect(move).not.toHaveBeenCalled();
    expect(end).toHaveBeenCalledTimes(1);
    expect(end.mock.calls[0]![1]).toBe(false);
  });

  it('starts drag when threshold exceeded; reports delta', () => {
    const start = vi.fn();
    const move = vi.fn();
    const end = vi.fn();
    const { getByTestId } = render(
      <Probe onDragStart={start} onDragMove={move} onDragEnd={end} />,
    );
    const el = getByTestId('probe');
    firePointer(el, 'pointerdown', { clientX: 50, clientY: 50 });
    firePointer(el, 'pointermove', { clientX: 60, clientY: 50 });
    expect(start).toHaveBeenCalledTimes(1);
    expect(move).toHaveBeenCalledTimes(1);
    expect(move.mock.calls[0]![1]).toEqual({ dx: 10, dy: 0 });
    firePointer(el, 'pointermove', { clientX: 65, clientY: 50 });
    expect(move).toHaveBeenCalledTimes(2);
    expect(move.mock.calls[1]![1]).toEqual({ dx: 5, dy: 0 });
    firePointer(el, 'pointerup', { clientX: 65, clientY: 50 });
    expect(end).toHaveBeenCalledTimes(1);
    expect(end.mock.calls[0]![1]).toBe(true);
  });

  it('pointercancel ends the drag with the current didDrag value', () => {
    const start = vi.fn();
    const end = vi.fn();
    const { getByTestId } = render(
      <Probe onDragStart={start} onDragMove={vi.fn()} onDragEnd={end} />,
    );
    const el = getByTestId('probe');
    firePointer(el, 'pointerdown', { clientX: 0, clientY: 0 });
    firePointer(el, 'pointermove', { clientX: 20, clientY: 0 });
    firePointer(el, 'pointercancel', { clientX: 20, clientY: 0 });
    expect(start).toHaveBeenCalled();
    expect(end).toHaveBeenCalledTimes(1);
    expect(end.mock.calls[0]![1]).toBe(true);
  });

  it('respects custom threshold', () => {
    const start = vi.fn();
    const { getByTestId } = render(
      <Probe onDragStart={start} onDragMove={vi.fn()} onDragEnd={vi.fn()} threshold={20} />,
    );
    const el = getByTestId('probe');
    firePointer(el, 'pointerdown', { clientX: 0, clientY: 0 });
    firePointer(el, 'pointermove', { clientX: 10, clientY: 0 });
    expect(start).not.toHaveBeenCalled();
    firePointer(el, 'pointermove', { clientX: 25, clientY: 0 });
    expect(start).toHaveBeenCalledTimes(1);
  });
});
