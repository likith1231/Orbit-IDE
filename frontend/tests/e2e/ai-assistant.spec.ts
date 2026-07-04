import { test, expect } from '@playwright/test';

test('AI Assistant flow', async ({ page }) => {
  const timestamp = Date.now();
  const testEmail = `ai-test-${timestamp}@example.com`;
  const testPassword = 'password123';

  await page.goto('/signup');
  await page.fill('input[placeholder="Likith Kumar"]', 'AI Test User');
  await page.fill('input[type="email"]', testEmail);
  await page.fill('input[type="password"]', testPassword);
  await page.click('button[type="submit"]');

  await expect(page).toHaveURL(/\/ide/);

  const chatTab = page.locator('.ai-tab', { hasText: 'Chat' });
  if (await chatTab.isVisible()) {
    await chatTab.click();
  }

  await page.fill('.chat-input', 'explain this file');
  await page.click('.chat-send-btn');

  // Verify that an assistant response appears
  // Look for a chat message from the assistant (excluding the loading dots)
  const assistantMessage = page.locator('.chat-msg.assistant').filter({ hasNot: page.locator('.typing-dot') }).last();
  await expect(assistantMessage).toBeVisible({ timeout: 30000 });
});
