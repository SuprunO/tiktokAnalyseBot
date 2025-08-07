
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

// ...existing code...

// ==============================
// EXPRESS APP SETUP
// ==============================
const app = express();
app.use(express.json());
app.get("/", (req, res) => res.send("✅ Bot is running."));

// ==============================
// OPENAI CLIENT
// ==============================
const openai = new OpenAI({ apiKey: OPENAI_KEY });

// ==============================
// TELEGRAM BOT SETUP
// ==============================
let bot;
let activeScrapes = 0;
const userStates = {};



if (RENDER_EXTERNAL_URL) {
  console.log("🟢 Running in Webhook mode");
  bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });
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
  if (RENDER_EXTERNAL_URL) {
    bot
      .setWebHook(`${RENDER_EXTERNAL_URL}/bot${TELEGRAM_TOKEN}`)
      .then(() =>
        console.log(
          `✅ Webhook set to ${RENDER_EXTERNAL_URL}/bot${TELEGRAM_TOKEN}`
        )
      )
      .catch(console.error);
  }
});

// ==============================
// HASHTAG CLOUD SERVICE
// ==============================

// Hashtag cloud generator
async function generateCloud(keyword) {
  function parseGptHashtags(response) {
    const hashtagRegex = /#[\w\p{L}\p{N}\-_\.]+/gu;
    const uaPart = response.split("🇺🇦 Українські:")[1]?.split("🇬🇧 English:")[0] || "";
    const enPart = response.split("🇬🇧 English:")[1] || "";
    let uaTags = (uaPart.match(hashtagRegex) || []).map((t) => t.trim());
    let enTags = (enPart.match(hashtagRegex) || []).map((t) => t.trim());
    uaTags = [...new Set(uaTags)].slice(0, 10);
    enTags = [...new Set(enTags)].slice(0, 10);
    return { uaTags, enTags };
  }
  const gpt = await openai.chat.completions.create({
    model: "gpt-3.5-turbo",
    messages: [
      {
        role: "system",
        content: `Ти TikTok-експерт. Згенеруй 10 перспективних українських хештегів і 10 англійських з content gap у ніші "${keyword}". \nФормат: спочатку блок "🇺🇦 Українські:" з 10 хештегів через кому, потім новий рядок "🇬🇧 English:" з 10 англійських хештегів через кому.`,
      },
    ],
    max_tokens: 400,
  });
  const response = gpt.choices[0].message.content || "";
  return parseGptHashtags(response);
}

// Handler for user reply after /hashtagcloud (moved to top-level)
async function handleHashtagCloud(chatId, keyword) {
  try {
    console.log(`[hashtagcloud] Received keyword: ${keyword}`);
    await bot.sendMessage(chatId, `☁️ Введене слово: "${keyword}"\nГенерую хмару з 10 українських і 10 англійських хештегів, найкращих для content gap...`);
    const { uaTags, enTags } = await generateCloud(keyword);
    console.log(`[hashtagcloud] GPT result: UA: ${uaTags.length}, EN: ${enTags.length}`);
    if (!uaTags.length && !enTags.length) {
      await bot.sendMessage(chatId, "⚠️ GPT не згенерував хештеги.");
    } else {
      let msgText = `☁️ Хештег-хмари для "${keyword}":`;
      if (uaTags.length) {
        msgText += `\n🇺🇦 Українські:\n${uaTags.join(" ")}`;
      }
      if (enTags.length) {
        msgText += `\n\n🇬🇧 English:\n${enTags.join(" ")}`;
      }
      await bot.sendMessage(chatId, msgText);
    }
    // Prompt for another word
    userStates[chatId] = { waitingForHashtagCloud: true };
    await bot.sendMessage(chatId, "🔄 Введіть інше слово для нової хештег-хмари або /cancel для виходу:");
  } catch (e) {
    console.error("❌ Error in /hashtagcloud:", e);
    await bot.sendMessage(chatId, `⚠️ Виникла помилка при генерації хештегів: ${e.message}`);
    userStates[chatId] = { waitingForHashtagCloud: true };
    await bot.sendMessage(chatId, "🔄 Введіть інше слово для нової хештег-хмари або /cancel для виходу:");
  }
}

// Register /hashtagcloud command after bot initialization
function registerHashtagCloudCommand() {
  // Interactive /hashtagcloud: ask for keyword, then generate cloud
  bot.onText(/^\/hashtagcloud(?:\s+(.*))?$/i, async (msg, match) => {
    const chatId = msg.chat.id;
    const keyword = match && match[1] ? match[1].trim() : "";
    if (!keyword) {
      userStates[chatId] = { waitingForHashtagCloud: true };
      await bot.sendMessage(chatId, "☁️ Введіть ключове слово для генерації хештег-хмари:");
      return;
    }
    await handleHashtagCloud(chatId, keyword);
  });
}

