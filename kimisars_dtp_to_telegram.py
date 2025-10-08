bash -lc 'cat > install_kimisars.sh <<'"'"'INSTALL'"'"' && chmod +x install_kimisars.sh && ./install_kimisars.sh
#!/usr/bin/env bash
set -euo pipefail
# ---------- Параметры (если нужно — отредактируй ниже) ----------
TARGET_USER="$(whoami)"
INSTALL_DIR="/home/${TARGET_USER}/kimisars_bot"
VENV_DIR="${INSTALL_DIR}/venv"
SCRIPT_PATH="${INSTALL_DIR}/kimisars_dtp_to_telegram.py"
ENV_FILE="${INSTALL_DIR}/.env"

# Токен и chat_id, которые ты передал (если хочешь, измени здесь)
TELEGRAM_BOT_TOKEN="8219557838:AAE18HofoNDD6gpn9LqbNtfMiEIOV3HPLF8"
TELEGRAM_CHAT_ID="7523840597"

# ---------- Обновление и установка системных пакетов ----------
echo "1) Обновление системы и установка зависимостей..."
sudo apt update
sudo apt upgrade -y
sudo apt install -y python3 python3-venv python3-pip wget curl git sqlite3 ca-certificates \
  libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libxcomposite1 libxdamage1 libxrandr2 \
  libgbm1 libasound2 libpangocairo-1.0-0 libxss1 libgconf-2-4 fonts-liberation libgtk-3-0 \
  libx11-xcb1 libxcb1

# ---------- Создаём директорию и venv ----------
echo "2) Создание папки и виртуального окружения..."
mkdir -p "${INSTALL_DIR}"
cd "${INSTALL_DIR}"
python3 -m venv "${VENV_DIR}"
# активировать venv для установки зависимостей
source "${VENV_DIR}/bin/activate"

# ---------- Установка Python-зависимостей ----------
echo "3) Установка Python-зависимостей (playwright, requests)..."
pip install --upgrade pip
pip install playwright requests

# Установим браузеры для playwright
echo "4) Установка браузеров Playwright (Chromium)... Это может занять минуту."
python -m playwright install chromium

# ---------- Запись .env (с токеном и chat_id) ----------
echo "5) Создание .env с токеном (в ${ENV_FILE})"
cat > "${ENV_FILE}" <<EOF
TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
TELEGRAM_CHAT_ID=${TELEGRAM_CHAT_ID}
TARGET_URL= https://nikibelyy.github.io/avarijnyj-komissar/
DATA_DIR=${INSTALL_DIR}/data
EOF
chmod 600 "${ENV_FILE}"

# ---------- Запись Python-скрипта ----------
echo "6) Запись Python-скрипта бота в ${SCRIPT_PATH}"
cat > "${SCRIPT_PATH}" <<'PYCODE'
#!/usr/bin/env python3
"""
kimisars_dtp_to_telegram.py
Скрипт: ищет ДТП на странице с Яндекс.Картой (ymaps.traffic._actualProvider),
делает скриншот участка с центром на событии и отправляет в Telegram.
Хранит уже отправленные события в SQLite (data/events.db).
"""
import os, sys, time, json, sqlite3, asyncio, requests
from pathlib import Path
from playwright.async_api import async_playwright

# Загружаем конфиг из .env (если есть)
env_path = Path(__file__).parent / ".env"
if env_path.exists():
    with open(env_path, "r") as f:
        for line in f:
            if "=" in line:
                k,v = line.strip().split("=",1)
                os.environ.setdefault(k, v)

TARGET_URL = os.environ.get("TARGET_URL", "https://nikibelyy.github.io/avarijnyj-komissar/")
TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN")
TELEGRAM_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID")

if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
    print("ERROR: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set")
    sys.exit(2)

