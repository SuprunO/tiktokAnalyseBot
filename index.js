require("dotenv").config();

const express = require("express");
const { chromium } = require("playwright");
const TelegramBot = require("node-telegram-bot-api");
const OpenAI = require("openai");
const fs = require("fs/promises"); // Using promises version for better memory management

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
const PORT = process.env.PORT || 3000;
const MAX_CONCURRENT_SCRAPES = 2; // Limit concurrent browser instances

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
let activeScrapes = 0; // Track active scraping operations

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
// HELPER FUNCTIONS (Memory Optimized)
// ==============================
function randomDelay(min = 1000, max = 3000) {
  return new Promise(resolve => setTimeout(resolve, Math.random() * (max - min) + min));
}

// Memory cleanup utility
async function cleanupTempFiles() {
  try {
    const files = ['captcha_detected.png', 'captcha_detected.html', 'error_screenshot.png', 'error_page.html'];
    for (const file of files) {
      try {
        await fs.unlink(file);
      } catch (e) {
        if (e.code !== 'ENOENT') console.error(`Cleanup error for ${file}:`, e);
      }
    }
  } catch (e) {
    console.error("General cleanup error:", e);
  }
}

// ==============================
// SCRAPER FUNCTION (Optimized)
// ==============================
async function scrapeTikTokKeywordInsights(keyword) {
  if (activeScrapes >= MAX_CONCURRENT_SCRAPES) {
    throw new Error("Too many concurrent scrapes. Please try again later.");
  }

  activeScrapes++;
  console.log(`🌐 Starting browser for keyword: "${keyword}" (Active scrapes: ${activeScrapes})`);

  let browser;
  try {
    browser = await chromium.launch({
      headless: true, // Changed to true for memory efficiency
      args: [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--use-gl=swiftshader",
        "--disable-software-rasterizer",
        "--disable-setuid-sandbox",
        "--disable-accelerated-2d-canvas",
        "--no-zygote",
        "--single-process" // Reduces memory usage
      ]
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      viewport: { width: 1280, height: 720 }
    });

    const page = await context.newPage();

    // Limit event listeners to reduce memory
    const errorHandler = error => console.log(`WebSocket error: ${error}`);
    page.on('websocket', ws => ws.on('socketerror', errorHandler));

    try {
      console.log("⏳ Navigating to TikTok Creative Center...");
      await page.goto(
        "https://ads.tiktok.com/business/creativecenter/keyword-insights/pc/en",
        { waitUntil: "networkidle", timeout: 120000 }
      );

      console.log("⏳ Waiting for page to be fully ready...");
      await randomDelay(5000, 10000);

      // CAPTCHA detection
      const captcha = await page.$('iframe[src*="captcha"], div.captcha');
      if (captcha) {
        console.warn("⚠️ CAPTCHA detected on the page!");
        await page.screenshot({ path: "captcha_detected.png", fullPage: false }); // Reduced size
        const html = await page.content();
        await fs.writeFile("captcha_detected.html", html);
        throw new Error("CAPTCHA detected");
      }

      console.log(`🔍 Filling search input with "${keyword}"`);
      await page.fill('input[placeholder="Search by keyword"]', keyword);
      await randomDelay(1000, 2000);

      console.log("🖱 Attempting to click search button");
      try {
        const searchButton = await page.$('[data-testid="cc_commonCom_autoComplete_seach"], button:has-text("Search")');
        if (searchButton) {
          await searchButton.click({ timeout: 10000 });
        } else {
          await page.keyboard.press('Enter');
        }
      } catch (clickError) {
        console.warn("⚠️ Click failed, using keyboard fallback:", clickError.message);
        await page.keyboard.press('Enter');
      }

      console.log("⏳ Waiting for results to load...");
      await page.waitForSelector(".byted-Table-Body, .table-container, .result-table", { 
        timeout: 30000 
      });

      console.log("📊 Extracting data from table...");
      const data = await page.evaluate(() => {
        const tableBody = document.querySelector(".byted-Table-Body") || 
                         document.querySelector(".table-container") ||
                         document.querySelector(".result-table tbody");
        
        if (!tableBody) return [];

        const rows = Array.from(tableBody.querySelectorAll("tr"));
        const result = [];
        
        // Process rows in batches to avoid memory spikes
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const cells = Array.from(row.querySelectorAll("td, th")).map(td => td.innerText.trim());
          
          result.push({
            rank: cells[0] || "",
            keyword: cells[1] || "",
            popularity: cells[2] || "",
            popularityChange: cells[3] || "",
            ctr: cells[4] || "",
            cvr: cells[5] || "",
            cpa: cells[6] || ""
          });
        }
        
        return result;
      });

      if (!data.length) {
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

      // Process data in smaller chunks
      const processedData = [];
      const batchSize = 50; // Process in batches to avoid memory spikes
      
      for (let i = 0; i < data.length; i += batchSize) {
        const batch = data.slice(i, i + batchSize);
        for (const item of batch) {
          const ctrVal = parseFloat(item.ctr.replace("%", "").replace(",", ".")) || 0.01;
          const cpaVal = parseFloat(item.cpa.replace(/[^\d.,]/g, "").replace(",", ".")) || 0.01;
          const popChangeVal = parseFloat(item.popularityChange.replace("%", "").replace(",", ".")) || 0;
          const score = popChangeVal * (cpaVal / ctrVal);
          
          processedData.push({
            ...item,
            contentGapScore: Number(score.toFixed(2))
          });
        }
      }

      return processedData.sort((a, b) => b.contentGapScore - a.contentGapScore);
    } catch (error) {
      console.error("❌ Error during scraping:", error);
      try {
        await page.screenshot({ path: "error_screenshot.png", fullPage: false }); // Reduced size
        const html = await page.content();
        await fs.writeFile("error_page.html", html);
        console.log("✅ Saved error screenshot and HTML");
      } catch (e) {
        console.error("❌ Failed to save screenshot or HTML:", e);
      }
      return [];
    } finally {
      try {
        if (browser) await browser.close();
        console.log("🛑 Browser closed");
      } catch (e) {
        console.error("Error closing browser:", e);
      }
      activeScrapes--;
      await cleanupTempFiles();
    }
  } catch (e) {
    activeScrapes--;
    throw e;
  }
}

