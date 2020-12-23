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
function changeModelPosition(
  model,
  height = 0,
  lng = 0,
  lat = 0,
  rotationZ = 0
) {
  let surface = Cesium.Matrix4.multiplyByPoint(
    model.modelMatrix,
    model.boundingSphere.center,
    new Cesium.Cartesian3()
  );
  let cartographic = Cesium.Cartographic.fromCartesian(surface);
  // console.log("move", {
  //     lng: Cesium.Math.toDegrees(cartographic.longitude + lng),
  //     lat: Cesium.Math.toDegrees(cartographic.latitude + lat),
  //     height: cartographic.height + height
  // })
  let offset = Cesium.Cartesian3.fromRadians(
    cartographic.longitude + Cesium.Math.toRadians(lng),
    cartographic.latitude + Cesium.Math.toRadians(lat),
    cartographic.height + height
  );
  let translation = Cesium.Cartesian3.subtract(
    offset,
    surface,
    new Cesium.Cartesian3()
  );
  let tmp = Cesium.Matrix4.add(
    model.modelMatrix,
    Cesium.Matrix4.fromTranslation(translation),
    new Cesium.Matrix4()
  );
  model.modelMatrix[12] = tmp[12];
  model.modelMatrix[13] = tmp[13];
  model.modelMatrix[14] = tmp[14];

  //旋转
  var rotation = Cesium.Matrix3.fromRotationZ(Cesium.Math.toRadians(rotationZ));
  let modelMatrix = Cesium.Matrix4.multiplyByMatrix3(
    model.modelMatrix.clone(),
    rotation,
    new Cesium.Matrix4()
  );
  model.modelMatrix = modelMatrix;
}
