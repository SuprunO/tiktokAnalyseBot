require('dotenv').config();
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

function encodeData(data) {
  return Buffer.from(data).toString('base64');
}

function decodeData(data) {
  return Buffer.from(data, 'base64').toString('utf-8');
}

async function chatWithGPT(prompt) {
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
}

async function generateImage(prompt) {
  const response = await axios.post(
    'https://api.openai.com/v1/images/generations',
    {
      model: 'dall-e-3',
      prompt: prompt,
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
}

app.post(`/webhook/${TELEGRAM_TOKEN}`, async (req, res) => {
  const body = req.body;

  // Обробка callback_query (натискання кнопки)
  if (body.callback_query) {
    const callback = body.callback_query;
    const chatId = callback.message.chat.id;
    const callbackId = callback.id;
    const data = callback.data;

    // Відповідаємо на callback_query, щоб прибрати "loading" у Telegram
    await axios.post(`${TELEGRAM_API}/answerCallbackQuery`, {
      callback_query_id: callbackId,
    });

    if (data.startsWith('generate_image:')) {
      const encodedJoke = data.split('generate_image:')[1];
      const joke = decodeData(encodedJoke);

      try {
        const imagePrompt = `Веселе ілюстроване зображення до цього українського жарту без тексту: ${joke}`;
        const imageUrl = await generateImage(imagePrompt);

        await axios.post(`${TELEGRAM_API}/sendPhoto`, {
          chat_id: chatId,
          photo: imageUrl,
          caption: joke,
        });
      } catch (err) {
        console.error('Image generation error:', err.message || err);
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: 'На жаль, не вдалося згенерувати зображення 😢 Але жарт залишається 😊',
        });
      }
    }

    return res.sendStatus(200);
  }

  // Обробка звичайного текстового повідомлення
  const message = body.message;
  if (!message || !message.text) return res.sendStatus(200);

  const chatId = message.chat.id;
  const userInput = message.text.trim();
  const words = userInput.split(/\s+/);

  if (words.length !== 3) {
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text: 'Будь ласка, надішліть рівно три слова для створення жарту 😊',
    });
    return res.sendStatus(200);
  }

  const jokePrompt = `Склади кумедний жарт українською мовою, використовуючи ці три слова: ${userInput}`;

  try {
    const joke = await chatWithGPT(jokePrompt);
    const encodedJoke = encodeData(joke);

    // Надсилаємо жарт із кнопкою, щоб картинку генерували пізніше вручну
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text: joke,
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: '🖼 Згенерувати зображення',
              callback_data: `generate_image:${encodedJoke}`,
            },
          ],
        ],
      },
    });
  } catch (err) {
    console.error('Telegram bot error:', err.message || err);
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text: 'На жаль, виникла помилка під час створення жарту 😢',
    });
  }

  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});
