import { expect, type Page, test } from '@playwright/test';
import { boxOf, centerOf, dragMouse, dropAt, openStory, settledBox } from './fixtures.js';

const STORY = 'workspace--roots-in-the-hosts-layout';

const root = (page: Page, id: string) => page.locator(`[data-workspace-root="ws-${id}"]`);
const seam = (page: Page, before: string, after: string) =>
  page.locator(`[data-affordance-hit="workspace-seam-ws-${before}-ws-${after}"]`);
const reveal = (page: Page, id: string) =>
  page.locator(`[data-affordance-hit="workspace-reveal-ws-${id}"]`);
const size = (page: Page, id: string) => page.getByTestId(`ws-size-ws-${id}`);
const shell = (page: Page) => page.locator('.ws-shell');

const widthOf = (page: Page, id: string) => async () => Math.round((await boxOf(root(page, id))).w);
const heightOf = (page: Page, id: string) => async () =>
  Math.round((await boxOf(root(page, id))).h);

function focusedNode(page: Page) {
  return page.evaluate(
    () => document.activeElement?.closest('[data-node]')?.getAttribute('data-node') ?? null,
  );
}

/** Press on a seam and travel `dx`, `dy` from its center, leaving the button
 *  down. Returns where the pointer ended up. */
async function pressAndMove(page: Page, handle: ReturnType<typeof seam>, dx: number, dy: number) {
  const from = centerOf(await settledBox(handle));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 10 });
  return { x: from.x + dx, y: from.y + dy };
}

test.describe('workspace: roots the host lays out', () => {
  test('dragging the sidebar seam sizes the sidebar and main takes the rest', async ({ page }) => {
    await openStory(page, STORY);
    expect(Math.round((await settledBox(root(page, 'side'))).w)).toBe(200);
    await expect(size(page, 'side')).toHaveText('as the CSS has it');

    const from = centerOf(await settledBox(seam(page, 'side', 'main')));
    await dragMouse(page, from, dropAt({ x: from.x + 60, y: from.y }));

    await expect.poll(widthOf(page, 'side')).toBe(260);
    // 800 across, less the 8px gap and the sidebar.
    await expect.poll(widthOf(page, 'main')).toBe(532);
    await expect(size(page, 'side')).toHaveText('w 260');
  });

  test('locking the sidebar size takes its seam away, and unlocking brings it back', async ({
    page,
  }) => {
    await openStory(page, STORY);
    await expect(seam(page, 'side', 'main')).toHaveCount(1);
    await page.getByTestId('ws-lock-ws-side').click();
    await expect(seam(page, 'side', 'main')).toHaveCount(0);
    // The dock's seam names neither locked root.
    await expect(seam(page, 'main', 'dock')).toHaveCount(1);
    await page.getByTestId('ws-lock-ws-side').click();
    await expect(seam(page, 'side', 'main')).toHaveCount(1);
  });

  test('the seam stops at the sidebar ceiling and at the main floor', async ({ page }) => {
    await openStory(page, STORY);
    const from = centerOf(await settledBox(seam(page, 'side', 'main')));
    await dragMouse(page, from, dropAt({ x: from.x + 500, y: from.y }));
    await expect.poll(widthOf(page, 'side')).toBe(360);
    await expect(seam(page, 'side', 'main')).toHaveAttribute('aria-valuenow', '360');
    await expect(seam(page, 'side', 'main')).toHaveAttribute('aria-valuemax', '360');
  });

  test('the seam above the dock sizes the dock, which sits after it', async ({ page }) => {
    await openStory(page, STORY);
    expect(Math.round((await settledBox(root(page, 'dock'))).h)).toBe(120);
    const from = centerOf(await settledBox(seam(page, 'main', 'dock')));
    await dragMouse(page, from, dropAt({ x: from.x, y: from.y - 40 }));
    await expect.poll(heightOf(page, 'dock')).toBe(160);
    // The sidebar shares the row above the dock, so it gives up the same 40.
    await expect.poll(heightOf(page, 'side')).toBe(312);
    await expect(size(page, 'dock')).toHaveText('h 160');
  });

  test('arrow keys move a focused seam', async ({ page }) => {
    await openStory(page, STORY);
    await seam(page, 'side', 'main').focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect.poll(widthOf(page, 'side')).toBe(216);
    await page.keyboard.press('Home');
    await expect.poll(widthOf(page, 'side')).toBe(120);
  });

  test('a seam pushed past the floor hides the root, and its handle brings it back', async ({
    page,
  }) => {
    await openStory(page, STORY);
    // 80 to the 120px floor, then past the 24px threshold.
    const floor = await pressAndMove(page, seam(page, 'side', 'main'), -80, 0);
    await page.mouse.move(floor.x - 40, floor.y, { steps: 6 });
    await expect(root(page, 'side')).toHaveAttribute('data-join-armed', 'true');
    await page.mouse.up();

    await expect(root(page, 'side')).toBeHidden();
    await expect(size(page, 'side')).toHaveText('hidden');
    await expect.poll(widthOf(page, 'main')).toBe(800);
    await expect(seam(page, 'side', 'main')).toHaveCount(0);

    await pressAndMove(page, reveal(page, 'side'), 40, 0);
    await expect(reveal(page, 'side')).toHaveAttribute('data-reveal-armed', 'true');
    await page.mouse.up();

    // Back at the width the drag found it with, not the floor it was pushed to.
    await expect.poll(widthOf(page, 'side')).toBe(200);
    await expect(size(page, 'side')).toHaveText('as the CSS has it');
  });

  test('main cannot be hidden by its seams', async ({ page }) => {
    await openStory(page, STORY);
    await pressAndMove(page, seam(page, 'side', 'main'), 700, 0);
    await expect.poll(widthOf(page, 'side')).toBe(360);
    await expect(root(page, 'main')).not.toHaveAttribute('data-join-armed', 'true');
    await page.mouse.up();
    await expect(root(page, 'main')).toBeVisible();
  });

  test('hiding a root from the host leaves a handle that shows it', async ({ page }) => {
    await openStory(page, STORY);
    await page.getByTestId('ws-toggle-ws-dock').click();
    await expect(root(page, 'dock')).toBeHidden();
    await expect.poll(heightOf(page, 'main')).toBe(480);

    await reveal(page, 'dock').focus();
    await page.keyboard.press('Enter');
    await expect.poll(heightOf(page, 'dock')).toBe(120);
    await expect.poll(heightOf(page, 'main')).toBe(352);
  });

  test('a zoomed root covers the workspace and the others keep their place', async ({ page }) => {
    await openStory(page, STORY);
    const from = centerOf(await settledBox(seam(page, 'side', 'main')));
    await dragMouse(page, from, dropAt({ x: from.x + 60, y: from.y }));
    await expect.poll(widthOf(page, 'side')).toBe(260);

    await page.getByTestId('ws-zoom').click();
    await expect(root(page, 'main')).toHaveAttribute('data-workspace-state', 'zoomed');
    await expect
      .poll(async () => {
        const b = await boxOf(root(page, 'main'));
        const s = await boxOf(shell(page));
        return [b.x - s.x, b.y - s.y, b.w, b.h].map(Math.round);
      })
      .toEqual([0, 0, 800, 480]);
    await expect(root(page, 'side')).toBeHidden();
    await expect(root(page, 'dock')).toBeHidden();
    await expect(page.locator('.ws-shell [data-affordance-hit]')).toHaveCount(0);

    await page.getByTestId('ws-zoom').click();
    await expect.poll(widthOf(page, 'side')).toBe(260);
    await expect.poll(heightOf(page, 'dock')).toBe(120);
  });

  test('arrow keys cross between roots, and not into a withheld one', async ({ page }) => {
    await openStory(page, STORY);
    await page.locator('[data-node="ws-editor"]').click();
    await expect.poll(() => focusedNode(page)).toBe('ws-editor');
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => focusedNode(page)).toBe('ws-terminal');

    await page.getByTestId('ws-zoom').click();
    await expect(root(page, 'dock')).toBeHidden();
    await page.locator('[data-node="ws-editor"]').click();
    await expect.poll(() => focusedNode(page)).toBe('ws-editor');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowLeft');
    // Give a wrong move the frames it would need to land.
    await page.evaluate(
      () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
    );
    expect(await focusedNode(page)).toBe('ws-editor');
  });

  test('a panel drags from one root into another', async ({ page }) => {
    await openStory(page, STORY);
    const from = centerOf(await settledBox(page.locator('[data-node="ws-files"]')));
    const to = centerOf(await settledBox(root(page, 'dock')));
    await dragMouse(page, from, dropAt(to));
    await expect(root(page, 'dock').locator('[data-node="ws-files"]')).toHaveCount(1);
  });
});

