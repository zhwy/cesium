import { VectorTile as VT } from "https://cdn.jsdelivr.net/npm/@mapbox/vector-tile@2.0.3/+esm";
import Protobuf from "https://cdn.jsdelivr.net/npm/pbf/+esm";
import * as Cesium from "../../../../Build/CesiumUnminified/index.js";
import TileType from "./TileType.js";
import VectorTile from "./VectorTile.js";
import TileVectorTile from "./TileVectorTile.js";

const defaultOptions = {
  tilingScheme: "WebMercatorTilingScheme",
  dataTypeField: "type",
  dataIdField: "id",
  minimumTerrainLevel: 0,
  maximumTerrainLevel: 18,
  tileType: TileType.XYZ,
  format: "application/vnd.mapbox-vector-tile",
  url: "",
};

export default class VectorTileLayer {
  get show() {
    return this._show;
  }

  set show(value) {
    this._show = value;
  }

  get vectorTileProvider() {
    return this._vectorTileProvider;
  }

  get readyEvent() {
    return this._readyEvent;
  }

  get errorEvent() {
    return this._errorEvent;
  }

  get ready() {
    return Cesium.defined(this._vectorTileProvider);
  }

  constructor(vectorTileProvider, options) {
    this._show = true;
    this._option = { ...defaultOptions, ...options };
    this._styleLayer = (this._option.layer || "").replace(/(.*:)/g, "");
    this._styles = options.styles || {};
    this._vectorTileProvider = vectorTileProvider;
    this._vectorTileCache = {};

    this._readyEvent = new Cesium.Event();
    this._errorEvent = new Cesium.Event();
  }

  getVectorTileFromCache(x, y, level, rectangle) {
    const cacheKey = getVectorTileCacheKey(x, y, level);
    let vectorTile = this._vectorTileCache[cacheKey];

    if (!Cesium.defined(vectorTile)) {
      vectorTile = new VectorTile(this, x, y, level, rectangle);
      this._vectorTileCache[cacheKey] = vectorTile;
    }

    vectorTile.addReference();
    return vectorTile;
  }

  removeVectorTileFromCache(vectorTile) {
    const cacheKey = getVectorTileCacheKey(
      vectorTile.x,
      vectorTile.y,
      vectorTile.level,
    );
    delete this._vectorTileCache[cacheKey];
  }

  _requestTile(vectorTile) {
    vectorTile.state = Cesium.ImageryState.TRANSITIONING;
    const vectorTileProvider = this._vectorTileProvider;
    const promise = vectorTileProvider.requestTile(vectorTile);
    if (promise) {
      promise
        .then((arrayBuffer) => {
          vectorTile.arrayBuffer = arrayBuffer;
          vectorTile.state = Cesium.ImageryState.RECEIVED;
        })
        .catch((e) => {
          vectorTile.state = Cesium.ImageryState.FAILED;
        });
    }
  }

  _createTilePrimitives(vectorTile) {
    if (vectorTile.arrayBuffer) {
      const vt = new VT(new Protobuf(vectorTile.arrayBuffer));
      const layerFeatures = readVectorTile(vectorTile, vt);
      vectorTile.primitives = {};
      Object.keys(this._styles).forEach((key) => {
        const style = this._styles[key];
        const features = layerFeatures[key] || [];
        if (features.length) {
          vectorTile.primitives[key] = this._createTilePrimitive(
            features,
            style,
          );
        }
      });

      vectorTile.arrayBuffer = undefined;
      vectorTile.state = Cesium.ImageryState.READY;
    }
  }

  _bindQuadtreeTile(tile, index) {
    const surfacecTile = tile.data;
    if (!Cesium.defined(index)) {
      index = surfacecTile.tileVectorTiles.length;
    }
    const vectorTile = this.getVectorTileFromCache(tile.x, tile.y, tile.level);
    surfacecTile.tileVectorTiles.splice(
      index,
      0,
      new TileVectorTile(vectorTile),
    );
  }

  _createTilePrimitive(features, style) {
    const geometryInstances = this._buildGeometryInstancesByLevel(
      features,
      style,
    );
    const primitive = new Cesium.Primitive({
      geometryInstances,
      appearance: this._createApperance(features[0].geometry.type, style),
      shadows: Cesium.ShadowMode.ENABLED,
      allowPicking: true,
      asynchronous: false,
    });
    // setAttributes(primitive, {
    //   layerId: options.layerId,
    //   tag: {
    //     type: "pipeline",
    //     id: "",
    //     pipeType: key,
    //   },
    // });

    return [primitive];
  }

