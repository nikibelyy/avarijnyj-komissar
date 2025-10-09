// server.js
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8309884289:AAH4b64WzSEf8en2ZbFNl2DQ-iOSBlTYiJc';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '7523840597';
const TG_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

const app = express();
app.use(bodyParser.json());

app.post('/event', async (req, res) => {
  const ev = req.body;
  if (!ev || !ev.id) return res.status(400).send({ error: 'bad payload' });

  const lat = ev.lat || '';
  const lon = ev.lon || '';
  const ymapLink = (lat && lon) ? `https://yandex.ru/maps/?ll=${encodeURIComponent(lon)},${encodeURIComponent(lat)}&z=16` : '';

  const textLines = [
    `🚨 *Дорожное событие*`,
    ev.title ? `*${escapeMarkdown(ev.title)}*` : null,
    ev.type ? `Тип: ${escapeMarkdown(ev.type)}` : null,
    ev.description ? `${escapeMarkdown(ev.description)}` : null,
    (lat && lon) ? `Координаты: ${lat}, ${lon}` : null,
    ymapLink ? `Ссылка: ${ymapLink}` : null,
    ev.time ? `Время: ${escapeMarkdown(String(ev.time))}` : null
  ].filter(Boolean).join('\n\n');

  try {
    await axios.post(`${TG_API}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: textLines,
      parse_mode: 'Markdown'
    });
    res.send({ ok: true });
  } catch (err) {
    console.error('Telegram send error:', err.response ? err.response.data : err.message);
    res.status(500).send({ error: 'tg error' });
  }
});

function escapeMarkdown(s) {
  // простое экранирование для Markdown (звёздочки, подчёркивания и т.д.)
  return s.replace(/([_*[\]()~`>#+-=|{}.!])/g, '\\$1');
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
