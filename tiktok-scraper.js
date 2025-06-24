const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({
    headless: false, // show browser to observe
    slowMo: 100, // slow down for demo
  });

  const page = await browser.newPage();
  await page.goto('https://ads.tiktok.com/business/creativecenter/keyword-insights/pc/en', {
    waitUntil: 'networkidle',
  });

  // Wait for search input, fill 'fitness'
  await page.waitForSelector('input[placeholder="Search by keyword"]');
  await page.fill('input[placeholder="Search by keyword"]', 'fitness');

  // Click search button
  await page.click('[data-testid="cc_commonCom_autoComplete_seach"]');

  // Wait for table body to appear
  await page.waitForSelector('.byted-Table-Body', { timeout: 15000 });

  // Extract data from table rows
  const data = await page.evaluate(() => {
    // The container with all rows
    const tableBody = document.querySelector('.byted-Table-Body');
    if (!tableBody) return [];

    // Each row is a 'tr' inside the table body
    const rows = Array.from(tableBody.querySelectorAll('tr'));

    // Map each row to an object with the expected columns
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

  // Save data to JSON file
  fs.writeFileSync('data.json', JSON.stringify(data, null, 2));
  console.log('✅ Data saved to data.json');

  await browser.close();
})();
