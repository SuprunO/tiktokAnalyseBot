require('dotenv').config();
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const puppeteer = require('puppeteer');

const app = express();
app.use(bodyParser.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

// === GPT Chat Handler ===
async function chatWithGPT(prompt) {
  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: prompt }],
    },
    {
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    }
  );
  return response.data.choices[0].message.content.trim();
}

// === TikTok Trends Scraper ===
async function scrapeTrends(niche = 'all') {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('https://ads.tiktok.com/business/creativecenter/search-trends/', {
    waitUntil: 'networkidle2',
    timeout: 60000
  });

  await page.waitForSelector('.trend-card'); // зачекати поки з'являться дані
  await autoScroll(page);

  const trends = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('.trend-card'));
    return items.map(el => {
      const title = el.querySelector('.title')?.textContent?.trim();
      const growth = el.querySelector('.rate')?.textContent?.trim();
      const updatedAt = el.querySelector('.desc')?.textContent?.trim();
      const hasLackOfContent = el.textContent.includes('Lack of content');
      return { title, growth, updatedAt, lackOfContent: hasLackOfContent };
    });
  });

  await browser.close();
  return trends.filter(t => t.lackOfContent).slice(0, 5); // топ-5
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 100;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 200);
    });
  });
}

// === Telegram Webhook ===
app.post(`/webhook/${TELEGRAM_TOKEN}`, async (req, res) => {
  const message = req.body.message;
  if (!message || !message.text) return res.sendStatus(200);

  const chatId = message.chat.id;
  const userText = message.text.trim();

  try {
    if (userText.startsWith('/trends')) {
      const niche = userText.split(' ')[1] || 'beauty';
      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: `🔍 Шукаю тренди TikTok для ніші "${niche}"...`
      });

      const trends = await scrapeTrends(niche);

      let replyText = `🔥 Тренди в ніші *${niche}*\n\n`;

      for (const trend of trends) {
        const idea = await chatWithGPT(`Give a short TikTok video idea for trend: "${trend.title}" in the niche "${niche}"`);
        replyText += `🟢 *${trend.title}* (${trend.growth})\n💡 ${idea}\n\n`;
      }

      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: replyText,
        parse_mode: 'Markdown'
      });

    } else {
      // Default GPT reply
      const reply = await chatWithGPT(userText);
      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: reply
      });
    }
  } catch (err) {
    console.error('Telegram bot error:', err);
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text: '😔 Виникла помилка. Спробуйте пізніше.'
    });
  }

  res.sendStatus(200);
});

// === Express Test Endpoint ===
app.get('/chat', async (req, res) => {
  const prompt = req.query.prompt || 'Розкажи смішний жарт украінською мовою';
  try {
    const reply = await chatWithGPT(prompt);
    res.json({ reply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate response.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});
