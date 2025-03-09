import * as Cesium from "../../../Build/CesiumUnminified/index.js";
import CustomPrimitive from "../Lib/customPrimitive.js";
import {
  COMMON,
  BUFFER_A,
  BUFFER_B,
  BUFFER_C,
  BUFFER_D,
  RENDER_SHADER_VERTEX_SOURCE,
  RENDER_SHADER_FRAGMENT_SOURCE,
} from "./FloodSimulation.glsl.js";
import generateHeightMap from "./GenerateHeightMap.js";

function generateModelMatrix(
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = [1, 1, 1],
) {
  if (!(position instanceof Cesium.Cartesian3)) {
    position = Cesium.Cartesian3.fromDegrees(...position);
  }
  const enuMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(position);

  const rotationX = Cesium.Matrix4.fromRotation(
    Cesium.Matrix3.fromRotationX(Cesium.Math.toRadians(rotation[0])),
  );
  const rotationY = Cesium.Matrix4.fromRotation(
    Cesium.Matrix3.fromRotationY(Cesium.Math.toRadians(rotation[1])),
  );
  const rotationZ = Cesium.Matrix4.fromRotation(
    Cesium.Matrix3.fromRotationZ(Cesium.Math.toRadians(rotation[2])),
  );

  Cesium.Matrix4.multiply(enuMatrix, rotationX, enuMatrix);
  Cesium.Matrix4.multiply(enuMatrix, rotationY, enuMatrix);
  Cesium.Matrix4.multiply(enuMatrix, rotationZ, enuMatrix);

  const scaleMatrix = Cesium.Matrix4.fromScale(new Cesium.Cartesian3(...scale));
  const modelMatrix = Cesium.Matrix4.multiply(
    enuMatrix,
    scaleMatrix,
    new Cesium.Matrix4(),
  );

  return modelMatrix;
}

export default class FloodSimulation {
  get inverseModelMatrix() {
    return Cesium.Matrix4.inverse(this.modelMatrix, new Cesium.Matrix4());
  }

  get textureSize() {
    return this._textureSize;
  }

  set textureSize(value) {
    this._textureSize = value;
    this._createTextures(value.x, value.y);
  }

