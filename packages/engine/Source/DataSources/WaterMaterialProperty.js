import Color from "../Core/Color.js";
import defaultValue from "../Core/defaultValue.js";
import defined from "../Core/defined.js";
import Event from "../Core/Event.js";
import createPropertyDescriptor from "./createPropertyDescriptor.js";
import Property from "./Property.js";
import Material from "../Scene/Material.js";

const defaultBaseWaterColor = new Color(0.2, 0.3, 0.6, 1.0);
const defaultBlendColor = new Color(0.0, 1.0, 0.699, 1.0);
const defaultFrequency = 10;
const defaultAnimationSpped = 0.01;
const defaultAmplitude = 1;
const defaultSpecularIntensity = 0.5;
const defaultFadeFactor = 1;

/**
 * A {@link MaterialProperty} that maps to image {@link Material} uniforms.
 * @alias WaterMaterialProperty
 * @constructor
 *
 * @param {Object} [options] Object with the following properties:
 * @param {Property|String} [options.specularMap] A Property specifying thie specular map.
 * @param {Property|String} [options.normalMap] A Property specifying thie normal map.
 * @param {Property|Color} [options.baseWaterColor=new Color(0.2, 0.3, 0.6, 1.0)] A {@link Color} Property specifying water color.
 * @param {Property|Color} [options.blendColor=new Color(0.0, 1.0, 0.699, 1.0)] A Property specifying the blend color.
 * @param {Property|Number} [options.frequency=10.0] Property specifying the waves amount.
 * @param {Property|Number} [options.animationSpeed=1.0] Property specifying the wave amplitude.
 * @param {Property|Number} [options.amplitude=1.0] Property specifying the wave amplitude.
 * @param {Property|Number} [options.specularIntensity=0.5] Property specifying the specular intensity.
 * @param {Property|Number} [options.fadeFactor=1.0] Property specifying the specular intensity.
 */
function WaterMaterialProperty(options) {
  options = defaultValue(options, defaultValue.EMPTY_OBJECT);

  this._definitionChanged = new Event();
  this._baseWaterColor = undefined;
  this._blendColor = undefined;
  this._specularMap = undefined;
  this._normalMap = undefined;
  this._frequency = undefined;
  this._animationSpeed = undefined;
  this._amplitude = undefined;
  this._specularIntensity = undefined;
  this._fadeFactor = undefined;

  this._transparent = undefined;

  this.baseWaterColor = options.baseWaterColor;
  this.blendColor = options.blendColor;
  this.specularMap = options.specularMap;
  this.normalMap = options.normalMap;
  this.frequency = options.frequency;
  this.animationSpeed = options.animationSpeed;
  this.amplitude = options.amplitude;
  this.specularIntensity = options.specularIntensity;
  this.fadeFactor = options.fadeFactor;
}

Object.defineProperties(WaterMaterialProperty.prototype, {
  /**
   * Gets a value indicating if this property is constant.  A property is considered
   * constant if getValue always returns the same result for the current definition.
   * @memberof WaterMaterialProperty.prototype
   *
   * @type {Boolean}
   * @readonly
   */
  isConstant: {
    get: function () {
      return true;
    },
  },

  /**
   * Gets the event that is raised whenever the definition of this property changes.
   * The definition is considered to have changed if a call to getValue would return
   * a different result for the same time.
   * @memberof WaterMaterialProperty.prototype
   *
   * @type {Event}
   * @readonly
   */
  definitionChanged: {
    get: function () {
      return this._definitionChanged;
    },
  },

  /**
   * Gets or sets the Property specifying water color.
   * @memberof WaterMaterialProperty.prototype
   * @type {Property|undefined}
   * @default new Color(0.2, 0.3, 0.6, 1.0)
   */
  baseWaterColor: createPropertyDescriptor("baseWaterColor"),

  /**
   * Gets or sets the Property specifying the blend color.
   * @memberof WaterMaterialProperty.prototype
   * @type {Property|undefined}
   * @default new Color(0.0, 1.0, 0.699, 1.0)
   */
  blendColor: createPropertyDescriptor("blendColor"),

  /**
   * Gets or sets the Property specifying thie specular map.
   * @memberof WaterMaterialProperty.prototype
   * @type {Property|undefined}
   */
  specularMap: createPropertyDescriptor("specularMap"),

  /**
   * Gets or sets the Property specifying the normal map.
   * @memberof WaterMaterialProperty.prototype
   * @type {Property|undefined}
   */
  normalMap: createPropertyDescriptor("normalMap"),

  /**
   * Gets or sets the Property specifying the waves amount.
   * @memberof WaterMaterialProperty.prototype
   * @type {Property|undefined}
   * @default 10.0
   */
  frequency: createPropertyDescriptor("frequency"),

  /**
   * Gets or sets the Property specifying the wave speed.
   * @memberof WaterMaterialProperty.prototype
   * @type {Property|undefined}
   * @default 0.01
   */
  animationSpeed: createPropertyDescriptor("animationSpeed"),

  /**
   * Gets or sets the Property specifying the wave amplitude.
   * @memberof WaterMaterialProperty.prototype
   * @type {Property|undefined}
   * @default 1.0
   */
  amplitude: createPropertyDescriptor("amplitude"),

  /**
   * Gets or sets the Property specifying the specular intensity.
   * @memberof WaterMaterialProperty.prototype
   * @type {Property|undefined}
   * @default 0.5
   */
  specularIntensity: createPropertyDescriptor("specularIntensity"),

  /**
   * Gets or sets the Property specifying the specular intensity.
   * @memberof WaterMaterialProperty.prototype
   * @type {Property|undefined}
   * @default 1.0
   */
  fadeFactor: createPropertyDescriptor("fadeFactor"),
});

