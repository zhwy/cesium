import protobuf from "protobufjs/dist/minimal/protobuf.js";
import Cartographic from "../../../../packages/core/Source/Cartographic.js";
import Ellipsoid from "../../../../packages/core/Source/Ellipsoid.js";
import Rectangle from "../../../../packages/core/Source/Rectangle.js";
import destroyObject from "../../../../packages/core/Source/destroyObject.js";
import WebMercatorTilingScheme from "../../../../packages/engine/Source/Core/WebMercatorTilingScheme.js";
import Axis from "../../../../packages/engine/Source/Scene/Axis.js";
import Cesium3DTileset from "../../../../packages/engine/Source/Scene/Cesium3DTileset.js";
import Empty3DTileContent from "../../../../packages/engine/Source/Scene/Empty3DTileContent.js";
import VectorGltf3DTileContent from "../../../../packages/engine/Source/Scene/VectorGltf3DTileContent.js";
import buildVectorGltfFromMVT from "../../../../packages/engine/Source/Scene/buildVectorGltfFromMVT.js";
import decodeMVT from "../../../../packages/engine/Source/Scene/decodeMVT.js";
import VectorTileDiagnostics from "./VectorTileDiagnostics.js";
import VectorTileFeatureStateUtils from "./VectorTileFeatureStateUtils.js";
import VectorTilePropertyProjectionUtils from "./VectorTilePropertyProjectionUtils.js";
import VectorTileStyleExpressionUtils from "./VectorTileStyleExpressionUtils.js";

// 仅供 benchmark。升级引擎时需回归这些私有接口：
// _runtimeContentCodec、_modelUpAxis、_modelForwardAxis。
// 阶段 1 在主线程构建，使用瓦片 z 过滤样式；不处理点、outline 和样式热更新。

export function buildVectorGltfTilesetJson(url, options = {}) {
  const { minZoom = 0, maxZoom = 14, maximumNodes = 50000 } = options;
  if (
    !Number.isInteger(minZoom) ||
    !Number.isInteger(maxZoom) ||
    minZoom < 0 ||
    maxZoom < minZoom ||
    maxZoom > 30 ||
    !Number.isInteger(maximumNodes) ||
    maximumNodes < 1
  ) {
    throw new Error("无效的瓦片树层级或节点上限。");
  }
  const scheme = new WebMercatorTilingScheme();
  const extent = Rectangle.clone(options.extent ?? scheme.rectangle);
  if (
    ![extent.west, extent.south, extent.east, extent.north].every(
      Number.isFinite,
    ) ||
    extent.west >= extent.east ||
    extent.south >= extent.north ||
    extent.west < -Math.PI ||
    extent.east > Math.PI ||
    extent.south < scheme.rectangle.south ||
    extent.north > scheme.rectangle.north
  ) {
    throw new Error(
      "benchmark 范围必须在 Web Mercator 内，且不能跨日期变更线。",
    );
  }
  const ranges = [];
  let nodeCount = 1;
  // 先估算所有层，超限时不生成任何节点。
  for (let z = minZoom; z <= maxZoom; z++) {
    const nw = scheme.positionToTileXY(
      Cartographic.fromRadians(extent.west, extent.north),
      z,
    );
    const se = scheme.positionToTileXY(
      Cartographic.fromRadians(extent.east, extent.south),
      z,
    );
    nodeCount += (se.x - nw.x + 1) * (se.y - nw.y + 1);
    if (nodeCount > maximumNodes) {
      throw new Error(
        `瓦片树超过节点上限 ${maximumNodes}，请缩小 extent 或 maxZoom。`,
      );
    }
    ranges.push({ nw, se });
  }
  const error = (2 * Math.PI * Ellipsoid.WGS84.maximumRadius) / 256;
  const root = {
    boundingVolume: {
      region: [
        extent.west,
        extent.south,
        extent.east,
        extent.north,
        -1000,
        10000,
      ],
    },
    geometricError: error,
    refine: "REPLACE",
    children: [],
  };
  let parents = new Map();
  for (let z = minZoom; z <= maxZoom; z++) {
    const { nw, se } = ranges[z - minZoom];
    const nodes = new Map();
    for (let y = nw.y; y <= se.y; y++) {
      for (let x = nw.x; x <= se.x; x++) {
        const rectangle = scheme.tileXYToRectangle(x, y, z);
        const reverseY = 2 ** z - y - 1;
        const values = {
          z,
          x,
          y,
          "-y": reverseY,
          reverseY,
          TileMatrixSet: options.tileMatrixSetID,
          TileMatrix:
            options.tileMatrixLabels?.[z] ?? `${options.tileMatrixSetID}:${z}`,
          TileRow: y,
          TileCol: x,
          layer: options.layer,
          workspace: options.workspace,
          s:
            options.subdomains?.[(x + y + z) % options.subdomains.length] ?? "",
        };
        const uri = url.replace(/\{([^}]+)\}/g, (token, key) => {
          if (values[key] === undefined) {
            throw new Error(`未配置瓦片 URL 占位符 ${token}。`);
          }
          return String(values[key]);
        });
        const node = {
          boundingVolume: {
            region: [
              rectangle.west,
              rectangle.south,
              rectangle.east,
              rectangle.north,
              -1000,
              10000,
            ],
          },
          geometricError: z === maxZoom ? 0 : error / 2 ** z,
          refine: "REPLACE",
          content: {
            uri: new URL(uri, globalThis.document?.baseURI ?? import.meta.url)
              .href,
          },
          extras: { tileX: x, tileY: y, tileZ: z },
        };
        const parent =
          z === minZoom
            ? root
            : parents.get(`${Math.floor(x / 2)}/${Math.floor(y / 2)}`);
        (parent.children ??= []).push(node);
        nodes.set(`${x}/${y}`, node);
      }
    }
    parents = nodes;
  }
  return { asset: { version: "1.1" }, geometricError: error, root };
}

