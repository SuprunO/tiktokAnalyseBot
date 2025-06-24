const { chromium } = require("playwright");
const TelegramBot = require("node-telegram-bot-api");
const express = require("express");
require("dotenv").config();

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
if (!TELEGRAM_TOKEN) {
  console.error("Please set TELEGRAM_TOKEN environment variable");
  process.exit(1);
}

const PORT = process.env.PORT || 3000;
const URL =
  process.env.RENDER_EXTERNAL_URL || "https://tiktokanalysebot.onrender.com"; // Change this to your Render URL

// Create bot instance with webhook option (no polling!)
const bot = new TelegramBot(TELEGRAM_TOKEN);

// Set Telegram webhook URL (Telegram will send updates here)
bot.setWebHook(`${URL}/bot${TELEGRAM_TOKEN}`);

// Create Express app
const app = express();
app.use(express.json());

// Webhook endpoint to receive updates from Telegram
app.post(`/bot${TELEGRAM_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// Your scraping function (same as before)
async function scrapeTikTokKeywordInsights(keyword) {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
    slowMo: 100,
  });

  const page = await browser.newPage();

  await page.goto(
    "https://ads.tiktok.com/business/creativecenter/keyword-insights/pc/en",
    {
      waitUntil: "networkidle",
    }
  );

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
    
    // ✅ Dump partial HTML for debugging
    const html = await page.content();
    console.log(`HTML snapshot (attempt ${i + 1}):\n`, html.slice(0, 1000));

    await page.waitForTimeout(3000); // short delay before retry
  }
}

if (!found) {
  throw new Error('Keyword input not found after multiple attempts');
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

// Telegram message handler - same logic, but no polling; triggered by webhook updates
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