  _buildGeometryInstancesByLevel(features, style) {
    // TODO 先测试线，后续支持图标、面
    const geometryInstances = [];
    features.forEach((feature) => {
      if (
        feature.geometry.type === "LineString" ||
        feature.geometry.type === "MultiLineString"
      ) {
        this._createPolylineGeometryInstances(
          feature,
          style,
          geometryInstances,
        );
      }

      if (
        feature.geometry.type === "Polygon" ||
        feature.geometry.type === "MultiPolygon"
      ) {
        this._createPolygonGeometryInstances(feature, style, geometryInstances);
      }
    });
    return geometryInstances;
  }

  _createPolylineGeometryInstances(feature, style, list) {
    const { geometry } = feature;
    const processFunction = (coordinates) => {
      if (coordinates.length < 2) {
        return;
      }
      const positions = coordinates.map((c) => {
        return Cesium.Cartesian3.fromDegrees(c[0], c[1]);
      });
      const polyline = new Cesium.PolylineGeometry({
        positions,
        width: style.lineWidth ?? 2,
      });
      list.push(
        new Cesium.GeometryInstance({
          geometry: polyline,
          attributes: {
            color: Cesium.ColorGeometryInstanceAttribute.fromColor(
              Cesium.Color.fromCssColorString(style.lineColor || "#ff0000"),
            ),
          },
        }),
      );
    };
    if (geometry.type === "LineString") {
      processFunction(geometry.coordinates);
    } else if (geometry.type === "MultiLineString") {
      geometry.coordinates.forEach((coordinates) => {
        processFunction(coordinates);
      });
    }
  }

  _createPolygonGeometryInstances(feature, style, list) {
    const { geometry } = feature;
    const processFunction = (coordinates) => {
      if (coordinates.length < 1 || coordinates[0].length < 3) {
        return;
      }
      const positions = coordinates[0].map((c) => {
        return Cesium.Cartesian3.fromDegrees(c[0], c[1]);
      });
      const holes = coordinates
        .slice(1)
        .filter((c) => c.length > 3)
        .map((hole) => {
          return new Cesium.PolygonHierarchy(
            hole.map((c) => {
              return Cesium.Cartesian3.fromDegrees(c[0], c[1]);
            }),
          );
        });
      const polygon = new Cesium.PolygonGeometry({
        polygonHierarchy: new Cesium.PolygonHierarchy(positions, holes),
      });
      list.push(
        new Cesium.GeometryInstance({
          geometry: polygon,
          attributes: {
            color: Cesium.ColorGeometryInstanceAttribute.fromColor(
              Cesium.Color.fromCssColorString(style.fillColor || "#ff000077"),
            ),
          },
        }),
      );
    };
    if (geometry.type === "Polygon") {
      processFunction(geometry.coordinates);
    } else if (geometry.type === "MultiPolygon") {
      geometry.coordinates.forEach((coordinates) => {
        processFunction(coordinates);
      });
    }
  }

  _createApperance(type, style) {
    if (type === "LineString" || type === "MultiLineString") {
      return new Cesium.PolylineColorAppearance();
    }
    if (type === "Polygon" || type === "MultiPolygon") {
      return new Cesium.EllipsoidSurfaceAppearance({
        flat: true,
        material: Cesium.Material.fromType("Color", {
          color: Cesium.Color.fromCssColorString(
            style.fillColor || "#ff000077",
          ),
        }),
      });
    }
  }
}

function getVectorTileCacheKey(x, y, level) {
  return JSON.stringify([x, y, level]);
}

function readVectorTile(tile, vt) {
  const layerFeatures = {};
  for (const layer in vt.layers) {
    if (vt.layers.hasOwnProperty(layer)) {
      const vectorTileLayer = vt.layers[layer];
      if (vectorTileLayer) {
        layerFeatures[layer] = vectorTileLayer._features.map((f, i) =>
          vectorTileLayer.feature(i).toGeoJSON(tile.x, tile.y, tile.level),
        );
      }
    }
  }
  return layerFeatures;
}
