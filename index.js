require("dotenv").config();

const express = require("express");
const { chromium } = require("playwright");
const TelegramBot = require("node-telegram-bot-api");
const OpenAI = require("openai");
const fs = require("fs/promises");

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
const PORT = process.env.PORT || 3000;
const MAX_CONCURRENT_SCRAPES = 2;

if (!TELEGRAM_TOKEN || !OPENAI_KEY) {
  console.error("❗ Please set TELEGRAM_TOKEN and OPENAI_API_KEY in .env");
  process.exit(1);
}

// ==============================
// EXPRESS APP
// ==============================
const app = express();
app.use(express.json());
app.get("/", (req, res) => res.send("✅ Bot is running."));

// ==============================
// OPENAI
// ==============================
const openai = new OpenAI({ apiKey: OPENAI_KEY });

// ==============================
// TELEGRAM BOT
// ==============================
let bot;
let activeScrapes = 0;
const userStates = {};

if (RENDER_EXTERNAL_URL) {
  console.log("🟢 Running in Webhook mode");
  bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });

  // Цей маршрут треба оголосити вже тут
  app.post(`/bot${TELEGRAM_TOKEN}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  });

} else {
  console.log("🟠 Running in Polling mode");
  bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
  console.log("✅ Polling started.");
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Express server listening on port ${PORT}`);

  // ВАЖЛИВО: викликаємо setWebHook тільки тепер, коли сервер точно слухає
  if (RENDER_EXTERNAL_URL) {
    bot.setWebHook(`${RENDER_EXTERNAL_URL}/bot${TELEGRAM_TOKEN}`)
      .then(() => console.log(`✅ Webhook set to ${RENDER_EXTERNAL_URL}/bot${TELEGRAM_TOKEN}`))
      .catch(console.error);
  }
});


// ==============================
// HELPERS
// ==============================
function randomDelay(min = 1000, max = 3000) {
  return new Promise(resolve => setTimeout(resolve, Math.random() * (max - min) + min));
}

async function cleanupTempFiles() {
  try {
    const files = ["captcha_detected.png", "error_screenshot.png"];
    for (const file of files) {
      try { await fs.unlink(file); } catch (e) { }
    }
  } catch (e) {
    console.error("Cleanup error:", e);
  }
}

// ==============================
// SCRAPER: KEYWORD INSIGHTS
// ==============================
async function scrapeTikTokKeywordInsights(keyword) {
  if (activeScrapes >= MAX_CONCURRENT_SCRAPES) throw new Error("Too many concurrent scrapes.");
  activeScrapes++;
  let browser;
  try {
    browser = await chromium.launch({ headless: false, args: ["--no-sandbox"] });
    const page = await browser.newPage();

    console.log("🌐 Opening TikTok Keyword Page...");
    await page.goto("https://ads.tiktok.com/business/creativecenter/keyword-insights/pc/en", {
      waitUntil: "domcontentloaded", timeout: 120000
    });
    await page.waitForTimeout(8000);

    console.log(`⌨️ Typing keyword: ${keyword}...`);
    await page.fill('input[placeholder="Search by keyword"]', keyword);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(5000);

    await page.waitForSelector(".byted-Table-Body", { timeout: 30000 });

    const data = await page.evaluate(() => {
      const rows = document.querySelectorAll(".byted-Table-Body tr");
      return Array.from(rows).map(row => {
        const cells = Array.from(row.querySelectorAll("td, th")).map(td =>
          td.innerText.trim()
        );
        return {
          rank: cells[0] || "",
          keyword: cells[1] || "",
          popularity: cells[2] || "",
          popularityChange: cells[3] || "",
          ctr: cells[4] || "",
          cvr: cells[5] || "",
          cpa: cells[6] || "",
        };
      });
    });

    if (!data.length) throw new Error("No data found in table");

    const processed = data.map(item => {
      const ctrVal = parseFloat(item.ctr.replace("%", "").replace(",", ".")) || 0.01;
      const cpaVal = parseFloat(item.cpa.replace(/[^\d.,]/g, "").replace(",", ".")) || 0.01;
      const popChangeVal = parseFloat(item.popularityChange.replace("%", "").replace(",", ".")) || 0;
      const score = popChangeVal * (cpaVal / ctrVal);
      return { ...item, contentGapScore: Number(score.toFixed(2)) };
    });

    return processed.sort((a, b) => b.contentGapScore - a.contentGapScore);
  } catch (e) {
    console.error("❌ Error during scraping:", e);
    return [];
  } finally {
    if (browser) await browser.close();
    activeScrapes--;
    await cleanupTempFiles();
  }
}

