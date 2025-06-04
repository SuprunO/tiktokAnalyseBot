require('dotenv').config();
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

// 🧠 In-memory user history
const userHistory = new Map(); // Map<chatId, Array<{ words, joke, imageUrl }>>

// === GPT Joke Generator ===
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

// === Image Generator with DALL·E ===
async function generateImage(jokeText) {
  const stylePrompt = `Уяви цей жарт як кольорову ілюстрацію в стилі Pixar. Без тексту, з простим фоном. "${jokeText}"`;
  const response = await axios.post(
    'https://api.openai.com/v1/images/generations',
    {
      model: "dall-e-3",
      prompt: stylePrompt,
      n: 1,
      size: "512x512",
      response_format: "url"
    },
    {
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    }
  );
  return response.data.data[0].url;
}

// === Telegram Webhook Handler ===
app.post(`/webhook/${TELEGRAM_TOKEN}`, async (req, res) => {
  const message = req.body.message;
  const callbackQuery = req.body.callback_query;

  // === Handle /history command ===
  if (message?.text?.toLowerCase() === '/history') {
    const chatId = message.chat.id;
    const history = userHistory.get(chatId) || [];

    if (history.length === 0) {
      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: 'У вас ще немає збережених жартів 😅'
      });
    } else {
      const formatted = history
        .slice(-5)
        .map((item, i) => `*${i + 1}.* ${item.joke}\n_(${item.words.join(', ')})_`)
        .join('\n\n');

      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: `Останні жарти:\n\n${formatted}`,
        parse_mode: 'Markdown'
      });
    }
    return res.sendStatus(200);
  }

  // === Handle callback button ===
  if (callbackQuery) {
    const chatId = callbackQuery.message.chat.id;
    const originalText = callbackQuery.data;

    const prompt = `Придумай короткий, дотепний жарт українською мовою, використовуючи рівно ці три слова: ${originalText}. Жарт має бути зрозумілим, веселим і не образливим. Уникай тем про політику, релігію, національність, фізичні вади та чорний гумор. Формат — як анекдот або одно-рядковий жарт.`;

    try {
      const joke = await chatWithGPT(prompt);
      const imageUrl = await generateImage(joke);
      const words = originalText.split(/\s+/);

      // Save history
      const entry = { words, joke, imageUrl };
      if (!userHistory.has(chatId)) userHistory.set(chatId, []);
      userHistory.get(chatId).push(entry);

      await axios.post(`${TELEGRAM_API}/sendPhoto`, {
        chat_id: chatId,
        photo: imageUrl,
        caption: joke,
        reply_markup: {
          inline_keyboard: [[
            {
              text: 'Спробувати ще раз 😄',
              callback_data: originalText
            }
          ]]
        }
      });
    } catch (err) {
      console.error('Telegram callback error:', err);
    }

    return res.sendStatus(200);
  }

  if (!message || !message.text) return res.sendStatus(200);

  const chatId = message.chat.id;
  const userInput = message.text;
  const words = userInput.trim().split(/\s+/);

  if (words.length !== 3) {
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text: 'Будь ласка, надішліть рівно три слова для створення жарту 😊'
    });
    return res.sendStatus(200);
  }

  const prompt = `Придумай короткий, дотепний жарт українською мовою, використовуючи рівно ці три слова: ${userInput}. Жарт має бути зрозумілим, веселим і не образливим. Уникай тем про політику, релігію, національність, фізичні вади та чорний гумор. Формат — як анекдот або одно-рядковий жарт.`;

  try {
    const joke = await chatWithGPT(prompt);
    const imageUrl = await generateImage(joke);

    // Save history
    const entry = { words, joke, imageUrl };
    if (!userHistory.has(chatId)) userHistory.set(chatId, []);
    userHistory.get(chatId).push(entry);

    await axios.post(`${TELEGRAM_API}/sendPhoto`, {
      chat_id: chatId,
      photo: imageUrl,
      caption: joke,
      reply_markup: {
        inline_keyboard: [[
          {
            text: 'Спробувати ще раз 😄',
            callback_data: userInput
          }
        ]]
      }
    });
  } catch (err) {
    console.error('Telegram bot error:', err);
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text: 'На жаль, виникла помилка під час створення жарту або картинки 😢'
    });
  }

  res.sendStatus(200);
});

// === Public API Test Endpoint ===
app.get('/chat', async (req, res) => {
  const prompt = req.query.prompt || 'Tell me a joke';
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
