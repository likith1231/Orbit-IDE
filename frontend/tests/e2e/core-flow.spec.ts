import { test, expect } from '@playwright/test';

test('Core flow: Signup, IDE usage, Run, Logout, Persistence', async ({ page }) => {
  test.setTimeout(120_000); // first run may pull a Docker image
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
  // New accounts start with a README.md and a main.py.
  const mainPy = page.locator('.file-name', { hasText: 'main.py' });
  await expect(mainPy).toBeVisible();

  await mainPy.click();
  
  await page.waitForTimeout(2000); // Give Monaco time to render
  
  // Click inside the editor view-lines to focus it
  await page.locator('.view-lines').click();
  
  const codeToType = `# E2E Test Code ${timestamp}\nprint("Hello from Playwright")`;
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Meta+A'); 
  await page.keyboard.press('Backspace');
  await page.keyboard.type(codeToType);

  const savedIndicator = page.locator('text=saved'); // Wait for "saved" text. It says '✓ saved' in the screenshot
  await expect(savedIndicator).toBeVisible({ timeout: 15000 });

  // Click the run button at the top header
  await page.locator('button.run-btn').filter({ hasText: 'Run' }).first().click();
  
  // Program output is shown in the Run tab of the terminal panel.
  const runOutput = page.locator('.terminal-host:visible .xterm-rows');
  await expect(runOutput.first()).toContainText('Hello from Playwright', { timeout: 60000 });

  await page.click('.logout-btn');
  await expect(page).toHaveURL(/\/login/);

  await page.fill('input[type="email"]', testEmail);
  await page.fill('input[type="password"]', testPassword);
  await page.click('button[type="submit"]');

  await expect(page).toHaveURL(/\/ide/);
  
  await page.locator('.file-name', { hasText: 'main.py' }).click();
  
  await page.waitForTimeout(2000);
  await expect(page.locator('.view-lines').first()).toContainText(`E2E Test Code ${timestamp}`);
});
