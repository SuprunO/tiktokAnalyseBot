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

  bot
    .setWebHook(`${RENDER_EXTERNAL_URL}/bot${TELEGRAM_TOKEN}`)
    .then(() =>
      console.log(
        `✅ Webhook set to ${RENDER_EXTERNAL_URL}/bot${TELEGRAM_TOKEN}`
      )
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
// SCRAPER FUNCTION
// ==============================
async function scrapeTikTokKeywordInsights(keyword) {
  console.log(`🌐 Starting browser for keyword: "${keyword}"`);

  const browser = await chromium.launch({
    headless: false, // якщо треба, можна з ENV
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--use-gl=swiftshader",
      "--disable-software-rasterizer",
      "--disable-setuid-sandbox",
      "--disable-accelerated-2d-canvas",
      "--no-zygote",
    ],
  });

  const page = await browser.newPage();

  try {
    console.log("⏳ Navigating to TikTok Creative Center...");
    await page.goto(
      "https://ads.tiktok.com/business/creativecenter/keyword-insights/pc/en",
      {
        waitUntil: "domcontentloaded",
        timeout: 120000,
      }
    );

    console.log("⏳ Waiting 10s for page to be fully ready...");
    await page.waitForTimeout(10000);

    // Перевірка на CAPTCHA
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

    console.log("🖱 Clicking search button");
    await page.click('[data-testid="cc_commonCom_autoComplete_seach"]');

    console.log("⏳ Waiting for results table selector...");
    await page.waitForSelector(".byted-Table-Body", { timeout: 30000 });

    console.log("📊 Extracting data from table...");
    const data = await page.evaluate(() => {
      const tableBody = document.querySelector(".byted-Table-Body");
      if (!tableBody) {
        console.log("⚠️ Table body selector not found");
        return [];
      }

      return Array.from(tableBody.querySelectorAll("tr")).map((row) => {
        const cells = Array.from(row.querySelectorAll("td")).map((td) =>
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

    console.log(`✅ Extracted ${data.length} rows from table`);

    data.forEach((item) => {
      const ctrVal =
        parseFloat(item.ctr.replace("%", "").replace(",", ".")) || 0.01;
      const cpaVal =
        parseFloat(item.cpa.replace(/[^\d.,]/g, "").replace(",", ".")) || 0.01;
      const popChangeVal =
        parseFloat(item.popularityChange.replace("%", "").replace(",", ".")) ||
        0;
      const score = popChangeVal * (cpaVal / ctrVal);
      item.contentGapScore = Number(score.toFixed(2));
    });

    data.sort((a, b) => b.contentGapScore - a.contentGapScore);

    return data;
  } catch (error) {
    console.error("❌ Error during scraping:", error);

    try {
      await page.screenshot({ path: "error_screenshot.png", fullPage: true });
      const html = await page.content();
      fs.writeFileSync("error_page.html", html);
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