  constructor(viewer) {
    this.viewer = viewer;
    this.context = viewer.scene.context;
    this.geometry = null;
    this.modelMatrix = Cesium.Matrix4.IDENTITY;
    this.terranLevel = 11;
    this.heightMapResolution = new Cesium.Cartesian2(512, 512);
    this.heightMap = null;
    this.primitives = null;
    this.time = 0;
    this.frame = 0;
    this.debug = false;

    this._drawing = false;
    this._firstPoint = null;
    this._updateHandler = null;
    this._addWater = false;
    this._mousePosition = new Cesium.Cartesian2();
    this._textureSize = new Cesium.Cartesian2(512, 512);

    this._createBox();
    this._createTextures();

    this.eventHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    this.eventHandler.setInputAction((movement) => {
      const ray = viewer.camera.getPickRay(movement.position);
      const intersection = viewer.scene.globe.pick(ray, viewer.scene);
      if (intersection) {
        if (this._drawing) {
          // 绘制范围
          const cartographic = Cesium.Cartographic.fromCartesian(intersection);
          if (!this._firstPoint) {
            this._firstPoint = cartographic;
          } else {
            const rectangle = Cesium.Rectangle.fromRadians(
              Math.min(this._firstPoint.longitude, cartographic.longitude),
              Math.min(this._firstPoint.latitude, cartographic.latitude),
              Math.max(this._firstPoint.longitude, cartographic.longitude),
              Math.max(this._firstPoint.latitude, cartographic.latitude),
            );
            this.updateExtent(rectangle);
            this._drawing = false;
            this._firstPoint = null;
          }
        } else {
          // 添加水
          const modelPosition = Cesium.Matrix4.multiplyByPoint(
            this.inverseModelMatrix,
            intersection,
            new Cesium.Cartesian3(),
          );
          this._mousePosition.x = modelPosition.x;
          this._mousePosition.y = -modelPosition.z;
          this.addWater = true;
        }
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }
  drawExtent() {
    this._drawing = true;
    this._firstPoint = null;
  }
  updateExtent(rectangle) {
    console.log("开始生成高度图");
    generateHeightMap(
      this.viewer,
      rectangle,
      this.terranLevel,
      this.heightMapResolution.x,
      this.heightMapResolution.y,
    ).then((res) => {
      console.log("高度图生成完成", res);
      this.heightMap = res.heightMap;
      const center = Cesium.Rectangle.center(rectangle);
      center.height = (res.minElevation + res.maxElevation) / 2;
      const geodesic = new Cesium.EllipsoidGeodesic(
        Cesium.Cartographic.fromRadians(rectangle.west, rectangle.south),
        Cesium.Cartographic.fromRadians(rectangle.east, rectangle.south),
      );
      const geodesic2 = new Cesium.EllipsoidGeodesic(
        Cesium.Cartographic.fromRadians(rectangle.west, rectangle.south),
        Cesium.Cartographic.fromRadians(rectangle.west, rectangle.north),
      );

      this.position = Cesium.Cartographic.toCartesian(center);
      this.scale = [
        geodesic.surfaceDistance,
        res.maxElevation - res.minElevation,
        geodesic2.surfaceDistance,
      ];

      this.modelMatrix = generateModelMatrix(
        this.position,
        [90, 0, 0],
        this.scale,
      );

      if (!this.primitives) {
        this._createPrimitives();
      } else {
        this.drawPrimitive.modelMatrix = this.modelMatrix;
      }

      if (this._updateHandler) {
        this._updateHandler();
      }
      this.time = 0;
      this.frame = 0;
      this._updateHandler = this.viewer.scene.postRender.addEventListener(
        () => {
          const now = performance.now();
          this.time = now / 1000;
          this.frame += 0.02;
        },
      );
    });
  }
  _createBox() {
    const boxGeometry = Cesium.BoxGeometry.fromDimensions({
      vertexFormat: Cesium.VertexFormat.POSITION_AND_ST,
      dimensions: new Cesium.Cartesian3(1, 1, 1),
    });
    this.geometry = Cesium.BoxGeometry.createGeometry(boxGeometry);
  }
  _createTextures() {
    const width = this.textureSize.x;
    const height = this.textureSize.y;
    const context = this.context;

    /**
     * 高度和水深信息
     */
    this.texA = new Cesium.Texture({
      context,
      width,
      height,
      pixelFormat: Cesium.PixelFormat.RGBA,
      pixelDatatype: Cesium.PixelDatatype.FLOAT,
      source: {
        arrayBufferView: new Float32Array(width * height * 4),
      },
    });

    /**
     * 水流流出信息
     */
    this.texB = new Cesium.Texture({
      context,
      width,
      height,
      pixelFormat: Cesium.PixelFormat.RGBA,
      pixelDatatype: Cesium.PixelDatatype.FLOAT,
      source: {
        arrayBufferView: new Float32Array(width * height * 4),
      },
    });

    /**
     * 第二阶段高度和水深信息(包含水流流入和流出)
     */
    this.texC = new Cesium.Texture({
      context,
      width,
      height,
      pixelFormat: Cesium.PixelFormat.RGBA,
      pixelDatatype: Cesium.PixelDatatype.FLOAT,
      source: {
        arrayBufferView: new Float32Array(width * height * 4),
      },
    });

    /**
     * 第二阶段水流流出信息
     */
    this.texD = new Cesium.Texture({
      context,
      width,
      height,
      pixelFormat: Cesium.PixelFormat.RGBA,
      pixelDatatype: Cesium.PixelDatatype.FLOAT,
      source: {
        arrayBufferView: new Float32Array(width * height * 4),
      },
    });
  }
  _createPrimitives() {
    const scope = this;
    const computeA = new CustomPrimitive({
      commandType: "Compute",
      uniformMap: {
        iTime: () => {
          return scope.time;
        },
        iFrame: () => {
          return scope.frame;
        },
        iResolution: () => {
          return scope.heightMapResolution;
        },
        textureSize: () => {
          return scope.textureSize;
        },
        iChannel0: () => {
          return scope.texC;
        },
        iChannel1: () => {
          return scope.texD;
        },
        heightMap: () => {
          return scope.heightMap;
        },
        addWater: () => {
          if (scope.addWater) {
            scope.addWater = false; // 只添加一次水
            return true;
          }
          return false;
        },
        mousePosition: () => {
          return scope._mousePosition;
        },
      },
      fragmentShaderSource: COMMON + BUFFER_A,
      outputTexture: scope.texA,
      preExecute: function () {
        computeA.command.outputTexture = scope.texA;
      },
    });

    const computeB = new CustomPrimitive({
      commandType: "Compute",
      uniformMap: {
        iFrame: () => {
          return scope.frame;
        },
        iChannel0: () => {
          return scope.texA;
        },
        iChannel1: () => {
          return scope.texD;
        },
        textureSize: () => {
          return scope.textureSize;
        },
      },
      fragmentShaderSource: COMMON + BUFFER_B,
      outputTexture: scope.texB,
      preExecute: function () {
        computeB.command.outputTexture = scope.texB;
      },
    });

    const computeC = new CustomPrimitive({
      commandType: "Compute",
      uniformMap: {
        iChannel0: () => {
          return scope.texA;
        },
        iChannel1: () => {
          return scope.texB;
        },
        textureSize: () => {
          return scope.textureSize;
        },
      },
      fragmentShaderSource: COMMON + BUFFER_C,
      outputTexture: scope.texC,
      preExecute: function () {
        computeC.command.outputTexture = scope.texC;
      },
    });

    const computeD = new CustomPrimitive({
      commandType: "Compute",
      uniformMap: {
        iChannel0: () => {
          return scope.texC;
        },
        iChannel1: () => {
          return scope.texB;
        },
        textureSize: () => {
          return scope.textureSize;
        },
      },
      fragmentShaderSource: COMMON + BUFFER_D,
      outputTexture: scope.texD,
      preExecute: function () {
        computeD.command.outputTexture = scope.texD;
      },
    });

    this.drawPrimitive = new CustomPrimitive({
      commandType: "Draw",
      uniformMap: {
        iResolution: () => {
          return scope.heightMapResolution;
        },
        textureSize: () => {
          return scope.textureSize;
        },
        iChannel0: () => {
          return scope.texC;
        },
        iChannel1: () => {
          return scope.heightMap;
        },
      },
      geometry: scope.geometry,
      modelMatrix: scope.modelMatrix,
      vertexShaderSource: RENDER_SHADER_VERTEX_SOURCE,
      fragmentShaderSource: COMMON + RENDER_SHADER_FRAGMENT_SOURCE,
      pass: Cesium.Pass.TRANSLUCENT,
      rawRenderState: Cesium.Appearance.getDefaultRenderState(),
    });

    this.primitives = new Cesium.PrimitiveCollection();
    this.primitives.add(computeA);
    this.primitives.add(computeB);
    this.primitives.add(computeC);
    this.primitives.add(computeD);
    this.primitives.add(this.drawPrimitive);

    this.viewer.scene.primitives.add(this.primitives);

    if (this.debug) {
      this.debugBox = this.viewer.entities.add({
        position: new Cesium.CallbackProperty(() => {
          return this.position;
        }, false),
        box: {
          dimensions: new Cesium.CallbackProperty(() => {
            return new Cesium.Cartesian3(
              this.scale[0],
              this.scale[2],
              this.scale[1],
            );
          }, false),
          material: Cesium.Color.RED.withAlpha(0.3),
        },
      });
    }
  }
}
