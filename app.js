/* PWA + Telegram sending logic */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(console.error);
  });
}

const form = document.getElementById('reportForm');
const statusEl = document.getElementById('status');
const sendBtn = document.getElementById('sendBtn');
const installBtn = document.getElementById('installBtn');
const iosTip = document.getElementById('iosTip');
const iosDialog = document.getElementById('iosDialog');
const closeIosDialog = document.getElementById('closeIosDialog');
let deferredPrompt;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (installBtn) installBtn.style.display = 'inline-flex';
});

if (installBtn) {
  installBtn.addEventListener('click', async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice && choice.outcome === 'accepted') {
        installBtn.textContent = 'Установлено';
      }
      deferredPrompt = null;
    } else {
      // Likely iOS: show instructions
      iosDialog.showModal();
    }
  });
}

iosTip?.addEventListener('click', () => iosDialog.showModal());
closeIosDialog?.addEventListener('click', () => iosDialog.close());

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

async function getPositionIfAllowed() {
  if (!document.getElementById('useGPS').checked || !('geolocation' in navigator)) return null;
  try {
    return await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(pos => resolve(pos.coords), err => resolve(null), {enableHighAccuracy:true, timeout:8000});
    });
  } catch { return null; }
}

function updateStatus(txt, kind='info') {
  statusEl.textContent = txt;
  statusEl.style.color = (kind === 'ok' ? '#32d74b' : kind === 'err' ? '#ff453a' : '#a1a1aa');
}

async function readFileAsImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

async function compressImage(file, maxDim=1600, quality=0.8) {
  const img = await readFileAsImage(file);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const ratio = Math.min(maxDim / img.width, maxDim / img.height, 1);
  canvas.width = Math.round(img.width * ratio);
  canvas.height = Math.round(img.height * ratio);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', quality));
  return new File([blob], `photo_${Date.now()}.jpg`, {type:'image/jpeg'});
}

async function sendTelegramPhoto({chatId, botToken, photoFile, caption}) {
  const fd = new FormData();
  fd.append('chat_id', chatId);
  fd.append('photo', photoFile, photoFile.name);
  fd.append('caption', caption);
  // Note: Telegram Bot API supports CORS on modern browsers.
  const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
    method: 'POST',
    body: fd
  });
  if (!resp.ok) throw new Error('Telegram sendPhoto failed');
  return resp.json();
}

async function sendTelegramLocation({chatId, botToken, lat, lon}) {
  const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendLocation`, {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({chat_id: chatId, latitude: lat, longitude: lon})
  });
  if (!resp.ok) throw new Error('Telegram sendLocation failed');
  return resp.json();
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    sendBtn.disabled = true;
    updateStatus('Готовим данные…');
    const fileInput = document.getElementById('photo');
    if (!fileInput.files || fileInput.files.length === 0) {
      updateStatus('Добавьте хотя бы одно фото.', 'err');
      sendBtn.disabled = false;
      return;
    }
    const rawFile = fileInput.files[0];
    const photoFile = await compressImage(rawFile);

    const plate = document.getElementById('plate').value.trim();
    const vehicle = document.getElementById('vehicle').value.trim();
    const city = document.getElementById('city').value.trim();
    const desc = document.getElementById('desc').value.trim();

    const coords = await getPositionIfAllowed();
    const stamp = new Date().toLocaleString();

    const caption = [
      '🚨 Репорт: пьяный водитель',
      plate ? `Номер: ${plate}` : null,
      vehicle ? `Авто: ${vehicle}` : null,
      city ? `Город: ${city}` : null,
      `Время: ${stamp}`,
      desc ? `Описание: ${desc}` : null,
      `Устройство: ${navigator.userAgent}`
    ].filter(Boolean).join('\n');

    updateStatus('Отправляем фото в Telegram…');
    await sendTelegramPhoto({
      chatId: window.TELEGRAM_CHAT_ID,
      botToken: window.TELEGRAM_BOT_TOKEN,
      photoFile,
      caption
    });

    if (coords) {
      updateStatus('Отправляем геолокацию…');
      await sendTelegramLocation({
        chatId: window.TELEGRAM_CHAT_ID,
        botToken: window.TELEGRAM_BOT_TOKEN,
        lat: coords.latitude,
        lon: coords.longitude
      });
    }

    updateStatus('Готово! Спасибо за отчёт. Мы свяжемся при необходимости.', 'ok');
    form.reset();
  } catch (err) {
    console.error(err);
    updateStatus('Не удалось отправить. Проверьте интернет и попробуйте снова.', 'err');
  } finally {
    sendBtn.disabled = false;
  }
});
