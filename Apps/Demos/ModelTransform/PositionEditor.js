import * as Cesium from "../../../Source/Cesium.js";
import PolylineCommon from "./PolylineCommon.js";

const vs = `${PolylineCommon}
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
        `;

const fs = `
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
        `;

const EditType = {
  TRANSLATE: 0,
  ROTATE: 1,
  SCALE: 2,
};

const getScaleFromTransform = function(m) {
  const scalex = Math.sqrt(m[0] * m[0] + m[1] * m[1] + m[2] * m[2]);
  const scaley = Math.sqrt(m[4] * m[4] + m[5] * m[5] + m[6] * m[6]);
  const scalez = Math.sqrt(m[8] * m[8] + m[9] * m[9] + m[10] * m[10]);
  return [scalex, scaley, scalez];
}

/**
 *
 *
 * @alias PositionEditor
 * @constructor
 *
 * @param {Object} [options] Object with the following properties:
 * @param {Number} [options.length=300.0] The length of the axes in pixels.
 * @param {Number} [options.width=20] The width of the axes in pixels.
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
 *   length : 300.0,
 *   width : 20.0
 * }));
 */
function PositionEditor(options) {
  options = Cesium.defaultValue(options, Cesium.defaultValue.EMPTY_OBJECT);

  this.viewer = options.viewer;

  /**
   * The length of the axes in meters.
   *
   * @type {Number}
   * @default 300.0
   */
  this.length = Cesium.defaultValue(options.length, 300.0);
  this._length = undefined;

  /**
   * The width of the axes in pixels.
   *
   * @type {Number}
   * @default 20
   */
  this.width = Cesium.defaultValue(options.width, 20);
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

  this.type = Cesium.defaultValue(options.type, EditType.TRANSLATE);
  this._type = undefined;

  this.xColor = Cesium.defaultValue(options.xColor, Cesium.Color.RED);
  this._xColor = undefined;
  this._xOriginColor = this.xColor;
  this.yColor = Cesium.defaultValue(options.yColor, Cesium.Color.GREEN);
  this._yColor = undefined;
  this._yOriginColor = this.yColor;
  this.zColor = Cesium.defaultValue(options.zColor, Cesium.Color.BLUE);
  this._zColor = undefined;
  this._zOriginColor = this.zColor;

  this._primitive = undefined;

  this.item = options.item;

  this.handler = new Cesium.ScreenSpaceEventHandler(this.viewer.canvas);

  const me = this;
  const viewer = this.viewer;
  let pickedObject = null;

  this.handler.setInputAction(function(movement) {
    const picked = viewer.scene.pick(movement.position);
    if (Cesium.defined(picked)) {
      // console.log(picked);
      if (picked.primitive === me) {
        // me.item._allowPicking = false;
        pickedObject = picked;
        viewer.scene.screenSpaceCameraController.enableRotate = false; // lock default map control
        viewer.scene.screenSpaceCameraController.enableTranslate = false;
      } else {
        // if (pickedObject) me.item._allowPicking = false;
        pickedObject = null;
        viewer.scene.screenSpaceCameraController.enableRotate = true; // release default map control
        viewer.scene.screenSpaceCameraController.enableTranslate = true;
      }
    }
  }, Cesium.ScreenSpaceEventType.LEFT_DOWN);

  this.handler.setInputAction(function() {
    if (pickedObject) {
      // me.item._allowPicking = true;
      pickedObject.primitive.xColor = Cesium.Color.RED;
      pickedObject.primitive.yColor = Cesium.Color.GREEN;
      pickedObject.primitive.zColor = Cesium.Color.BLUE;
      pickedObject = null;
    }

    viewer.scene.screenSpaceCameraController.enableRotate = true; // release default map control
    viewer.scene.screenSpaceCameraController.enableTranslate = true;
  }, Cesium.ScreenSpaceEventType.LEFT_UP);

  this.handler.setInputAction(function(movement) {
    if (!pickedObject) {
      const hovered = viewer.scene.pick(movement.endPosition);
      if (Cesium.defined(hovered) && hovered.primitive === me) {
        switch (hovered.id.axis) {
          case "x":
            me.xColor = Cesium.Color.YELLOW;
            me.yColor = me._yOriginColor;
            me.zColor = me._zOriginColor;
            viewer.canvas.style.cursor = "pointer";
            break;
          case "y":
            me.yColor = Cesium.Color.YELLOW;
            me.xColor = me._xOriginColor;
            me.zColor = me._zOriginColor;
            viewer.canvas.style.cursor = "pointer";
            break;
          case "z":
            me.zColor = Cesium.Color.YELLOW;
            me.xColor = me._xOriginColor;
            me.yColor = me._yOriginColor;
            viewer.canvas.style.cursor = "pointer";
            break;
          default:
            me.xColor = me._xOriginColor;
            me.yColor = me._yOriginColor;
            me.zColor = me._zOriginColor;
            viewer.canvas.style.cursor = "default";
            break;
        }
      } else {
        viewer.canvas.style.cursor = "default";
        me.xColor = me._xOriginColor;
        me.yColor = me._yOriginColor;
        me.zColor = me._zOriginColor;
      }

      return;
    }

    const m = me.modelMatrix;
    const origin = new Cesium.Cartesian3(m[12], m[13], m[14]);
    const transform = Cesium.Transforms.eastNorthUpToFixedFrame(origin);
    const cameraDistance =
      Cesium.Cartesian3.distance(origin, viewer.camera.position) / 500;
    const windowStart = Cesium.SceneTransforms.wgs84ToWindowCoordinates(
      viewer.scene,
      origin,
      new Cesium.Cartesian2()
    );

    if (me.type === EditType.TRANSLATE) {
      const translation = new Cesium.Matrix4();
      const newPoint = new Cesium.Cartesian3();
      const transVector = new Cesium.Cartesian3();

      switch (pickedObject.id.axis) {
        case "x":
          Cesium.Matrix4.multiplyByPoint(
            transform,
            Cesium.Cartesian3.UNIT_X,
            newPoint
          );
          break;
        case "y":
          Cesium.Matrix4.multiplyByPoint(
            transform,
            Cesium.Cartesian3.UNIT_Y,
            newPoint
          );
          break;
        case "z":
          Cesium.Matrix4.multiplyByPoint(
            transform,
            Cesium.Cartesian3.UNIT_Z,
            newPoint
          );
          break;
        default:
          break;
      }

      Cesium.Cartesian3.subtract(newPoint, origin, transVector);

      const windowEnd = Cesium.SceneTransforms.wgs84ToWindowCoordinates(
        viewer.scene,
        newPoint,
        new Cesium.Cartesian2()
      );

      const direction = Cesium.Cartesian2.subtract(
        windowEnd,
        windowStart,
        new Cesium.Cartesian2()
      );
      const mouseDirection = new Cesium.Cartesian2(
        movement.endPosition.x - movement.startPosition.x,
        movement.endPosition.y - movement.startPosition.y
      );

      let scale = Cesium.Cartesian2.dot(mouseDirection, direction) > 0 ? 1 : -1;

      Cesium.Matrix4.fromTranslation(
        Cesium.Cartesian3.multiplyByScalar(
          transVector,
          scale * cameraDistance,
          new Cesium.Cartesian3()
        ),
        translation
      );

      const tmp = Cesium.Matrix4.multiply(
        translation,
        me.modelMatrix,
        new Cesium.Matrix4()
      );

      me.modelMatrix[12] = tmp[12];
      me.modelMatrix[13] = tmp[13];
      me.modelMatrix[14] = tmp[14];

      const item = me.item;
      if (item) {
        item.modelMatrix[12] = tmp[12];
        item.modelMatrix[13] = tmp[13];
        item.modelMatrix[14] = tmp[14];
      }
    } else if (me.type === EditType.ROTATE) {
      const windowOrigin = Cesium.SceneTransforms.wgs84ToWindowCoordinates(
        viewer.scene,
        origin,
        new Cesium.Cartesian2()
      );

      const startVector = Cesium.Cartesian2.subtract(
        new Cesium.Cartesian2(
          movement.startPosition.x,
          movement.startPosition.y
        ),
        windowOrigin,
        new Cesium.Cartesian2()
      );
      const endVector = Cesium.Cartesian2.subtract(
        new Cesium.Cartesian2(movement.endPosition.x, movement.endPosition.y),
        windowOrigin,
        new Cesium.Cartesian2()
      );

      const isCounterClockWise =
        Cesium.Cartesian2.cross(startVector, endVector) > 0 ? -1 : 1;
      let isCameraPositive;
      const angle = Cesium.Cartesian2.angleBetween(startVector, endVector);
      const org2Camera = Cesium.Cartesian3.subtract(
        viewer.scene.camera.position,
        origin,
        new Cesium.Cartesian3()
      );

      const rotation = new Cesium.Matrix3();

      const axis = new Cesium.Cartesian3();

      switch (pickedObject.id.axis) {
        case "x":
          Cesium.Matrix4.multiplyByPointAsVector(
            me.modelMatrix,
            Cesium.Cartesian3.UNIT_X,
            axis
          );
          isCameraPositive =
            Cesium.Cartesian3.dot(axis, org2Camera) > 0 ? 1 : -1;

          Cesium.Matrix3.fromRotationX(
            angle * isCameraPositive * isCounterClockWise,
            rotation
          );
          break;
        case "y":
          Cesium.Matrix4.multiplyByPointAsVector(
            me.modelMatrix,
            Cesium.Cartesian3.UNIT_Y,
            axis
          );
          isCameraPositive =
            Cesium.Cartesian3.dot(axis, org2Camera) > 0 ? 1 : -1;

          Cesium.Matrix3.fromRotationY(
            angle * isCameraPositive * isCounterClockWise,
            rotation
          );
          break;
        case "z":
          Cesium.Matrix4.multiplyByPointAsVector(
            me.modelMatrix,
            Cesium.Cartesian3.UNIT_Z,
            axis
          );
          isCameraPositive =
            Cesium.Cartesian3.dot(axis, org2Camera) > 0 ? 1 : -1;

          Cesium.Matrix3.fromRotationZ(
            angle * isCameraPositive * isCounterClockWise,
            rotation
          );
          break;
        default:
          break;
      }

      Cesium.Matrix4.multiplyByMatrix3(
        me.modelMatrix,
        rotation,
        me.modelMatrix
      );

      if (me.item) {
        const scaleValue = getScaleFromTransform(me.item.modelMatrix);
        Cesium.Matrix4.multiply(me.modelMatrix, Cesium.Matrix4.fromScale(new Cesium.Cartesian3(scaleValue[0], scaleValue[1], scaleValue[2])), me.item.modelMatrix);
      }
    } else if (me.type === EditType.SCALE) {
      const scaleMatrix = new Cesium.Matrix4();
      const newPoint = new Cesium.Cartesian3();
      const windowEnd = new Cesium.Cartesian2();
      const direction = new Cesium.Cartesian2();
      const mouseDirection = new Cesium.Cartesian2(
        movement.endPosition.x - movement.startPosition.x,
        movement.endPosition.y - movement.startPosition.y
      );

      switch (pickedObject.id.axis) {
        case "x":
          Cesium.Matrix4.multiplyByPoint(
            me.modelMatrix,
            Cesium.Cartesian3.UNIT_X,
            newPoint
          );

          Cesium.SceneTransforms.wgs84ToDrawingBufferCoordinates(
            viewer.scene,
            newPoint,
            windowEnd
          );
          Cesium.Cartesian2.subtract(windowEnd, windowStart, direction);

          const scalex =
            Cesium.Cartesian2.cross(direction, mouseDirection) > 0 ? 1.1 : 0.9;

          Cesium.Matrix4.fromScale(
            new Cesium.Cartesian3(scalex, 1, 1),
            scaleMatrix
          );

          break;
        case "y":
          Cesium.Matrix4.multiplyByPoint(
            me.modelMatrix,
            Cesium.Cartesian3.UNIT_Y,
            newPoint
          );

          Cesium.SceneTransforms.wgs84ToDrawingBufferCoordinates(
            viewer.scene,
            newPoint,
            windowEnd
          );
          Cesium.Cartesian2.subtract(windowEnd, windowStart, direction);

          const scaley =
            Cesium.Cartesian2.cross(direction, mouseDirection) > 0 ? 1.1 : 0.9;

          Cesium.Matrix4.fromScale(
            new Cesium.Cartesian3(1, scaley, 1),
            scaleMatrix
          );
          break;
        case "z":
          Cesium.Matrix4.multiplyByPoint(
            me.modelMatrix,
            Cesium.Cartesian3.UNIT_Z,
            newPoint
          );

          Cesium.SceneTransforms.wgs84ToDrawingBufferCoordinates(
            viewer.scene,
            newPoint,
            windowEnd
          );
          Cesium.Cartesian2.subtract(windowEnd, windowStart, direction);

          const scalez =
            Cesium.Cartesian2.cross(direction, mouseDirection) > 0 ? 1.1 : 0.9;

          Cesium.Matrix4.fromScale(
            new Cesium.Cartesian3(1, 1, scalez),
            scaleMatrix
          );
          break;
        default:
          break;
      }

      if (me.item) {
        Cesium.Matrix4.multiply(
          me.item.modelMatrix,
          scaleMatrix,
          me.item.modelMatrix
        );
      }
    }
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
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
  const m = model.modelMatrix;
  scratchPosition.x = m[12];
  scratchPosition.y = m[13];
  scratchPosition.z = m[14];

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
    scale = (model.length * metersPerPixel) / (2.0 * radius);
  }

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
    this._zColor !== this.zColor ||
    this._type !== this.type
  ) {
    if (this._type !== this.type) {
      if (this.type === EditType.TRANSLATE) {
        // reset the editor's modelMatrix to make the translation indicators point to axises
        const m = this.item.modelMatrix;
        const itemPos = new Cesium.Cartesian3(m[12], m[13], m[14]);
        this.modelMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(itemPos);
      } else if (
        this.type === EditType.ROTATE ||
        this.type === EditType.SCALE
      ) {
        const m = this.item.modelMatrix.clone();
        const scale = getScaleFromTransform(m);

        m[0] /= scale[0];
        m[1] /= scale[0];
        m[2] /= scale[0];
        m[4] /= scale[1];
        m[5] /= scale[1];
        m[6] /= scale[1];
        m[8] /= scale[2];
        m[9] /= scale[2];
        m[10] /= scale[2]
        this.modelMatrix = m;
      }
    }

    this._modelMatrix = Cesium.Matrix4.clone(
      this.modelMatrix,
      this._modelMatrix
    );
    this._length = this.length;
    this._width = this.width;
    this._id = this.id;
    this._xColor = this.xColor;
    this._yColor = this.yColor;
    this._zColor = this.zColor;
    this._type = this.type;

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

    let material,
      xpoints = [],
      ypoints = [],
      zpoints = [];

    if (this.type === EditType.TRANSLATE || this.type === EditType.SCALE) {
      material = Cesium.Material.fromType("PolylineArrow");
      xpoints = [Cesium.Cartesian3.ZERO, Cesium.Cartesian3.UNIT_X];
      ypoints = [Cesium.Cartesian3.ZERO, Cesium.Cartesian3.UNIT_Y];
      zpoints = [Cesium.Cartesian3.ZERO, Cesium.Cartesian3.UNIT_Z];
    } else if (this.type === EditType.ROTATE) {
      material = Cesium.Material.fromType("Color", {
        color: Cesium.Color.WHITE,
      });
      const counts = 64;
      for (let i = 0; i <= counts; i += 1) {
        xpoints.push(
          Cesium.Matrix3.multiplyByVector(
            Cesium.Matrix3.fromRotationX((i * (2 * Cesium.Math.PI)) / counts),
            Cesium.Cartesian3.UNIT_Y,
            new Cesium.Cartesian3()
          )
        );
      }
      for (let i = 0; i <= counts; i += 1) {
        ypoints.push(
          Cesium.Matrix3.multiplyByVector(
            Cesium.Matrix3.fromRotationY((i * (2 * Cesium.Math.PI)) / counts),
            Cesium.Cartesian3.UNIT_Z,
            new Cesium.Cartesian3()
          )
        );
      }
      for (let i = 0; i <= counts; i += 1) {
        zpoints.push(
          Cesium.Matrix3.multiplyByVector(
            Cesium.Matrix3.fromRotationZ((i * (2 * Cesium.Math.PI)) / counts),
            Cesium.Cartesian3.UNIT_X,
            new Cesium.Cartesian3()
          )
        );
      }
    }

    const width = this.type === EditType.ROTATE ? this.width / 2 : this.width;

    const x = new Cesium.GeometryInstance({
      geometry: new Cesium.PolylineGeometry({
        positions: xpoints,
        width: width,
        vertexFormat: Cesium.PolylineMaterialAppearance.VERTEX_FORMAT,
        arcType: Cesium.ArcType.NONE,
      }),
      modelMatrix: axisMatrix,
      id: {
        axis: "x",
      },
      pickPrimitive: this,
      attributes: {
        color: Cesium.ColorGeometryInstanceAttribute.fromColor(this.xColor),
        depthFailColor: Cesium.ColorGeometryInstanceAttribute.fromColor(
          Cesium.Color.multiplyByScalar(this.xColor, 0.5, new Cesium.Color())
        ),
      },
    });
    const y = new Cesium.GeometryInstance({
      geometry: new Cesium.PolylineGeometry({
        positions: ypoints,
        width: width,
        vertexFormat: Cesium.PolylineMaterialAppearance.VERTEX_FORMAT,
        arcType: Cesium.ArcType.NONE,
      }),
      modelMatrix: axisMatrix,
      id: {
        axis: "y",
      },
      pickPrimitive: this,
      attributes: {
        color: Cesium.ColorGeometryInstanceAttribute.fromColor(this.yColor),
        depthFailColor: Cesium.ColorGeometryInstanceAttribute.fromColor(
          Cesium.Color.multiplyByScalar(this.yColor, 0.5, new Cesium.Color())
        ),
      },
    });
    const z = new Cesium.GeometryInstance({
      geometry: new Cesium.PolylineGeometry({
        positions: zpoints,
        width: width,
        vertexFormat: Cesium.PolylineMaterialAppearance.VERTEX_FORMAT,
        arcType: Cesium.ArcType.NONE,
      }),
      modelMatrix: axisMatrix,
      id: {
        axis: "z",
      },
      pickPrimitive: this,
      attributes: {
        color: Cesium.ColorGeometryInstanceAttribute.fromColor(this.zColor),
        depthFailColor: Cesium.ColorGeometryInstanceAttribute.fromColor(
          Cesium.Color.multiplyByScalar(this.zColor, 0.5, new Cesium.Color())
        ),
      },
    });

    const appearance = new Cesium.PolylineMaterialAppearance({
      material: material,
      vertexShaderSource: vs,
      fragmentShaderSource: fs,
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

  const scaledMatrix = Cesium.Matrix4.multiplyByUniformScale(
    this.modelMatrix,
    scale,
    new Cesium.Matrix4()
  );

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

PositionEditor.EditType = Object.freeze(EditType);

export default PositionEditor;
