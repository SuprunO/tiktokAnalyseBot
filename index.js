// Telegram + OpenAI + Express server with switchable image generator (Stable Diffusion by default)
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const STABILITY_API_KEY = process.env.STABILITY_API_KEY;
const IMAGE_GENERATOR = 'stable'; // 'dalle' or 'stable'
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
async function generateImageDalle(prompt) {
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

// === Image Generator with Stable Diffusion (via Stability AI) ===
async function generateImageStable(prompt) {
  const response = await axios.post(
    'https://api.stability.ai/v1/generation/stable-diffusion-v1-5/text-to-image',
    {
      text_prompts: [{ text: prompt }],
      cfg_scale: 7,
      height: 512,
      width: 512,
      samples: 1,
      steps: 30
    },
    {
      headers: {
        Authorization: `Bearer ${STABILITY_API_KEY}`,
        'Content-Type': 'application/json'
      }
    }
  );
  const base64 = response.data.artifacts[0].base64;
  return `data:image/png;base64,${base64}`;
}

// === Unified Image Generator ===
async function generateImage(prompt) {
  if (IMAGE_GENERATOR === 'dalle') {
    return await generateImageDalle(prompt);
  } else {
    return await generateImageStable(prompt);
  }
}

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
    const imagePrompt = `Веселе ілюстроване зображення до цього українського жарту без тексту: ${joke}`;
    const imageUrl = await generateImage(imagePrompt);

    if (imageUrl.startsWith('data:image')) {
      // If base64, use Telegram's sendPhoto with file upload
      const buffer = Buffer.from(imageUrl.split(',')[1], 'base64');
      const FormData = require('form-data');
      const form = new FormData();
      form.append('chat_id', chatId);
      form.append('caption', joke);
      form.append('photo', buffer, 'image.png');

      await axios.post(`${TELEGRAM_API}/sendPhoto`, form, {
        headers: form.getHeaders()
      });
    } else {
      await axios.post(`${TELEGRAM_API}/sendPhoto`, {
        chat_id: chatId,
        photo: imageUrl,
        caption: joke
      });
    }
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