test.describe('workspace: a sized root whose neighbor is hidden', () => {
  test('takes the row while main is hidden and its dragged width when main is back', async ({
    page,
  }) => {
    await openStory(page, 'workspace--a-sized-root-left-alone');
    const from = centerOf(await settledBox(seam(page, 'side', 'main')));
    await dragMouse(page, from, dropAt({ x: from.x + 60, y: from.y }));
    await expect.poll(widthOf(page, 'side')).toBe(260);

    await page.getByTestId('ws-toggle-ws-main').click();
    await expect(root(page, 'side')).toHaveAttribute('data-workspace-fill', 'w');
    await expect.poll(widthOf(page, 'side')).toBe(800);
    await expect(size(page, 'side')).toHaveText('w 260');

    await page.getByTestId('ws-toggle-ws-main').click();
    await expect(root(page, 'side')).not.toHaveAttribute('data-workspace-fill');
    await expect.poll(widthOf(page, 'side')).toBe(260);
  });
});

test.describe('Workspace: which root a node is in', () => {
  test('reads the focused root, and one moveNode sends the panel to main', async ({ page }) => {
    await openStory(page, STORY);
    const files = page.locator('[data-node="ws-files"]');
    await files.click();
    await expect(page.getByTestId('ws-focused-root')).toHaveText('Sidebar');
    await page.getByTestId('ws-send-to-main').click();
    await expect(root(page, 'main').locator('[data-node="ws-files"]')).toHaveCount(1);
    await expect(page.getByTestId('ws-focused-root')).toHaveText('Main');
    await expect(page.getByTestId('ws-send-to-main')).toBeDisabled();
  });
});
