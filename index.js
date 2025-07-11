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

const app = express();
app.use(express.json());

app.get("/", (req, res) => res.send("✅ Bot is running."));

const openai = new OpenAI({ apiKey: OPENAI_KEY });

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

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Express server listening on port ${PORT}`);
});

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

  const page = await browser.newPage();

  page.on("console", msg => {
    console.log(`📢 Browser console: ${msg.type()}: ${msg.text()}`);
  });

  try {
    console.log("⏳ Navigating to TikTok Creative Center...");
    await page.goto(
      "https://ads.tiktok.com/business/creativecenter/keyword-insights/pc/en",
      { waitUntil: "domcontentloaded", timeout: 120000 }
    );

    console.log("⏳ Waiting 10s for page to be fully ready...");
    await page.waitForTimeout(10000);

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
    await page.waitForTimeout(4000);

    console.log("📸 Taking screenshot before waiting for results...");
    await page.screenshot({ path: "before_results.png", fullPage: true });
    const html = await page.content();
    fs.writeFileSync("before_results.html", html);

    console.log("⏳ Waiting for results table selector...");
    await page.waitForSelector(".byted-Table-Body", { timeout: 30000 });

    console.log("📊 Extracting data from table...");
    const data = await page.evaluate(() => {
      const tableBody = document.querySelector(".byted-Table-Body");
      if (!tableBody) return [];

      return Array.from(tableBody.querySelectorAll("tr")).map(row => {
        const cells = Array.from(row.querySelectorAll("td")).map(td => td.innerText.trim());
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

    console.log(`✅ Extracted ${data.length} rows from table`);

    data.forEach(item => {
      const ctrVal = parseFloat(item.ctr.replace("%", "").replace(",", ".")) || 0.01;
      const cpaVal = parseFloat(item.cpa.replace(/[^\d.,]/g, "").replace(",", ".")) || 0.01;
      const popChangeVal = parseFloat(item.popularityChange.replace("%", "").replace(",", ".")) || 0;
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