// ==============================
// FORMATTING FUNCTIONS (Optimized)
// ==============================
function formatTable(data) {
  if (!data.length) return "❗ Немає даних у Creative Center.";

  // Limit to first 5 items to reduce message size
  return data.slice(0, 5)
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
  // Limit to first 3 items to reduce token usage
  const rowsText = topN.slice(0, 3)
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
// BOT LOGIC (Optimized)
// ==============================
bot.onText(/\/start/, (msg) => {
  console.log(`📩 /start received from chatId ${msg.chat.id}`);
  bot.sendMessage(
    msg.chat.id,
    "Привіт! Надішли мені слово для аналізу з TikTok Creative Center."
  ).catch(console.error);
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text?.trim();
  console.log(`📩 Received message from chatId ${chatId}: "${text}"`);

  if (!text || text.startsWith("/start")) return;

  try {
    await bot.sendMessage(
      chatId,
      `🔎 Шукаю за запитом: "${text}"... Це може зайняти 30-60 секунд.`
    );

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
            content: "Ти досвідчений маркетолог і TikTok-креатор. Відповідай українською мовою.",
          },
          { role: "user", content: fallbackPrompt },
        ],
        max_tokens: 500 // Limit response size
      });

      await bot.sendMessage(chatId, fallbackResponse.choices[0].message.content);
      return;
    }

    console.log(`✅ Found ${results.length} results for "${text}"`);

    // Split large messages to avoid memory issues
    const tableMessage = "✅ Знайдено дані. Ось таблиця:\n\n" + formatTable(results);
    await bot.sendMessage(chatId, tableMessage);
    
    await bot.sendMessage(chatId, "💬 Аналізую з GPT...");

    const topN = results.slice(0, 3); // Reduced from 5 to 3 for memory
    const gptPrompt = makeGPTPrompt(text, topN);

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: "Ти досвідчений маркетолог і сценарист TikTok Ads. Відповідай українською мовою.",
        },
        { role: "user", content: gptPrompt },
      ],
      max_tokens: 1000 // Limit response size
    });

    // Split long GPT response into chunks
    const responseText = completion.choices[0].message.content;
    const chunkSize = 3000;
    for (let i = 0; i < responseText.length; i += chunkSize) {
      const chunk = responseText.substring(i, i + chunkSize);
      await bot.sendMessage(chatId, chunk);
    }
  } catch (err) {
    console.error("❌ Bot error:", err);
    await bot.sendMessage(
      chatId,
      "❗ Сталася помилка. Спробуй ще раз пізніше."
    ).catch(e => console.error("Failed to send error message:", e));
  }
});

// Regular cleanup
setInterval(cleanupTempFiles, 3600000); // Cleanup every hour