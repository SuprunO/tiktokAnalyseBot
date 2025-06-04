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
      size: "512x512"
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

// === Public API Endpoint ===
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

// === Telegram Webhook Handler ===
app.post(`/webhook/${TELEGRAM_TOKEN}`, async (req, res) => {
  const message = req.body.message;
  const callbackQuery = req.body.callback_query;

  const processInput = async (chatId, textInput) => {
    const words = textInput.trim().split(/\s+/);
    if (words.length !== 3) {
      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: 'Будь ласка, надішліть рівно три слова для створення жарту 😊'
      });
      return;
    }

    const prompt = `Придумай короткий, дотепний жарт українською мовою, використовуючи рівно ці три слова: ${textInput}. Жарт має бути зрозумілим, веселим і не образливим. Уникай тем про політику, релігію, національність, фізичні вади та чорний гумор. Формат — як анекдот або одно-рядковий жарт.`;

    try {
      const joke = await chatWithGPT(prompt);

      const imagePrompt = `Уяви цей жарт як кольорову ілюстрацію в стилі Pixar. Без тексту, з простим фоном. "${joke}"`;
      const imageUrl = await generateImage(imagePrompt);

      await axios.post(`${TELEGRAM_API}/sendPhoto`, {
        chat_id: chatId,
        photo: imageUrl,
        caption: joke,
        reply_markup: {
          inline_keyboard: [[
            {
              text: 'Спробувати ще раз 😄',
              callback_data: textInput
            }
          ]]
        }
      });
    } catch (err) {
      console.error('Telegram bot error:', err?.response?.data || err.message);
      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: 'На жаль, виникла помилка під час створення жарту або картинки 😢'
      });
    }
  };

  // === Handle callback ===
  if (callbackQuery) {
    const chatId = callbackQuery.message.chat.id;
    const textInput = callbackQuery.data;
    await processInput(chatId, textInput);
    return res.sendStatus(200);
  }

  // === Handle message ===
  if (message?.text) {
    const chatId = message.chat.id;
    const textInput = message.text;
    await processInput(chatId, textInput);
    return res.sendStatus(200);
  }

  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});
