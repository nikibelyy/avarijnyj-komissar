// === server.js ===
// npm install express node-fetch
import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// 🔐 Здесь вставь свои данные
const BOT_TOKEN = "8309884289:AAH4b64WzSEf8en2ZbFNl2DQ-iOSBlTYiJc";
const CHAT_ID = "7523840597";

app.post("/send", async (req, res) => {
  try {
    const text = req.body.text;
    if (!text) return res.status(400).json({ error: "Нет текста" });

    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `chat_id=${CHAT_ID}&text=${encodeURIComponent(text)}&parse_mode=HTML`
    });

    const data = await r.json();
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

app.listen(3000, () => console.log("✅ Proxy-сервер запущен на http://localhost:3000"));
