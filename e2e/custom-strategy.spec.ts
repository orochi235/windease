import { expect, type Page, test } from '@playwright/test';
import { centerOf, openStory, settledBox } from './fixtures.js';

const STORY = 'custom-strategy--placement-keys';

const lanes = (page: Page) => page.getByTestId('lanes').textContent();

async function dragToBoard(page: Page, id: string): Promise<void> {
  const from = centerOf(await settledBox(page.getByTestId(`card-${id}`)));
  const to = centerOf(await settledBox(page.getByTestId('board')));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y + 100, { steps: 14 });
  await page.mouse.up();
}

test.describe('a custom strategy reading its own placement key', () => {
  test('flipping a card moves it to the other lane', async ({ page }) => {
    await openStory(page, STORY);
    await expect.poll(() => lanes(page)).toBe('audit:now, payroll:later, taxes:later');
    const before = await settledBox(page.getByTestId('card-audit'));
    await page.getByTestId('flip-audit').click();
    await expect.poll(() => lanes(page)).toBe('audit:later, payroll:later, taxes:later');
    await expect
      .poll(async () => (await settledBox(page.getByTestId('card-audit'))).x)
      .toBeGreaterThan(before.x + 100);
  });

  test('a card dragged onto the board lands in now, and the sixth is refused', async ({ page }) => {
    await openStory(page, STORY);
    await dragToBoard(page, 'invoice');
    await expect.poll(() => lanes(page)).toContain('invoice:now');
    await dragToBoard(page, 'refund');
    await expect.poll(() => lanes(page)).toContain('refund:now');
    await dragToBoard(page, 'receipt');
    await expect(page.getByTestId('inbox').getByTestId('card-receipt')).toBeVisible();
    expect(await lanes(page)).not.toContain('receipt');
  });

  test('save and restore round-trip the custom key', async ({ page }) => {
    await openStory(page, STORY);
    await page.getByTestId('save').click();
    await expect(page.getByTestId('saved')).toHaveText('audit:now, payroll:later, taxes:later');
    await page.getByTestId('flip-payroll').click();
    await expect.poll(() => lanes(page)).toBe('audit:now, payroll:now, taxes:later');
    await page.getByTestId('restore').click();
    await expect.poll(() => lanes(page)).toBe('audit:now, payroll:later, taxes:later');
  });
});
