import assert from "node:assert/strict";

import VectorTileStyleZoomUtils from "../src/VectorTileStyleZoomUtils.js";

const highCameraZoom =
  VectorTileStyleZoomUtils.computeCameraVectorTileStyleZoom({
    camera: {
      positionCartographic: {
        latitude: 0,
        height: 1000000,
      },
      frustum: {
        fovy: Math.PI / 3,
      },
    },
    context: {
      drawingBufferHeight: 1000,
    },
  });
const lowCameraZoom = VectorTileStyleZoomUtils.computeCameraVectorTileStyleZoom(
  {
    camera: {
      positionCartographic: {
        latitude: 0,
        height: 10000,
      },
      frustum: {
        fovy: Math.PI / 3,
      },
    },
    context: {
      drawingBufferHeight: 1000,
    },
  },
);
assert.ok(lowCameraZoom > highCameraZoom);

const terrainAdjustedZoom =
  VectorTileStyleZoomUtils.computeCameraVectorTileStyleZoom(
    {
      camera: {
        positionCartographic: {
          latitude: 0,
          height: 10000,
        },
        frustum: {
          fovy: Math.PI / 3,
        },
      },
      context: {
        drawingBufferHeight: 1000,
      },
    },
    {
      scene: {
        globe: {
          getHeight: () => 9000,
        },
      },
    },
  );
assert.ok(terrainAdjustedZoom > lowCameraZoom);

console.log("VectorTileStyleZoom tests passed.");
