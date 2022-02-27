import * as Cesium from "../../../Source/Cesium.js";
import PolylineCommon from "./PolylineCommon.js";

/**
 * Draws the axes of a reference frame Cesium.defined by a matrix that transforms to world
 * coordinates, i.e., Earth's WGS84 coordinates.  The most prominent example is
 * a primitives <code>modelMatrix</code>.
 * <p>
 * The X axis is red; Y is green; and Z is blue.
 * </p>
 * <p>
 * This is for debugging only; it is not optimized for production use.
 * </p>
 *
 * @alias PositionEditor
 * @constructor
 *
 * @param {Object} [options] Object with the following properties:
 * @param {Number} [options.length=100.0] The length of the axes in meters.
 * @param {Number} [options.width=2.0] The width of the axes in pixels.
 * @param {Cesium.Matrix4} [options.modelMatrix=Cesium.Matrix4.IDENTITY] The 4x4 matrix that defines the reference frame, i.e., origin plus axes, to visualize.
 * @param {Boolean} [options.show=true] Determines if this primitive will be shown.
 * @param {Object} [options.id] A user-Cesium.defined object to return when the instance is picked with {@link Scene#pick}
 * @param {Cesium.Color} [options.xColor=Cesium.Color.RED] Cesium.Color for axis x
 * @param {Cesium.Color} [options.yColor=Cesium.Color.GREEN] Cesium.Color for axis y
 * @param {Cesium.Color} [options.zColor=Cesium.Color.BLUE] Cesium.Color for axis z
 *
 * @example
 * primitives.add(new Cesium.PositionEditor({
 *   modelMatrix : primitive.modelMatrix,  // primitive to debug
 *   length : 100000.0,
 *   width : 10.0
 * }));
 */
function PositionEditor(options) {
  options = Cesium.defaultValue(options, Cesium.defaultValue.EMPTY_OBJECT);

  /**
   * The length of the axes in meters.
   *
   * @type {Number}
   * @default 100.0
   */
  this.length = Cesium.defaultValue(options.length, 100.0);
  this._length = undefined;

  /**
   * The width of the axes in pixels.
   *
   * @type {Number}
   * @default 2.0
   */
  this.width = Cesium.defaultValue(options.width, 2.0);
  this._width = undefined;

  /**
   * Determines if this primitive will be shown.
   *
   * @type Boolean
   * @default true
   */
  this.show = Cesium.defaultValue(options.show, true);

  /**
   * The 4x4 matrix that defines the reference frame, i.e., origin plus axes, to visualize.
   *
   * @type {Cesium.Matrix4}
   * @default {@link Cesium.Matrix4.IDENTITY}
   */
  this.modelMatrix = Cesium.Matrix4.clone(
    Cesium.defaultValue(options.modelMatrix, Cesium.Matrix4.IDENTITY)
  );
  this._modelMatrix = new Cesium.Matrix4();

  /**
   * User-Cesium.defined value returned when the primitive is picked.
   *
   * @type {*}
   * @default undefined
   *
   * @see Scene#pick
   */
  this.id = options.id;
  this._id = undefined;

  this.xColor = Cesium.defaultValue(options.xColor, Cesium.Color.RED);
  this._xColor = undefined;
  this.yColor = Cesium.defaultValue(options.yColor, Cesium.Color.GREEN);
  this._yColor = undefined;
  this.zColor = Cesium.defaultValue(options.zColor, Cesium.Color.BLUE);
  this._zColor = undefined;

  this._primitive = undefined;
}

const scratchBoundingSphere = new Cesium.BoundingSphere();

function scaleInPixels(positionWC, radius, frameState) {
  scratchBoundingSphere.center = positionWC;
  scratchBoundingSphere.radius = radius;
  return frameState.camera.getPixelSize(
    scratchBoundingSphere,
    frameState.context.drawingBufferWidth,
    frameState.context.drawingBufferHeight
  );
}

const scratchPosition = new Cesium.Cartesian3();
const scratchCartographic = new Cesium.Cartographic();

