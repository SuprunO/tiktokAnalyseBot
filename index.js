require("dotenv").config();

const express = require("express");
const { chromium } = require("playwright");
const TelegramBot = require("node-telegram-bot-api");
const OpenAI = require("openai");
const fs = require("fs");

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
const PORT = process.env.PORT || 3000;

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

if (RENDER_EXTERNAL_URL) {
  console.log("🟢 Running in Webhook mode");
  bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });

  bot.setWebHook(`${RENDER_EXTERNAL_URL}/bot${TELEGRAM_TOKEN}`)
    .then(() =>
      console.log(`✅ Webhook set to ${RENDER_EXTERNAL_URL}/bot${TELEGRAM_TOKEN}`)
    )
    .catch(console.error);

  app.post(`/bot${TELEGRAM_TOKEN}`, (req, res) => {
    console.log("🔔 Received update via webhook");
    bot.processUpdate(req.body);
    res.sendStatus(200);
  });
} else {
  console.log("🟠 Running in Polling mode");
  bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
  console.log("✅ Polling started.");
}

// ==============================
// START EXPRESS
// ==============================
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Express server listening on port ${PORT}`);
});

// ==============================
// HELPER FUNCTIONS
// ==============================
function randomDelay(min = 1000, max = 3000) {
  return new Promise(resolve => setTimeout(resolve, Math.random() * (max - min) + min));
}

// ==============================
// SCRAPER FUNCTION
// ==============================
async function scrapeTikTokKeywordInsights(keyword) {
  console.log(`🌐 Starting browser for keyword: "${keyword}"`);

  const browser = await chromium.launch({
    headless: false,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--use-gl=swiftshader",
      "--disable-software-rasterizer",
      "--disable-setuid-sandbox",
      "--disable-accelerated-2d-canvas",
      "--no-zygote"
    ]
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    viewport: { width: 1280, height: 720 }
  });

  const page = await context.newPage();

  // Ignore WebSocket errors
  page.on('websocket', ws => {
    ws.on('socketerror', error => {
      console.log(`WebSocket error: ${error}`);
    });
  });

  page.on("request", request => {
    console.log(`➡️ Request: ${request.method()} ${request.url()}`);
  });
  
  page.on("response", response => {
    console.log(`⬅️ Response: ${response.status()} ${response.url()}`);
  });

  page.on("console", msg => {
    console.log(`📢 Browser console: ${msg.type()}: ${msg.text()}`);
  });

  try {
    console.log("⏳ Navigating to TikTok Creative Center...");
   await page.goto(
      "https://ads.tiktok.com/business/creativecenter/keyword-insights/pc/en",
      { waitUntil: "domcontentloaded", timeout: 120000 }
    );

    console.log("⏳ Waiting for page to be fully ready...");
    await randomDelay(5000, 10000);

    // CAPTCHA detection
    const captcha = await page.$('iframe[src*="captcha"], div.captcha');
    if (captcha) {
      console.warn("⚠️ CAPTCHA detected on the page!");
      await page.screenshot({ path: "captcha_detected.png", fullPage: true });
      const html = await page.content();
      fs.writeFileSync("captcha_detected.html", html);
      throw new Error("CAPTCHA detected");
    }

    console.log(`🔍 Filling search input with "${keyword}"`);
    await page.fill('input[placeholder="Search by keyword"]', keyword);
    await randomDelay(1000, 2000);

    console.log("🖱 Attempting to click search button");
    try {
      // Try multiple selector variations
      const searchButton = await page.$('[data-testid="cc_commonCom_autoComplete_seach"], button:has-text("Search")');
      if (searchButton) {
        await searchButton.click({ timeout: 10000 });
      } else {
        console.warn("⚠️ Search button not found with selectors, trying evaluate");
        await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button'));
          const searchBtn = buttons.find(btn => 
            btn.textContent.includes('Search') || 
            btn.getAttribute('data-testid')?.includes('search')
          );
          searchBtn?.click();
        });
      }
    } catch (clickError) {
      console.warn("⚠️ Click failed:", clickError.message);
      console.log("🖱 Trying keyboard Enter as fallback");
      await page.keyboard.press('Enter');
    }

    console.log("⏳ Waiting for results to load...");
    try {
      await page.waitForSelector(".byted-Table-Body, .table-container, .result-table", { 
        timeout: 30000 
      });
    } catch (e) {
      console.warn("⚠️ Table not found, checking for alternative indicators");
      await page.waitForFunction(() => 
        document.querySelector('.byted-Table-Body') || 
        document.querySelector('.result-container') ||
        document.body.innerText.includes('Keyword')
      , { timeout: 30000 });
    }

    console.log("📸 Taking screenshot after search...");
    await page.screenshot({ path: "after_search.png", fullPage: true });

    console.log("📊 Extracting data from table...");
    const data = await page.evaluate(() => {
      // Try multiple table selectors
      const tableBody = document.querySelector(".byted-Table-Body") || 
                       document.querySelector(".table-container") ||
                       document.querySelector(".result-table tbody");
      
      if (!tableBody) return [];

      return Array.from(tableBody.querySelectorAll("tr")).map(row => {
        const cells = Array.from(row.querySelectorAll("td, th")).map(td => td.innerText.trim());
        // More resilient cell mapping
        return {
          rank: cells[0] || "",
          keyword: cells[1] || "",
          popularity: cells[2] || "",
          popularityChange: cells[3] || "",
          ctr: cells[4] || "",
          cvr: cells[5] || "",
          cpa: cells[6] || ""
        };
      });
    });

    if (!data.length) {
      // Fallback extraction method
      const fallbackData = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('.keyword-row, .result-row'));
        return rows.map(row => {
          const cells = Array.from(row.querySelectorAll('div.cell, .data-cell'));
          return {
            rank: cells[0]?.innerText.trim() || "",
            keyword: cells[1]?.innerText.trim() || "",
            popularity: cells[2]?.innerText.trim() || "",
            popularityChange: cells[3]?.innerText.trim() || "",
            ctr: cells[4]?.innerText.trim() || "",
            cvr: cells[5]?.innerText.trim() || "",
            cpa: cells[6]?.innerText.trim() || ""
          };
        });
      });

      if (fallbackData.length) {
        console.log(`✅ Extracted ${fallbackData.length} rows using fallback method`);
        return fallbackData;
      }

      throw new Error("No data found in table");
    }

    console.log(`✅ Extracted ${data.length} rows from table`);

    // Process data
    data.forEach(item => {
      const ctrVal = parseFloat(item.ctr.replace("%", "").replace(",", ".")) || 0.01;
      const cpaVal = parseFloat(item.cpa.replace(/[^\d.,]/g, "").replace(",", ".")) || 0.01;
      const popChangeVal = parseFloat(item.popularityChange.replace("%", "").replace(",", ".")) || 0;
      const score = popChangeVal * (cpaVal / ctrVal);
      item.contentGapScore = Number(score.toFixed(2));
    });

    return data.sort((a, b) => b.contentGapScore - a.contentGapScore);
  } catch (error) {
    console.error("❌ Error during scraping:", error);
    try {
      await page.screenshot({ path: "error_screenshot.png", fullPage: true });
      const html = await page.content();
      fs.writeFileSync("error_page.html", html);
      console.log("✅ Saved error screenshot and HTML");
    } catch (e) {
      console.error("❌ Failed to save screenshot or HTML:", e);
    }
    return [];
  } finally {
    await browser.close();
    console.log("🛑 Browser closed");
  }
}

// ==============================
// FORMATTING FUNCTIONS
// ==============================
function formatTable(data) {
  if (!data.length) return "❗ Немає даних у Creative Center.";

  return data
    .map(
      (item, idx) =>
        `#${idx + 1}\n` +
        `Слово: ${item.keyword}\n` +
        `Ранг: ${item.rank}\n` +
        `Популярність: ${item.popularity}\n` +
        `Зміна популярності: ${item.popularityChange}\n` +
        `CTR: ${item.ctr}\n` +
        `CVR: ${item.cvr}\n` +
        `CPA: ${item.cpa}\n` +
        `Content Gap Score: ${item.contentGapScore}\n`
    )
    .join("\n");
}

