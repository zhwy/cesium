/* eslint-disable */
import * as Cesium from "../../../Build/CesiumUnminified/index.js";
window.CESIUM_BASE_URL = "../../../Build/CesiumUnminified/";
function Test() {
  var _originCamera = {
    position: new Cesium.Cartesian3.fromDegrees(116.794479, 36.495727, 500),
    direction: {
      heading: 0,
      pitch: Cesium.Math.toRadians(-35.0),
      roll: 0.0,
    },
    up: new Cesium.Cartesian3(0, 0, 1),
  }; //相机初始位置

  var viewer = new Cesium.Viewer("cesiumContainer", {
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
    shouldAnimate: true,
  });
  viewer.scene.globe.depthTestAgainstTerrain = true;
  //阴影设置
  viewer.shadowMap.softShadows = true;
  //viewer.scene.globe.enableLighting = true;
  viewer.shadowMap.maximumDistance = 1000;
  //模型显示不完整
  viewer.scene.logarithmicDepthBuffer = false;
  //viewer.scene.farToNearRatio = 1;
  setTimeout(function () {
    viewer.camera.flyTo({
      destination: _originCamera.position,
      complete: function () {
        viewer.camera.flyTo({
          destination: _originCamera.position,
          orientation: _originCamera.direction,
          duration: 0.1,
          complete: function () {},
        });
      },
    });
  }, 2000);

  //加载模型
  var model = new Cesium.Cesium3DTileset({
    url: "http://localhost:8082/fenji2/GD_test/tileset.json",
    luminanceAtZenith: 1,
    lightColor: new Cesium.Cartesian3(1, 1, 1),
    // immediatelyLoadDesiredLevelOfDetail: true,
    // maximumScreenSpaceError: 0
    // debugShowGeometricError: true
    // debugShowBoundingVolume: true
    //debugShowUrl: true,
    // loadSiblings: true
    // maximumMemoryUsage: 64
  });

  viewer.scene.primitives.add(model);

  var handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction(function (movement) {
    var scene = viewer.scene;
    if (scene.mode !== Cesium.SceneMode.MORPHING) {
      var pickedObject = scene.pick(movement.position);
      if (scene.pickPositionSupported && Cesium.defined(pickedObject)) {
        if (Cesium.defined(pickedObject.tileset)) {
          var name = pickedObject.getProperty("name");
          console.log(name);
        }
      }
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
}
export default Test;
