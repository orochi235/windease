import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { boxOf, centerOf, dragMouse, openStory } from './fixtures.js';

const DESKTOPS = 'pages--desktops';
const FLOWED = 'pages--flowed';

const node = (page: Page, id: string) => page.locator(`[data-node="${id}"]`);
const pageButton = (page: Page, n: number, of: number) =>
  page.getByRole('button', { name: `Page ${n} of ${of}` });

/** Ids of the children a container renders, in DOM order. */
function shown(page: Page, containerId: string) {
  return page.evaluate(
    (id) =>
      [...document.querySelectorAll(`[data-node-container="${id}"] > [data-node]`)].map((el) =>
        el.getAttribute('data-node'),
      ),
    containerId,
  );
}

test.describe('pages — desktops', () => {
  test('shows only the first desktop at first', async ({ page }) => {
    await openStory(page, DESKTOPS);
    await expect.poll(() => shown(page, 'desk')).toEqual(['mail', 'editor']);
  });

  test('a page button switches desktops', async ({ page }) => {
    await openStory(page, DESKTOPS);
    await pageButton(page, 2, 4).click();
    await expect.poll(() => shown(page, 'desk')).toEqual(['music']);
    await expect(page.getByTestId('dot-1')).toHaveAttribute('data-current', 'true');
  });

  test('page up and down step through desktops and stop at the ends', async ({ page }) => {
    await openStory(page, DESKTOPS);
    await page.keyboard.press('PageUp');
    await expect.poll(() => shown(page, 'desk')).toEqual(['mail', 'editor']);
    await page.keyboard.press('PageDown');
    await page.keyboard.press('PageDown');
    await expect.poll(() => shown(page, 'desk')).toEqual(['notes']);
  });

  test("a window's menu sends it to another desktop", async ({ page }) => {
    await openStory(page, DESKTOPS);
    await page.getByTestId('move-mail').selectOption('3');
    await expect.poll(() => shown(page, 'desk')).toEqual(['editor']);
    await pageButton(page, 4, 4).click();
    await expect.poll(() => shown(page, 'desk')).toEqual(['mail']);
  });

  test('a window dragged in lands on the desktop shown', async ({ page }) => {
    await openStory(page, DESKTOPS);
    await pageButton(page, 2, 4).click();
    await expect.poll(() => shown(page, 'desk')).toEqual(['music']);
    const bar = node(page, 'photos').locator('.pages-window__bar');
    const desk = await boxOf(page.locator('[data-node-container="desk"]'));
    await dragMouse(page, centerOf(await boxOf(bar)), { x: desk.x + desk.w - 60, y: desk.y + 60 });
    await expect.poll(() => shown(page, 'desk')).toContain('photos');
    await pageButton(page, 1, 4).click();
    await expect.poll(() => shown(page, 'desk')).toEqual(['mail', 'editor']);
  });
});

test.describe('pages — flowed', () => {
  test('tiles fill a page and spill onto the next', async ({ page }) => {
    await openStory(page, FLOWED);
    const first = await shown(page, 'tiles');
    expect(first[0]).toBe('tile-1');
    await pageButton(page, 2, 2).click();
    await expect.poll(async () => (await shown(page, 'tiles')).at(-1)).toBe('tile-23');
    await expect.poll(async () => (await shown(page, 'tiles'))[0]).toBe(`tile-${first.length + 1}`);
  });

  test('adding tiles past a full page adds a page', async ({ page }) => {
    await openStory(page, FLOWED);
    const perPage = (await shown(page, 'tiles')).length;
    const add = page.getByRole('button', { name: 'Add a tile' });
    for (let n = 23; n < perPage * 2 + 1; n++) await add.click();
    await expect(pageButton(page, 3, 3)).toBeVisible();
  });
});
