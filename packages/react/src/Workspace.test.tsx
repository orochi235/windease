import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { binarySplit } from '@windease/core';
import { Workspace } from './Workspace.js';

// jsdom lacks pointer capture; shim for drag tests.
beforeAll(() => {
  if (!('setPointerCapture' in Element.prototype)) {
    Element.prototype.setPointerCapture = () => {};
  }
  if (!('releasePointerCapture' in Element.prototype)) {
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!('hasPointerCapture' in Element.prototype)) {
    Element.prototype.hasPointerCapture = () => true;
  }
});

// jsdom's PointerEvent doesn't propagate clientX/clientY from init; fall back to MouseEvent
// (which does) and label it as a pointer event for React's synthetic event dispatcher.
function firePointer(
  el: Element,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  init: { clientX: number; clientY: number; pointerId?: number },
): void {
  const evt = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: init.clientX,
    clientY: init.clientY,
  });
  Object.defineProperty(evt, 'pointerId', { value: init.pointerId ?? 1 });
  Object.defineProperty(evt, 'pointerType', { value: 'mouse' });
  el.dispatchEvent(evt);
}

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
});