// ==============================
// SCRAPER: HASHTAG INSIGHTS
// ==============================
async function scrapeTikTokHashtagInsights(period = 30) {
  if (activeScrapes >= MAX_CONCURRENT_SCRAPES) throw new Error("Too many concurrent scrapes.");
  activeScrapes++;
  let browser;
  try {
    browser = await chromium.launch({ headless: false, args: ["--no-sandbox"] });
    const page = await browser.newPage();

    console.log("🌐 Opening TikTok Hashtag Page...");
    await page.goto("https://ads.tiktok.com/business/creativecenter/inspiration/popular/hashtag/pc/en", {
      waitUntil: "domcontentloaded", timeout: 120000
    });

    await page.waitForTimeout(8000);

    console.log(`🟠 Selecting period: ${period} days`);
    await page.waitForSelector('[id="hashtagPeriodSelect"]', { timeout: 10000 });
    await page.click('[id="hashtagPeriodSelect"]');
    await page.waitForTimeout(2000);

    const option = await page.$(`text="Last ${period} days"`);
    if (option) await option.click();
    else console.warn(`⚠️ Period option not found, using default`);

    await page.waitForTimeout(5000);

    for (let i = 0; i < 15; i++) {
      const seeMoreBtn = await page.$('[data-testid=cc_contentArea_viewmore_btn]');
      if (!seeMoreBtn) break;
      if (await seeMoreBtn.isVisible() && await seeMoreBtn.isEnabled()) {
        await seeMoreBtn.click();
        await page.waitForTimeout(4000);
      } else break;
    }

    for (let i = 0; i < 10; i++) {
      const prevHeight = await page.evaluate(() => document.body.scrollHeight);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(3000);
      const newHeight = await page.evaluate(() => document.body.scrollHeight);
      if (newHeight === prevHeight) break;
    }

    return await page.evaluate(() => {
      const results = [];
      document.querySelectorAll('a[class*="container"]').forEach((card, idx) => {
        const rankEl = card.querySelector('span[class*="rankingIndex"]');
        const nameEl = card.querySelector('span[class*="titleText"]');
        let posts = 0;
        const postTextEl = Array.from(card.querySelectorAll('*')).find(el =>
          /posts$/i.test(el.textContent.trim())
        );
        if (postTextEl) {
          let text = postTextEl.textContent.trim().toUpperCase().replace(/\s+/g, '').replace('POSTS', '');
          if (text.endsWith('K')) posts = parseFloat(text) * 1000;
          else if (text.endsWith('M')) posts = parseFloat(text) * 1e6;
          else if (text.endsWith('B')) posts = parseFloat(text) * 1e9;
          else posts = parseInt(text, 10) || 0;
        }
        const rank = rankEl ? parseInt(rankEl.textContent.trim(), 10) : idx + 1;
        const hashtag = nameEl ? nameEl.textContent.trim().replace(/^#/, '') : '';
        if (hashtag) results.push({ rank, hashtag, posts: Math.round(posts) });
      });
      return results;
    });
  } catch (e) {
    console.error("❌ Error scraping hashtags:", e);
    return [];
  } finally {
    if (browser) await browser.close();
    activeScrapes--;
    await cleanupTempFiles();
  }
}

// ==============================
// SCRAPER: POPULAR MUSIC
// ==============================
async function scrapePopularMusic(region = "United States", time = 30) {
  if (activeScrapes >= MAX_CONCURRENT_SCRAPES) throw new Error("Too many concurrent scrapes.");
  activeScrapes++;
  let browser;
  try {
    browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();

    console.log("🌐 Opening TikTok Music Page...");
    await page.goto("https://ads.tiktok.com/business/creativecenter/inspiration/popular/music/pc/en", {
      waitUntil: "domcontentloaded", timeout: 120000
    });
    await page.waitForTimeout(8000);

    console.log("🟠 Selecting region...");
    const regionTrigger = await page.$('div[class*=index-mobile_locationSelectContainer]');
    if (regionTrigger) {
      await regionTrigger.click();
      await page.waitForTimeout(2000);
      await page.fill('input[placeholder="Start typing or select from the list"]', region);
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      console.log(`✅ Region set to ${region}`);
    } else console.warn("⚠️ Region dropdown not found.");

    await page.waitForTimeout(5000);

    await selectTime(page, time);

    for (let i = 0; i < 15; i++) {
      const seeMoreBtn = await page.$('[data-testid="cc_contentArea_viewmore_btn"]>div');
      if (seeMoreBtn && await seeMoreBtn.isVisible() && await seeMoreBtn.isEnabled()) {
        await seeMoreBtn.click();
        await page.waitForTimeout(4000);
      }
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(3000);
    }

    return await page.evaluate(() => {
      const results = [];
      document.querySelectorAll('div[class*="cardWrapper"]').forEach((card, idx) => {
        const rank = parseInt(card.querySelector('span[class*="rankingIndex"]')?.textContent.trim()) || idx + 1;
        const song = card.querySelector('span[class*="musicName"]')?.textContent.trim() || '';
        const artist = card.querySelector('span[class*="autherName"]')?.textContent.trim() || '';
        if (song && artist) results.push({ rank, song, artist });
      });
      return results;
    });
  } catch (e) {
    console.error("❌ Error scraping music:", e);
    return [];
  } finally {
    if (browser) await browser.close();
    activeScrapes--;
    await cleanupTempFiles();
  }
}

async function selectTime(page, time) {
  console.log(`🟠 Selecting time: Last ${time} days`);
  try {
    await page.waitForSelector('[data-testid="cc_single_select_undefined"]', { timeout: 10000 });
    await page.click('[data-testid="cc_single_select_undefined"]');
    await page.waitForTimeout(2000);
    let option = await page.$(`text="Last ${time} Days"`);
    if (!option) option = await page.$('[data-option-id="SelectOption82"]');
    if (option) await option.click();
  } catch (e) {
    console.warn("⚠️ Time selector error:", e);
  }
  await page.waitForTimeout(3000);
}

// ==============================
// FORMATTERS
// ==============================
function formatTable(data) {
  if (!data.length) return "❗ Немає даних у Creative Center.";
  return data
    .slice(0, 5)
    .map((item, idx) =>
      `#${idx + 1}\nСлово: ${item.keyword}\nРанг: ${item.rank}\nПопулярність: ${item.popularity}\nЗміна популярності: ${item.popularityChange}\nCTR: ${item.ctr}\nCVR: ${item.cvr}\nCPA: ${item.cpa}\nContent Gap Score: ${item.contentGapScore}\n`
    ).join("\n");
}

function formatHashtagList(data) {
  if (!data.length) return "❗ Хештеги не знайдено.";
  return data.slice(0, 20).map(h => `#${h.hashtag}\nРанг: ${h.rank}\nПостів: ${h.posts.toLocaleString()}`).join("\n\n");
}

function formatMusicList(data) {
  if (!data.length) return "❗ Треки не знайдено.";
  return data.slice(0, 20).map(m => `#${m.rank}: "${m.song}" – ${m.artist}`).join("\n\n");
}

// ==============================
// BOT COMMANDS HANDLER
// ==============================

bot.onText(/^\/start$/, async (msg) => {
  const chatId = msg.chat.id;
  userStates[chatId] = {};
  await bot.sendMessage(chatId, `Привіт! Я бот для TikTok-аналітики.

✅ /keywords – пошук ідей за ключовим словом
✅ /hashtags – популярні хештеги
✅ /tracks – популярна музика
✅ /help – допомога з командами`, {
    reply_markup: {
      keyboard: [
        [{ text: "/keywords" }, { text: "/hashtags" }, { text: "/tracks" }],
        [{ text: "/help" }]
      ],
      resize_keyboard: true
    }
  });
});

bot.onText(/^\/help$/, async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(chatId, `Ось доступні команди:

✅ /keywords – пошук ідей за ключовим словом
✅ /hashtags – популярні хештеги
✅ /tracks – популярна музика
✅ /help – допомога з командами`, {
    reply_markup: {
      keyboard: [
        [{ text: "/keywords" }, { text: "/hashtags" }, { text: "/tracks" }],
        [{ text: "/help" }]
      ],
      resize_keyboard: true
    }
  });
});

