import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Bounce, ColdStartFlood, TruthVsPublished } from './Throttling.stories.js';

// Ladle stories are not exercised by the rest of the test suite. These
// smoke tests only prove each story mounts, drives its interaction, and
// tears down without throwing — not that the pixels are right.

afterEach(() => {
  cleanup();
});

describe('Throttling stories smoke test', () => {
  it('Bounce renders and survives a full bounce cycle without throwing', async () => {
    vi.useFakeTimers();
    try {
      const { getByText } = render(<Bounce throttled={true} dwellMs={0} />);
      const button = getByText(/Bounce \(show/);

      act(() => {
        button.click();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('Bounce renders with throttled=false (identity passthrough)', async () => {
    vi.useFakeTimers();
    try {
      const { getByText } = render(<Bounce throttled={false} dwellMs={150} />);
      const button = getByText(/Bounce \(show/);
      act(() => {
        button.click();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('ColdStartFlood registers and resets 24 panels without throwing', async () => {
    vi.useFakeTimers();
    try {
      const { getByText } = render(
        <ColdStartFlood throttled={true} notifyMs={16} staggerBatch={4} staggerMs={40} />,
      );
      const registerButton = getByText('Register 24 panels');

      act(() => {
        registerButton.click();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });

      const resetButton = getByText('Reset');
      act(() => {
        resetButton.click();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('TruthVsPublished renders the readout and survives churning', async () => {
    vi.useFakeTimers();
    try {
      const { getByText } = render(
        <TruthVsPublished throttled={true} notifyMs={16} dwellMs={100} />,
      );
      const churnButton = getByText('Start churn');

      act(() => {
        churnButton.click();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });

      act(() => {
        getByText('Stop churn').click();
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