function getScale(model, frameState) {

  // Compute size of bounding sphere in pixels
  const context = frameState.context;
  const maxPixelSize = Math.max(
    context.drawingBufferWidth,
    context.drawingBufferHeight
  );
  const m = Cesium.defined(model._clampedModelMatrix)
    ? model._clampedModelMatrix
    : model.modelMatrix;
  scratchPosition.x = m[12];
  scratchPosition.y = m[13];
  scratchPosition.z = m[14];

  if (Cesium.defined(model._rtcCenter)) {
    Cesium.Cartesian3.add(model._rtcCenter, scratchPosition, scratchPosition);
  }

  if (frameState.camera._scene.mode !== Cesium.SceneMode.SCENE3D) {
    const projection = frameState.mapProjection;
    const cartographic = projection.ellipsoid.cartesianToCartographic(
      scratchPosition,
      scratchCartographic
    );
    projection.project(cartographic, scratchPosition);
    Cesium.Cartesian3.fromElements(
      scratchPosition.z,
      scratchPosition.x,
      scratchPosition.y,
      scratchPosition
    );
  }

  const radius = 1;

  const metersPerPixel = scaleInPixels(scratchPosition, radius, frameState);

  // metersPerPixel is always > 0.0
  const pixelsPerMeter = 1.0 / metersPerPixel;
  const diameterInPixels = Math.min(
    pixelsPerMeter * 2.0 * radius,
    maxPixelSize
  );

  let scale = 1;
  // Maintain model's minimum pixel size
  if (diameterInPixels < model.length) {
    scale =
      (model.length * metersPerPixel) / (2.0 * radius);
  }

  // scale = Math.min(model.length, scale);

  // console.log(scale)

  return scale;
}

/**
 * @private
 */
