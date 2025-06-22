require('dotenv').config();
const express = require('express');
const axios = require('axios');
const chromium = require('chrome-aws-lambda');
const puppeteer = require('puppeteer-core');

const app = express();
app.use(express.json());

// Environment detection
const isProduction = process.env.NODE_ENV === 'production';

// ================== LOGGER SETUP ==================
const logger = {
  info: (...args) => console.log('[INFO]', ...args),
  error: (...args) => console.error('[ERROR]', ...args),
  debug: (...args) => process.env.DEBUG && console.log('[DEBUG]', ...args)
};

// ================== IMPROVED SCRAPER ==================
async function scrapeTikTokTrends({ keyword = '' }) {
  let browser;
  try {
    logger.info('Launching browser...');
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
        : process.env.CHROME_PATH || '/usr/bin/chromium-browser',
      headless: "new"
    });

    const page = await browser.newPage();
    
    // Stealth configuration
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9'
    });

    logger.debug('Navigating to TikTok...');
    const navigationPromise = page.goto('https://ads.tiktok.com/business/creativecenter/search-trends/', {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    // Timeout handling
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Navigation timeout')), 60000
    ));

    await Promise.race([navigationPromise, timeoutPromise]);
    logger.info('Page loaded successfully');

    // Content verification
    const pageTitle = await page.title();
    if (!pageTitle.includes('TikTok')) {
      throw new Error('Failed to load TikTok - possible CAPTCHA or blocking');
    }

    logger.debug('Scrolling page...');
    await autoScroll(page);

    logger.info('Extracting trends...');
    const trends = await page.evaluate(() => {
      try {
        return Array.from(document.querySelectorAll('.trend-card'))
          .slice(0, 15)
          .map(card => ({
            title: card.querySelector('.title')?.textContent?.trim() || '',
            growth: parseInt(card.querySelector('.rate')?.textContent?.replace(/\D/g, '') || '0'),
            lackOfContent: card.textContent.includes('Lack of content'),
            exists: !!card.querySelector('.title') // Verify element exists
          }));
      } catch (e) {
        console.error('Evaluation error:', e);
        return [];
      }
    });

    const filtered = trends
      .filter(t => t.exists && t.lackOfContent)
      .filter(t => !keyword || t.title.toLowerCase().includes(keyword.toLowerCase()));

    logger.info(`Found ${filtered.length} trends`);
    return filtered;

  } catch (err) {
    logger.error('SCRAPER FAILURE:', {
      error: err.message,
      stack: err.stack,
      timestamp: new Date().toISOString()
    });
    throw err;
  } finally {
    if (browser) {
      logger.debug('Closing browser...');
      await browser.close().catch(e => logger.error('Browser close failed:', e));
    }
  }
}

// ================== TELEGRAM HANDLER ==================
app.post(`/webhook/${process.env.TELEGRAM_TOKEN}`, async (req, res) => {
  const startTime = Date.now();
  const requestId = Math.random().toString(36).slice(2, 8);
  
  try {
    logger.info(`[${requestId}] New request`, {
      body: req.body,
      headers: req.headers
    });

    const { message } = req.body;
    if (!message?.text) {
      logger.debug(`[${requestId}] Empty message`);
      return res.sendStatus(200);
    }

    const chatId = message.chat.id;
    const text = message.text.trim();

    if (text.startsWith('/trends')) {
      const keyword = text.split(' ').slice(1).join(' ').trim();
      logger.info(`[${requestId}] Searching trends for: "${keyword}"`);

      // Immediate acknowledgment
      await safeSendMessage(chatId, `🔍 Searching for "${keyword || 'all'}" trends...`);

      const trends = await scrapeTikTokTrends({ keyword });
      
      if (!trends.length) {
        logger.debug(`[${requestId}] No trends found`);
        await safeSendMessage(chatId, 'No underserved trends found 😕');
        return res.sendStatus(200);
      }

      logger.debug(`[${requestId}] Sending ${trends.length} trends`);
      const response = trends.slice(0, 5).map(t => 
        `🔥 <b>${t.title}</b>\n⬆️ ${t.growth}% growth`
      ).join('\n\n');

      await safeSendMessage(chatId, response, { parse_mode: 'HTML' });
    } else {
      logger.debug(`[${requestId}] Unknown command`);
      await safeSendMessage(chatId, 'Send /trends [keyword] to search');
    }

    logger.info(`[${requestId}] Request completed in ${Date.now() - startTime}ms`);
    res.sendStatus(200);
  } catch (err) {
    logger.error(`[${requestId}] HANDLER ERROR`, {
      error: err.message,
      stack: err.stack,
      duration: Date.now() - startTime,
      chatId: req.body.message?.chat?.id
    });
    
    await safeSendMessage(
      req.body.message?.chat?.id, 
      '⚠️ Server error. Admins have been notified.'
    );
    res.sendStatus(200);
  }
});

// ================== UTILITIES ==================
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 300;
      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= document.body.scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 500);
    });
  });
}

async function safeSendMessage(chatId, text, options = {}) {
  try {
    logger.debug(`Sending message to ${chatId}`);
    await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`, {
      chat_id: chatId,
      text,
      ...options,
    });
  } catch (err) {
    logger.error('TELEGRAM SEND FAILED:', {
      chatId,
      error: err.response?.data || err.message,
      text: text.slice(0, 50) + (text.length > 50 ? '...' : '')
    });
  }
}

// ================== SERVER START ==================
app.listen(process.env.PORT || 3000, () => {
  logger.info(`Server started on port ${process.env.PORT || 3000}`);
  logger.info(`Environment: ${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'}`);
  logger.info(`Chromium path: ${isProduction ? 'AWS Lambda' : process.env.CHROME_PATH || 'system default'}`);
});