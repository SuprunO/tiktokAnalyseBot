require('dotenv').config();
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

// Локальний кеш для зберігання жартів по ID
const jokesCache = new Map();

async function chatWithGPT(prompt) {
  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );
    return response.data.choices[0].message.content.trim();
  } catch (error) {
    console.error('Error in chatWithGPT:', error.response?.data || error.message || error);
    throw error;
  }
}

async function generateImage(prompt) {
  try {
    const response = await axios.post(
      'https://api.openai.com/v1/images/generations',
      {
        model: 'dall-e-3',
        prompt,
        n: 1,
        size: '1024x1024',
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );
    return response.data.data[0].url;
  } catch (error) {
    console.error('Error in generateImage:', error.response?.data || error.message || error);
    throw error;
  }
}

app.post(`/webhook/${TELEGRAM_TOKEN}`, async (req, res) => {
  const body = req.body;
  console.log('Incoming update:', JSON.stringify(body, null, 2));

  if (body.callback_query) {
    const callback = body.callback_query;
    const chatId = callback.message.chat.id;
    const callbackId = callback.id;
    const data = callback.data;

    try {
      await axios.post(`${TELEGRAM_API}/answerCallbackQuery`, {
        callback_query_id: callbackId,
      });
    } catch (err) {
      console.error('Failed to answer callback query:', err.response?.data || err.message || err);
    }

    if (data.startsWith('generate_image:')) {
      const id = data.split('generate_image:')[1];
      const joke = jokesCache.get(id);
      if (!joke) {
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id,
          text: 'Жарт не знайдено або час очікування минув. Будь ласка, створіть жарт заново.',
        });
        return res.sendStatus(200);
      }

      try {
        const imagePrompt = `Веселе ілюстроване зображення до цього українського жарту без тексту: ${joke}`;
        const imageUrl = await generateImage(imagePrompt);

        await axios.post(`${TELEGRAM_API}/sendPhoto`, {
          chat_id,
          photo: imageUrl,
          caption: joke,
        });
      } catch (err) {
        console.error('Image generation error:', err.response?.data || err.message || err);
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id,
          text: 'На жаль, не вдалося згенерувати зображення 😢 Але жарт залишається 😊',
        });
      }
    }

    return res.sendStatus(200);
  }

  const message = body.message;
  if (!message || !message.text) {
    console.log('No message or text found');
    return res.sendStatus(200);
  }

  const chatId = message.chat.id;
  const userInput = message.text.trim();
  const words = userInput.split(/\s+/);

  if (words.length !== 3) {
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id,
      text: 'Будь ласка, надішліть рівно три слова для створення жарту 😊',
    });
    return res.sendStatus(200);
  }

  const jokePrompt = `Склади кумедний жарт українською мовою, використовуючи ці три слова: ${userInput}`;
  console.log('Sending prompt to GPT:', jokePrompt);

  try {
    const joke = await chatWithGPT(jokePrompt);
    console.log('Received joke:', joke);

    const id = Date.now().toString(); // простий унікальний ID
    jokesCache.set(id, joke);

    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id,
      text: joke,
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: '🖼 Згенерувати зображення',
              callback_data: `generate_image:${id}`,
            },
          ],
        ],
      },
    });
  } catch (err) {
    console.error('Telegram bot error while creating joke:', err.response?.data || err.message || err);
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id,
      text: 'На жаль, виникла помилка під час створення жарту',
    });
  }

  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});