PositionEditor.prototype.update = function(frameState) {
  if (!this.show) {
    return;
  }

  if (
    !Cesium.defined(this._primitive) ||
    !Cesium.Matrix4.equals(this._modelMatrix, this.modelMatrix) ||
    this._length !== this.length ||
    this._width !== this.width ||
    this._id !== this.id ||
    this._xColor !== this.xColor ||
    this._yColor !== this.yColor ||
    this._zColor !== this.zColor
  ) {
    this._modelMatrix = Cesium.Matrix4.clone(this.modelMatrix, this._modelMatrix);
    this._length = this.length;
    this._width = this.width;
    this._id = this.id;
    this._xColor = this.xColor;
    this._yColor = this.yColor;
    this._zColor = this.zColor;

    if (Cesium.defined(this._primitive)) {
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

    const axisMatrix = Cesium.Matrix4.IDENTITY.clone();
    axisMatrix[14] = 0.01;

    const x = new Cesium.GeometryInstance({
      geometry: new Cesium.PolylineGeometry({
        positions: [Cesium.Cartesian3.ZERO, Cesium.Cartesian3.UNIT_X],
        width: this.width,
        vertexFormat: Cesium.PolylineMaterialAppearance.VERTEX_FORMAT,
        arcType: Cesium.ArcType.NONE,
      }),
      // modelMatrix: Cesium.Matrix4.multiplyByUniformScale(
      //   this.modelMatrix,
      //   this.length,
      //   new Cesium.Matrix4()
      // ),
      modelMatrix: axisMatrix,
      id: {
        axis: "x",
        id: this.id,
      },
      pickPrimitive: this,
      attributes: {
        color: Cesium.ColorGeometryInstanceAttribute.fromColor(this.xColor),
        depthFailColor: Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.multiplyByScalar(this.xColor, 0.5, new Cesium.Color())),
      },
    });
    const y = new Cesium.GeometryInstance({
      geometry: new Cesium.PolylineGeometry({
        positions: [Cesium.Cartesian3.ZERO, Cesium.Cartesian3.UNIT_Y],
        width: this.width,
        vertexFormat: Cesium.PolylineMaterialAppearance.VERTEX_FORMAT,
        arcType: Cesium.ArcType.NONE,
      }),
      modelMatrix: axisMatrix,
      id: {
        axis: "y",
        id: this.id,
      },
      pickPrimitive: this,
      attributes: {
        color: Cesium.ColorGeometryInstanceAttribute.fromColor(this.yColor),
        depthFailColor: Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.multiplyByScalar(this.yColor, 0.5, new Cesium.Color())),
      },
    });
    const z = new Cesium.GeometryInstance({
      geometry: new Cesium.PolylineGeometry({
        positions: [Cesium.Cartesian3.ZERO, Cesium.Cartesian3.UNIT_Z],
        width: this.width,
        vertexFormat: Cesium.PolylineMaterialAppearance.VERTEX_FORMAT,
        arcType: Cesium.ArcType.NONE,
      }),
      modelMatrix: axisMatrix,
      id: {
        axis: "z",
        id: this.id,
      },
      pickPrimitive: this,
      attributes: {
        color: Cesium.ColorGeometryInstanceAttribute.fromColor(this.zColor),
        depthFailColor: Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.multiplyByScalar(this.zColor, 0.5, new Cesium.Color())),
      },
    });

    const appearance = new Cesium.PolylineMaterialAppearance({
      material: Cesium.Material.fromType("PolylineArrow"),
      vertexShaderSource: `
        ${PolylineCommon}\n
attribute vec3 position3DHigh;
attribute vec3 position3DLow;
attribute vec3 prevPosition3DHigh;
attribute vec3 prevPosition3DLow;
attribute vec3 nextPosition3DHigh;
attribute vec3 nextPosition3DLow;
attribute vec2 expandAndWidth;
attribute vec2 st;
attribute float batchId;
attribute vec4 color;

varying float v_width;
varying vec2 v_st;
varying float v_polylineAngle;
varying vec4 v_color;

void main()
{
    float expandDir = expandAndWidth.x;
    float width = abs(expandAndWidth.y) + 0.5;
    bool usePrev = expandAndWidth.y < 0.0;

    vec4 p = czm_computePosition();
    vec4 prev = czm_computePrevPosition();
    vec4 next = czm_computeNextPosition();

    float angle;
    vec4 positionWC = getPolylineWindowCoordinates(p, prev, next, expandDir, width, usePrev, angle);
    gl_Position = czm_viewportOrthographic * positionWC;

    v_width = width;
    v_st.s = st.s;
    v_st.t = czm_writeNonPerspective(st.t, gl_Position.w);
    v_polylineAngle = angle;
    v_color = color;
}
        `,
      fragmentShaderSource: `
        #ifdef VECTOR_TILE
uniform vec4 u_highlightColor;
#endif

varying vec2 v_st;
varying vec4 v_color;

void main()
{
    czm_materialInput materialInput;

    vec2 st = v_st;
    st.t = czm_readNonPerspective(st.t, gl_FragCoord.w);

    materialInput.s = st.s;
    materialInput.st = st;
    materialInput.str = vec3(st, 0.0);

    czm_material material = czm_getMaterial(materialInput);
    gl_FragColor = vec4((material.diffuse + material.emission) * v_color.rgb, material.alpha * v_color.w);
#ifdef VECTOR_TILE
    gl_FragColor *= u_highlightColor;
#endif

    czm_writeLogDepth();
}
        `
    });

    this._primitive = new Cesium.Primitive({
      geometryInstances: [x, y, z],
      appearance: appearance,
      depthFailAppearance: appearance,
      asynchronous: false,
      releaseGeometryInstances: false,
    });
  }

  const scale = getScale(this, frameState);

  const scaledMatrix = Cesium.Matrix4.multiplyByUniformScale(this.modelMatrix, scale, new Cesium.Matrix4());

  this._primitive.modelMatrix = scaledMatrix;

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
 * @see PositionEditor#destroy
 */
PositionEditor.prototype.isDestroyed = function() {
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
 * @see PositionEditor#isDestroyed
 */
PositionEditor.prototype.destroy = function() {
  this._primitive = this._primitive && this._primitive.destroy();
  return Cesium.destroyObject(this);
};
export default PositionEditor;
