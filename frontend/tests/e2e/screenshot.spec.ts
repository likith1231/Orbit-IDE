import { test, expect } from '@playwright/test';
test('screenshot', async ({ page }) => {
  await page.goto('http://localhost:5173');
  await page.waitForTimeout(2000);
  
  // Try to login if we are on the login page
  const loginInput = await page.locator('.auth-input[type="email"]').count();
  if (loginInput > 0) {
    await page.fill('.auth-input[type="email"]', 'test@test.com');
    await page.fill('.auth-input[type="password"]', 'password');
    await page.click('.auth-btn');
    await page.waitForTimeout(2000);
  }
  
  // Pick a project if needed
  const projectItem = await page.locator('.project-item').first().count();
  if (projectItem > 0) {
    await page.click('.project-item');
    await page.waitForTimeout(2000);
  }

  // Open Database panel
  await page.click('button[title="Database"]');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: '../../brain/0390a21d-42a8-4e37-a669-58cc07c2cc3f/final-database.png' });

  // Open extensions
  await page.click('button[title="Extensions"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: '../../brain/0390a21d-42a8-4e37-a669-58cc07c2cc3f/final-extensions.png' });

  // Open search
  await page.click('button[title="Search"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: '../../brain/0390a21d-42a8-4e37-a669-58cc07c2cc3f/final-search.png' });
});
