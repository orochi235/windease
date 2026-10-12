import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { asNodeId, createNode, type NodeId, Store, type WorkspaceSeam } from '../index.js';
import { Provider } from './Provider.js';
import { Workspace, WorkspaceRoot } from './Workspace.js';

const SIDE = asNodeId('side');
const MAIN = asNodeId('main');

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const FRAME: Box = { x: 10, y: 20, w: 800, h: 400 };
const BOXES: Record<string, Box> = {
  side: { x: 10, y: 20, w: 200, h: 400 },
  main: { x: 218, y: 20, w: 592, h: 400 },
};

/** jsdom lays nothing out, so each root answers with the box its id names, or
 *  with none while the workspace has it out of view. */
function stubRects() {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const id = this.getAttribute('data-workspace-root');
    const shown = this.getAttribute('data-workspace-state') === 'placed';
    const b = this.classList.contains('windease-workspace')
      ? FRAME
      : id && shown
        ? (BOXES[id] ?? { x: 0, y: 0, w: 0, h: 0 })
        : { x: 0, y: 0, w: 0, h: 0 };
    return {
      x: b.x,
      y: b.y,
      left: b.x,
      top: b.y,
      right: b.x + b.w,
      bottom: b.y + b.h,
      width: b.w,
      height: b.h,
      toJSON: () => ({}),
    } as DOMRect;
  });
}

function build(): Store {
  const s = new Store();
  for (const [id, title] of [
    [SIDE, 'Sidebar'],
    [MAIN, 'Main'],
  ] as const) {
    s.registerNode(
      createNode({
        kind: 'zone',
        id,
        container: { strategyId: 'strip', config: {} },
        meta: { title },
        hints: { minSize: { w: 120, h: 0 } },
      }),
    );
    s.showNode(id);
  }
  return s;
}

const SEAMS: WorkspaceSeam[] = [{ before: SIDE, after: MAIN, axis: 'x', overshoot: 'hide' }];

function mount(store: Store, zoom?: NodeId) {
  stubRects();
  return render(
    <Provider store={store}>
      <Workspace seams={SEAMS} {...(zoom ? { zoom } : {})}>
        <WorkspaceRoot id={SIDE} className="side">
          side
        </WorkspaceRoot>
        <WorkspaceRoot id={MAIN}>main</WorkspaceRoot>
      </Workspace>
    </Provider>,
  );
}

const rootEl = (c: HTMLElement, id: string) =>
  c.querySelector<HTMLElement>(`[data-workspace-root="${id}"]`)!;

afterEach(() => vi.restoreAllMocks());

describe('<Workspace>', () => {
  it('draws the seam between two measured roots, in its own coordinates', () => {
    const { container } = mount(build());
    const seam = container.querySelector<HTMLElement>('[role="separator"]')!;
    expect(seam.getAttribute('aria-label')).toBe('resize Sidebar and Main');
    expect(seam.getAttribute('aria-valuenow')).toBe('200');
    expect(seam.getAttribute('aria-valuemin')).toBe('120');
    expect(seam.getAttribute('aria-valuemax')).toBe('672');
    const line = seam.querySelector<HTMLElement>('[data-affordance]')!;
    expect(line.getAttribute('data-affordance')).toBe('workspace-seam-side-main');
    expect(seam.style.left).toBe('198px');
    expect(seam.style.height).toBe('400px');
  });

  it('writes an arrow key on the seam to the store and sizes the root from it', () => {
    const store = build();
    const { container } = mount(store);
    const seam = container.querySelector<HTMLElement>('[role="separator"]')!;
    act(() => {
      fireEvent.keyDown(seam, { key: 'ArrowRight' });
      store.flushNow();
    });
    expect(store.getNode(SIDE)?.hints?.size).toEqual({ w: 208 });
    expect(rootEl(container, 'side').style.width).toBe('208px');
    expect(rootEl(container, 'main').style.width).toBe('');
    expect(rootEl(container, 'side').className).toBe('windease-workspace-root side');
  });

  it('takes a hidden root out of view and shows it again from its handle', () => {
    const store = build();
    const { container } = mount(store);
    act(() => {
      store.hideNode(SIDE);
      store.flushNow();
    });
    expect(rootEl(container, 'side').getAttribute('data-workspace-state')).toBe('hidden');
    expect(container.querySelector('[role="separator"]')).toBeNull();
    const handle = container.querySelector<HTMLElement>(
      '[data-affordance-hit="workspace-reveal-side"]',
    )!;
    expect(handle.getAttribute('aria-label')).toBe('show Sidebar');
    act(() => {
      fireEvent.keyDown(handle, { key: 'Enter' });
      store.flushNow();
    });
    expect(store.getNode(SIDE)?.lifecycle.state).toBe('visible');
    expect(rootEl(container, 'side').getAttribute('data-workspace-state')).toBe('placed');
    expect(container.querySelector('[role="separator"]')).not.toBeNull();
  });

  it('hides the root a seam is pushed past its floor into, on Enter', () => {
    const store = build();
    const { container } = mount(store);
    const press = (key: string) =>
      act(() => {
        fireEvent.keyDown(container.querySelector<HTMLElement>('[role="separator"]')!, { key });
        store.flushNow();
      });
    press('Home');
    expect(store.getNode(SIDE)?.hints?.size).toEqual({ w: 120 });
    for (let i = 0; i < 4; i++) press('ArrowLeft');
    expect(rootEl(container, 'side').getAttribute('data-join-armed')).toBe('true');
    press('Enter');
    expect(store.getNode(SIDE)?.lifecycle.state).toBe('hidden');
    expect(store.getNode(SIDE)?.hints?.size).toBeUndefined();
  });

  it('lays a zoomed root over the rest and draws no seams', () => {
    const { container } = mount(build(), MAIN);
    expect(rootEl(container, 'main').getAttribute('data-workspace-state')).toBe('zoomed');
    expect(rootEl(container, 'side').getAttribute('data-workspace-state')).toBe('withheld');
    expect(container.querySelector('[role="separator"]')).toBeNull();
  });

  it('draws nothing with affordances off', () => {
    stubRects();
    const { container } = render(
      <Provider store={build()}>
        <Workspace seams={SEAMS} affordances={false}>
          <WorkspaceRoot id={SIDE} />
          <WorkspaceRoot id={MAIN} />
        </Workspace>
      </Provider>,
    );
    expect(container.querySelector('[role="separator"]')).toBeNull();
  });

  it('refuses a root outside a workspace', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      render(
        <Provider store={build()}>
          <WorkspaceRoot id={SIDE} />
        </Provider>,
      ),
    ).toThrow('<WorkspaceRoot> must be used inside <Workspace>');
    quiet.mockRestore();
  });
});