DATA_DIR = Path(os.environ.get("DATA_DIR", Path(__file__).parent / "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "events.db"
SCREENSHOT_PATH = DATA_DIR / "last_dtp.png"

TG_API = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}"

# DB helpers
def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("CREATE TABLE IF NOT EXISTS sent (id TEXT PRIMARY KEY, caption TEXT, ts INTEGER)")
    conn.commit()
    return conn

def was_sent(conn, event_id):
    cur = conn.cursor()
    cur.execute("SELECT 1 FROM sent WHERE id=?", (event_id,))
    return cur.fetchone() is not None

def mark_sent(conn, event_id, caption):
    conn.execute("INSERT OR REPLACE INTO sent VALUES (?, ?, ?)", (event_id, caption, int(time.time())))
    conn.commit()

# Telegram helpers
def send_message(text):
    r = requests.post(f"{TG_API}/sendMessage", json={
        "chat_id": TELEGRAM_CHAT_ID,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": True
    }, timeout=20)
    r.raise_for_status()
    return r.json()

def send_photo(path, caption=None):
    with open(path, "rb") as f:
        files = {"photo": f}
        data = {"chat_id": TELEGRAM_CHAT_ID}
        if caption:
            data["caption"] = caption
            data["parse_mode"] = "HTML"
        r = requests.post(f"{TG_API}/sendPhoto", data=data, files=files, timeout=60)
        r.raise_for_status()
        return r.json()

# JS extractor: получает features из провайдера и фильтрует ДТП/аварии/заторы
JS_EXTRACT = r"""
(() => {
  try {
    if (!window.ymaps || !ymaps.traffic) return {ok:false, reason:'no_ymaps_or_traffic'};
    // попытаемся получить активный провайдер
    let prov = ymaps.traffic._actualProvider || null;
    if (!prov) {
      // ищем среди полей ymaps.traffic
      for (const k of Object.keys(ymaps.traffic)) {
        try {
          const v = ymaps.traffic[k];
          if (v && v.constructor && v.constructor.name === 'Actual') { prov = v; break; }
        } catch(e){}
      }
    }
    if (!prov || !prov.state) return {ok:false, reason:'no_provider'};
    const feats = prov.state.get('features') || [];
    const keywords = ['дтп','авар','столк','затор','пробк','перекр'];
    const dtp = feats.filter(f=>{
      try{
        const ic = (f.properties && (f.properties.iconCaption || f.properties.caption || f.properties.hint || f.properties.name)) || '';
        if (!ic) return false;
        const s = (''+ic).toLowerCase();
        return keywords.some(k=>s.indexOf(k)!==-1);
      }catch(e){ return false; }
    });
    // map useful info
    return {
      ok:true,
      count: dtp.length,
      events: dtp.map(function(f,i){
        return {
          id: (f.id || ('feat_'+i)) + '|' + (f.geometry && f.geometry.coordinates ? f.geometry.coordinates.join(',') : i),
          caption: f.properties && (f.properties.iconCaption || f.properties.caption || f.properties.name || '') || '',
          coords: f.geometry && f.geometry.coordinates || null
        };
      })
    };
  } catch(e) {
    return {ok:false, error: e && e.toString()};
  }
})();
"""

# JS to attempt to open balloon/info for a given coords or caption
JS_OPEN_BALLOON = r"""
((needle)=>{
  try {
    if (!window.ymaps || !ymaps.traffic) return {ok:false, reason:'no_ymaps'};
    let prov = ymaps.traffic._actualProvider || null;
    if (!prov) {
      for (const k of Object.keys(ymaps.traffic)) {
        try {
          const v = ymaps.traffic[k];
          if (v && v.constructor && v.constructor.name === 'Actual') { prov = v; break; }
        } catch(e){}
      }
    }
    if (!prov) return {ok:false, reason:'no_provider'};
    const feats = prov.state.get('features') || [];
    let found=null;
    // поиск по id (если передали) или по caption/coords substring
    for (let i=0;i<feats.length;i++){
      try{
        const f = feats[i];
        const coords = f.geometry && f.geometry.coordinates ? f.geometry.coordinates.join(',') : '';
        const caption = (f.properties && (f.properties.iconCaption||f.properties.caption||f.properties.name)) || '';
        const id = (f.id || ('feat_'+i)) + '|' + coords;
        if (String(id)===String(needle) || (String(caption).toLowerCase().indexOf(String(needle).toLowerCase())!==-1) || coords.indexOf(String(needle))!==-1) {
          found = {f: f, idx:i, id:id, caption: caption, coords: f.geometry && f.geometry.coordinates};
          break;
        }
      }catch(e){}
    }
    if (!found) return {ok:false, reason:'not_found'};
    try {
      // Попытка открыть balloon (не у всех внутренних объектов есть balloon)
      if (found.f && found.f.balloon && typeof found.f.balloon.open === 'function') {
        found.f.balloon.open();
        return {ok:true, opened:true, idx: found.idx, caption: found.caption};
      }
      // иначе, пробуем вызвать провайдер/infobox-методы через глобальные объекты (best effort)
      if (window.ymaps && window.ymaps.traffic && window.ymaps.traffic.InfoLayer) {
        // best-effort: ничего универсального не делаем
      }
      return {ok:true, opened:false, reason:'no_balloon', caption: found.caption};
    } catch(e) {
      return {ok:false, error: e && e.toString()};
    }
  } catch(e){ return {ok:false, error: e && e.toString()}; }
})(arguments[0]);
"""

# Центрирование карты (попытка через window.map)
JS_CENTER = r"""
((lat, lon, zoom)=>{
  try {
    if (window.map && typeof window.map.setCenter === 'function') {
      window.map.setCenter([lat, lon], zoom||15);
      return {ok:true};
    }
    // попытка найти любой объект типа ymaps.Map
    for (const k of Object.keys(window)) {
      try {
        const v = window[k];
        if (v && v.constructor && v.constructor.name === 'Map' && typeof v.setCenter === 'function') {
          v.setCenter([lat, lon], zoom||15);
          return {ok:true};
        }
      } catch(e){}
    }
    return {ok:false, reason:'no_map_obj'};
  } catch(e){ return {ok:false, error: e && e.toString()}; }
})(arguments[0], arguments[1], arguments[2]);
"""

async def fetch_events():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=["--no-sandbox"])
        page = await browser.new_page(viewport={"width":1280,"height":900})
        await page.goto(TARGET_URL, timeout=60000)
        await page.wait_for_timeout(4000)
        try:
            data = await page.evaluate(JS_EXTRACT)
        except Exception as e:
            data = {"ok": False, "error": str(e)}
        await browser.close()
        return data

