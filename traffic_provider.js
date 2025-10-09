ymaps.ready(init);

function init() {
    var myMap = new ymaps.Map("map", {
        center: [51.6833, 39.1802],
        zoom: 13,
        controls: []
    });

    var actualProvider = new ymaps.traffic.provider.Actual(
        {},
        { infoLayerShown: true }
    );

    actualProvider.setMap(myMap);

    var infoLayer = new ymaps.traffic.InfoLayer(myMap, {
        provider: actualProvider
    });

    infoLayer.setMap(myMap);

    // Экспорт для внешнего мониторинга
    window.__ymap = myMap;
    window.__actualTrafficProvider = actualProvider;
    window.__trafficInfoLayer = infoLayer;

    // Для логирования в консоль страницы
    actualProvider.state.events.add('change', function () {
        try {
            var ts = actualProvider.state.get('timestamp');
            console.log('traffic state timestamp:', ts);
        } catch (e) {}
    });
}
