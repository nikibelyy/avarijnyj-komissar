ymaps.ready(init);

function init() {
    var myMap = new ymaps.Map("map", {
        center: [51.6833, 39.1802],
        zoom: 13,
        controls: []
    });

    var actualProvider = new ymaps.traffic.provider.Actual({}, { infoLayerShown: true });
    actualProvider.setMap(myMap);

    // Пробуем найти hotspot слой и слушать клики/добавления
    function attachToHotspotLayers() {
        myMap.layers.each(function(layer) {
            if (layer && layer instanceof ymaps.hotspot.Layer) {
                console.log("Нашли hotspot слой — добавляем обработчик");

                // При клике по инфо-точке
                layer.events.add('click', function (e) {
                    const target = e.get('target');
                    const props = target?.properties?.getAll?.() || {};
                    const desc = props.description || props.hintContent || JSON.stringify(props);
                    const coords = e.get('coords');
                    console.log("Событие:", desc, coords);

                    // Отправляем на сервер уведомление
                    notifyServer({
                        type: "traffic_event",
                        desc,
                        coords
                    });
                });
            }
        });
    }

    // Подключаем обработчик через 1 сек и при изменении состояния провайдера
    setTimeout(attachToHotspotLayers, 1000);
    actualProvider.state.events.add('change', attachToHotspotLayers);
}

// Отправляем POST-запрос на твой backend
function notifyServer(data) {
    fetch('https://nikibelyy.github.io/notify-incident', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(data)
    }).catch(err => console.error('Ошибка отправки на сервер:', err));
}
