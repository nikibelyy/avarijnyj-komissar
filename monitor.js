// monitor.js
const puppeteer = require('puppeteer');
const axios = require('axios');

const SITE_URL = process.env.SITE_URL || 'http://localhost:8000/'; // URL вашей страницы
const SERVER_EVENT_ENDPOINT = process.env.SERVER_EVENT_ENDPOINT || 'http://localhost:3000/event';
const POLL_INTERVAL = Number(process.env.POLL_INTERVAL_MS || 15000); // 15s

(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox','--disable-setuid-sandbox'] });
  const page = await browser.newPage();

  page.on('console', msg => {
    console.log('PAGE LOG>', msg.text());
  });

  console.log('Opening page', SITE_URL);
  await page.goto(SITE_URL, { waitUntil: 'networkidle2' });

  // ждём появления экспортированных объектов
  await page.waitForFunction(() =>
    window.ymaps && window.__actualTrafficProvider && window.__ymap, { timeout: 30000 });

  console.log('ymaps ready on page');

  let knownIds = new Set();

  async function fetchEventsFromPage() {
    return await page.evaluate(() => {
      try {
        const provider = window.__actualTrafficProvider;
        const map = window.__ymap;
        const out = [];

        // попытаемся прочитать инстансы инфоточек/слоя
        try {
          // Первый подход: если provider хранит какой-то кеш/список событий
          if (provider && provider._eventsCache) {
            for (const ev of provider._eventsCache) {
              out.push({
                id: ev.id || `${ev.coord}_${ev.type}`,
                title: ev.title || ev.text || 'ДТП',
                type: ev.type || 'unknown',
                lat: ev.coord ? ev.coord[0] : null,
                lon: ev.coord ? ev.coord[1] : null,
                description: ev.desc || ev.text || null,
                time: ev.time || null
              });
            }
          }
        } catch (e) {}

        // Второй подход: просмотреть все слои карты — искать объекты с центром/coords
        try {
          const layers = map.layers && (map.layers._layers || map.layers._instances || map.layers);
          if (layers) {
            for (let key in layers) {
              const L = layers[key];
              if (!L) continue;
              // попытаться найти объекты внутри слоя
              try {
                // разные версии API — разные внутренние структуры
                const internal = L._source || L._features || L;
                if (!internal) continue;
                // если есть _cache с тайлами
                if (internal._cache) {
                  for (const tileId in internal._cache) {
                    const tile = internal._cache[tileId];
                    if (!tile) continue;
                    const arr = tile.objects || tile._objects || tile.features || [];
                    for (const obj of arr) {
                      // obj может содержать центр/coords
                      let lat = null, lon = null;
                      if (obj.center && Array.isArray(obj.center)) {
                        lon = obj.center[0]; lat = obj.center[1];
                      } else if (obj.geometry && obj.geometry.coordinates) {
                        lon = obj.geometry.coordinates[0]; lat = obj.geometry.coordinates[1];
                      }
                      const id = obj.id || (lat && lon ? `${lat}_${lon}_${(obj.type||'')}` : JSON.stringify(obj).slice(0,200));
                      out.push({
                        id,
                        title: obj.text || obj.title || obj.name || 'Дорожное событие',
                        type: obj.type || obj.kind || 'unknown',
                        lat,
                        lon,
                        description: obj.description || obj.text || null,
                        time: null
                      });
                    }
                  }
                }
              } catch (e) {
                // игнорируем ошибки по слоям
              }
            }
          }
        } catch (e) {}

        // убираем дубли по id
        const unique = [];
        const seen = new Set();
        for (const o of out) {
          if (!o.id) continue;
          if (!seen.has(o.id)) {
            seen.add(o.id);
            unique.push(o);
          }
        }
        return unique;
      } catch (err) {
        return [];
      }
    });
  }

  // цикл опроса
  setInterval(async () => {
    try {
      const events = await fetchEventsFromPage();
      for (const ev of events) {
        if (!knownIds.has(ev.id)) {
          knownIds.add(ev.id);
          try {
            await axios.post(SERVER_EVENT_ENDPOINT, ev, { timeout: 10000 });
            console.log('Sent event ->', ev.id, ev.title);
          } catch (err) {
            console.error('Post event failed:', err.message);
          }
        }
      }
    } catch (err) {
      console.error('Error in polling:', err && err.message);
    }
  }, POLL_INTERVAL);

  console.log('Monitor started, polling every', POLL_INTERVAL, 'ms');
})();
