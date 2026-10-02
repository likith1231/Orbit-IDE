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

  test.setTimeout(120_000);
  // The agent panel is open by default.
  await page.fill('.chat-input', 'In one sentence, what does main.py do?');
  await page.click('.send-btn');

  // A new assistant reply (after the welcome message) finishes streaming.
  const replies = page.locator('.chat-msg.assistant .chat-bubble');
  await expect(replies).toHaveCount(2, { timeout: 30000 });
  await expect(replies.last()).not.toContainText('Thinking', { timeout: 90000 });
  await expect(replies.last()).not.toBeEmpty();
});
