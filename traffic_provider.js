ymaps.ready(init);

function init() {
    try {
        var myMap = new ymaps.Map("map", {
            center: [51.6833, 39.1802],
            zoom: 13,
            controls: [],
            type: 'yandex#dark' // можно вернуть на 'yandex#map', если темная не работает
        });

        window.actualProvider = new ymaps.traffic.provider.Actual({}, { infoLayerShown: true });
        window.actualProvider.setMap(myMap);

        var infoLayer = new ymaps.traffic.InfoLayer(myMap, {
            provider: window.actualProvider
        });

        infoLayer.setMap(myMap);
    } catch (e) {
        console.error("Ошибка инициализации карты:", e);
        document.getElementById("map").innerHTML = "<h2 style='color:white;text-align:center;margin-top:40vh'>Ошибка загрузки карты</h2>";
    }
}
