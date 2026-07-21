import defined from "../../../../packages/engine/Source/Core/defined.js";
import DeveloperError from "../../../../packages/engine/Source/Core/DeveloperError.js";
import Resource from "../../../../packages/engine/Source/Core/Resource.js";
import WebMercatorTilingScheme from "../../../../packages/engine/Source/Core/WebMercatorTilingScheme.js";
import CommonUtils from "./CommonUtils.js";
import VectorTileTaskScheduler from "./VectorTileTaskScheduler.js";
import VectorTileStyleUtils from "./VectorTileStyleUtils.js";

let mvtLoaderInstance;

/**
 * 统一封装 MVT 二进制请求调度的轻量级加载器单例。
 *
 * @param {*} [cacheStore] 预留的缓存存储对象，当前实现未启用。
 */
function MVTLoader(cacheStore) {
  // 预留外部缓存存储接入点，当前版本尚未启用。
}

MVTLoader.prototype.load = function (
  resource,
  scheduler,
  priority,
  diagnostics,
) {
  return scheduler.schedule((context) => {
    const promise = resource.fetchArrayBuffer();
    context.onCancel(() => resource.request?.cancel());
    return Promise.resolve(promise).then((arrayBuffer) => {
      if (arrayBuffer instanceof ArrayBuffer) {
        diagnostics?.increment("downloadedBytes", arrayBuffer.byteLength);
      }
      return arrayBuffer;
    });
  }, priority);
};

MVTLoader.prototype.clearCache = function () {
  // 预留缓存清理入口，当前版本尚未启用。
};

MVTLoader.instance = function () {
  if (!mvtLoaderInstance) {
    mvtLoaderInstance = new MVTLoader();
    // 这里预留了接入 IndexedDB 缓存的扩展位置，当前默认关闭。
  }
  return mvtLoaderInstance;
};

// 初始化加载器单例。
MVTLoader.instance();

/**
 * 矢量瓦片数据源的基类，负责统一管理来源配置、层级范围和网络请求入口。
 *
 * @param {object} [options={}] 构造参数。
 * @param {string} [options.url] 瓦片服务地址模板。
 * @param {object} [options.tilingScheme] Cesium 瓦片切片方案。
 * @param {number} [options.minimumLevel=0] 可请求的最小层级。
 * @param {number} [options.maximumLevel=18] 可请求的最大层级。
 * @param {object} [options.networkScheduler] 网络调度器。
 * @param {VectorTilePbfCache} [options.pbfCache] manager 共享的原始 PBF 缓存。
 * @param {string} [options.pbfCacheNamespace] 自定义 PBF source namespace。
 * @param {string} [options.sourceId] 数据源标识。
 * @param {string} [options.styleSourceId] 样式文档中的数据源标识。
 * @param {object} [options.source] 单个数据源定义。
 * @param {object} [options.styleDocument] 完整样式文档；提供后会自动抽取当前 source 对应内容。
 * @param {object[]} [options.styleRules] 当未传入 `styleDocument` 时，可直接提供样式规则数组。
 */
function VectorTileProvider(options = {}) {
  const sourceState = getProviderSourceState(options);
  this._sourceId = sourceState.sourceId;
  this._source = sourceState.source;
  this._options = {
    ...(this._source ?? {}),
    ...options,
  };
  if (this._sourceId) {
    this._options.sourceId = this._sourceId;
    this._options.styleSourceId = this._sourceId;
  }
  if (sourceState.styleDocument) {
    this._options.styleDocument = sourceState.styleDocument;
  }

  this._tilingScheme =
    this._options.tilingScheme ?? new WebMercatorTilingScheme();
  this._minimumLevel = this._options.minimumLevel ?? 0;
  this._maximumLevel = this._options.maximumLevel ?? 18;
  this._networkScheduler =
    this._options.networkScheduler ?? new VectorTileTaskScheduler(8);
  this._pbfCache = this._options.pbfCache;
  this._pbfCacheNamespace =
    this._options.pbfCacheNamespace ?? this._sourceId ?? "";
  this._diagnostics = this._options.diagnostics;

  this._resource = new Resource({
    url: this._options.url,
  });
}

Object.defineProperties(VectorTileProvider.prototype, {
  sourceId: {
    get: function () {
      return this._sourceId;
    },
  },
  source: {
    get: function () {
      return this._source;
    },
  },
  minimumLevel: {
    get: function () {
      return this._minimumLevel;
    },
  },
  maximumLevel: {
    get: function () {
      return this._maximumLevel;
    },
  },
  tilingScheme: {
    get: function () {
      return this._tilingScheme;
    },
  },
  resource: {
    get: function () {
      return this._resource;
    },
    set: function (val) {
      this._resource = val;
    },
  },
});

