const { chromium } = require("playwright");

async function scrapePopularMusic(region = "United States", time = 30) {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  console.log("🌐 Opening TikTok Creative Center (Popular Music)...");
  await page.goto(
    "https://ads.tiktok.com/business/creativecenter/inspiration/popular/music/pc/en",
    { waitUntil: "networkidle", timeout: 120000 }
  );

  await page.waitForTimeout(8000);

  // 1️⃣ Натискаємо на дропдаун регіону
  console.log("🟠 Opening region dropdown...");
  const regionDropdownTrigger = await page.$('div[class*=index-mobile_locationSelectContainer]');
  if (regionDropdownTrigger) {
    await regionDropdownTrigger.click({ timeout: 5000 });
    console.log("✅ Region dropdown opened.");
  } else {
    console.warn("⚠️ Region dropdown trigger not found! Keeping default region.");
  }

  await page.waitForTimeout(2000);

  // 2️⃣ Вводимо регіон у інпут
  console.log(`⌨️ Typing region: ${region}...`);
  await page.waitForSelector('input[placeholder="Start typing or select from the list"]', { timeout: 10000 });
  const regionInput = await page.$('input[placeholder="Start typing or select from the list"]');
  if (regionInput) {
    await regionInput.click();
    await regionInput.fill(region);
    await page.waitForTimeout(1500);

    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    console.log(`✅ Region set to "${region}"`);
  } else {
    console.warn("⚠️ Region input not found after opening dropdown. Keeping default.");
  }

  await page.waitForTimeout(5000);

  // 3️⃣ Вибираємо період часу
  await selectTime(page, time);

  // 4️⃣ Клік по кнопці «See More» і скрол
  console.log("🟠 Trying to load all music entries with 'See More' and scrolling...");
  for (let i = 0; i < 15; i++) {
    // Перевіряємо кнопку за текстом
    const seeMoreBtn = await page.$('[data-testid="cc_contentArea_viewmore_btn"]>div');

    if (seeMoreBtn) {
      const isVisible = await seeMoreBtn.isVisible();
      const isEnabled = await seeMoreBtn.isEnabled();

      if (isVisible && isEnabled) {
        console.log("✅ 'See More' button found. Clicking...");
        await seeMoreBtn.click();
        await page.waitForTimeout(4000);
      } else {
        console.log("⚠️ 'See More' button not clickable. Skipping to scroll.");
      }
    } else {
      console.log("ℹ️ No 'See More' button found. Performing scroll instead.");
    }

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(3000);
  }

  // 5️⃣ Збір даних
  console.log("🔎 Extracting music entries...");
  const musicList = await page.evaluate(() => {
    const results = [];
    const cards = document.querySelectorAll('div[class*="cardWrapper"]');

    cards.forEach((card, idx) => {
      const rankEl = card.querySelector('span[class*="rankingIndex"]');
      const titleEl = card.querySelector('span[class*="musicName"]');
      const artistEl = card.querySelector('span[class*="autherName"]');

      const rank = rankEl ? parseInt(rankEl.textContent.trim(), 10) : idx + 1;
      const song = titleEl ? titleEl.textContent.trim() : '';
      const artist = artistEl ? artistEl.textContent.trim() : '';

      if (song && artist) {
        results.push({ rank, song, artist });
      }
    });

    return results;
  });

  if (!musicList.length) {
    console.log("❌ No music entries found. Check selectors!");
  } else {
    console.log(`✅ Found ${musicList.length} music entries!`);
    musicList.slice(0, 20).forEach((m) => {
      console.log(`#${m.rank}: "${m.song}" by ${m.artist}`);
    });
  }

  await browser.close();
  console.log("\n✅ Done.");
}

// ✅ Допоміжна функція вибору часу
async function selectTime(page, time) {
  console.log(`🟠 Selecting time: Last ${time} days...`);

  try {
    await page.waitForSelector('[data-testid="cc_single_select_undefined"]', { timeout: 10000 });
    await page.click('[data-testid="cc_single_select_undefined"]');
    await page.waitForTimeout(2000);

    let timeOption = await page.$(`text="Last ${time} Days"`);

    if (!timeOption) {
      console.warn(`⚠️ Text option 'Last ${time} Days' not found. Trying fallback selector...`);
      timeOption = await page.$('[data-option-id="SelectOption82"]');
    }

    if (timeOption) {
      await timeOption.click();
      console.log(`✅ Time set to Last ${time} days`);
    } else {
      console.warn(`⚠️ Time option for '${time} Days' not found. Keeping default.`);
    }
  } catch (err) {
    console.error("❌ Error selecting time:", err);
  }

  await page.waitForTimeout(3000);
}

// 🟢 Запуск зі своїми параметрами:
scrapePopularMusic("United States", 30)
  .catch(console.error);
