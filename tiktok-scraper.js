const { chromium } = require('playwright');

(async () => {
  const keyword = process.argv[2] || 'fitness'; // Use CLI argument or fallback

  const browser = await chromium.launch({
    headless: false,      // 👈 Show browser
    slowMo: 100,          // 👈 Slow down for easier debugging
    devtools: true        // 👈 Optional: open DevTools
  });

  const page = await browser.newPage();

  await page.goto('https://ads.tiktok.com/business/creativecenter/keyword-insights/pc/en', {
    waitUntil: 'networkidle'
  });

  await page.waitForTimeout(30000); // Wait for dynamic content to load

  await page.waitForSelector('input[placeholder="Search by keyword"]', { timeout: 30000 });
  await page.fill('input[placeholder="Search by keyword"]', keyword);

  await page.click('[data-testid="cc_commonCom_autoComplete_seach"]');

  await page.waitForSelector('.byted-Table-Body', { timeout: 20000 });

  const data = await page.evaluate(() => {
    const tableBody = document.querySelector('.byted-Table-Body');
    if (!tableBody) return [];

    const rows = Array.from(tableBody.querySelectorAll('tr'));

    return rows.map(row => {
      const cells = Array.from(row.querySelectorAll('td')).map(td => td.innerText.trim());

      return {
        rank: cells[0] || '',
        keyword: cells[1] || '',
        popularity: cells[2] || '',
        popularityChange: cells[3] || '',
        ctr: cells[4] || '',
        cvr: cells[5] || '',
        cpa: cells[6] || '',
      };
    });
  });

  console.log(`\n🔍 Results for keyword: "${keyword}"`);
  console.table(data.slice(0, 10)); // Show first 10 results

  await browser.close();
})();
