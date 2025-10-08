ymaps.ready(init);

function init() {
    // Создаем карту, центрируем на Воронеж
    var myMap = new ymaps.Map("map", {
        center: [51.6833, 39.1802], // координаты центра Воронежа
        zoom: 13,                   // масштаб
        controls: [],
        type: 'yandex#dark'         // <<< НОЧНАЯ ТЕМА
    });

    // Глобальный провайдер пробок
    window.actualProvider = new ymaps.traffic.provider.Actual(
        {},
        { infoLayerShown: true }
    );

    // Добавляем провайдер на карту
    window.actualProvider.setMap(myMap);

    // Слой инфоточек для событий
    var infoLayer = new ymaps.traffic.InfoLayer(myMap, {
        provider: window.actualProvider
    });

    infoLayer.setMap(myMap);
}
