import { render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FlowVersusPlaced } from './FlowMode.stories.js';
import { MoveWithShiftArrow } from './KeyboardMove.stories.js';
import {
  DragToTheEdgeToScroll,
  GridOverflowModes,
  ScrollAwareNavigation,
} from './Scrolling.stories.js';

/** A story that throws on mount is a broken demo nobody notices until they
 *  open Ladle. These assert only that each one mounts and puts its boxes on
 *  screen — the gestures themselves belong to the Playwright suite.
 *
 *  The keyboard story is checked at its groups rather than its panes: its
 *  nested containers take no explicit viewport, so they measure through a
 *  ResizeObserver that jsdom does not have and stay empty here. */
const STORIES = [
  ['keyboard move', MoveWithShiftArrow, '.cap-group', 2],
  ['flow mode', FlowVersusPlaced, '.cap-pane', 5],
  ['scroll-aware navigation', ScrollAwareNavigation, '.cap-pane', 8],
  ['drag to the edge', DragToTheEdgeToScroll, '.cap-pane', 8],
  ['grid overflow modes', GridOverflowModes, '.cap-pane', 8],
] as const;

describe('capability stories', () => {
  for (const [name, Story, selector, count] of STORIES) {
    it(`${name} mounts and renders ${count} ${selector}`, async () => {
      const { container } = render(<Story />);
      await waitFor(() =>
        expect(container.querySelectorAll(selector).length).toBeGreaterThanOrEqual(count),
      );
    });
  }
});
