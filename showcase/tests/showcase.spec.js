import { test, expect } from '@playwright/test';

test('desktop visitor can explore workspaces and request a custom paid build', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Make room for diplomacy.' })).toBeVisible();
  await page.getByRole('link', { name: 'See the connected workflow' }).click();
  await page.getByRole('tab', { name: /Move ideas forward/ }).click();
  await expect(page.getByRole('tabpanel')).toContainText('Changes requested');
  await page.getByRole('tab', { name: /Move ideas forward/ }).press('ArrowDown');
  await expect(page.getByRole('tab', { name: /Close the loop/ })).toBeFocused();
  await expect(page.getByRole('tabpanel')).toContainText('Print queue');
  await page.getByRole('tab', { name: /Close the loop/ }).press('Home');
  await expect(page.getByRole('tabpanel')).toContainText('Roll call');
  await expect(page.getByRole('link', { name: 'Let’s build something great' })).toHaveAttribute('href', /^mailto:zuhayrsidq@gmail.com\?subject=/);
  await expect(page.locator('#contact')).toContainText('paid service');
  await expect(page.getByRole('link', { name: 'zuhayrsidq@gmail.com ↗' })).toHaveAttribute('href', 'mailto:zuhayrsidq@gmail.com');
  await expect(page.locator('#people')).toContainText('John Paul Ribeiru');
  const brand = await page.request.get('/munos-brand-sheet.svg');
  expect(brand.ok()).toBeTruthy();
  expect(await brand.text()).toContain('data:image/png;base64,');
  await page.goto('/');
  await page.screenshot({ path: 'test-results/desktop.png', fullPage: true, animations: 'disabled' });
  expect(errors).toEqual([]);
});

test('mobile layout stays within viewport and tabs work horizontally', async ({ page }) => {
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    await page.getByRole('tab', { name: /Move ideas forward/ }).click();
    await expect(page.getByRole('tabpanel')).toContainText('From draft to decision.');
    if (width < 761) await expect(page.getByRole('tablist')).toHaveAttribute('aria-orientation', 'horizontal');
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true, animations: 'disabled' });
});

test('reduced motion and disabling JavaScript keep the message usable', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto('http://localhost:4173');
  await expect(page.getByRole('heading', { name: 'Make room for diplomacy.' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.getAnimations().filter(a => a.playState === 'running').length)).toBe(0);
  await page.getByRole('tab', { name: /Close the loop/ }).click();
  await expect(page.getByRole('tabpanel')).toContainText('Print queue');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => page.evaluate(() => document.getAnimations().filter(a => a.playState === 'running').length)).toBe(0);
  await context.close();
  const noJs = await browser.newContext({ javaScriptEnabled: false });
  const fallback = await noJs.newPage();
  await fallback.goto('http://localhost:4173');
  await expect(fallback.getByRole('heading', { name: 'Make room for diplomacy.' })).toBeVisible();
  await expect(fallback.locator('#contact')).toContainText('paid service');
  await expect(fallback.locator('.no-script-note')).toContainText('approval review');
  await noJs.close();
});

test('scroll storytelling highlights the resolution handoffs beneath executive oversight', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await expect(page.locator('html')).toHaveClass(/scroll-cinema/);
  await expect(page.locator('.workflow-stages li')).toHaveCount(3);
  await expect(page.locator('.oversight-band')).toContainText('Decisions stay in each team’s workspace');
  for (const [fraction, index] of [[0.1, 0], [0.5, 1], [0.9, 2]]) {
    await page.locator('.workflow-scene').evaluate((scene, f) => {
      const start = scene.getBoundingClientRect().top + window.scrollY - 90;
      const end = scene.getBoundingClientRect().bottom + window.scrollY - window.innerHeight;
      window.scrollTo({ top: start + (end - start) * f, behavior: 'instant' });
    }, fraction);
    await expect(page.locator('.workflow-stages li').nth(index)).toHaveAttribute('data-active', 'true');
    await expect(page.locator('.oversight-band')).toBeInViewport();
  }
  await page.screenshot({ path: 'test-results/workflow-scroll.png', animations: 'disabled' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('html')).not.toHaveClass(/scroll-cinema/);
  await expect(page.locator('.workflow-pin')).toHaveCSS('position', 'static');
});
