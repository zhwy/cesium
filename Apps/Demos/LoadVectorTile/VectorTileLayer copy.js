import * as Cesium from "../../../../Build/CesiumUnminified/index.js";
import TileType from "./TileType.js";

const defaultOptions = {
  tilingScheme: "WebMercatorTilingScheme",
  dataTypeField: "type",
  dataIdField: "id",
  minimumLevel: 0,
  maximumLevel: 18,
  tileType: TileType.XYZ,
  format: "application/vnd.mapbox-vector-tile",
  url: "",
  layer: "",
  colors: {
    DEFAULT: "#FF0000",
  },
};

export default class VectorTileLayer {
  get quadtreePrimitive() {
    return this._layer.quadtreePrimitive;
  }

  get primitives() {
    return this._layer.primitives;
  }

  get show() {
    return this._show;
  }

  set show(value) {
    this._show = value;
    this._layer.primitives.show = value;
  }

  constructor(imageryProvider, options) {
    this._option = { ...defaultOptions, ...options };
    this._styleLayer = (this._option.layer || "").replace(/(.*:)/g, "");
    this.visible = true;
    const primitives = new Cesium.PrimitiveCollection();
    this._layer.primitives = primitives;
    this._imageryProvider = imageryProvider;
  }

  addToScene(scene) {
    if (!scene.primitives.contains(this.quadtreePrimitive)) {
      scene.primitives.add(this.quadtreePrimitive);
    }
    scene.primitives.add(this.primitives);
  }

  removeFromScene(scene) {
    this.primitives.removeAll();
    scene.primitives.remove(this.primitives);
    this.quadtreePrimitive.removeVisualizer(this);
    if (this.quadtreePrimitive.visualizers.length === 0) {
      scene.primitives.remove(this.quadtreePrimitive);
    }
  }

  requestTile(tile) {
    return this._imageryProvider.requestTile(tile);
  }

  renderTiles(quadtreePrimitive, frameState) {
    const eachTile = (tile) => {
      const features = this.tileFeatures(tile);
      if (tile.data && features.length > 0) {
        if (!tile.data.primitives[this._styleLayer]) {
          tile.data.primitives[this._styleLayer] = this.createTilePrimitive(
            features,
            {
              layerId: this.id,
              tile,
            },
          );
        }
        tile.data.primitives[this._styleLayer].forEach((primitive) => {
          primitive.update(frameState);
        });
      }
    };
    quadtreePrimitive._tilesToRender.forEach(eachTile);
  }

  destroyTile(tile) {
    if (tile.data.primitives) {
      Object.keys(tile.data.primitives).forEach((key) => {
        tile.data.primitives[key].forEach((primitive) => {
          // removeAttributes(primitive);
          primitive.destroy();
        });
        tile.data.primitives[key] = undefined;
        delete tile.data.primitives[key];
      });
      tile.data.layerFeatures[this._styleLayer] = undefined;
    }
  }

  /***
   * 从瓦片读取图层要素
   */
  tileFeatures(tile) {
    if (tile && tile.data && tile.data.layerFeatures) {
      return tile.data.layerFeatures[this._styleLayer] || [];
    }
    return [];
  }

  createTilePrimitive(features, options = {}) {
    const primitives = [];

    const sortedFeatures = {};
    features.forEach((f) => {
      const type = f.properties[this._option.dataTypeField];
      if (!sortedFeatures[type]) {
        sortedFeatures[type] = [];
      }
      sortedFeatures[type].push(f);
    });

    Object.keys(sortedFeatures).forEach((key) => {
      const features = sortedFeatures[key];
      const geometryInstances = this._buildGeometryInstancesByLevel(
        features,
        options.tile,
      );
      const primitive = new Cesium.Primitive({
        geometryInstances,
        appearance: this._createApperance(
          features[0].geometry.type,
          options.tile,
        ),
        shadows: Cesium.ShadowMode.ENABLED,
        allowPicking: true,
      });
      // setAttributes(primitive, {
      //   layerId: options.layerId,
      //   tag: {
      //     type: "pipeline",
      //     id: "",
      //     pipeType: key,
      //   },
      // });
      primitives.push(primitive);
    });

    return primitives;
  }

  _buildGeometryInstancesByLevel(features, tile) {
    // TODO 先测试线，后续支持图标、面
    const geometryInstances = [];
    features.forEach((feature) => {
      if (
        feature.geometry.type === "LineString" ||
        feature.geometry.type === "MultiLineString"
      ) {
        this._createPolylineGeometryInstances(feature, geometryInstances);
      }

      if (
        feature.geometry.type === "Polygon" ||
        feature.geometry.type === "MultiPolygon"
      ) {
        this._createPolygonGeometryInstances(feature, geometryInstances);
      }
    });
    return geometryInstances;
  }

  _createApperance(type, tile) {
    if (type === "LineString" || type === "MultiLineString") {
      return new Cesium.PolylineColorAppearance();
    }
    if (type === "Polygon" || type === "MultiPolygon") {
      return new Cesium.PerInstanceColorAppearance({
        flat: true,
      });
    }
  }

  _createPolylineGeometryInstances(feature, list) {
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
        width: this._option.lineWidth || 5,
      });
      list.push(
        new Cesium.GeometryInstance({
          geometry: polyline,
          attributes: {
            color: Cesium.ColorGeometryInstanceAttribute.fromColor(
              Cesium.Color.fromCssColorString(this._option.colors.DEFAULT),
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

  _createPolygonGeometryInstances(feature, list) {
    const { geometry } = feature;
    const processFunction = (coordinates) => {
      const positions = coordinates[0].map((c) => {
        return Cesium.Cartesian3.fromDegrees(c[0], c[1]);
      });
      const holes = coordinates.slice(1).map((hole) => {
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
              Cesium.Color.fromCssColorString(this._option.colors.DEFAULT),
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
}
