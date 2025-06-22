require('dotenv').config();
const express = require('express');
const axios = require('axios');
const chromium = require('chrome-aws-lambda');
const puppeteer = require('puppeteer-core');

const app = express();
app.use(express.json());

const isProduction = process.env.NODE_ENV === 'production';

// Improved Scraper with Error Handling
async function scrapeTikTokTrends({ keyword = '' } = {}) {
  let browser;
  try {
    browser = await puppeteer.launch({
      args: [
        ...chromium.args,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--single-process'
      ],
      executablePath: isProduction 
        ? await chromium.executablePath 
        : '/usr/bin/chromium-browser',
      headless: "new",
    });

    const page = await browser.newPage();
    
    // Stealth Mode
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
    });

    // Navigate with retries
    let retries = 3;
    while (retries > 0) {
      try {
        await page.goto('https://ads.tiktok.com/business/creativecenter/search-trends/', {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });
        break;
      } catch (err) {
        retries--;
        if (retries === 0) throw err;
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    // Safer scraping
    const trends = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.trend-card'))
        .slice(0, 15) // Limit to 15 cards
        .map(card => {
          return {
            title: card.querySelector('.title')?.textContent?.trim() || '',
            growth: parseInt(card.querySelector('.rate')?.textContent?.replace(/\D/g, '') || '0'),
            lackOfContent: card.textContent.includes('Lack of content'),
          };
        })
        .filter(t => t.lackOfContent && t.title);
    });

    return trends;

  } catch (err) {
    console.error('Scraping Error:', err);
    throw new Error('Failed to fetch trends. TikTok may have blocked the request.');
  } finally {
    if (browser) await browser.close().catch(console.error);
  }
}

// Telegram Handler with Retries
app.post(`/webhook/${process.env.TELEGRAM_TOKEN}`, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message?.text) return res.sendStatus(200);

    const chatId = message.chat.id;
    const text = message.text.trim();

    if (text.startsWith('/trends')) {
      const keyword = text.split(' ').slice(1).join(' ').trim();
      
      // Immediate response to prevent timeout
      await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`, {
        chat_id: chatId,
        text: `🔍 Searching for "${keyword || 'all'}" trends...`,
      });

      const trends = await scrapeTikTokTrends({ keyword });
      
      if (!trends.length) {
        await sendMessage(chatId, 'No underserved trends found 😕');
        return res.sendStatus(200);
      }

      const response = trends.slice(0, 5).map(t => 
        `🔥 <b>${t.title}</b>\n⬆️ ${t.growth}% growth`
      ).join('\n\n');

      await sendMessage(chatId, response, { parse_mode: 'HTML' });
    } else {
      await sendMessage(chatId, 'Send /trends [keyword] to search');
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('Handler Error:', err);
    await sendMessage(req.body.message?.chat?.id, '⚠️ Please try again later');
    res.sendStatus(200);
  }
});

// Robust Message Sender
async function sendMessage(chatId, text, options = {}) {
  try {
    await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`, {
      chat_id: chatId,
      text,
      ...options,
    });
  } catch (err) {
    console.error('Telegram API Error:', err.response?.data || err.message);
  }
}

app.listen(process.env.PORT || 3000, () => {
  console.log('Bot running');
});