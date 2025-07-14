const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  console.log("Opening TikTok Creative Center...");
  await page.goto(
    "https://ads.tiktok.com/business/creativecenter/inspiration/popular/hashtag/pc/en",
    { waitUntil: "networkidle", timeout: 120000 }
  );

  console.log("Waiting 10 seconds for initial hashtags to render...");
  await page.waitForTimeout(10000);

  // Клікаємо кнопку "See More" поки вона існує та доступна
  console.log("Clicking 'See More' button to load all hashtags...");
  while (true) {
    // Знаходимо кнопку за текстом, чекаємо що вона видима і клікабельна
    const seeMoreBtn = await page.$('[data-testid=cc_contentArea_viewmore_btn]');

    if (!seeMoreBtn) {
      console.log("No more 'See More' button found.");
      break;
    }

    // Переконаємось, що кнопка не заблокована та видима
    const isVisible = await seeMoreBtn.isVisible();
    const isEnabled = await seeMoreBtn.isEnabled();

    if (!isVisible || !isEnabled) {
      console.log("'See More' button is not visible or enabled, зупинка.");
      break;
    }

    await seeMoreBtn.click();
    console.log("'See More' clicked, чекаємо 5 секунд для підвантаження...");
    await page.waitForTimeout(5000);
  }

  // Додатково скролимо сторінку вниз, щоб підвантажити весь контент
  console.log("Scrolling to load all content...");
  let previousHeight;
  for (let i = 0; i < 10; i++) {
    previousHeight = await page.evaluate(() => document.body.scrollHeight);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(3000);
    const newHeight = await page.evaluate(() => document.body.scrollHeight);
    if (newHeight === previousHeight) {
      console.log("No more new content loaded.");
      break;
    }
  }

  console.log("Extracting hashtags from page...");

 const hashtags = await page.evaluate(() => {
    const results = [];
    const cards = document.querySelectorAll('a[class*="container"]');

    cards.forEach((card, idx) => {
      const rankEl = card.querySelector('span[class*="rankingIndex"]');
      const nameEl = card.querySelector('span[class*="titleText"]');

      let posts = 0;
      const postTextEl = Array.from(card.querySelectorAll('*')).find(el =>
        /posts$/i.test(el.textContent.trim())
      );

      if (postTextEl) {
        let text = postTextEl.textContent
          .trim()
          .toUpperCase()
          .replace(/\s+/g, '')
          .replace('POSTS', '');

        // Smart parsing
        if (text.endsWith('K')) {
          posts = parseFloat(text.replace('K', '')) * 1000;
        } else if (text.endsWith('M')) {
          posts = parseFloat(text.replace('M', '')) * 1000000;
        } else if (text.endsWith('B')) {
          posts = parseFloat(text.replace('B', '')) * 1000000000;
        } else {
          posts = parseInt(text, 10) || 0;
        }
      }

      const rank = rankEl ? parseInt(rankEl.textContent.trim(), 10) : idx + 1;
      const hashtag = nameEl ? nameEl.textContent.trim().replace(/^#/, '') : '';

      if (hashtag) {
        results.push({ rank, hashtag, posts: Math.round(posts) });
      }
    });

    return results;
  });

  if (!hashtags.length) {
    console.log("❌ No hashtags found. Double-check the selectors!");
  } else {
    console.log(`✅ Found ${hashtags.length} hashtags!`);
    hashtags.slice(0, 20).forEach(h => {
      console.log(`#${h.hashtag} (Rank ${h.rank}, ${h.posts} posts)`);
    });
  }

  await browser.close();
  console.log("\n✅ Done.");
})();