bot.onText(/^\/keywords$/, async (msg) => {
  const chatId = msg.chat.id;
  userStates[chatId] = { waitingForKeyword: true };
  await bot.sendMessage(chatId, "✏️ Введіть ключове слово для пошуку:");
});

bot.onText(/^\/hashtags$/, async (msg) => {
  const chatId = msg.chat.id;
  userStates[chatId] = { waitingForPeriodForHashtags: true };
  await bot.sendMessage(chatId, "✏️ Вкажіть період (7, 30 або 120):");
});

bot.onText(/^\/tracks$/, async (msg) => {
  const chatId = msg.chat.id;
  userStates[chatId] = { waitingForRegionForTracks: true };
  await bot.sendMessage(chatId, "✏️ Вкажіть регіон (наприклад United States):");
});


// ==============================
// BOT MESSAGE HANDLER
// ==============================
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text?.trim();
  if (!text) return;

  // ✅ Не чіпаємо команди, якщо немає активного стану
  if (text.startsWith("/") && !userStates[chatId]) {
    return;
  }

  // -------------------------------
  // KEYWORDS: вибір номера
  // -------------------------------
  if (userStates[chatId]?.waitingForKeywordPick) {
    const selected = parseInt(text);
    const keywords = userStates[chatId].keywordsList;

    if (!selected || selected < 1 || selected > keywords.length) {
      await bot.sendMessage(chatId, "❗ Введіть номер із таблиці (наприклад 1 або 2):");
      return;
    }

    const keyword = keywords[selected - 1];
    userStates[chatId] = {};
    await bot.sendMessage(chatId, `🧠 Генерую GPT-ідею для: "${keyword}"...`);

    const prompt = `
Тема: "${keyword}"
1️⃣ 📌 Слово
2️⃣ 🎥 Сценарій
3️⃣ 📊 Чому це спрацює
4️⃣ 🏷️ 5-7 хештегів українською
`;

    const gptResponse = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: "Ти досвідчений маркетолог і TikTok-креатор. Відповідай українською мовою." },
        { role: "user", content: prompt },
      ],
      max_tokens: 500,
    });

    await bot.sendMessage(chatId, gptResponse.choices[0].message.content);
    return;
  }

  // -------------------------------
  // KEYWORDS: введення ключового слова
  // -------------------------------
  if (userStates[chatId]?.waitingForKeyword) {
    userStates[chatId] = {};
    const keyword = text;

    await bot.sendMessage(chatId, `🔎 Шукаю за ключовим словом: "${keyword}"... Це може зайняти 30-60 секунд.`);
    const results = await scrapeTikTokKeywordInsights(keyword);

    if (!results.length) {
      await bot.sendMessage(chatId, "⚠️ Немає даних у Creative Center.");
      return;
    }

    await bot.sendMessage(chatId, "✅ Знайдено дані в Creative Center:\n\n" + formatTable(results));
    userStates[chatId] = {
      waitingForKeywordPick: true,
      keywordsList: results.slice(0, 5).map(i => i.keyword)
    };
    await bot.sendMessage(chatId, "✏️ Введіть номер з таблиці для генерації ідеї (наприклад 1 або 2):");
    return;
  }

  // -------------------------------
  // HASHTAGS
  // -------------------------------
  if (userStates[chatId]?.waitingForPeriodForHashtags) {
    const period = parseInt(text, 10);
    if (![7, 30, 120].includes(period)) {
      await bot.sendMessage(chatId, "❗ Вкажіть 7, 30 або 120:");
      return;
    }
    userStates[chatId] = {};
    await bot.sendMessage(chatId, `🔎 Збираю хештеги за ${period} днів...`);
    const hashtags = await scrapeTikTokHashtagInsights(period);
    await bot.sendMessage(chatId, formatHashtagList(hashtags));
    return;
  }

  // -------------------------------
  // TRACKS: введення регіону
  // -------------------------------
  if (userStates[chatId]?.waitingForRegionForTracks) {
    userStates[chatId].region = text;
    userStates[chatId].waitingForPeriodForTracks = true;
    delete userStates[chatId].waitingForRegionForTracks;
    await bot.sendMessage(chatId, "✏️ Тепер вкажіть період (7, 30 або 120):");
    return;
  }

  // -------------------------------
  // TRACKS: введення періоду
  // -------------------------------
  if (userStates[chatId]?.waitingForPeriodForTracks) {
    const period = parseInt(text, 10);
    if (![7, 30, 120].includes(period)) {
      await bot.sendMessage(chatId, "❗ Вкажіть 7, 30 або 120:");
      return;
    }
    const region = userStates[chatId].region || "United States";
    userStates[chatId] = {};
    await bot.sendMessage(chatId, `🔎 Збираю треки для ${region}, ${period} днів...`);
    const music = await scrapePopularMusic(region, period);
    await bot.sendMessage(chatId, formatMusicList(music));
    return;
  }

  // -------------------------------
  // Невідоме повідомлення без стану
  // -------------------------------
  if (!userStates[chatId]) {
    await bot.sendMessage(chatId, "❗ Не зрозумів команду. Оберіть /start для меню.");
  }
});
