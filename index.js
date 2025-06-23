require('dotenv').config();
const express = require('express');
const axios = require('axios');
const puppeteer = require('puppeteer'); // Full puppeteer with built-in Chromium
const path = require('path');

const app = express();
app.use(express.json());

// ================== SIMPLIFIED SCRAPER ==================
async function scrapeTikTokTrends(keyword = '') {
  const browser = await puppeteer.launch({
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--single-process',
      '--disable-dev-shm-usage'
    ],
    headless: true
  });

  try {
    const page = await browser.newPage();
    await page.goto('https://ads.tiktok.com/business/creativecenter/search-trends/', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // Scroll to load all content
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });

    // Extract trend data
    const trends = await page.evaluate(() => {
      const cards = document.querySelectorAll('.trend-card');
      const results = [];

      cards.forEach(card => {
        try {
          const titleElement = card.querySelector('.title');
          const title = titleElement ? titleElement.textContent.trim() : '';

          const rateElement = card.querySelector('.rate');
          let growth = 0;
          if (rateElement) {
            const growthText = rateElement.textContent.replace(/\D/g, '');
            growth = parseInt(growthText) || 0;
          }

          const hasLackOfContent = card.textContent.includes('Lack of content');

          results.push({
            title,
            growth,
            hasLackOfContent
          });
        } catch (error) {
          console.error('Error processing card:', error);
        }
      });

      return results;
    });

    return trends;
  } catch (err) {
    console.error('Scraper error:', err);
    return [];
  } finally {
    await browser.close();
  }
}

// ================== TELEGRAM BOT ==================
app.post(`/webhook/${process.env.TELEGRAM_TOKEN}`, async (req, res) => {
  const { message } = req.body;
  if (!message?.text) return res.sendStatus(200);

  const chatId = message.chat.id;
  const text = message.text.trim();

  try {
    if (text === '/start') {
      await sendMessage(chatId, 'Send /trends [keyword] to find TikTok trends');
    } 
    else if (text.startsWith('/trends')) {
      const keyword = text.split(' ').slice(1).join(' ').trim();
      const trends = await scrapeTikTokTrends(keyword);

      if (trends.length === 0) {
        await sendMessage(chatId, 'No trends found 😕');
      } else {
        const response = trends.slice(0, 5).map(t => 
          `📈 ${t.title} (${t.growth}% growth)`
        ).join('\n\n');
        await sendMessage(chatId, response);
      }
    }
  } catch (err) {
    console.error('Error:', err);
    await sendMessage(chatId, '⚠️ Please try again later');
  }

  res.sendStatus(200);
});

async function sendMessage(chatId, text) {
  await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`, {
    chat_id: chatId,
    text
  });
}

app.get('/terms', (req, res) => {
  res.sendFile(path.join(__dirname, 'terms.html'));
});

app.get('/privacy', (req, res) => {
  res.sendFile(path.join(__dirname, 'privacy.html'));
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
