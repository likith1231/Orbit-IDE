const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('LOG:', msg.text()));
  page.on('pageerror', err => console.log('ERROR:', err.toString()));
  
  await page.goto('http://localhost:5000', { waitUntil: 'networkidle0' }).catch(() => {});
  const html = await page.evaluate(() => document.body.innerHTML);
  console.log('HTML size:', html.length);
  
  // click terminal tab
  await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('.bottom-tab'));
    const termTab = tabs.find(t => t.textContent.includes('TERMINAL'));
    if (termTab) termTab.click();
  });
  
  await new Promise(r => setTimeout(r, 1000));
  
  const termHtml = await page.evaluate(() => {
    const term = document.querySelector('.terminal-host');
    return term ? term.innerHTML : 'NOT FOUND';
  });
  console.log('Terminal HTML length:', termHtml.length);
  
  await browser.close();
})();
