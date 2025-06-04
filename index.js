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

    // Image generation prompt (simplified)
  const imagePrompt = `Веселе ілюстроване зображення до цього українського жарту без тексту: ${joke}`;
    const imageUrl = await generateImage(imagePrompt);

    // Send image with joke as caption
    await axios.post(`${TELEGRAM_API}/sendPhoto`, {
      chat_id: chatId,
      photo: imageUrl,
      caption: joke
    });
  } catch (err) {
    console.error('Telegram bot error:', err);
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text: 'На жаль, виникла помилка під час створення жарту або зображення 😢'
    });
  }

  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});
