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

  this.times = options.times || [];
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

Cesium.Material._materialCache.addMaterial(Cesium.Material.PolylineTimeTrailType, {
  fabric: {
    type: Cesium.Material.PolylineTimeTrailType,

    uniforms: {
      color: new Cesium.Color(1.0, 0.0, 0.0, 1),

      image: Cesium.Material.PolylineTimeTrailImage,

      time: 0,

      duration: 1000,

      repeat: 1,

      length: 1,

      // times: []
    },

    source: `    

    varying float v_speed;

    czm_material czm_getMaterial(czm_materialInput materialInput)    
{

    czm_material material = czm_getDefaultMaterial(materialInput); 

    vec2 st = materialInput.st; 

    float _duration = duration;

    float _time = ( time - (_duration * floor(time / _duration) ) ) / _duration;

    // _time *= v_speed;

    vec4 colorImage = texture2D(image, vec2(smoothstep(1. - length ,1. ,fract(st.s * repeat - _time * repeat)), st.t));        

    material.alpha = colorImage.a + color.a;

    material.diffuse = (colorImage.rgb + color.rgb) / 2.0; 

    return material; 

} `,
  },
  translucent: function(material) {
    return true;
  },
});

Cesium.PolylineTimeTrailMaterialProperty = PolylineTimeTrailMaterialProperty;