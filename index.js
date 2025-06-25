const { chromium } = require("playwright");  // <-- import chromium directly
const TelegramBot = require("node-telegram-bot-api");
const express = require("express");
require("dotenv").config();

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
if (!TELEGRAM_TOKEN) {
  console.error("Please set TELEGRAM_TOKEN environment variable");
  process.exit(1);
}

const PORT = process.env.PORT || 3000;
const URL = process.env.RENDER_EXTERNAL_URL || "https://tiktokanalysebot.onrender.com";

// Create bot instance with webhook option (no polling!)
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });

// Set Telegram webhook URL
bot.setWebHook(`${URL}/bot${TELEGRAM_TOKEN}`).then(() => {
  console.log(`Webhook set to ${URL}/bot${TELEGRAM_TOKEN}`);
});

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Bot is running.");
});

app.post(`/bot${TELEGRAM_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

async function scrapeTikTokKeywordInsights(keyword) {
  const browser = await chromium.launch({
    headless: true,  // keep headless for production
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
    slowMo: 50,
  });

  const page = await browser.newPage();

  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117 Safari/537.36"
  );
  await page.setViewportSize({ width: 1366, height: 768 });

  let found = false;
  for (let i = 0; i < 3; i++) {
    try {
      await page.goto(
        "https://ads.tiktok.com/business/creativecenter/keyword-insights/pc/en",
        {
          waitUntil: "networkidle",
          timeout: 60000,
        }
      );

      await page.waitForSelector('input[placeholder="Search by keyword"]', {
        timeout: 60000,
      });

      found = true;
      break;
    } catch (err) {
      console.log(`Try ${i + 1}: selector not found yet, retrying...`);
      const html = await page.content();
      console.log(`HTML snapshot (attempt ${i + 1}):\n`, html.slice(0, 1000));
      await page.waitForTimeout(3000);
    }
  }

  if (!found) {
    await browser.close();
    throw new Error("Keyword input not found after multiple attempts");
  }

  await page.fill('input[placeholder="Search by keyword"]', keyword);
  await page.click('[data-testid="cc_commonCom_autoComplete_seach"]');

  await page.waitForSelector(".byted-Table-Body", { timeout: 15000 });

  const data = await page.evaluate(() => {
    const tableBody = document.querySelector(".byted-Table-Body");
    if (!tableBody) return [];

    const rows = Array.from(tableBody.querySelectorAll("tr"));
    return rows.map((row) => {
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

  await browser.close();
  return data;
}

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const keyword = msg.text?.trim();

  if (!keyword) {
    bot.sendMessage(chatId, "Please send a keyword to search TikTok insights.");
    return;
  }

  bot.sendMessage(
    chatId,
    `Searching TikTok keyword insights for: "${keyword}"...`
  );

  try {
    const results = await scrapeTikTokKeywordInsights(keyword);

    if (!results.length) {
      bot.sendMessage(chatId, "No data found for that keyword.");
      return;
    }

    let reply = `Top TikTok keyword insights for "${keyword}":\n\n`;
    results.slice(0, 10).forEach((item) => {
      reply += `Rank: ${item.rank}\nKeyword: ${item.keyword}\nPopularity: ${item.popularity}\nPopularity Change: ${item.popularityChange}\nCTR: ${item.ctr}\nCVR: ${item.cvr}\nCPA: ${item.cpa}\n\n`;
    });

    bot.sendMessage(chatId, reply);
  } catch (error) {
    console.error("Error scraping TikTok:", error);
    bot.sendMessage(
      chatId,
      "Sorry, an error occurred while fetching data. Please try again later."
    );
  }
});

app.listen(PORT, () => {
  console.log(`Express server listening on port ${PORT}`);
});