function makeGPTPrompt(keyword, topN) {
  const rowsText = topN
    .map((item, idx) =>
      `
#${idx + 1}
Ключове слово: ${item.keyword}
Ранг: ${item.rank}
Популярність: ${item.popularity}
Зміна популярності: ${item.popularityChange}
CTR: ${item.ctr}
CVR: ${item.cvr}
CPA: ${item.cpa}
Content Gap Score: ${item.contentGapScore}
`.trim()
    )
    .join("\n\n");

  return `
Ти досвідчений маркетолог-аналітик і сценарист для TikTok Ads. Відповідай українською мовою.

Для кожного результату зроби дуже детальний і зрозумілий розбір. Формат:

1️⃣ 📌 Слово
2️⃣ 📊 Аналіз показників з поясненням
3️⃣ 🎥 Сценарій для 1-хвилинного відео
4️⃣ 🏷️ Пропозиція хештегів з поясненням

Ось результати:
${rowsText}
`;
}

// ==============================
// BOT LOGIC
// ==============================
bot.onText(/\/start/, (msg) => {
  console.log(`📩 /start received from chatId ${msg.chat.id}`);
  bot.sendMessage(
    msg.chat.id,
    "Привіт! Надішли мені слово для аналізу з TikTok Creative Center."
  );
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text?.trim();
  console.log(`📩 Received message from chatId ${chatId}: "${text}"`);

  if (!text || text.startsWith("/start")) return;

  await bot.sendMessage(
    chatId,
    `🔎 Шукаю за запитом: "${text}"... Це може зайняти 30-60 секунд.`
  );

  try {
    const results = await scrapeTikTokKeywordInsights(text);

    if (!results.length) {
      console.log(`❗ No data for keyword "${text}", fallback to GPT`);
      await bot.sendMessage(
        chatId,
        "❗ У Creative Center немає даних. Генерую ідею з GPT..."
      );

      const fallbackPrompt = `
Тема: "${text}"
1️⃣ 📌 Слово
2️⃣ 🎥 Сценарій (вау-ефект, сюжет, CTA)
3️⃣ 📊 Чому це спрацює
4️⃣ 🏷️ 5-7 хештегів українською
`;

      const fallbackResponse = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content:
              "Ти досвідчений маркетолог і TikTok-креатор. Відповідай українською мовою.",
          },
          { role: "user", content: fallbackPrompt },
        ],
      });

      await bot.sendMessage(
        chatId,
        fallbackResponse.choices[0].message.content
      );
      return;
    }

    console.log(`✅ Found ${results.length} results for "${text}"`);

    await bot.sendMessage(
      chatId,
      "✅ Знайдено дані. Ось таблиця:\n\n" + formatTable(results.slice(0, 5))
    );
    await bot.sendMessage(chatId, "💬 Аналізую з GPT...");

    const topN = results.slice(0, Math.min(5, results.length));
    const gptPrompt = makeGPTPrompt(text, topN);

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content:
            "Ти досвідчений маркетолог і сценарист TikTok Ads. Відповідай українською мовою.",
        },
        { role: "user", content: gptPrompt },
      ],
    });

    await bot.sendMessage(chatId, completion.choices[0].message.content);
  } catch (err) {
    console.error("❌ Bot error:", err);
    await bot.sendMessage(
      chatId,
      "❗ Сталася помилка. Спробуй ще раз пізніше."
    );
  }
});