// Register custom commands after bot is initialized
registerHashtagCloudCommand();



// ==============================
// HELPERS
// ==============================
async function cleanupTempFiles() {
  const files = ["captcha_detected.png", "error_screenshot.png"];
  for (const file of files) {
    try {
      await fs.unlink(file);
    } catch {}
  }
}

function isValidPeriod(value) {
  return [7, 30, 120].includes(value);
}

function formatTable(data) {
  if (!data.length) return "❗ Немає даних у Creative Center.";
  return data
    .slice(0, 5)
    .map(
      (item, idx) =>
        `#${idx + 1}\nСлово: ${item.keyword}\nРанг: ${
          item.rank
        }\nПопулярність: ${item.popularity}\nЗміна популярності: ${
          item.popularityChange
        }\nCTR: ${item.ctr}\nCVR: ${item.cvr}\nCPA: ${
          item.cpa
        }\nContent Gap Score: ${item.contentGapScore}\n`
    )
    .join("\n");
}

function formatHashtagList(data) {
  if (!data.length) return "❗ Хештеги не знайдено.";
  return data
    .slice(0, 20)
    .map(
      (h) =>
        `#${h.hashtag}\nРанг: ${h.rank}\nПостів: ${h.posts.toLocaleString()}`
    )
    .join("\n\n");
}

function formatMusicList(data) {
  if (!data.length) return "❗ Треки не знайдено.";
  return data
    .slice(0, 20)
    .map((m) => `#${m.rank}: "${m.song}" – ${m.artist}`)
    .join("\n\n");
}

// ==============================
// SCRAPER FUNCTIONS
// ==============================

