// Telegram + OpenAI + Express server
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

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
async function generateImage(prompt) {
  const response = await axios.post(
    'https://api.openai.com/v1/images/generations',
    {
      model: "dall-e-3",
      prompt: prompt,
      n: 1,
      size: "1024x1024"
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
  const body = req.body;

  // 1. Обробка натискання кнопки (callback_query)
  if (body.callback_query) {
    const callback = body.callback_query;
    const chatId = callback.message.chat.id;
    const data = callback.data;

    // Тут можна додати перевірку преміум-статусу користувача, якщо хочеш
    if (data.startsWith('generate_image:')) {
      const joke = data.split('generate_image:')[1];

      try {
        const imagePrompt = `Веселе ілюстроване зображення до цього українського жарту без тексту: ${joke}`;
        const imageUrl = await generateImage(imagePrompt);

        await axios.post(`${TELEGRAM_API}/sendPhoto`, {
          chat_id: chatId,
          photo: imageUrl,
          caption: joke
        });
      } catch (err) {
        console.error('Image generation error:', err.message || err);
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: 'На жаль, не вдалося згенерувати зображення 😢'
        });
      }
    }

    return res.sendStatus(200);
  }

  // 2. Обробка звичайного текстового повідомлення
  const message = body.message;
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

  const jokePrompt = `Склади кумедний жарт українською мовою, використовуючи ці три слова: ${userInput}`;
  try {
    const joke = await chatWithGPT(jokePrompt);

    // Надсилаємо жарт із кнопкою для генерації зображення
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text: joke,
      reply_markup: {
        inline_keyboard: [[
          {
            text: '🖼 Згенерувати зображення',
            callback_data: `generate_image:${joke}`
          }
        ]]
      }
    });
  } catch (err) {
    console.error('Telegram bot error:', err);
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text: 'На жаль, виникла помилка під час створення жарту 😢'
    });
  }

  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});
