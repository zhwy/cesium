/**
 * 经纬度转墨卡托
 * @param {*} poi
 */
function getMercator(poi) {
  var mercator = {};
  var earthRad = 6378137.0;
  mercator.x = ((poi.lng * Math.PI) / 180) * earthRad;
  var a = (poi.lat * Math.PI) / 180;
  mercator.y =
    (earthRad / 2) * Math.log((1.0 + Math.sin(a)) / (1.0 - Math.sin(a)));
  return mercator;
}

/**
 * 墨卡托转经纬度
 * @param {*} poi
 */
function getLngLat(poi) {
  var lnglat = {};
  lnglat.lng = (poi.x / 20037508.34) * 180;
  var mmy = (poi.y / 20037508.34) * 180;
  lnglat.lat =
    (180 / Math.PI) *
    (2 * Math.atan(Math.exp((mmy * Math.PI) / 180)) - Math.PI / 2);
  return lnglat;
}

/**
 * 更改tileset位置
 * @param {*} tileset
 */
function changeTilesetPosition(tileset, dx, dy, dz) {
  var cartographic = Cesium.Cartographic.fromCartesian(
    tileset.boundingSphere.center
  );
  var surface = Cesium.Cartesian3.fromRadians(
    cartographic.longitude,
    cartographic.latitude,
    0.0
  );
  var offset = Cesium.Cartesian3.fromRadians(
    cartographic.longitude + dx,
    cartographic.latitude + dy,
    dz
  );
  var translation = Cesium.Cartesian3.subtract(
    offset,
    surface,
    new Cesium.Cartesian3()
  );

  tileset.modelMatrix = Cesium.Matrix4.fromTranslation(translation); //平移
}
/**
 * 更改模型位置
 * @param {*} model
 * @param {*} height
 * @param {*} lng
 * @param {*} lat
 * @param {*} rotationZ
 */
function changeModelPosition(model, z = 0, x = 0, y = 0, rotationZ = 0) {
  const { modelMatrix } = model;

  const cartesian = new Cesium.Cartesian3(
    modelMatrix[12],
    modelMatrix[13],
    modelMatrix[14]
  );

  const transform = Cesium.Transforms.eastNorthUpToFixedFrame(cartesian);

  const translationVector = new Cesium.Cartesian3(x, y, z);
  Cesium.Matrix4.multiplyByPointAsVector(
    transform,
    translationVector,
    translationVector
  );

  Cesium.Matrix4.multiply(
    Cesium.Matrix4.fromTranslation(translationVector),
    modelMatrix,
    modelMatrix
  );

  // 旋转
  const rotation = Cesium.Matrix3.fromRotationZ(
    Cesium.Math.toRadians(rotationZ)
  );

  Cesium.Matrix4.multiplyByMatrix3(
    model.modelMatrix,
    rotation,
    model.modelMatrix
  );
}
