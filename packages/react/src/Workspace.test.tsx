import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { binarySplit, recursiveSplit, type SplitNode } from '@windease/core';
import { Workspace } from './Workspace.js';
import { firePointer, installPointerCaptureShim } from './dnd/firePointer.js';

installPointerCaptureShim();

describe('<Workspace>', () => {
  it('renders one wrapper per item with CSS custom props', () => {
    render(
      <Workspace
        strategy={binarySplit}
        items={[{ id: 'a' }, { id: 'b' }]}
        options={{ direction: 'horizontal' }}
        initialState={{ ratio: 0.5 }}
        container={{ w: 200, h: 100 }}
      >
        {(item) => <div data-testid={`item-${item.id}`}>{item.id}</div>}
      </Workspace>,
    );
    const a = screen.getByTestId('item-a').parentElement!;
    expect(a.style.getPropertyValue('--w-x')).toBe('0px');
    expect(a.style.getPropertyValue('--w-w')).toBe('98px');
    const b = screen.getByTestId('item-b').parentElement!;
    expect(b.style.getPropertyValue('--w-x')).toBe('102px');
  });

  it('renders affordances as drag handles', () => {
    render(
      <Workspace
        strategy={binarySplit}
        items={[{ id: 'a' }, { id: 'b' }]}
        options={{ direction: 'horizontal' }}
        initialState={{ ratio: 0.5 }}
        container={{ w: 200, h: 100 }}
      >
        {(item) => <div>{item.id}</div>}
      </Workspace>,
    );
    const handle = document.querySelector('.windease-affordance[data-kind="drag-x"]') as HTMLElement;
    expect(handle).toBeTruthy();
    expect(handle.style.cursor).toBe('col-resize');
  });

  it('pointer drag dispatches and onStateChange fires', () => {
    const onStateChange = vi.fn();
    render(
      <Workspace
        strategy={binarySplit}
        items={[{ id: 'a' }, { id: 'b' }]}
        options={{ direction: 'horizontal' }}
        initialState={{ ratio: 0.5 }}
        container={{ w: 200, h: 100 }}
        onStateChange={onStateChange}
      >
        {(item) => <div>{item.id}</div>}
      </Workspace>,
    );
    const handle = document.querySelector('.windease-affordance[data-kind="drag-x"]') as HTMLElement;
    firePointer(handle, 'pointerdown', { clientX: 100, clientY: 50, pointerId: 1 });
    firePointer(handle, 'pointermove', { clientX: 120, clientY: 50, pointerId: 1 });
    firePointer(handle, 'pointerup', { clientX: 120, clientY: 50, pointerId: 1 });
    expect(onStateChange).toHaveBeenCalled();
    const lastState = onStateChange.mock.calls.at(-1)![0] as { ratio: number };
    expect(lastState.ratio).toBeCloseTo(0.5 + 20 / 200, 5);
  });

  it('throws when strategy has no initialState and none provided', () => {
    expect(() =>
      render(
        // @ts-expect-error — deliberately missing initialState
        <Workspace
          strategy={{ name: 'noop', layout: () => ({ placements: new Map(), affordances: [] }) }}
          items={[{ id: 'a' }]}
          container={{ w: 100, h: 100 }}
        >
          {(item) => <div>{item.id}</div>}
        </Workspace>,
      ),
    ).toThrow(/NO_INITIAL_STATE|initial state/i);
  });

  it('custom affordance renderer is invoked for unknown kinds', () => {
    const customStrat = {
      name: 'custom',
      initialState: () => null,
      layout: () => ({
        placements: new Map(),
        affordances: [{ id: 'x', kind: 'custom-toggle', rect: { x: 0, y: 0, w: 10, h: 10 } }],
      }),
    };
    render(
      <Workspace
        strategy={customStrat as never}
        items={[]}
        container={{ w: 100, h: 100 }}
        affordanceRenderers={{
          'custom-toggle': (a) => <button data-testid={`aff-${a.id}`}>{a.id}</button>,
        }}
      >
        {() => null}
      </Workspace>,
    );
    expect(screen.getByTestId('aff-x')).toBeTruthy();
  });

  it('zone-swap drags one workspace child onto another and swaps leaves', () => {
    const onStateChange = vi.fn();
    const initial: SplitNode = {
      kind: 'split',
      direction: 'horizontal',
      ratio: 0.5,
      a: { kind: 'leaf', id: 'left' },
      b: { kind: 'leaf', id: 'right' },
    };
    render(
      <Workspace
        strategy={recursiveSplit}
        items={[{ id: 'left' }, { id: 'right' }]}
        initialState={initial}
        container={{ w: 400, h: 200 }}
        onStateChange={onStateChange}
      >
        {(item) => (
          <div data-zone-id={item.id} style={{ width: '100%', height: '100%' }} data-testid={`zone-${item.id}`} />
        )}
      </Workspace>,
    );
    const left = document.querySelector('[data-zone-id="left"]') as HTMLElement;
    const right = document.querySelector('[data-zone-id="right"]') as HTMLElement;

    vi.spyOn(left, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 200, bottom: 200, width: 200, height: 200, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    vi.spyOn(right, 'getBoundingClientRect').mockReturnValue({ left: 200, top: 0, right: 400, bottom: 200, width: 200, height: 200, x: 200, y: 0, toJSON: () => ({}) } as DOMRect);

    // Stub elementsFromPoint
    if (!('elementsFromPoint' in document)) {
      Object.defineProperty(document, 'elementsFromPoint', { value: () => [], configurable: true });
    }
    vi.spyOn(document, 'elementsFromPoint').mockImplementation((x: number) => (x < 200 ? [left] : [right]));

    firePointer(left, 'pointerdown', { clientX: 50, clientY: 50 });
    firePointer(left, 'pointermove', { clientX: 250, clientY: 50 });
    firePointer(left, 'pointerup', { clientX: 250, clientY: 50 });

    expect(onStateChange).toHaveBeenCalled();
    const next = onStateChange.mock.calls.at(-1)![0] as SplitNode;
    if (next.kind !== 'split') throw new Error('expected split');
    expect((next.a as { kind: string; id: string }).id).toBe('right');
    expect((next.b as { kind: string; id: string }).id).toBe('left');
  });

  it('controlled mode: external state prop drives layout', () => {
    const initial: SplitNode = {
      kind: 'split',
      direction: 'horizontal',
      ratio: 0.5,
      a: { kind: 'leaf', id: 'a' },
      b: { kind: 'leaf', id: 'b' },
    };
    render(
      <Workspace
        strategy={recursiveSplit}
        items={[{ id: 'a' }, { id: 'b' }]}
        state={initial}
        container={{ w: 200, h: 100 }}
      >
        {(item) => <div data-zone-id={item.id} data-testid={`z-${item.id}`} />}
      </Workspace>,
    );
    expect(document.querySelector('[data-zone-id="a"]')).toBeTruthy();
    expect(document.querySelector('[data-zone-id="b"]')).toBeTruthy();
  });

  it('zone-swap drag fires onGestureStart and onGestureEnd exactly once', () => {
    const onGestureStart = vi.fn();
    const onGestureEnd = vi.fn();
    const initial: SplitNode = {
      kind: 'split',
      direction: 'horizontal',
      ratio: 0.5,
      a: { kind: 'leaf', id: 'a' },
      b: { kind: 'leaf', id: 'b' },
    };
    render(
      <Workspace
        strategy={recursiveSplit}
        items={[{ id: 'a' }, { id: 'b' }]}
        initialState={initial}
        container={{ w: 400, h: 200 }}
        onGestureStart={onGestureStart}
        onGestureEnd={onGestureEnd}
      >
        {(item) => <div data-zone-id={item.id} style={{ width: '100%', height: '100%' }} />}
      </Workspace>,
    );
    const left = document.querySelector('[data-zone-id="a"]') as HTMLElement;
    const right = document.querySelector('[data-zone-id="b"]') as HTMLElement;
    vi.spyOn(left, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 200, bottom: 200, width: 200, height: 200, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    vi.spyOn(right, 'getBoundingClientRect').mockReturnValue({ left: 200, top: 0, right: 400, bottom: 200, width: 200, height: 200, x: 200, y: 0, toJSON: () => ({}) } as DOMRect);
    if (!('elementsFromPoint' in document)) {
      Object.defineProperty(document, 'elementsFromPoint', { value: () => [], configurable: true });
    }
    vi.spyOn(document, 'elementsFromPoint').mockImplementation((x: number) => (x < 200 ? [left] : [right]));
    firePointer(left, 'pointerdown', { clientX: 50, clientY: 50 });
    firePointer(left, 'pointermove', { clientX: 250, clientY: 50 });
    firePointer(left, 'pointerup', { clientX: 250, clientY: 50 });
    expect(onGestureStart).toHaveBeenCalledTimes(1);
    expect(onGestureEnd).toHaveBeenCalledTimes(1);
  });
});