async function scrapeTikTokKeywordInsights(keyword, period = 7) {
  if (activeScrapes >= MAX_CONCURRENT_SCRAPES)
    throw new Error("Too many concurrent scrapes.");
  activeScrapes++;
  let browser;
  try {
    browser = await chromium.launch({
      headless: false,
      args: ["--no-sandbox"],
    });
    const page = await browser.newPage();

    console.log("🌐 Opening TikTok Keyword Page...");
    await page.goto(
      "https://ads.tiktok.com/business/creativecenter/keyword-insights/pc/en",
      {
        waitUntil: "domcontentloaded",
        timeout: 120000,
      }
    );

    // Вибір періоду
    const periodMap = {
      7: "Last 7 days",
      30: "Last 30 days",
      120: "Last 120 days",
    };
    const periodText = periodMap[period] || "Last 7 days";

    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(15000);

    console.log("🧹 Trying to skip guide modal...");
    await page.click("[class*='guide-modal-footer-skip-btn']").catch(() => {
      console.warn("⚠️ Skip guide button not found or already closed");
    });
    await page.waitForTimeout(15000);

    console.log("🔍 Waiting for #keywordPeriod in DOM...");
    await page
      .waitForSelector("#keywordPeriod>span", { timeout: 15000 })
      .catch(() => {
        throw new Error("❌ #keywordPeriod not found in DOM at all");
      });

    // 🧪 Перевірка стилів
    console.log("🔬 Checking #keywordPeriod styles...");
    const periodDebug = await page.evaluate(() => {
      const el = document.getElementById("keywordPeriod");
      if (!el) return "❌ Not found";
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return {
        pointerEvents: style.pointerEvents,
        visibility: style.visibility,
        display: style.display,
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      };
    });
    console.log("🧾 keywordPeriod style debug:", periodDebug);

    // 🚀 Пробуємо клік
    if (
      periodDebug.pointerEvents !== "none" &&
      periodDebug.visibility !== "hidden" &&
      periodDebug.display !== "none" &&
      periodDebug.width > 0 &&
      periodDebug.height > 0
    ) {
      console.log("🖱 Attempting to click #keywordPeriod...");
      await page.evaluate(() => {
        document
          .getElementById("keywordPeriod")
          .scrollIntoView({ behavior: "auto", block: "center" });
      });
      await page.waitForTimeout(1000);
      await page.click("#keywordPeriod", { timeout: 5000 });
      console.log("✅ Click successful");
    } else {
      throw new Error("❌ #keywordPeriod is not visible/clickable");
    }

    // Вибрати відповідний період
    const option = await page.$(`text="${periodText}"`);
    if (option) {
      await option.click();
    } else {
      console.warn(`⚠️ Period option not found: ${periodText}`);
    }
    await page.waitForTimeout(2000);

    // Пошук ключового слова
    console.log(`⌨️ Typing keyword: ${keyword}...`);
    await page.fill('input[placeholder="Search by keyword"]', keyword);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(5000);

    await page.waitForSelector(".byted-Table-Body", { timeout: 30000 });

    const data = await page.evaluate(() => {
      const rows = document.querySelectorAll(".byted-Table-Body tr");
      return Array.from(rows).map((row) => {
        const cells = Array.from(row.querySelectorAll("td, th")).map((td) =>
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

    // Обробка
    const processed = data.map((item) => {
      const ctrVal =
        parseFloat(item.ctr.replace("%", "").replace(",", ".")) || 0.01;
      const cpaVal =
        parseFloat(item.cpa.replace(/[^\d.,]/g, "").replace(",", ".")) || 0.01;
      const popChangeVal =
        parseFloat(item.popularityChange.replace("%", "").replace(",", ".")) ||
        0;
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

async function scrapeTikTokHashtagInsights(period = 30) {
  if (activeScrapes >= MAX_CONCURRENT_SCRAPES)
    throw new Error("Too many concurrent scrapes.");
  activeScrapes++;
  let browser;
  try {
    browser = await chromium.launch({
      headless: false,
      args: ["--no-sandbox"],
    });
    const page = await browser.newPage();

    console.log("🌐 Opening TikTok Hashtag Page...");
    await page.goto(
      "https://ads.tiktok.com/business/creativecenter/inspiration/popular/hashtag/pc/en",
      {
        waitUntil: "domcontentloaded",
        timeout: 120000,
      }
    );

    await page.waitForTimeout(12000);

    console.log(`🟠 Selecting period: ${period} days`);
    await page.waitForSelector('[id="hashtagPeriodSelect"]', {
      timeout: 10000,
    });
    await page.click('[id="hashtagPeriodSelect"]');
    await page.waitForTimeout(2000);

    const option = await page.$(`text="Last ${period} days"`);
    if (option) await option.click();
    else console.warn(`⚠️ Period option not found, using default`);

    await page.waitForTimeout(5000);

    for (let i = 0; i < 15; i++) {
      const seeMoreBtn = await page.$(
        "[data-testid=cc_contentArea_viewmore_btn]"
      );
      if (!seeMoreBtn) break;
      if ((await seeMoreBtn.isVisible()) && (await seeMoreBtn.isEnabled())) {
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
      document
        .querySelectorAll('a[class*="container"]')
        .forEach((card, idx) => {
          const rankEl = card.querySelector('span[class*="rankingIndex"]');
          const nameEl = card.querySelector('span[class*="titleText"]');
          let posts = 0;
          const postTextEl = Array.from(card.querySelectorAll("*")).find((el) =>
            /posts$/i.test(el.textContent.trim())
          );
          if (postTextEl) {
            let text = postTextEl.textContent
              .trim()
              .toUpperCase()
              .replace(/\s+/g, "")
              .replace("POSTS", "");
            if (text.endsWith("K")) posts = parseFloat(text) * 1000;
            else if (text.endsWith("M")) posts = parseFloat(text) * 1e6;
            else if (text.endsWith("B")) posts = parseFloat(text) * 1e9;
            else posts = parseInt(text, 10) || 0;
          }
          const rank = rankEl
            ? parseInt(rankEl.textContent.trim(), 10)
            : idx + 1;
          const hashtag = nameEl
            ? nameEl.textContent.trim().replace(/^#/, "")
            : "";
          if (hashtag)
            results.push({ rank, hashtag, posts: Math.round(posts) });
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

async function scrapePopularMusic(region = "United States", time = 30) {
  if (activeScrapes >= MAX_CONCURRENT_SCRAPES)
    throw new Error("Too many concurrent scrapes.");
  activeScrapes++;
  let browser;
  try {
    browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();

    console.log("🌐 Opening TikTok Music Page...");
    await page.goto(
      "https://ads.tiktok.com/business/creativecenter/inspiration/popular/music/pc/en",
      {
        waitUntil: "domcontentloaded",
        timeout: 120000,
      }
    );
    await page.waitForTimeout(8000);

    console.log("🟠 Selecting region...");
    const regionTrigger = await page.$(
      "div[class*=index-mobile_locationSelectContainer]"
    );
    if (regionTrigger) {
      await regionTrigger.click();
      await page.waitForTimeout(2000);
      await page.fill(
        'input[placeholder="Start typing or select from the list"]',
        region
      );
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      console.log(`✅ Region set to ${region}`);
    } else console.warn("⚠️ Region dropdown not found.");

    await page.waitForTimeout(5000);

    await selectTime(page, time);

    for (let i = 0; i < 15; i++) {
      const seeMoreBtn = await page.$(
        '[data-testid="cc_contentArea_viewmore_btn"]>div'
      );
      if (
        seeMoreBtn &&
        (await seeMoreBtn.isVisible()) &&
        (await seeMoreBtn.isEnabled())
      ) {
        await seeMoreBtn.click();
        await page.waitForTimeout(4000);
      }
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(3000);
    }

    return await page.evaluate(() => {
      const results = [];
      document
        .querySelectorAll('div[class*="cardWrapper"]')
        .forEach((card, idx) => {
          const rank =
            parseInt(
              card
                .querySelector('span[class*="rankingIndex"]')
                ?.textContent.trim()
            ) || idx + 1;
          const song =
            card
              .querySelector('span[class*="musicName"]')
              ?.textContent.trim() || "";
          const artist =
            card
              .querySelector('span[class*="autherName"]')
              ?.textContent.trim() || "";
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
    await page.waitForSelector('[data-testid="cc_single_select_undefined"]', {
      timeout: 10000,
    });
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
// STATE-BASED HANDLERS
// ==============================

async function handleKeywordPeriod(chatId, text) {
  const period = parseInt(text, 10);
  if (!isValidPeriod(period)) {
    await bot.sendMessage(chatId, "❗ Вкажіть лише 7, 30 або 120:");
    return false;
  }
  userStates[chatId] = { periodForKeyword: period, waitingForKeyword: true };
  await bot.sendMessage(chatId, "🔤 Введіть ключове слово для пошуку:");
  return true;
}

async function handleKeywordSearch(chatId, keyword) {
  const period = userStates[chatId]?.periodForKeyword || 7;
  userStates[chatId] = {}; // Очистити стан

  await bot.sendMessage(
    chatId,
    `🔎 Шукаю за ключовим словом: "${keyword}" за останні ${period} днів... Це може зайняти 30-60 секунд.`
  );

  const results = await scrapeTikTokKeywordInsights(keyword, period);

  if (!results.length) {
    await bot.sendMessage(
      chatId,
      `⚠️ Creative Center не знайшов результатів для: "${keyword}".`
    );

    // GPT fallback – українські та англійські хештеги окремо
    // --- Robust GPT hashtag parsing ---
    function parseGptHashtags(response) {
      const hashtagRegex = /#[\w\p{L}\p{N}\-_\.]+/gu;
      const uaPart = response.split("🇺🇦 Українські:")[1]?.split("🇬🇧 English:")[0] || "";
      const enPart = response.split("🇬🇧 English:")[1] || "";
      let uaTags = (uaPart.match(hashtagRegex) || []).map((t) => t.trim());
      let enTags = (enPart.match(hashtagRegex) || []).map((t) => t.trim());
      uaTags = [...new Set(uaTags)].slice(0, 8);
      enTags = [...new Set(enTags)].slice(0, 8);
      return { uaTags, enTags };
    }

    const gpt = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: `Ти TikTok-експерт. Згенеруй 8 перспективних українських хештегів і 8 англійських з content gap у ніші "${keyword}". 
               Формат: спочатку блок "🇺🇦 Українські:" з 8 хештегів через кому, потім новий рядок "🇬🇧 English:" з 8 англійських хештегів через кому.`,
        },
      ],
      max_tokens: 300,
    });

    const response = gpt.choices[0].message.content || "";
    const { uaTags, enTags } = parseGptHashtags(response);

    if (!uaTags.length && !enTags.length) {
      await bot.sendMessage(chatId, "⚠️ GPT не згенерував хештеги.");
      return;
    }

    // ...existing code...
  }

  // Send results to chat
  await bot.sendMessage(
    chatId,
    "✅ Знайдено дані в Creative Center:\n\n" + formatTable(results)
  );

  userStates[chatId] = {
    waitingForKeywordPick: true,
    keywordsList: results.slice(0, 5).map((i) => i.keyword),
  };

  await bot.sendMessage(
    chatId,
    "✏️ Введіть номер з таблиці для генерації ідеї (наприклад 1 або 2):"
  );
}

async function handleKeywordPick(chatId, text) {
  const selected = parseInt(text, 10);
  const keywords = userStates[chatId]?.keywordsList || [];

  if (!selected || selected < 1 || selected > keywords.length) {
    await bot.sendMessage(
      chatId,
      "❗ Введіть номер із таблиці (наприклад 1 або 2):"
    );
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
      {
        role: "system",
        content:
          "Ти досвідчений маркетолог і TikTok-креатор. Відповідай українською мовою.",
      },
      { role: "user", content: prompt },
    ],
    max_tokens: 500,
  });

  await bot.sendMessage(chatId, gptResponse.choices[0].message.content);
}

async function handleHashtagPeriod(chatId, text) {
  const period = parseInt(text, 10);
  if (!isValidPeriod(period)) {
    await bot.sendMessage(chatId, "❗ Вкажіть 7, 30 або 120:");
    return false;
  }
  userStates[chatId] = {};
  await bot.sendMessage(chatId, `🔎 Збираю хештеги за ${period} днів...`);
  const hashtags = await scrapeTikTokHashtagInsights(period);
  await bot.sendMessage(chatId, formatHashtagList(hashtags));
  return true;
}

async function handleTrackRegion(chatId, text) {
  userStates[chatId] = { waitingForPeriodForTracks: true, region: text };
  await bot.sendMessage(
    chatId,
    "✏️ Тепер вкажіть період (7, 30 або 120 днів):"
  );
}

async function handleTrackPeriod(chatId, text) {
  const period = parseInt(text, 10);
  if (!isValidPeriod(period)) {
    await bot.sendMessage(chatId, "❗ Вкажіть 7, 30 або 120:");
    return false;
  }
  const region = userStates[chatId]?.region || "United States";
  userStates[chatId] = {};
  await bot.sendMessage(
    chatId,
    `🔎 Збираю популярну музику з ${region} за ${period} днів...`
  );
  const tracks = await scrapePopularMusic(region, period);
  await bot.sendMessage(chatId, formatMusicList(tracks));
  return true;
}

// ==============================
// COMMANDS AND MESSAGES
// ==============================

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(
    chatId,
    "⏳ Будь ласка, зачекайте 30 секунд — сервіс запускається..."
  );
  userStates[chatId] = {};
  await bot.sendMessage(
    chatId,
    `Привіт! Я TikTok-аналітичний бот.

Команди:
/start - запустити чатбот
/keywords - пошук ідей за ключовим словом
/hashtags - трендові хештеги
/tracks - популярна музика
/hashtagcloud - генерація хештег-хмар
Використовуйте ці команди для отримання аналітики та ідей для контенту.

Вкажи команду для початку.`
  );
});

bot.onText(/\/keywords/, async (msg) => {
  const chatId = msg.chat.id;
  userStates[chatId] = {};
  await bot.sendMessage(
    chatId,
    "Вкажіть період для пошуку ключових слів (7, 30, 120 днів):"
  );
  userStates[chatId].waitingForPeriodForKeyword = true;
});

bot.onText(/\/hashtags/, async (msg) => {
  const chatId = msg.chat.id;
  userStates[chatId] = {};
  await bot.sendMessage(
    chatId,
    "Вкажіть період для хештегів (7, 30, 120 днів):"
  );
  userStates[chatId].waitingForPeriodForHashtags = true;
});

bot.onText(/\/tracks/, async (msg) => {
  const chatId = msg.chat.id;
  userStates[chatId] = {};
  await bot.sendMessage(
    chatId,
    "Вкажіть регіон (наприклад, United States, Ukraine, Russia):"
  );
  userStates[chatId].waitingForRegionForTracks = true;
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = (msg.text || "").trim();

  if (!text || text.startsWith("/")) {
    // If user sends /cancel, exit hashtagcloud mode
    if (text === "/cancel" && state.waitingForHashtagCloud) {
      userStates[chatId] = {};
      await bot.sendMessage(chatId, "❌ Вихід з режиму генерації хештег-хмар.");
    }
    return;
  }

  const state = userStates[chatId] || {};

  try {
    if (state.waitingForPeriodForKeyword) {
      if (await handleKeywordPeriod(chatId, text)) return;
    }
    if (state.waitingForKeyword) {
      await handleKeywordSearch(chatId, text);
      return;
    }
    if (state.waitingForKeywordPick) {
      await handleKeywordPick(chatId, text);
      return;
    }
    if (state.waitingForPeriodForHashtags) {
      if (await handleHashtagPeriod(chatId, text)) return;
    }
    if (state.waitingForRegionForTracks) {
      await handleTrackRegion(chatId, text);
      return;
    }
    if (state.waitingForPeriodForTracks) {
      if (await handleTrackPeriod(chatId, text)) return;
    }
    if (state.waitingForHashtagCloud) {
      userStates[chatId] = {};
      await handleHashtagCloud(chatId, text);
      return;
    }
  } catch (e) {
    console.error("❌ Error handling message:", e);
    await bot.sendMessage(chatId, "⚠️ Виникла помилка, спробуйте ще раз.");
  }
});
