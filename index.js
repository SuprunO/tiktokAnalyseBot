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

// Environment detection
const isProduction = process.env.NODE_ENV === 'production';

// ================== IMPROVED SCRAPER ==================
async function scrapeTikTokTrends({ minGrowth = 200, keyword = '' } = {}) {
  let browser;
  try {
    // Enhanced browser configuration
    const options = {
      args: [
        ...chromium.args,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--single-process',
        '--no-zygote'
      ],
      headless: true,
      executablePath: isProduction
        ? await chromium.executablePath
        : process.env.CHROME_PATH || '/usr/bin/google-chrome',
      ignoreHTTPSErrors: true
    };

    browser = await puppeteer.launch(options);
    const page = await browser.newPage();

    // Enhanced stealth and headers
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9'
    });

    // Configure page behavior
    await page.setViewport({ width: 1280, height: 800 });
    await page.setDefaultNavigationTimeout(90000);

    console.log('Navigating to TikTok Trends...');
    await page.goto('https://ads.tiktok.com/business/creativecenter/search-trends/', {
      waitUntil: 'networkidle2',
      timeout: 90000
    });

    // Improved auto-scroll with error handling
    await autoScroll(page);

    console.log('Extracting trends...');
    const trends = await page.evaluate(() => {
      const results = [];
      document.querySelectorAll('.trend-card').forEach(card => {
        try {
          const title = card.querySelector('.title')?.textContent?.trim() || '';
          const growthText = card.querySelector('.rate')?.textContent || '0';
          const growth = parseInt(growthText.replace(/\D/g, '')) || 0;
          const hasLackOfContent = card.textContent.includes('Lack of content');
          const updatedAt = card.querySelector('.desc')?.textContent?.trim() || '';
          
          if (title) {
            results.push({ title, growth, updatedAt, lackOfContent: hasLackOfContent });
          }
        } catch (e) {
          console.error('Error parsing card:', e);
        }
      });
      return results;
    });

    // Enhanced filtering
    return trends
      .filter(t => t.lackOfContent)
      .filter(t => t.growth >= minGrowth)
      .filter(t => !keyword || t.title.toLowerCase().includes(keyword.toLowerCase()))
      .slice(0, 10); // Limit to 10 results

  } catch (err) {
    console.error('❌ Critical scraping error:', err);
    throw new Error(`Scraping failed: ${err.message}`);
  } finally {
    if (browser) {
      await browser.close().catch(e => console.error('Browser close error:', e));
    }
  }
}

// ================== IMPROVED AUTOSCROLL ==================
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 300;
      const maxScrolls = 10;
      let scrollCount = 0;
      
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;
        scrollCount++;

        if (totalHeight >= scrollHeight || scrollCount >= maxScrolls) {
          clearInterval(timer);
          resolve();
        }
      }, 1000);
    });
  });
}

// ================== TELEGRAM HANDLER ==================
app.post(`/webhook/${TELEGRAM_TOKEN}`, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || !message.text) return res.sendStatus(200);

    const chatId = message.chat.id;
    const text = message.text.trim();

    if (text === '/start') {
      await sendTelegramMessage(chatId, 
        `👋 Hi! I'm a TikTok trend finder bot. Send /trends [keyword] to find underserved trends.\n\n` +
        `Example: /trends cooking`
      );
      return res.sendStatus(200);
    }

    if (text.startsWith('/trends')) {
      const keyword = text.split(' ').slice(1).join(' ').trim();
      
      await sendTelegramMessage(chatId, 
        `🔍 Searching for TikTok trends with "Lack of Content"...\n` +
        `${keyword ? `Keyword: "${keyword}"` : 'No keyword filter'}`,
        { parse_mode: 'HTML' }
      );

      const trends = await scrapeTikTokTrends({ keyword });
      
      if (!trends.length) {
        await sendTelegramMessage(chatId, 
          '❌ No underserved trends found. Try a different keyword or check back later.'
        );
        return res.sendStatus(200);
      }

      const message = trends.map((t, i) => 
        `📈 <b>Trend ${i+1}: ${t.title}</b>\n` +
        `⬆️ Growth: ${t.growth}%\n` +
        `🕒 Updated: ${t.updatedAt}\n` +
        `#${t.title.replace(/\s+/g, '').slice(0, 10)}`
      ).join('\n\n');

      await sendTelegramMessage(chatId, message, { parse_mode: 'HTML' });
      return res.sendStatus(200);
    }

    await sendTelegramMessage(chatId, 
      '❌ Unknown command. Use /trends [keyword] to search for trends.'
    );
    return res.sendStatus(200);
  } catch (err) {
    console.error('Telegram handler error:', err);
    await sendTelegramMessage(req.body.message.chat.id, 
      '⚠️ An error occurred. Please try again later.'
    );
    return res.sendStatus(200);
  }
});

// ================== HELPER FUNCTIONS ==================
async function sendTelegramMessage(chatId, text, options = {}) {
  try {
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text,
      ...options
    });
  } catch (err) {
    console.error('Telegram API error:', err.response?.data || err.message);
  }
}

// ================== SERVER START ==================
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  if (!isProduction) {
    console.log('Testing scraper locally...');
    scrapeTikTokTrends({ keyword: 'food' })
      .then(trends => console.log('Test results:', trends))
      .catch(err => console.error('Test failed:', err));
  }
});