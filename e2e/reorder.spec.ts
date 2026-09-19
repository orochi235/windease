import { expect, type Page, test } from '@playwright/test';
import { boxOf, centerOf, openStory, settledBox } from './fixtures.js';

/** Rendered child order inside a container, per the DOM's placements. */
function orderIn(page: Page, containerId: string) {
  return page.evaluate((id) => {
    const box = document.querySelector(`[data-node-container="${id}"]`);
    const kids = [...(box?.querySelectorAll('[data-node]') ?? [])].filter(
      (el) =>
        el.parentElement === box || el.parentElement?.getAttribute('data-node-container') === id,
    );
    return kids
      .map((el) => ({
        id: el.getAttribute('data-node'),
        x: el.getBoundingClientRect().x,
        y: el.getBoundingClientRect().y,
      }))
      .sort((a, b) => a.x - b.x || a.y - b.y)
      .map((k) => k.id);
  }, containerId);
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 15 });
  await page.mouse.up();
}

test.describe('reorder: true — Firefox-like tabs', () => {
  const STORY = 'reorder--firefox-tabs';

  test('dragging a tab along its strip reorders it, and the release selects nothing', async ({
    page,
  }) => {
    await openStory(page, STORY);
    await expect.poll(() => orderIn(page, 'top-strip')).toEqual(['news', 'mail', 'docs', 'maps']);
    const mail = centerOf(await settledBox(page.getByTestId('tab-mail')));
    const maps = await boxOf(page.getByTestId('tab-maps'));
    await drag(page, mail, { x: maps.x + maps.w * 0.75, y: mail.y });
    await expect.poll(() => orderIn(page, 'top-strip')).toEqual(['news', 'docs', 'maps', 'mail']);
    await expect(page.getByTestId('selected')).toHaveText('news');
  });

  test('a click on a tab selects it without moving it', async ({ page }) => {
    await openStory(page, STORY);
    await expect(page.getByTestId('selected')).toHaveText('news');
    await page.getByTestId('tab-mail').click();
    await expect(page.getByTestId('selected')).toHaveText('mail');
    expect(await orderIn(page, 'top-strip')).toEqual(['news', 'mail', 'docs', 'maps']);
  });

  test('dragging a tab into the other window moves it there', async ({ page }) => {
    await openStory(page, STORY);
    const music = centerOf(await settledBox(page.getByTestId('tab-music')));
    const maps = await boxOf(page.getByTestId('tab-maps'));
    await drag(page, music, { x: maps.x + maps.w * 0.75, y: maps.y + maps.h / 2 });
    await expect
      .poll(() => orderIn(page, 'top-strip'))
      .toEqual(['news', 'mail', 'docs', 'maps', 'music']);
    expect(await orderIn(page, 'bottom-strip')).toEqual(['notes']);
  });
});

test.describe("reorder: 'handle' — presets", () => {
  const STORY = 'reorder--handle';

  test('only the marked grip starts a drag; the label still clicks', async ({ page }) => {
    await openStory(page, STORY);
    const initial = ['inbox', 'drafts', 'sent', 'archive'];
    await expect.poll(() => orderIn(page, 'folders')).toEqual(initial);

    const label = centerOf(await settledBox(page.getByTestId('row-inbox')));
    const sent = await boxOf(page.getByTestId('row-sent'));
    await drag(page, label, { x: label.x, y: sent.y + sent.h * 0.9 });
    expect(await orderIn(page, 'folders')).toEqual(initial);

    await page.getByTestId('row-drafts').click();
    await expect(page.getByTestId('selected')).toHaveText('drafts');
    expect(await orderIn(page, 'folders')).toEqual(initial);

    const grip = centerOf(await boxOf(page.getByTestId('grip-inbox')));
    const archive = await boxOf(page.locator('[data-node="archive"]'));
    await drag(page, grip, { x: grip.x, y: archive.y + archive.h * 0.8 });
    await expect
      .poll(() => orderIn(page, 'folders'))
      .toEqual(['drafts', 'sent', 'archive', 'inbox']);
  });
});