async def screenshot_event(ev):
    coords = ev.get("coords")
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=["--no-sandbox"])
        page = await browser.new_page(viewport={"width":1280,"height":900})
        await page.goto(TARGET_URL, timeout=60000)
        await page.wait_for_timeout(3000)
        if coords and isinstance(coords, (list,tuple)) and len(coords)>=2:
            lat, lon = coords[0], coords[1]
            try:
                await page.evaluate(JS_CENTER, lat, lon, 15)
                await page.wait_for_timeout(1200)
            except Exception:
                pass
        # попытка открыть balloon по id или caption
        try:
            await page.evaluate(JS_OPEN_BALLOON, ev.get("id") or ev.get("caption") or "")
            await page.wait_for_timeout(700)
        except Exception:
            pass
        # делаем скриншот всего видимого контейнера
        try:
            # пробуем найти контейнер карты
            selectors = ["#map", ".ymaps-2-1-79-map", ".ymaps-map", ".map", "#ymaps2"]
            el = None
            for s in selectors:
                try:
                    el = await page.query_selector(s)
                    if el:
                        await el.screenshot(path=str(SCREENSHOT_PATH))
                        break
                except Exception:
                    el = None
            if not el:
                await page.screenshot(path=str(SCREENSHOT_PATH))
        except Exception as e:
            # fallback full page
            await page.screenshot(path=str(SCREENSHOT_PATH))
        await browser.close()
        return SCREENSHOT_PATH

async def main():
    conn = init_db()
    data = await fetch_events()
    if not data.get("ok"):
        try:
            send_message(f"❌ Ошибка при получении событий: {data.get('error') or data.get('reason')}")
        except Exception:
            print("Ошибка при отправке сообщения о проблеме:", data)
        return
    events = data.get("events", [])
    if not events:
        print("Нет ДТП на карте (на данный момент).")
        return
    # Перебираем события и отправляем только новые
    for ev in events:
        ev_id = ev.get("id") or (ev.get("caption") + "_" + str(ev.get("coords")))
        caption = ev.get("caption") or "ДТП"
        if was_sent(conn, ev_id):
            continue
        # делаем скриншот
        try:
            scr = await screenshot_event(ev)
        except Exception as e:
            scr = None
            print("Ошибка при создании скриншота:", e)
        # отправляем
        try:
            time_str = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime())
            send_message(f"🚨 <b>ДТП / дорожное событие</b>\n{time_str}\n{caption}\nКоординаты: {ev.get('coords')}\nИсточник: {TARGET_URL}")
            if scr and Path(scr).exists():
                send_photo(scr, caption)
            mark_sent(conn, ev_id, caption)
            print("Отправлено:", caption)
        except Exception as e:
            print("Ошибка отправки в Telegram:", e)

if __name__ == "__main__":
    asyncio.run(main())
PYCODE

# Сделаем исполняемым
chmod +x "${SCRIPT_PATH}"

# ---------- Создаём systemd unit и timer для автоматического запуска каждые 5 минут ----------
SERVICE_FILE="/etc/systemd/system/kimisars.service"
TIMER_FILE="/etc/systemd/system/kimisars.timer"
echo "7) Создание systemd-сервиса и таймера..."

sudo bash -c "cat > ${SERVICE_FILE}" <<SERVICE
[Unit]
Description=Kimisars DTP to Telegram service
After=network.target

[Service]
Type=oneshot
User=${TARGET_USER}
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${ENV_FILE}
ExecStart=${VENV_DIR}/bin/python ${SCRIPT_PATH}
TimeoutStartSec=120

[Install]
WantedBy=multi-user.target
SERVICE

sudo bash -c "cat > ${TIMER_FILE}" <<TIMER
[Unit]
Description=Run Kimisars bot every 5 minutes

[Timer]
OnCalendar=*:0/5
AccuracySec=30s
Persistent=true

[Install]
WantedBy=timers.target
TIMER

# Перезагружаем systemd и включаем таймер
echo "8) Reload systemd, enable and start timer..."
sudo systemctl daemon-reload
sudo systemctl enable --now kimisars.timer
sudo systemctl start kimisars.timer

echo "Установка завершена!"
echo "Папка: ${INSTALL_DIR}"
echo "Лог сервиса можно посмотреть через: sudo journalctl -u kimisars.service -f"
echo "Лог таймера: sudo systemctl list-timers --all | grep kimisars"
echo "Чтобы запустить вручную: ${VENV_DIR}/bin/python ${SCRIPT_PATH}"
echo "Если нужно — перезаписать .env: ${ENV_FILE}"
echo "Готово."
INSTALL
'