// 引擎 decodeMVT 跳过了 feature.id；补读字段 1，保持原生 id 过滤的语义。
export function decodeVectorGltfTile(arrayBuffer) {
  const decoded = decodeMVT(arrayBuffer);
  function readIds(reader, depth, target) {
    let index = 0;
    while (reader.pos < reader.len) {
      const tag = reader.uint32();
      if (depth === 2 && tag === 8) {
        target.id = Number(reader.uint64().toString());
      } else if ((depth === 0 && tag === 26) || (depth === 1 && tag === 18)) {
        const child =
          depth === 0 ? target.layers[index++] : target.features[index++];
        readIds(protobuf.Reader.create(reader.bytes()), depth + 1, child);
      } else {
        reader.skipType(tag & 7);
      }
    }
  }
  readIds(protobuf.Reader.create(new Uint8Array(arrayBuffer)), 0, decoded);
  return decoded;
}

export function prepareDecodedTileForStyle(decoded, z, rules, options = {}) {
  const layers = [];
  for (const rule of rules) {
    if (
      !["fill", "line"].includes(rule.type) ||
      rule.visibility === false ||
      z < (rule.minzoom ?? 0) ||
      z >= (rule.maxzoom ?? Infinity)
    ) {
      continue;
    }
    const layer = decoded.layers.find(
      (candidate) => candidate.name === rule.sourceLayer,
    );
    if (!layer) {
      continue;
    }
    const projection =
      VectorTilePropertyProjectionUtils.createVectorTilePropertyProjections(
        { layers: [rule] },
        { allowPicking: true, pickProperties: options.pickProperties ?? [] },
      )[rule.sourceLayer];
    const features = [];
    layer.features.forEach((feature, index) => {
      if (feature.type !== "LineString" && feature.type !== "Polygon") {
        return;
      }
      const { id } = VectorTileFeatureStateUtils.resolveFeatureStateId(
        layer.name,
        feature,
        options.promoteId,
      );
      if (
        !VectorTileStyleExpressionUtils.evaluateVectorStyleFilter(
          rule.filter,
          { ...feature, id },
          { zoom: z, level: z },
        )
      ) {
        return;
      }
      let geometry = feature.geometry;
      if (rule.type === "fill" && feature.type === "LineString") {
        // 每条线独立作为外环；统一绕序，避免被 glTF 构建器误认作洞。
        geometry = geometry
          .filter((line) => line.length >= 3)
          .map((line) => {
            const ring = line.slice();
            const area = ring.reduce((sum, point, i) => {
              const previous = ring[(i + ring.length - 1) % ring.length];
              return sum + (previous.x + point.x) * (previous.y - point.y);
            }, 0);
            if (area > 0) {
              ring.reverse();
            }
            const first = ring[0];
            const last = ring[ring.length - 1];
            if (first.x !== last.x || first.y !== last.y) {
              ring.push({ ...first });
            }
            return ring;
          });
      }
      if (geometry.length > 0) {
        const properties =
          VectorTilePropertyProjectionUtils.projectVectorTileProperties(
            feature.properties,
            projection,
          );
        properties._fid = `${rule.id}:${index}`;
        if (id !== undefined) {
          properties._id = id;
        }
        features.push({
          type: rule.type === "fill" ? "Polygon" : "LineString",
          geometry,
          properties,
        });
      }
    });
    if (features.length > 0) {
      layers.push({ name: rule.id, extent: layer.extent, features });
    }
  }
  return { layers };
}

