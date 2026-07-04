import { test, expect } from '@playwright/test';

test('Core flow: Signup, IDE usage, Run, Logout, Persistence', async ({ page }) => {
  const timestamp = Date.now();
  const testEmail = `test-${timestamp}@example.com`;
  const testPassword = 'password123';

  await page.goto('/signup');
  await page.fill('input[placeholder="Likith Kumar"]', 'Test User');
  await page.fill('input[type="email"]', testEmail);
  await page.fill('input[type="password"]', testPassword);
  await page.click('button[type="submit"]');

  await expect(page).toHaveURL(/\/ide/);

  await expect(page.locator('.file-tree')).toBeVisible();
  const indexJsFile = page.locator('.file-name', { hasText: 'index.js' });
  await expect(indexJsFile).toBeVisible();

  await indexJsFile.click();
  
  await page.waitForTimeout(2000); // Give Monaco time to render
  
  // Click inside the editor view-lines to focus it
  await page.locator('.view-lines').click();
  
  const codeToType = `// E2E Test Code ${timestamp}\nconsole.log("Hello from Playwright");`;
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Meta+A'); 
  await page.keyboard.press('Backspace');
  await page.keyboard.type(codeToType);

  const savedIndicator = page.locator('text=saved'); // Wait for "saved" text. It says '✓ saved' in the screenshot
  await expect(savedIndicator).toBeVisible({ timeout: 15000 });

  // Click the run button at the top header
  await page.locator('button.run-btn').filter({ hasText: 'Run' }).first().click();
  
  // Output might appear in the xterm terminal or output tab. Let's wait for the terminal content.
  // xterm usually renders text in .xterm-rows
  const outputOrTerminal = page.locator('.xterm-rows, .problems-host');
  await expect(outputOrTerminal.first()).toContainText('Hello from Playwright', { timeout: 25000 });

  await page.click('.logout-btn');
  await expect(page).toHaveURL(/\/login/);

  await page.fill('input[type="email"]', testEmail);
  await page.fill('input[type="password"]', testPassword);
  await page.click('button[type="submit"]');

  await expect(page).toHaveURL(/\/ide/);
  
  await page.locator('.file-name', { hasText: 'index.js' }).click();
  
  await page.waitForTimeout(2000);
  await expect(page.locator('.view-lines').first()).toContainText(`E2E Test Code ${timestamp}`);
});