/**
 * Gets the {@link Material} type at the provided time.
 *
 * @param {JulianDate} time The time for which to retrieve the type.
 * @returns {String} The type of material.
 */
WaterMaterialProperty.prototype.getType = function (time) {
  return Material.WaterType;
};

/**
 * Gets the value of the property at the provided time.
 *
 * @param {JulianDate} time The time for which to retrieve the value.
 * @param {Object} [result] The object to store the value into, if omitted, a new instance is created and returned.
 * @returns {Object} The modified result parameter or a new instance if the result parameter was not supplied.
 */
WaterMaterialProperty.prototype.getValue = function (time, result) {
  if (!defined(result)) {
    result = {};
  }

  result.specularMap = Property.getValueOrDefault(
    this._specularMap,
    time,
    Material.DefaultImageId
  );
  result.normalMap = Property.getValueOrDefault(
    this._normalMap,
    time,
    Material.DefaultImageId
  );
  result.baseWaterColor = Property.getValueOrClonedDefault(
    this._baseWaterColor,
    time,
    defaultBaseWaterColor,
    result.repeat
  );
  result.blendColor = Property.getValueOrClonedDefault(
    this._blendColor,
    time,
    defaultBlendColor,
    result.blendColor
  );
  result.frequency = Property.getValueOrClonedDefault(
    this._frequency,
    time,
    defaultFrequency,
    result.blendColor
  );
  result.animationSpeed = Property.getValueOrDefault(
    this._animationSpeed,
    time,
    defaultAnimationSpped
  );
  result.amplitude = Property.getValueOrDefault(
    this._amplitude,
    time,
    defaultAmplitude
  );
  result.specularIntensity = Property.getValueOrDefault(
    this._specularIntensity,
    time,
    defaultSpecularIntensity
  );
  result.fadeFactor = Property.getValueOrDefault(
    this._fadeFactor,
    time,
    defaultFadeFactor
  );

  return result;
};

/**
 * Compares this property to the provided property and returns
 * <code>true</code> if they are equal, <code>false</code> otherwise.
 *
 * @param {Property} [other] The other property.
 * @returns {Boolean} <code>true</code> if left and right are equal, <code>false</code> otherwise.
 */
WaterMaterialProperty.prototype.equals = function (other) {
  return (
    this === other ||
    (other instanceof WaterMaterialProperty &&
      Property.equals(this._baseWaterColor, other._baseWaterColor) &&
      Property.equals(this._blendColor, other._blendColor) &&
      Property.equals(this._specularMap, other._specularMap) &&
      Property.equals(this._normalMap, other._normalMap) &&
      Property.equals(this._frequency, other._frequency) &&
      Property.equals(this._animationSpeed, other._animationSpeed) &&
      Property.equals(this._amplitude, other._amplitude) &&
      Property.equals(this._specularIntensity, other._specularIntensity) &&
      Property.equals(this._fadeFactor, other._fadeFactor))
  );
};
export default WaterMaterialProperty;