class VectorGltfTilesetProvider {
  constructor(tileset, options = {}) {
    this.tileset = tileset;
    this._options = options;
    this.diagnostics = new VectorTileDiagnostics(true);
    tileset._modelUpAxis = Axis.Z;
    tileset._modelForwardAxis = Axis.X;
    tileset._runtimeContentCodec = {
      contentType: "mvt",
      missingTilePolicy: { statusCodes: [404, 204] },
      createContent: (tileset, tile, resource, buffer) =>
        this._createContent(tileset, tile, resource, buffer),
    };
  }

  static async fromUrl(url, options = {}) {
    const json = buildVectorGltfTilesetJson(url, options);
    const blobUrl = URL.createObjectURL(
      new Blob([JSON.stringify(json)], { type: "application/json" }),
    );
    try {
      const tileset = await Cesium3DTileset.fromUrl(blobUrl, {
        skipLevelOfDetail: false,
        enablePick: true,
        featureIdLabel: "featureId_0",
        instanceFeatureIdLabel: "instanceFeatureId_0",
        heightReference: options.heightReference,
        scene: options.scene,
      });
      return new this(tileset, options);
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  }

  async _createContent(tileset, tile, resource, buffer) {
    const diagnostics = this.diagnostics;
    const coords = tile.extras;
    diagnostics.increment("decodedTiles");
    diagnostics.increment(`decodedTilesAtLevel${coords.tileZ}`);
    let start = diagnostics.startTimer();
    const decoded = decodeVectorGltfTile(buffer);
    diagnostics.recordDuration("decode", start);
    diagnostics.increment(
      "decodedFeatures",
      decoded.layers.reduce((sum, layer) => sum + layer.features.length, 0),
    );
    start = diagnostics.startTimer();
    const prepared = prepareDecodedTileForStyle(
      decoded,
      coords.tileZ,
      this._options.rules ?? [],
      this._options,
    );
    diagnostics.recordDuration("filter", start);
    // 按 rule 计数，同一原始要素命中多个 rule 时分别计入构建工作量。
    diagnostics.increment(
      "filteredFeatures",
      prepared.layers.reduce((sum, layer) => sum + layer.features.length, 0),
    );
    start = diagnostics.startTimer();
    const glb = buildVectorGltfFromMVT(prepared, coords, {
      featureIdProperty: "_fid",
    });
    diagnostics.recordDuration("buildGltf", start);
    diagnostics.increment("glbBytes", glb?.byteLength ?? 0);
    return glb
      ? VectorGltf3DTileContent.fromGltf(tileset, tile, resource, glb)
      : new Empty3DTileContent(tileset, tile);
  }

  get show() {
    return this.tileset.show;
  }
  set show(value) {
    this.tileset.show = value;
  }
  update(frameState) {
    this.tileset.update(frameState);
  }
  prePassesUpdate(frameState) {
    this.tileset.prePassesUpdate(frameState);
  }
  postPassesUpdate(frameState) {
    this.tileset.postPassesUpdate(frameState);
  }
  updateForPass(frameState, passState) {
    this.tileset.updateForPass(frameState, passState);
  }
  isDestroyed() {
    return false;
  }
  destroy() {
    this.tileset.destroy();
    return destroyObject(this);
  }
}

export default VectorGltfTilesetProvider;
