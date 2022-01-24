/* eslint-disable */
function PolylineTimeTrailMaterialProperty(options) {
  options = Cesium.defaultValue(options, Cesium.defaultValue.EMPTY_OBJECT);

  this._definitionChanged = new Cesium.Event();

  this._color = undefined;

  this.color = options.color || new Cesium.Color(1, 1, 1, 1);

  this.duration = options.duration || 10;

  this.image = options.image || Cesium.Material.PolylineTimeTrailImage;

  this._time = performance.now();

  this.repeat = options.repeat || 1;

  this.length = options.length || 1;
}

Cesium.defineProperties(PolylineTimeTrailMaterialProperty.prototype, {
  isConstant: {
    get: function () {
      return false;
    },
  },

  definitionChanged: {
    get: function () {
      return this._definitionChanged;
    },
  },

  color: Cesium.createPropertyDescriptor("color"),
});

PolylineTimeTrailMaterialProperty.prototype.getType = function (time) {
  return "PolylineTimeTrail";
};

PolylineTimeTrailMaterialProperty.prototype.getValue = function (time, result) {
  if (!Cesium.defined(result)) {
    result = {};
  }

  result.color = Cesium.Property.getValueOrClonedDefault(
    this._color,
    time,
    Cesium.Color.WHITE,
    result.color
  );

  result.image = this.image;

  result.time =
    ((performance.now() - this._time) % this.duration) / this.duration;

  return result;
};

PolylineTimeTrailMaterialProperty.prototype.equals = function (other) {
  return (
    this === other ||
    (other instanceof PolylineTimeTrailMaterialProperty &&
      Cesium.Property.equals(this._color, other._color))
  );
};

Cesium.Material.PolylineTimeTrailType = "PolylineTimeTrail";

Cesium.Material.PolylineTimeTrailImage = "./red.png";

Cesium.Material._materialCache.addMaterial(
  Cesium.Material.PolylineTimeTrailType,
  {
    fabric: {
      type: Cesium.Material.PolylineTimeTrailType,

      uniforms: {
        color: new Cesium.Color(1.0, 0.0, 0.0, 1),

        image: Cesium.Material.PolylineTimeTrailImage,

        time: 0,

        duration: 1000,

        repeat: 1,

        length: 1,
      },
      source: `

    varying vec4 v_timeOffset;
    varying float v_segments;
    czm_material czm_getMaterial(czm_materialInput materialInput)
{

    czm_material material = czm_getDefaultMaterial(materialInput);

    vec2 st = materialInput.st;

    float offset = v_timeOffset.x;
    float timeLength = v_timeOffset.y;
    float idx = v_timeOffset.z;
    float _segments = v_timeOffset.w;

    float normalizedTime = ( time - (duration * floor(time / duration) ) ) / duration;

    if( normalizedTime < offset || normalizedTime > (offset + timeLength * 1.1)) discard; // 留一个拖尾效果

    float _time = ( idx - 1.) / _segments + ( normalizedTime - offset) / _segments / timeLength;

    // if(abs(st.s - _time) > 0.02 * timeLength) discard;

    // todo 应该用每段长度和总长的比例来校正每段拖尾的效果
    // 从材质uniforms传递贴图，顶点仅存储属于哪一条数据的哪一段
    vec4 colorImage = texture2D(image, vec2(smoothstep((1. - length * timeLength), 1., fract((st.s - _time) * repeat)), st.t));

    material.alpha = colorImage.a * color.a;

    material.diffuse = color.rgb;

    return material;

} `,
    },
    translucent: function (material) {
      return true;
    },
  }
);

Cesium.PolylineTimeTrailMaterialProperty = PolylineTimeTrailMaterialProperty;
