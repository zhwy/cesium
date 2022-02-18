import ArcType from "../Core/ArcType.js";
import Cartesian3 from "../Core/Cartesian3.js";
import Color from "../Core/Color.js";
import defaultValue from "../Core/defaultValue.js";
import defined from "../Core/defined.js";
import destroyObject from "../Core/destroyObject.js";
import GeometryInstance from "../Core/GeometryInstance.js";
import Matrix4 from "../Core/Matrix4.js";
import PolylineGeometry from "../Core/PolylineGeometry.js";
import PolylineColorAppearance from "./PolylineColorAppearance.js";
import Primitive from "./Primitive.js";
import PolylineMaterialAppearance from "./PolylineMaterialAppearance.js";
import Material from "./Material.js";
import ColorGeometryInstanceAttribute from "../Core/ColorGeometryInstanceAttribute.js";

/**
 * Draws the axes of a reference frame defined by a matrix that transforms to world
 * coordinates, i.e., Earth's WGS84 coordinates.  The most prominent example is
 * a primitives <code>modelMatrix</code>.
 * <p>
 * The X axis is red; Y is green; and Z is blue.
 * </p>
 * <p>
 * This is for debugging only; it is not optimized for production use.
 * </p>
 *
 * @alias DebugModelMatrixPrimitiveNew
 * @constructor
 *
 * @param {Object} [options] Object with the following properties:
 * @param {Number} [options.length=10000000.0] The length of the axes in meters.
 * @param {Number} [options.width=2.0] The width of the axes in pixels.
 * @param {Matrix4} [options.modelMatrix=Matrix4.IDENTITY] The 4x4 matrix that defines the reference frame, i.e., origin plus axes, to visualize.
 * @param {Boolean} [options.show=true] Determines if this primitive will be shown.
 * @param {Object} [options.id] A user-defined object to return when the instance is picked with {@link Scene#pick}
 * @param {Color} [options.xColor=Color.RED] Color for axis x
 * @param {Color} [options.yColor=Color.GREEN] Color for axis y
 * @param {Color} [options.zColor=Color.BLUE] Color for axis z
 *
 * @example
 * primitives.add(new Cesium.DebugModelMatrixPrimitiveNew({
 *   modelMatrix : primitive.modelMatrix,  // primitive to debug
 *   length : 100000.0,
 *   width : 10.0
 * }));
 */
function DebugModelMatrixPrimitiveNew(options) {
  options = defaultValue(options, defaultValue.EMPTY_OBJECT);

  /**
   * The length of the axes in meters.
   *
   * @type {Number}
   * @default 10000000.0
   */
  this.length = defaultValue(options.length, 10000000.0);
  this._length = undefined;

  /**
   * The width of the axes in pixels.
   *
   * @type {Number}
   * @default 2.0
   */
  this.width = defaultValue(options.width, 2.0);
  this._width = undefined;

  /**
   * Determines if this primitive will be shown.
   *
   * @type Boolean
   * @default true
   */
  this.show = defaultValue(options.show, true);

  /**
   * The 4x4 matrix that defines the reference frame, i.e., origin plus axes, to visualize.
   *
   * @type {Matrix4}
   * @default {@link Matrix4.IDENTITY}
   */
  this.modelMatrix = Matrix4.clone(
    defaultValue(options.modelMatrix, Matrix4.IDENTITY)
  );
  this._modelMatrix = new Matrix4();

  /**
   * User-defined value returned when the primitive is picked.
   *
   * @type {*}
   * @default undefined
   *
   * @see Scene#pick
   */
  this.id = options.id;
  this._id = undefined;

  this.xColor = defaultValue(options.xColor, Color.RED);
  this._xColor = undefined;
  this.yColor = defaultValue(options.yColor, Color.GREEN);
  this._yColor = undefined;
  this.zColor = defaultValue(options.zColor, Color.BLUE);
  this._zColor = undefined;

  this._primitive = undefined;
}

/**
 * @private
 */
