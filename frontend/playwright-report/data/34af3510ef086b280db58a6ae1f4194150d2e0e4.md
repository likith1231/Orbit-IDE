# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: screenshot.spec.ts >> screenshot
- Location: tests/e2e/screenshot.spec.ts:2:1

# Error details

```
TimeoutError: page.click: Timeout 15000ms exceeded.
Call log:
  - waiting for locator('button[title="Database"]')

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - navigation [ref=e4]:
    - generic [ref=e5]:
      - generic [ref=e7] [cursor=pointer]: ⚡ AI Cloud IDE
      - list [ref=e8]:
        - listitem [ref=e9]:
          - link "Features" [ref=e10] [cursor=pointer]:
            - /url: "#features"
        - listitem [ref=e11]:
          - link "About" [ref=e12] [cursor=pointer]:
            - /url: "#about"
        - listitem [ref=e13]:
          - link "Pricing" [ref=e14] [cursor=pointer]:
            - /url: "#pricing"
        - listitem [ref=e15]:
          - link "Docs" [ref=e16] [cursor=pointer]:
            - /url: "#docs"
      - link "Sign in" [ref=e18] [cursor=pointer]:
        - /url: /login
  - main [ref=e19]:
    - generic [ref=e20]:
      - generic [ref=e21]:
        - heading "Your AI-Powered Coding Sandbox" [level=1] [ref=e22]
        - paragraph [ref=e23]: Code, test, and deploy instantly with built-in Docker isolation, AI assistance, and chaos engineering.
        - generic [ref=e24]:
          - generic [ref=e25]:
            - generic [ref=e26]: ⚡
            - heading "Instant Execution" [level=3] [ref=e27]
            - paragraph [ref=e28]: Run 15+ languages in isolated containers
          - generic [ref=e29]:
            - generic [ref=e30]: 🤖
            - heading "AI Assistant" [level=3] [ref=e31]
            - paragraph [ref=e32]: Auto-fix bugs and scaffold entire projects
          - generic [ref=e33]:
            - generic [ref=e34]: 💥
            - heading "Chaos Testing" [level=3] [ref=e35]
            - paragraph [ref=e36]: Test resilience under extreme conditions
      - generic [ref=e38]:
        - generic [ref=e39]:
          - heading "Sign in" [level=2] [ref=e40]
          - paragraph [ref=e41]: Welcome back to your workspace
        - generic [ref=e42]:
          - generic [ref=e43]:
            - generic [ref=e44]: Email
            - textbox "you@example.com" [ref=e45]
          - generic [ref=e46]:
            - generic [ref=e47]: Password
            - textbox "••••••••" [ref=e48]
          - button "Sign in" [ref=e49] [cursor=pointer]
        - paragraph [ref=e51]:
          - text: Don't have an account?
          - link "Create one" [ref=e52] [cursor=pointer]:
            - /url: /signup
    - generic [ref=e54]:
      - heading "Ready to code smarter?" [level=2] [ref=e55]
      - paragraph [ref=e56]: Join thousands of developers using AI Cloud IDE for faster development cycles.
      - link "Get Started Free" [ref=e57] [cursor=pointer]:
        - /url: /signup
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | test('screenshot', async ({ page }) => {
  3  |   await page.goto('http://localhost:5173');
  4  |   await page.waitForTimeout(2000);
  5  |   
  6  |   // Try to login if we are on the login page
  7  |   const loginInput = await page.locator('.auth-input[type="email"]').count();
  8  |   if (loginInput > 0) {
  9  |     await page.fill('.auth-input[type="email"]', 'test@test.com');
  10 |     await page.fill('.auth-input[type="password"]', 'password');
  11 |     await page.click('.auth-btn');
  12 |     await page.waitForTimeout(2000);
  13 |   }
  14 |   
  15 |   // Pick a project if needed
  16 |   const projectItem = await page.locator('.project-item').first().count();
  17 |   if (projectItem > 0) {
  18 |     await page.click('.project-item');
  19 |     await page.waitForTimeout(2000);
  20 |   }
  21 | 
  22 |   // Open Database panel
> 23 |   await page.click('button[title="Database"]');
     |              ^ TimeoutError: page.click: Timeout 15000ms exceeded.
  24 |   await page.waitForTimeout(1000);
  25 |   await page.screenshot({ path: '../../brain/0390a21d-42a8-4e37-a669-58cc07c2cc3f/final-database.png' });
  26 | 
  27 |   // Open extensions
  28 |   await page.click('button[title="Extensions"]');
  29 |   await page.waitForTimeout(500);
  30 |   await page.screenshot({ path: '../../brain/0390a21d-42a8-4e37-a669-58cc07c2cc3f/final-extensions.png' });
  31 | 
  32 |   // Open search
  33 |   await page.click('button[title="Search"]');
  34 |   await page.waitForTimeout(500);
  35 |   await page.screenshot({ path: '../../brain/0390a21d-42a8-4e37-a669-58cc07c2cc3f/final-search.png' });
  36 | });
  37 | 
```