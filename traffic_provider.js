// traffic_provider.js
ymaps.ready(init);

function init() {
  var myMap = new ymaps.Map("map", {
    center: [51.6833, 39.1802],
    zoom: 13,
    controls: []
  });

  var actualProvider = new ymaps.traffic.provider.Actual({}, { infoLayerShown: true });
  actualProvider.setMap(myMap);

  // Набор уникальных id событий, чтобы не слать дубликаты
  var seen = new Set();

  // Попытки прикрепиться к hotspot-слою
  function attachToHotspotLayers() {
    try {
      myMap.layers.each(function(layer) {
        // Проверяем разные варианты: ymaps.hotspot.Layer может не быть в глобальной видимости,
        // поэтому сравниваем по имени конструктора и по наличию подозрительных полей.
        var isHotspotLike = false;
        try {
          isHotspotLike = (layer && (
            (layer.constructor && /hotspot/i.test(layer.constructor.name)) ||
            layer._hotspotObjectManager || layer._objects || layer.getHotspots
          ));
        } catch (e) {
          isHotspotLike = false;
        }
        if (!isHotspotLike) return;

        // Избегаем повторного навешивания на тот же слой
        if (layer.__incidentWatcherAttached) return;
        layer.__incidentWatcherAttached = true;

        console.log("Прикрепляемся к hotspot-слою:", layer);

        // 1) Слушаем событие 'add' у возможного objectManager (если есть events API)
        try {
          var om = layer._hotspotObjectManager || layer._objectManager || layer.objectManager;
          if (om && om.events && om.events.add) {
            om.events.add('add', function(e) {
              safeProcessHotspotFromEvent(e, layer);
            });
          }
        } catch (e) {
          // ignore
        }

        // 2) Периодически (каждые 2-3s) пробегаем объекты в manager-е и ищем новые
        setInterval(function() {
          try {
            processObjectsFromLayer(layer);
          } catch (err) {
            console.warn('processObjectsFromLayer failed', err);
          }
        }, 2500);

        // 3) Слушаем клики как дополнительный источник (на случай, если add не срабатывает)
        try {
          layer.events && layer.events.add && layer.events.add('click', function(e) {
            processClickEvent(e, layer);
          });
        } catch (e) {}
      });
    } catch (err) {
      console.warn('attachToHotspotLayers failed', err);
    }
  }

  // Попытка получить human-readable id события
  function buildIdFromObject(obj) {
    try {
      // Разные варианты расположения данных:
      var props = obj.properties || obj.data || (obj.options && obj.options.meta) || {};
      var geom = obj.geometry || obj.geometryData || obj._geometry || {};
      var coords = '';
      if (Array.isArray(geom.coordinates)) coords = geom.coordinates.join(',');
      else if (geom.type === 'Point' && Array.isArray(geom.coordinates)) coords = geom.coordinates.join(',');
      else if (obj.lat && obj.lon) coords = obj.lat + ',' + obj.lon;
      var time = props.time || props.startTime || props.date || props.updatedAt || '';
      var type = props.type || props.eventType || props.kind || '';
      var desc = (props.description || props.name || props.title || props.hint || '') + '';
      return (type + '|' + coords + '|' + time + '|' + desc).slice(0, 500);
    } catch (e) {
      return JSON.stringify(obj).slice(0, 300);
    }
  }

  // Попытка извлечь координаты и описание
  function extractInfoFromObject(obj) {
    var props = obj.properties || obj.data || obj.options || obj;
    var geometry = obj.geometry || obj.geometryData || obj.position || {};
    var coords = null;
    if (geometry && Array.isArray(geometry.coordinates)) {
      // GeoJSON style: [lon, lat] или [lat, lon] — будем угадывать
      var c = geometry.coordinates;
      if (Math.abs(c[0]) <= 90 && Math.abs(c[1]) <= 90) {
        // скорее lat,lon
        coords = [c[0], c[1]];
      } else {
        // скорее lon,lat
        coords = [c[1], c[0]];
      }
    } else if (obj.lat && obj.lon) {
      coords = [obj.lat, obj.lon];
    } else if (obj.coordinate && Array.isArray(obj.coordinate)) {
      coords = obj.coordinate;
    } else if (obj._geometry && obj._geometry.coordinates) {
      var c2 = obj._geometry.coordinates;
      coords = (c2[1] && c2[0]) ? [c2[1], c2[0]] : c2;
    }

    var desc = props && (props.description || props.hint || props.name || props.title || props.type || JSON.stringify(props).slice(0,150)) || '';
    return { coords, desc };
  }

  function safeProcessHotspotFromEvent(e, layer) {
    try {
      // e.get && e.get('target') — возможные формы
      var target = (e.get && e.get('target')) || e.target || e.object || e.data;
      if (!target) return;
      // Попробуем получить raw object
      var obj = target._object || target.object || target;
      processOneObject(obj, layer);
    } catch (err) {
      console.warn('safeProcessHotspotFromEvent failed', err);
    }
  }

  function processClickEvent(e, layer) {
    try {
      var target = e.get && e.get('target') || e.target;
      if (!target) return;
      var props = (target.properties && target.properties.getAll && target.properties.getAll()) || target.properties || {};
      var coords = e.get && e.get('coords') || (target.geometry && target.geometry.getCoordinates && target.geometry.getCoordinates());
      // Структура props может содержать description/hintContent
      var desc = props.description || props.hintContent || props.hint || JSON.stringify(props);
      sendIfNew({ coords, desc, raw: props, source: 'click' });
    } catch (err) {
      console.warn('processClickEvent failed', err);
    }
  }

  // Обход объектов, которые может содержать слой/manager
  function processObjectsFromLayer(layer) {
    // Список возможных размещений объектных коллекций
    var candidates = [];

    if (layer.getHotspots && typeof layer.getHotspots === 'function') {
      try { candidates.push(layer.getHotspots()); } catch(e){}
    }
    if (layer._hotspotObjectManager) candidates.push(layer._hotspotObjectManager);
    if (layer._objectManager) candidates.push(layer._objectManager);
    if (layer.objectManager) candidates.push(layer.objectManager);
    if (layer._objects) candidates.push(layer._objects);
    if (layer.objects) candidates.push(layer.objects);
    if (layer._orig) candidates.push(layer._orig);

    candidates.forEach(function(cand) {
      try {
        // разные структуры — пробуем разумные варианты
        // 1) cand.objects (map of id->obj) or cand._objects
        if (cand._objects && typeof cand._objects.forEach === 'function') {
          cand._objects.forEach(function(obj) { processOneObject(obj, layer); });
        } else if (cand.objects && Array.isArray(cand.objects)) {
          cand.objects.forEach(function(obj) { processOneObject(obj, layer); });
        } else if (cand.get && typeof cand.get === 'function') {
          // возможно geoObjectCollection
          var all = null;
          try { all = cand.get(); } catch(e){}
          if (Array.isArray(all)) all.forEach(function(obj){ processOneObject(obj, layer); });
        } else if (Array.isArray(cand)) {
          cand.forEach(function(obj) { processOneObject(obj, layer); });
        } else if (cand._storage && cand._storage._objects) {
          // внутренние хранилища
          Object.values(cand._storage._objects).forEach(function(obj){ processOneObject(obj, layer); });
        }
      } catch (e) {
        // молча игнорируем ошибку в однm варианте
      }
    });
  }

  function processOneObject(obj, layer) {
    try {
      if (!obj) return;
      // Если GeoObject (ymaps.GeoObject) — у него есть properties.getAll()
      var id = buildIdFromObject(obj);
      if (seen.has(id)) return;

      var info = extractInfoFromObject(obj);
      // Попробуем фильтровать по ключевым словам (рус/англ)
      var descLower = (info.desc || '').toString().toLowerCase();
      var looksLikeAccident = /дтп|авар|столкн|crash|accident|collision|incident/i.test(descLower);
      // Можно менять логику: если хочешь слать всё — удаляй этот if
      if (!looksLikeAccident) {
        // иногда описание пустое — всё равно можно отправить если coords есть
        if (!info.coords) return;
      }

      // отмечаем как увиденное и отправляем
      seen.add(id);
      sendIfNew({ coords: info.coords, desc: info.desc || 'Дорожное событие', rawObject: obj, source: 'auto' });
    } catch (err) {
      // не ломаем основной цикл
      console.warn('processOneObject error', err);
    }
  }

  // Отправка на сервер (замени URL)
  function sendIfNew(payload) {
    try {
      var coords = payload.coords;
      var latLon = '';
      if (Array.isArray(coords)) {
        // coords может быть [lat, lon] или [lon, lat] — проверим числовой диапазон
        var a = Number(coords[0]), b = Number(coords[1]);
        if (Math.abs(a) <= 90 && Math.abs(b) <= 180) {
          latLon = a + ',' + b; // lat,lon
        } else {
          latLon = b + ',' + a;
        }
      } else if (typeof coords === 'string') {
        latLon = coords;
      }

      var text = (payload.desc || 'Дорожное событие') + (latLon ? ('\n\nКоординаты: ' + latLon) : '');

      // Формируем объект, который отправляем на сервер
      var body = {
        desc: text,
        coords: latLon,
        meta: { source: payload.source || 'unknown', time: (new Date()).toISOString() }
      };

      // POST на твой серверный endpoint — CORS должен быть разрешён сервером
      fetch('https://nikibelyy.github.io/avarijnyj-komissar/', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(body)
      }).then(function(resp) {
        if (!resp.ok) console.warn('notify-incident responded: ', resp.status);
      }).catch(function(err) {
        console.warn('Ошибка отправки notify-incident', err);
      });
    } catch (e) {
      console.warn('sendIfNew failed', e);
    }
  }

  // Первичная попытка прикрепиться + при изменениях состояния провайдера
  setTimeout(attachToHotspotLayers, 1200);
  actualProvider.state.events && actualProvider.state.events.add && actualProvider.state.events.add('change', attachToHotspotLayers);

  // На всякий случай — повторяем попытку через 5 и 10 сек (когда всё подгрузится)
  setTimeout(attachToHotspotLayers, 5000);
  setTimeout(attachToHotspotLayers, 10000);

  console.info('Traffic watcher initialized (experimental)');
}