DebugModelMatrixPrimitiveNew.prototype.update = function (frameState) {
  if (!this.show) {
    return;
  }

  if (
    !defined(this._primitive) ||
    !Matrix4.equals(this._modelMatrix, this.modelMatrix) ||
    this._length !== this.length ||
    this._width !== this.width ||
    this._id !== this.id ||
    this._xColor !== this.xColor ||
    this._yColor !== this.yColor ||
    this._zColor !== this.zColor
  ) {
    this._modelMatrix = Matrix4.clone(this.modelMatrix, this._modelMatrix);
    this._length = this.length;
    this._width = this.width;
    this._id = this.id;
    this._xColor = this.xColor;
    this._yColor = this.yColor;
    this._zColor = this.zColor;

    if (defined(this._primitive)) {
      this._primitive.destroy();
    }

    // Workaround projecting (0, 0, 0)
    if (
      this.modelMatrix[12] === 0.0 &&
      this.modelMatrix[13] === 0.0 &&
      this.modelMatrix[14] === 0.0
    ) {
      this.modelMatrix[14] = 0.01;
    }

    var x = new GeometryInstance({
      geometry: new PolylineGeometry({
        positions: [Cartesian3.ZERO, Cartesian3.UNIT_X],
        width: this.width,
        vertexFormat: PolylineMaterialAppearance.VERTEX_FORMAT,
        colors: [this.xColor, this.xColor],
        arcType: ArcType.NONE,
      }),
      modelMatrix: Matrix4.multiplyByUniformScale(
        this.modelMatrix,
        this.length,
        new Matrix4()
      ),
      id: {
        axis: "x",
        id: this.id,
      },
      pickPrimitive: this,
      attributes: {
        color: ColorGeometryInstanceAttribute.fromColor(this.xColor),
      },
    });
    var y = new GeometryInstance({
      geometry: new PolylineGeometry({
        positions: [Cartesian3.ZERO, Cartesian3.UNIT_Y],
        width: this.width,
        vertexFormat: PolylineMaterialAppearance.VERTEX_FORMAT,
        colors: [this.yColor, this.yColor],
        arcType: ArcType.NONE,
      }),
      modelMatrix: Matrix4.multiplyByUniformScale(
        this.modelMatrix,
        this.length,
        new Matrix4()
      ),
      id: {
        axis: "y",
        id: this.id,
      },
      pickPrimitive: this,
      attributes: {
        color: ColorGeometryInstanceAttribute.fromColor(this.yColor),
      },
    });
    var z = new GeometryInstance({
      geometry: new PolylineGeometry({
        positions: [Cartesian3.ZERO, Cartesian3.UNIT_Z],
        width: this.width,
        vertexFormat: PolylineMaterialAppearance.VERTEX_FORMAT,
        colors: [this.zColor, this.zColor],
        arcType: ArcType.NONE,
      }),
      modelMatrix: Matrix4.multiplyByUniformScale(
        this.modelMatrix,
        this.length,
        new Matrix4()
      ),
      id: {
        axis: "z",
        id: this.id,
      },
      pickPrimitive: this,
      attributes: {
        color: ColorGeometryInstanceAttribute.fromColor(this.zColor),
      },
    });

    this._primitive = new Primitive({
      geometryInstances: [x, y, z],
      appearance: new PolylineMaterialAppearance({
        material: Material.fromType("PolylineArrow"),
      }),
      asynchronous: false,
      releaseGeometryInstances: false,
    });
  }

  this._primitive.update(frameState);
};

/**
 * Returns true if this object was destroyed; otherwise, false.
 * <p>
 * If this object was destroyed, it should not be used; calling any function other than
 * <code>isDestroyed</code> will result in a {@link DeveloperError} exception.
 * </p>
 *
 * @returns {Boolean} <code>true</code> if this object was destroyed; otherwise, <code>false</code>.
 *
 * @see DebugModelMatrixPrimitiveNew#destroy
 */
DebugModelMatrixPrimitiveNew.prototype.isDestroyed = function () {
  return false;
};

/**
 * Destroys the WebGL resources held by this object.  Destroying an object allows for deterministic
 * release of WebGL resources, instead of relying on the garbage collector to destroy this object.
 * <p>
 * Once an object is destroyed, it should not be used; calling any function other than
 * <code>isDestroyed</code> will result in a {@link DeveloperError} exception.  Therefore,
 * assign the return value (<code>undefined</code>) to the object as done in the example.
 * </p>
 *
 * @exception {DeveloperError} This object was destroyed, i.e., destroy() was called.
 *
 * @example
 * p = p && p.destroy();
 *
 * @see DebugModelMatrixPrimitiveNew#isDestroyed
 */
DebugModelMatrixPrimitiveNew.prototype.destroy = function () {
  this._primitive = this._primitive && this._primitive.destroy();
  return destroyObject(this);
};
export default DebugModelMatrixPrimitiveNew;
