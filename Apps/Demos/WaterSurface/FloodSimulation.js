import * as Cesium from "../../../Build/CesiumUnminified/index.js";
import CustomPrimitive from "./CustomPrimitive.js";
import {
  COMMON,
  BUFFER_A,
  BUFFER_B,
  BUFFER_C,
  BUFFER_D,
  RENDER_SHADER_VERTEX_SOURCE,
  RENDER_SHADER_FRAGMENT_SOURCE,
} from "./FloodSimulation.glsl.js";

window.CESIUM_BASE_URL = "../../../Build/CesiumUnminified/";
Cesium.Ion.defaultAccessToken =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiI0MjM4NGQ4Yi05MjAzLTQ3NzMtOTZmYS05ZDE1ZWZhYTk3OWMiLCJpZCI6MTEzNTYsInNjb3BlcyI6WyJhc3IiLCJnYyJdLCJpYXQiOjE1NTg2ODcwMDJ9.I0-TpqepRcWIVUUI8KrhoSZp-a70sRSRveNLBXOwOto";

function generateModelMatrix(
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = [1, 1, 1],
) {
  const rotationX = Cesium.Matrix4.fromRotationTranslation(
    Cesium.Matrix3.fromRotationX(Cesium.Math.toRadians(rotation[0])),
  );

  const rotationY = Cesium.Matrix4.fromRotationTranslation(
    Cesium.Matrix3.fromRotationY(Cesium.Math.toRadians(rotation[1])),
  );

  const rotationZ = Cesium.Matrix4.fromRotationTranslation(
    Cesium.Matrix3.fromRotationZ(Cesium.Math.toRadians(rotation[2])),
  );
  if (!(position instanceof Cesium.Cartesian3)) {
    position = Cesium.Cartesian3.fromDegrees(...position);
  }
  const enuMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(position);
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

const viewer = new Cesium.Viewer("cesiumContainer");
window._viewer = viewer;
Cesium.createWorldTerrainAsync().then((provider) => {
  viewer.terrainProvider = provider;
});

viewer.scene.globe.depthTestAgainstTerrain = true;

const context = viewer.scene.context;

const WIDTH = 2048;
const HEIGHT = 2048;

const resolution = new Cesium.Cartesian2(WIDTH, HEIGHT);

let time = 1;
let frame = 0;

/**
 * 高度和水深信息
 */
const texA = new Cesium.Texture({
  context,
  width: WIDTH,
  height: HEIGHT,
  pixelFormat: Cesium.PixelFormat.RGBA,
  pixelDatatype: Cesium.PixelDatatype.FLOAT,
  source: {
    arrayBufferView: new Float32Array(WIDTH * HEIGHT * 4),
  },
});

/**
 * 水流流出信息
 */
const texB = new Cesium.Texture({
  context,
  width: WIDTH,
  height: HEIGHT,
  pixelFormat: Cesium.PixelFormat.RGBA,
  pixelDatatype: Cesium.PixelDatatype.FLOAT,
  source: {
    arrayBufferView: new Float32Array(WIDTH * HEIGHT * 4),
  },
});

/**
 * 第二阶段高度和水深信息(包含水流流入和流出)
 */
const texC = new Cesium.Texture({
  context,
  width: WIDTH,
  height: HEIGHT,
  pixelFormat: Cesium.PixelFormat.RGBA,
  pixelDatatype: Cesium.PixelDatatype.FLOAT,
  source: {
    arrayBufferView: new Float32Array(WIDTH * HEIGHT * 4),
  },
});

/**
 * 第二阶段水流流出信息
 */
const texD = new Cesium.Texture({
  context,
  width: WIDTH,
  height: HEIGHT,
  pixelFormat: Cesium.PixelFormat.RGBA,
  pixelDatatype: Cesium.PixelDatatype.FLOAT,
  source: {
    arrayBufferView: new Float32Array(WIDTH * HEIGHT * 4),
  },
});

let heightMap = new Cesium.Texture({
  context,
  width: 1,
  height: 1,
});
Cesium.Resource.fetchImage({
  url: "./Erosion/1724136544296.png",
}).then((image) => {
  resolution.x = image.width;
  resolution.y = image.height;
  heightMap = new Cesium.Texture({
    context: context,
    width: image.width,
    height: image.height,
    pixelFormat: Cesium.PixelFormat.RGBA,
    pixelDatatype: Cesium.PixelDatatype.UNSIGNED_BYTE,
    flipY: true,
    sampler: new Cesium.Sampler({
      minificationFilter: Cesium.TextureMinificationFilter.LINEAR,
      magnificationFilter: Cesium.TextureMagnificationFilter.LINEAR,
      wrapS: Cesium.TextureWrap.REPEAT,
      wrapT: Cesium.TextureWrap.REPEAT,
    }),
    source: image,
  });
});

const computeA = new CustomPrimitive({
  commandType: "Compute",
  uniformMap: {
    iTime: () => {
      return time;
    },
    iFrame: () => {
      return frame;
    },
    iResolution: () => {
      return resolution;
    },
    iChannel0: () => {
      return texC;
    },
    iChannel1: () => {
      return texD;
    },
    heightMap: () => {
      return heightMap;
    },
  },
  fragmentShaderSource: COMMON + BUFFER_A,
  outputTexture: texA,
  preExecute: function () {
    computeA.command.outputTexture = texA;
  },
});

const computeB = new CustomPrimitive({
  commandType: "Compute",
  uniformMap: {
    iFrame: () => {
      return frame;
    },
    iChannel0: () => {
      return texA;
    },
    iChannel1: () => {
      return texD;
    },
  },
  fragmentShaderSource: COMMON + BUFFER_B,
  outputTexture: texB,
  preExecute: function () {
    computeB.command.outputTexture = texB;
  },
});

const computeC = new CustomPrimitive({
  commandType: "Compute",
  uniformMap: {
    iChannel0: () => {
      return texA;
    },
    iChannel1: () => {
      return texB;
    },
  },
  fragmentShaderSource: COMMON + BUFFER_C,
  outputTexture: texC,
  preExecute: function () {
    computeC.command.outputTexture = texC;
  },
});

const computeD = new CustomPrimitive({
  commandType: "Compute",
  uniformMap: {
    iChannel0: () => {
      return texC;
    },
    iChannel1: () => {
      return texB;
    },
  },
  fragmentShaderSource: COMMON + BUFFER_D,
  outputTexture: texD,
  preExecute: function () {
    computeD.command.outputTexture = texD;
  },
});

let terrainMap = new Cesium.Texture({
  context,
  width: 1,
  height: 1,
});
Cesium.Resource.fetchImage({
  url: "https://www.shadertoy.com/media/a/8979352a182bde7c3c651ba2b2f4e0615de819585cc37b7175bcefbca15a6683.jpg",
}).then((image) => {
  resolution.x = image.width;
  resolution.y = image.height;

  terrainMap = new Cesium.Texture({
    context,
    width: image.width,
    height: image.height,
    pixelFormat: Cesium.PixelFormat.RGBA,
    pixelDatatype: Cesium.PixelDatatype.UNSIGNED_BYTE,
    flipY: true,
    sampler: new Cesium.Sampler({
      minificationFilter: Cesium.TextureMinificationFilter.LINEAR,
      magnificationFilter: Cesium.TextureMagnificationFilter.LINEAR,
      wrapS: Cesium.TextureWrap.REPEAT,
      wrapT: Cesium.TextureWrap.REPEAT,
    }),
    source: image,
  });
});

const boxGeometry = Cesium.BoxGeometry.fromDimensions({
  vertexFormat: Cesium.VertexFormat.POSITION_AND_ST,
  dimensions: new Cesium.Cartesian3(1, 1, 1),
});
const geometry = Cesium.BoxGeometry.createGeometry(boxGeometry);

const rectangle = Cesium.Rectangle.fromDegrees(
  -119.66467126563256,
  37.64805162750813,
  -119.43723039796743,
  37.827915948691874,
);

viewer.camera.setView({
  destination: rectangle,
});

const minElevation = 1153;
const maxElevation = 3158;
const center = Cesium.Rectangle.center(rectangle);
center.height = (minElevation + maxElevation) / 2;
const geodesic = new Cesium.EllipsoidGeodesic(
  Cesium.Cartographic.fromRadians(rectangle.west, rectangle.south),
  Cesium.Cartographic.fromRadians(rectangle.east, rectangle.south),
);
const geodesic2 = new Cesium.EllipsoidGeodesic(
  Cesium.Cartographic.fromRadians(rectangle.west, rectangle.south),
  Cesium.Cartographic.fromRadians(rectangle.west, rectangle.north),
);

const modelMatrix = generateModelMatrix(
  Cesium.Cartographic.toCartesian(center),
  [90, 0, 0],
  [
    geodesic.surfaceDistance,
    maxElevation - minElevation,
    geodesic2.surfaceDistance,
  ],
);

const drawPrimitive = new CustomPrimitive({
  commandType: "Draw",
  uniformMap: {
    iResolution: () => {
      return resolution;
    },
    iChannel0: () => {
      return texC;
    },
    iChannel1: () => {
      return terrainMap;
    },
    heightRange: () => {
      return new Cesium.Cartesian2(minElevation, maxElevation);
    },
  },
  geometry,
  modelMatrix,
  vertexShaderSource: RENDER_SHADER_VERTEX_SOURCE,
  fragmentShaderSource: COMMON + RENDER_SHADER_FRAGMENT_SOURCE,
  pass: Cesium.Pass.TRANSLUCENT,
  rawRenderState: Cesium.Appearance.getDefaultRenderState(),
});

const debugPrimitive = new Cesium.Primitive({
  geometryInstances: new Cesium.GeometryInstance({
    geometry: boxGeometry,
    modelMatrix,
  }),
  appearance: new Cesium.MaterialAppearance({
    material: new Cesium.Material({
      fabric: {
        type: "Color",
        uniforms: {
          color: new Cesium.Color(1, 1, 0, 0.3),
        },
      },
    }),
  }),
});
debugPrimitive.show = true;

viewer.scene.primitives.add(computeA);
viewer.scene.primitives.add(computeB);
viewer.scene.primitives.add(computeC);
viewer.scene.primitives.add(computeD);
viewer.scene.primitives.add(drawPrimitive);
viewer.scene.primitives.add(debugPrimitive);

viewer.scene.postRender.addEventListener(() => {
  const now = performance.now();
  time = now / 1000;
  frame += 0.02;
});
