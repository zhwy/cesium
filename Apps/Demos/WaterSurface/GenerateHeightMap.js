import * as Cesium from "../../../Build/CesiumUnminified/index.js";

// 计算点所在瓦片的行列号
function lonLatToTileXY(lonRad, latRad, level) {
  const x = Math.floor(
    ((lonRad + Math.PI) / (2 * Math.PI)) * Math.pow(2, level + 1),
  );
  const y = Math.floor(((Math.PI / 2 - latRad) / Math.PI) * Math.pow(2, level));

  return { x, y };
}

function requestTileGeometry(
  terrainProvider,
  rectangle,
  lonPerPixel,
  latPerPixel,
  x,
  y,
  level,
  width,
  height,
  heightMap,
) {
  return new Promise((resolve) => {
    terrainProvider.requestTileGeometry(x, y, level).then((terrainData) => {
      let min = Number.POSITIVE_INFINITY;
      let max = Number.NEGATIVE_INFINITY;
      if (terrainData) {
        const tileRange = terrainProvider.tilingScheme.tileXYToRectangle(
          x,
          y,
          level,
        );
        const minX = Math.max(rectangle.west, tileRange.west);
        const minY = Math.max(rectangle.south, tileRange.south);
        const maxX = Math.min(rectangle.east, tileRange.east);
        const maxY = Math.min(rectangle.north, tileRange.north);
        for (let i = minX; i <= maxX; i += lonPerPixel) {
          for (let j = minY; j <= maxY; j += latPerPixel) {
            const u = Math.floor((i - rectangle.west) / lonPerPixel);
            const v = Math.floor((j - rectangle.south) / latPerPixel);
            const elevation = terrainData.interpolateHeight(tileRange, i, j);
            heightMap[v * width + u] = elevation;
            min = Math.min(min, elevation);
            max = Math.max(max, elevation);
          }
        }
      }
      resolve({
        maxElevation: max,
        minElevation: min,
      });
    });
  });
}

function generateHeightMap(
  viewer,
  rectangle,
  level,
  width = 512,
  height = 512,
) {
  const terrainProvider = viewer.terrainProvider;

  const leftTop = lonLatToTileXY(rectangle.west, rectangle.north, level);
  const rightBottom = lonLatToTileXY(rectangle.east, rectangle.south, level);
  const lonPerPixel = rectangle.width / width;
  const latPerPixel = rectangle.height / height;
  const arrayBufferView = new Float32Array(width * height);
  const promises = [];

  for (let x = leftTop.x; x <= rightBottom.x; x++) {
    for (let y = leftTop.y; y <= rightBottom.y; y++) {
      promises.push(
        requestTileGeometry(
          terrainProvider,
          rectangle,
          lonPerPixel,
          latPerPixel,
          x,
          y,
          level,
          width,
          height,
          arrayBufferView,
        ),
      );
    }
  }

  return Promise.all(promises).then((datas) => {
    let maxElevation = Number.NEGATIVE_INFINITY;
    let minElevation = Number.POSITIVE_INFINITY;
    datas.forEach((data) => {
      maxElevation = Math.max(maxElevation, data.maxElevation);
      minElevation = Math.min(minElevation, data.minElevation);
    });
    arrayBufferView.forEach((elevation, index) => {
      arrayBufferView[index] =
        (elevation - minElevation) / (maxElevation - minElevation);
    });

    return {
      heightMap: new Cesium.Texture({
        context: viewer.scene.context,
        width,
        height,
        pixelFormat: Cesium.PixelFormat.RED,
        pixelDatatype: Cesium.PixelDatatype.FLOAT,
        flipY: true,
        sampler: new Cesium.Sampler({
          minificationFilter: Cesium.TextureMinificationFilter.LINEAR,
          magnificationFilter: Cesium.TextureMagnificationFilter.LINEAR,
          wrapS: Cesium.TextureWrap.CLAMP_TO_EDGE,
          wrapT: Cesium.TextureWrap.CLAMP_TO_EDGE,
        }),
        source: {
          arrayBufferView,
        },
      }),
      minElevation,
      maxElevation,
    };
  });
}

export default generateHeightMap;
