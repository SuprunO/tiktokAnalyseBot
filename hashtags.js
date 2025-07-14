const { chromium } = require("playwright");

(async () => {
  const periodDays = 30; // <<== тут можна міняти період (7, 30, 120)

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  console.log("🌐 Opening TikTok Creative Center (Popular Hashtags)...");
  await page.goto(
    "https://ads.tiktok.com/business/creativecenter/inspiration/popular/hashtag/pc/en",
    { waitUntil: "networkidle", timeout: 120000 }
  );

  await page.waitForTimeout(8000);

  // 1️⃣ Вибір періоду часу
  console.log(`🟠 Selecting time period: Last ${periodDays} Days...`);

  try {
    await page.waitForSelector('[id="hashtagPeriodSelect"]', { timeout: 10000 });
    await page.click('[id="hashtagPeriodSelect"]');
    await page.waitForTimeout(2000);

    let timeOption = await page.$(`text="Last ${periodDays} days"`);
    if (!timeOption) {
      console.warn(`⚠️ Text option 'Last ${periodDays} Days' not found. Trying fallback selector...`);
      timeOption = await page.$('[data-testid="cc_single_select_undefined_item_1"]');
    }

    if (timeOption) {
      await timeOption.click();
      console.log(`✅ Time set to Last ${periodDays} Days`);
    } else {
      console.warn(`⚠️ Time option for '${periodDays} Days' not found. Keeping default.`);
    }
  } catch (err) {
    console.error("❌ Error selecting time:", err);
  }

  await page.waitForTimeout(5000);

  // 2️⃣ Клікаємо "See More", якщо є
  console.log("🟠 Clicking 'See More' button to load all hashtags...");
  for (let i = 0; i < 15; i++) {
    const seeMoreBtn = await page.$('[data-testid=cc_contentArea_viewmore_btn]');
    if (!seeMoreBtn) {
      console.log("ℹ️ No more 'See More' button found.");
      break;
    }

    const isVisible = await seeMoreBtn.isVisible();
    const isEnabled = await seeMoreBtn.isEnabled();

    if (!isVisible || !isEnabled) {
      console.log("⚠️ 'See More' button is not visible or enabled, stopping.");
      break;
    }

    await seeMoreBtn.click();
    console.log("✅ 'See More' clicked, waiting 4 seconds...");
    await page.waitForTimeout(4000);
  }

  // 3️⃣ Додаткове прокручування сторінки
  console.log("🟠 Scrolling to load all content...");
  for (let i = 0; i < 10; i++) {
    const prevHeight = await page.evaluate(() => document.body.scrollHeight);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(3000);
    const newHeight = await page.evaluate(() => document.body.scrollHeight);
    if (newHeight === prevHeight) {
      console.log("ℹ️ No more new content loaded.");
      break;
    }
  }

  // 4️⃣ Збір даних
  console.log("🔎 Extracting hashtags from page...");
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
          .replace(' POSTS', '')
          .replace(/\s+/g, '');

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
