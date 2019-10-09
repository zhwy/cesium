/* eslint-disable */
function Test() {
    var _originXY = {
        lng: 116.790876,
        lat: 36.498399,
        height: 100,
        mercX: 13001100.84,
        mercY: 4369418.66,
        roamH: 135,
        dixiaModelH: -22.5,
        dishangModelH: 12
    }; //模型原点
    var _originCamera = {
        position: new Cesium.Cartesian3.fromDegrees(116.794479, 36.495727, 500),
        // position: new Cesium.Cartesian3.fromDegrees(114.78024, 28.50369, 1000),
        direction: {
            //heading: 0.421,
            heading: 0,
            pitch: Cesium.Math.toRadians(-35.0),
            roll: 0.0
        },
        up: new Cesium.Cartesian3(0, 0, 1)
    }; //相机初始位置

    var viewer = new Cesium.Viewer('cesiumContainer', {
        animation: false,
        baseLayerPicker: false,
        geocoder: false,
        timeline: false,
        infobox: false,
        navigationHelpButton: false,
        sceneModePicker: false,
        scene3DOnly: true,
        homeButton: false,
        infoBox: false,
        selectionIndicator: false,
        fullscreenButton: false,
        //shadows: true,
        //terrainShadows:Cesium.ShadowMode.ENABLED,
        shouldAnimate: true,
        //高德
        imageryProvider: new Cesium.UrlTemplateImageryProvider({
            url:
                'https://webst04.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}',
            // 'http://www.google.cn/maps/vt?lyrs=s&x={x}&y={y}&z={z}',
            maximumLevel: 18,
            tileMatrixSetID: 'GoogleMapsCompatible'
        })
    });
    viewer.scene.globe.depthTestAgainstTerrain = true;
    //阴影设置
    viewer.shadowMap.softShadows = true;
    //viewer.scene.globe.enableLighting = true;
    viewer.shadowMap.maximumDistance = 1000;
    //模型显示不完整
    viewer.scene.logarithmicDepthBuffer = false;
    //viewer.scene.farToNearRatio = 1;
    setTimeout(function() {
        viewer.camera.flyTo({
            destination: _originCamera.position,
            complete: function() {
                viewer.camera.flyTo({
                    destination: _originCamera.position,
                    orientation: _originCamera.direction,
                    duration: 0.1,
                    complete: function() {}
                });
            }
        });
    }, 2000);

    //加载模型
    var _roadModel = new Cesium.PrimitiveCollection({
        show: true,
        destroyPrimitives: true
    });
    var model = new Cesium.Cesium3DTileset({
        // url: 'http://localhost:8081/indexDbTest/tileset.json',//宜丰
        url: 'http://localhost:8082/fenji2/GD_test/tileset.json',
        // url: 'http://localhost:8082/revit/tileset.json',
        luminanceAtZenith: 1,
        lightColor: new Cesium.Cartesian3(1, 1, 1)
        // immediatelyLoadDesiredLevelOfDetail: true,
        // maximumScreenSpaceError: 0,
        // debugShowGeometricError: true
        // debugShowBoundingVolume: true
        //debugShowUrl: true,
        // loadSiblings: true
        // maximumMemoryUsage: 64
    });
    model.origin = 'GD';
    _changeModelPosition(model, 0, 0, 0, 0, true);
    _roadModel.add(model);

    var jgModel = new Cesium.Cesium3DTileset({
        url: 'http://localhost:8082/fenji2/JG/tileset.json',
        luminanceAtZenith: 1,
        lightColor: new Cesium.Cartesian3(1, 1, 1)
        // immediatelyLoadDesiredLevelOfDetail: true,
        // maximumScreenSpaceError: 10
        // debugShowGeometricError: true
        // debugShowBoundingVolume:true,
        //debugShowUrl: true,
        // loadSiblings: true
        // maximumMemoryUsage: 64
    });
    jgModel.origin = 'JG';
    _changeModelPosition(jgModel, 0, 0, _originXY.dishangModelH);
    _roadModel.add(jgModel);

    viewer.scene.primitives.add(_roadModel);

    var handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction(function(movement) {
        var scene = viewer.scene;
        if (scene.mode !== Cesium.SceneMode.MORPHING) {
            var pickedObject = scene.pick(movement.position);
            if (scene.pickPositionSupported && Cesium.defined(pickedObject)) {
                if (Cesium.defined(pickedObject.tileset)) {
                    var name = pickedObject.getProperty('name');
                    console.log(name);
                }
            }
        }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    function _changeModelPosition(tileset, lng, lat, height, adjust) {
        tileset.readyPromise.then(function(argument) {
            var mat = Cesium.Matrix4.fromArray(tileset._root.transform);
            var pos = Cesium.Matrix4.getTranslation(
                mat,
                new Cesium.Cartesian3()
            );
            var wpos = Cesium.Cartographic.fromCartesian(pos);
            if (wpos) {
                lng = Cesium.Math.toDegrees(wpos.longitude);
                lat = Cesium.Math.toDegrees(wpos.latitude);
                if (adjust) height = wpos.height + height;
                else height = wpos.height + height + _originXY.height;
            }

            // var position = _originCamera.position;
            var position = Cesium.Cartesian3.fromDegrees(lng, lat, height);
            // var position = Cesium.Cartesian3.fromDegrees(
            //   _originXY.lng,
            //   _originXY.lat,
            //   _originXY.height
            // );
            var mat = Cesium.Transforms.eastNorthUpToFixedFrame(position);
            var rotationX = Cesium.Matrix4.fromRotationTranslation(
                Cesium.Matrix3.fromRotationZ(Cesium.Math.toRadians(0))
            );
            Cesium.Matrix4.multiply(mat, rotationX, mat);
            tileset._root.transform = mat;
        });
    }
}
