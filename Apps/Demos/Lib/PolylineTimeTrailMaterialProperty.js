/* eslint-disable */
function PolylineTimeTrailMaterialProperty(options) {
  options = Cesium.defaultValue(options, Cesium.defaultValue.EMPTY_OBJECT);

  this._definitionChanged = new Cesium.Event();

  this._color = undefined;

  this.color = options.color || new Cesium.Color(1, 1, 1, 1);

  this.duration = options.duration || 10;

  this.trailImage = options.trailImage || Cesium.Material.PolylineTimeTrailImage;

  this._time = performance.now();

  this.repeat = options.repeat || 1;

  this.length = options.length || 1;

}

Cesium.defineProperties(PolylineTimeTrailMaterialProperty.prototype, {
  isConstant: {
    get: function() {
      return false;
    },
  },

  definitionChanged: {
    get: function() {
      return this._definitionChanged;
    },
  },

  color: Cesium.createPropertyDescriptor("color"),
});

PolylineTimeTrailMaterialProperty.prototype.getType = function(time) {
  return "PolylineTimeTrail";
};

PolylineTimeTrailMaterialProperty.prototype.getValue = function(time, result) {
  if (!Cesium.defined(result)) {
    result = {};
  }

  result.color = Cesium.Property.getValueOrClonedDefault(
    this._color,
    time,
    Cesium.Color.WHITE,
    result.color
  );

  result.image = Cesium.Material.PolylineTimeTrailImage;

  // result.image = this.trailImage;

  result.time =
    ((performance.now() - this._time) % this.duration) / this.duration;

  return result;
};

PolylineTimeTrailMaterialProperty.prototype.equals = function(other) {
  return (
    this === other ||
    (other instanceof PolylineTimeTrailMaterialProperty &&
      Cesium.Property.equals(this._color, other._color))
  );
};

Cesium.Material.PolylineTimeTrailType = "PolylineTimeTrail";

Cesium.Material.PolylineTimeTrailImage = "./red.png";

Cesium.Material.PolylineTimeTrailSpeedCoolor = "./color.png";

Cesium.Material._materialCache.addMaterial(Cesium.Material.PolylineTimeTrailType, {
  fabric: {
    type: Cesium.Material.PolylineTimeTrailType,

    uniforms: {
      color: new Cesium.Color(1.0, 0.0, 0.0, 1),

      image: Cesium.Material.PolylineTimeTrailImage,

      speedColor: "./color.png",

      time: 0,

      duration: 1000,

      repeat: 1,

      length: 1,

      test: "./color.png" // to think 将速度纹理写入几何属性，创建类似PerInstanceColorAppearance，读取每个几何中的速度纹理，
      // 就不需要每个geometry instance都创建一个primitive
    },

    source: `

    czm_material czm_getMaterial(czm_materialInput materialInput)    
{

    czm_material material = czm_getDefaultMaterial(materialInput); 

    vec2 st = materialInput.st; 

    float _duration = duration;

    float _time = ( time - (_duration * floor(time / _duration) ) ) / _duration;

    // if(_time == 0.){
    //   _time = 1.;
    // }
    

    vec4 speed = texture2D(test, vec2(_time, 0)); 

    vec4 colorImage = texture2D(image, vec2(smoothstep((1. - length) ,1. ,fract((st.s - _time) * repeat)), st.t));

    // vec4 colorImage = texture2D(image, vec2(fract((st.s - _time) * repeat), st.t));

    vec4 speedImage = texture2D(speedColor, vec2(speed.x, st.t));

    material.alpha = colorImage.a * color.a;


    // 不要渐变
    // material.alpha = 0.;
    // if(colorImage.a >= 0.5)
    //   material.alpha = color.a;

    // material.diffuse = color.rgb; //相同颜色

    material.diffuse = speedImage.rgb; //不同速度颜色不同

    return material; 

} `,
  },
  translucent: function(material) {
    return true;
  },
});

Cesium.PolylineTimeTrailMaterialProperty = PolylineTimeTrailMaterialProperty;