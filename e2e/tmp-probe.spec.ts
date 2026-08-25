import { test } from '@playwright/test';
import { boxOf, openStory } from './fixtures.js';
const OUT = '/private/tmp/claude-501/-Users-mike-src-windease/112138c4-9aa7-4d8b-bb37-9bc0be870fd4/scratchpad';
const S = 'declarative--drop-intent';

async function drop(page, gripId: string, target: {x:number;y:number}, shot?: string) {
  const g = await boxOf(page.getByTestId(gripId));
  await page.mouse.move(g.x + g.w / 2, g.y + g.h / 2);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 12 });
  await page.waitForTimeout(120);
  if (shot) await page.screenshot({ path: `${OUT}/${shot}` });
  await page.mouse.up();
  await page.waitForTimeout(350);
}

test('centre drop stacks', async ({ page }) => {
  await openStory(page, S);
  const r = page.getByTestId('dd-readout');
  const a = await boxOf(page.locator('[data-node="alpha"]'));
  await drop(page, 'grip-charlie', { x: a.x + a.w / 2, y: a.y + a.h / 2 }, 'dd-stack-hover.png');
  console.log('STACK →', await r.textContent());
  await page.screenshot({ path: `${OUT}/dd-stacked.png` });
});

test('edge drop splits', async ({ page }) => {
  await openStory(page, S);
  const r = page.getByTestId('dd-readout');
  const a = await boxOf(page.locator('[data-node="alpha"]'));
  await drop(page, 'grip-charlie', { x: a.x + a.w / 2, y: a.y + 6 }, 'dd-split-hover.png');
  console.log('SPLIT →', await r.textContent());
  await page.screenshot({ path: `${OUT}/dd-split.png` });
});

test('seam drop inserts', async ({ page }) => {
  await openStory(page, S);
  const r = page.getByTestId('dd-readout');
  const a = await boxOf(page.locator('[data-node="alpha"]'));
  await drop(page, 'grip-charlie', { x: a.x + 3, y: a.y + a.h / 2 });
  console.log('INSERT →', await r.textContent());
});
