require('dotenv').config();
const express = require('express');
const axios = require('axios');
const chromium = require('chrome-aws-lambda');
const puppeteer = require('puppeteer-core');
const bodyParser = require('body-parser');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
const PORT = process.env.PORT || 3000;

const app = express();
app.use(bodyParser.json());

// === Scrape TikTok trends ===
async function scrapeTikTokTrends({ minGrowth = 200 } = {}) {
  const browser = await puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath,
    headless: chromium.headless,
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0');

  await page.goto('https://ads.tiktok.com/business/creativecenter/search-trends/', {
    waitUntil: 'networkidle2',
    timeout: 60000,
  });

  await autoScroll(page);

  const trends = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.trend-card'));
    return cards.map(card => {
      const title = card.querySelector('.title')?.textContent?.trim();
      const growthText = card.querySelector('.rate')?.textContent || '';
      const growth = parseInt(growthText.replace(/\D/g, '')) || 0;
      const hasLackOfContent = card.textContent.includes('Lack of content');
      const updatedAt = card.querySelector('.desc')?.textContent?.trim();
      return { title, growth, updatedAt, lackOfContent: hasLackOfContent };
    });
  });

  await browser.close();
  return trends.filter(t => t.lackOfContent && t.growth >= minGrowth);
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 300;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight >= scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 300);
    });
  });
}

// === Telegram handler ===
app.post(`/webhook/${TELEGRAM_TOKEN}`, async (req, res) => {
  const message = req.body.message;
  if (!message || !message.text) return res.sendStatus(200);

  const chatId = message.chat.id;
  const text = message.text.trim();

  try {
    if (text === '/start') {
      return sendTelegramMessage(chatId, `👋 Привіт! Я бот, який знаходить TikTok тренди з тегом "Lack of content". Напиши /trendideas щоб отримати ідеї!`);
    }

    if (text === '/trendideas') {
      await sendTelegramMessage(chatId, `⏳ Збираю тренди з TikTok Creative Center...`);

      const trends = await scrapeTikTokTrends();
      if (trends.length === 0) {
        return sendTelegramMessage(chatId, `😕 Не знайдено трендів з тегом "Lack of content".`);
      }

      const reply = trends.slice(0, 5).map(t =>
        `🔥 <b>${t.title}</b>\n⬆️ ${t.growth}%\n🕒 ${t.updatedAt}`
      ).join('\n\n');

      return sendTelegramMessage(chatId, reply, { parse_mode: 'HTML' });
    }

    return sendTelegramMessage(chatId, `🤖 Невідома команда. Напиши /trendideas або /start`);
  } catch (err) {
    console.error('❌ Деталі помилки:', err);
    return sendTelegramMessage(chatId, `❌ Помилка: ${err.message}`);
  } finally {
    res.sendStatus(200);
  }
});

async function sendTelegramMessage(chatId, text, options = {}) {
  return axios.post(`${TELEGRAM_API}/sendMessage`, {
    chat_id: chatId,
    text,
    ...options
  });
}

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
