const { chromium } = require('playwright');
const TelegramBot = require('node-telegram-bot-api');
const OpenAI = require('openai');
const express = require('express');
require('dotenv').config();

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
const PORT = process.env.PORT || 3000;


console.log('ENV:', {
  TELEGRAM_TOKEN,
  OPENAI_KEY,
  RENDER_EXTERNAL_URL,
  PORT
});

if (!TELEGRAM_TOKEN || !OPENAI_KEY) {
  console.error('❗ Please set TELEGRAM_TOKEN and OPENAI_API_KEY in .env');
  process.exit(1);
}

const openai = new OpenAI({
  apiKey: OPENAI_KEY
});

// ==============================
//  TELEGRAM BOT
// ==============================

let bot;
if (RENDER_EXTERNAL_URL) {
  // Render deployment - Webhook
  bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });
  bot.setWebHook(`${RENDER_EXTERNAL_URL}/bot${TELEGRAM_TOKEN}`).then(() =>
    console.log(`✅ Webhook set to ${RENDER_EXTERNAL_URL}/bot${TELEGRAM_TOKEN}`)
  );

  const app = express();
  app.use(express.json());

  app.get('/', (req, res) => res.send('Bot is running.'));
  app.post(`/bot${TELEGRAM_TOKEN}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  });

  app.listen(PORT, () => console.log(`🚀 Express server on ${PORT}`));
} else {
  // Local polling
  bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
  console.log('✅ Bot running in polling mode.');
}

// ==============================
//  SCRAPER FUNCTION
// ==============================
async function scrapeTikTokKeywordInsights(keyword) {
  const browser = await chromium.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });

  const page = await browser.newPage();

  await page.goto('https://ads.tiktok.com/business/creativecenter/keyword-insights/pc/en', {
    waitUntil: 'networkidle'
  });

  await page.waitForTimeout(10000);
  await page.fill('input[placeholder="Search by keyword"]', keyword);
  await page.click('[data-testid="cc_commonCom_autoComplete_seach"]');

  await page.waitForSelector('.byted-Table-Body', { timeout: 20000 });

  const data = await page.evaluate(() => {
    const tableBody = document.querySelector('.byted-Table-Body');
    if (!tableBody) return [];

    const rows = Array.from(tableBody.querySelectorAll('tr'));
    return rows.map(row => {
      const cells = Array.from(row.querySelectorAll('td')).map(td => td.innerText.trim());
      return {
        rank: cells[0] || '',
        keyword: cells[1] || '',
        popularity: cells[2] || '',
        popularityChange: cells[3] || '',
        ctr: cells[4] || '',
        cvr: cells[5] || '',
        cpa: cells[6] || ''
      };
    });
  });

  await browser.close();

  data.forEach(item => {
    const ctrVal = parseFloat(item.ctr.replace('%', '').replace(',', '.')) || 0.01;
    const cpaVal = parseFloat(item.cpa.replace(/[^\d.,]/g, '').replace(',', '.')) || 0.01;
    const popChangeVal = parseFloat(item.popularityChange.replace('%', '').replace(',', '.')) || 0;
    const score = popChangeVal * (cpaVal / ctrVal);
    item.contentGapScore = Number(score.toFixed(2));
  });

  data.sort((a, b) => b.contentGapScore - a.contentGapScore);
  return data;
}

// ==============================
//  FORMATTING FUNCTIONS
// ==============================
function formatTable(data) {
  if (!data.length) return '❗ Немає даних у Creative Center.';

  return data.map((item, idx) => 
    `#${idx + 1}\n` +
    `Слово: ${item.keyword}\n` +
    `Ранг: ${item.rank}\n` +
    `Популярність: ${item.popularity}\n` +
    `Зміна популярності: ${item.popularityChange}\n` +
    `CTR: ${item.ctr}\n` +
    `CVR: ${item.cvr}\n` +
    `CPA: ${item.cpa}\n` +
    `Content Gap Score: ${item.contentGapScore}\n`
  ).join('\n');
}

function makeGPTPrompt(keyword, topN) {
  const rowsText = topN.map((item, idx) => `
#${idx + 1}
Ключове слово: ${item.keyword}
Ранг: ${item.rank}
Популярність: ${item.popularity}
Зміна популярності: ${item.popularityChange}
CTR: ${item.ctr}
CVR: ${item.cvr}
CPA: ${item.cpa}
Content Gap Score: ${item.contentGapScore}
`.trim()).join('\n\n');

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
//  BOT LOGIC
// ==============================
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, 'Привіт! Надішли мені слово для аналізу з TikTok Creative Center.');
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text?.trim();

  if (!text || text.startsWith('/start')) return;

  await bot.sendMessage(chatId, `🔎 Шукаю за запитом: "${text}"... Це може зайняти 30-60 секунд.`);

  try {
    const results = await scrapeTikTokKeywordInsights(text);

    if (!results.length) {
      // GPT fallback
      await bot.sendMessage(chatId, '❗ У Creative Center немає даних. Генерую ідею з GPT...');
      const fallbackPrompt = `
Тема: "${text}"
1️⃣ 📌 Слово
2️⃣ 🎥 Сценарій (вау-ефект, сюжет, CTA)
3️⃣ 📊 Чому це спрацює
4️⃣ 🏷️ 5-7 хештегів українською
`;

      const fallbackResponse = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: 'Ти досвідчений маркетолог і TikTok-креатор. Відповідай українською мовою.' },
          { role: 'user', content: fallbackPrompt }
        ]
      });

      return bot.sendMessage(chatId, fallbackResponse.choices[0].message.content);
    }

    // Send table first
    await bot.sendMessage(chatId, '✅ Знайдено дані. Ось таблиця:\n\n' + formatTable(results.slice(0, 5)));

    // GPT analysis
    await bot.sendMessage(chatId, '💬 Аналізую з GPT...');
    const topN = results.slice(0, Math.min(5, results.length));
    const gptPrompt = makeGPTPrompt(text, topN);

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'Ти досвідчений маркетолог і сценарист TikTok Ads. Відповідай українською мовою.' },
        { role: 'user', content: gptPrompt }
      ]
    });

    await bot.sendMessage(chatId, completion.choices[0].message.content);

  } catch (err) {
    console.error(err);
    await bot.sendMessage(chatId, '❗ Сталася помилка. Спробуй ще раз пізніше.');
  }
});
