import * as Cesium from "../../../../Build/CesiumUnminified/index.js";
import TileType from "./TileType.js";

const defaultOptions = {
  tilingScheme: "WebMercatorTilingScheme",
  dataTypeField: "",
  dataIdField: "id",
  minimumTerrainLevel: 0,
  maximumTerrainLevel: 18,
  tileType: TileType.XYZ,
  format: "application/vnd.mapbox-vector-tile",
  url: "",
  styles: {},
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
    this._styles = options.styles || {};
    this._vectorTileProvider = vectorTileProvider;

    this._readyEvent = new Cesium.Event();
    this._errorEvent = new Cesium.Event();
  }

  requestTile(tile) {
    return this._vectorTileProvider.requestTile(tile);
  }

  renderTile(tile, frameState) {
    if (tile.data) {
      Object.keys(this._styles).forEach((key) => {
        if (!tile.data.primitives[key]) {
          const features = this.getFeatures(tile, key);
          if (features.length) {
            tile.data.primitives[key] = this.createTilePrimitive(
              features,
              tile,
              this._styles[key],
            );
          }
        }
        tile.data.primitives[key]?.forEach((primitive) => {
          primitive.update(frameState);
        });
      });
    }
  }

  /***
   * 从瓦片读取图层要素
   */
  getFeatures(tile, layerName) {
    if (tile && tile.data && tile.data.layerFeatures) {
      return tile.data.layerFeatures[layerName] || [];
    }
    return [];
  }

  createTilePrimitive(features, tile, style) {
    const geometryInstances = this._buildGeometryInstancesByLevel(
      features,
      style,
      tile,
    );
    const primitive = new Cesium.Primitive({
      geometryInstances,
      appearance: this._createApperance(features[0].geometry.type, style, tile),
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

  _buildGeometryInstancesByLevel(features, style, tile) {
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

  _createApperance(type, style, tile) {
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