/**
 * 子类需实现此方法
 * @param {*} tile
 */
VectorTileProvider.prototype.getTileResource = function (tile) {};

VectorTileProvider.prototype.isTileAvailable = function (level) {
  return level >= this._minimumLevel && level <= this._maximumLevel;
};

/**
 * 注入 manager 持有的共享 PBF cache。
 *
 * @param {VectorTilePbfCache} pbfCache 共享缓存。
 */
VectorTileProvider.prototype.setPbfCache = function (pbfCache) {
  this._pbfCache = pbfCache;
};

/**
 * 生成与样式内容代无关的 PBF key。带额外请求身份（例如租户 header）的
 * 自定义 provider 应覆盖此方法，并把完整数据身份纳入 key。
 *
 * @param {object} tile 瓦片坐标对象。
 * @param {Resource} resource 已解析模板值的请求资源。
 * @returns {string} PBF cache key。
 */
VectorTileProvider.prototype.getPbfCacheKey = function (tile, resource) {
  return JSON.stringify([
    this._pbfCacheNamespace,
    resource.url,
    tile.level,
    tile.x,
    tile.y,
  ]);
};

VectorTileProvider.prototype.requestTile = function (tile) {
  if (!this.isTileAvailable(tile.level)) {
    return;
  }

  const resource = this.getTileResource(tile);
  if (defined(resource)) {
    const load = (priority) =>
      MVTLoader.instance().load(
        resource,
        this._networkScheduler,
        priority,
        this._diagnostics,
      );
    if (this._pbfCache) {
      return this._pbfCache.getOrLoad(
        this.getPbfCacheKey(tile, resource),
        load,
        tile.priority,
      );
    }
    return load(tile.priority);
  }
};

VectorTileProvider.readVectorTile = function (tile, vectorTile) {
  const layerFeatures = {};
  for (const layer in vectorTile.layers) {
    if (vectorTile.layers.hasOwnProperty(layer)) {
      const vectorTileLayer = vectorTile.layers[layer];
      if (vectorTileLayer) {
        layerFeatures[layer] = vectorTileLayer._features.map((f, i) =>
          vectorTileLayer.feature(i).toGeoJSON(tile.x, tile.y, tile.level),
        );
      }
    }
  }
  return layerFeatures;
};

function getProviderSourceState(options) {
  if (!options.styleDocument) {
    const sourceId = options.sourceId ?? options.styleSourceId;
    const source = CommonUtils.isPlainObject(options.source)
      ? CommonUtils.cloneValue(options.source)
      : undefined;
    const styleRules = (options.styleRules ?? []).map(cloneStyleRule);
    return {
      sourceId,
      source,
      styleDocument:
        sourceId && source
          ? {
              version: 1,
              sources: {
                [sourceId]: CommonUtils.cloneValue(source),
              },
              layers: styleRules,
              metadata: {},
            }
          : undefined,
    };
  }

  const normalizedStyle = VectorTileStyleUtils.normalizeStyleDocument(
    options.styleDocument,
  );
  const sourceId = resolveProviderSourceId(options, normalizedStyle);
  const source = CommonUtils.cloneValue(normalizedStyle.sources[sourceId]);
  const styleRules = normalizedStyle.layers
    .filter((layer) => layer.source === sourceId)
    .map(cloneStyleRule);
  return {
    sourceId,
    source,
    styleDocument: {
      version: normalizedStyle.version,
      sources: {
        [sourceId]: CommonUtils.cloneValue(source),
      },
      layers: styleRules,
      metadata: CommonUtils.cloneValue(normalizedStyle.metadata ?? {}),
    },
  };
}

function resolveProviderSourceId(options, styleDocument) {
  const explicitSourceId = options.sourceId ?? options.styleSourceId;
  if (explicitSourceId) {
    if (!styleDocument.sources[explicitSourceId]) {
      throw new DeveloperError(
        `styleDocument does not contain source "${explicitSourceId}".`,
      );
    }
    return explicitSourceId;
  }

  const sourceIds = Object.keys(styleDocument.sources);
  if (sourceIds.length !== 1) {
    throw new DeveloperError(
      "styleDocument must contain exactly one source when sourceId is not provided.",
    );
  }
  return sourceIds[0];
}

function cloneStyleRule(styleRule) {
  return styleRuleToJSON(styleRule);
}

function styleRuleToJSON(styleRule) {
  if (typeof styleRule?.toJSON === "function") {
    return styleRule.toJSON();
  }
  return CommonUtils.cloneValue(styleRule);
}

export default VectorTileProvider;
