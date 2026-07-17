# Cesium 矢量瓦片加载框架

本目录是一套基于 Cesium 四叉树调度的实验性 MVT/PBF 矢量瓦片加载框架。它不使用 `ImageryProvider` 把矢量绘制到 Canvas，而是将 MVT 几何转换为 Cesium `Primitive`，直接参与场景渲染、裁剪和拾取。

当前框架包含：

- XYZ/TMS 和 WMTS 地址生成；
- Cesium 四叉树可见瓦片选择；
- 有界网络、解码、建模任务队列；
- Web Worker MVT 解码；
- 瓦片 buffer 线面裁剪；
- `GeometryInstance` 和实验性 packed Geometry 两种线渲染后端；
- 父级回退、LOD 去重、无缝样式刷新、渲染缓存和 manager 级原始 PBF 内存缓存；
- 性能诊断和 A/B 基准测试。

## 文件结构与入口

当前目录已经从早期 `src_test` 结构整理为更接近 Demo 模块的布局：

```text
Apps/Demos/LoadVectorTile/
├── index.html              # Demo 页面入口
├── README.md               # 当前说明文档
├── STYLE.md                # 完整样式参考
├── TODO.txt                # 临时待办记录
├── src/                    # 31 个运行时文件（整套 Demo 共 35 个顶层/运行时文件）
│   ├── VectorTileLayerManager.js
│   ├── VectorTileLayerCollection.js
│   ├── VectorTileLayer.js
│   ├── VectorTileStyleUtils.js
│   ├── VectorTileStyleRule.js
│   ├── VectorTileStyleExpression.js
│   ├── VectorTileStyleZoom.js
│   ├── VectorTileProvider.js
│   ├── VectorTileQuadtreePrimitive.js
│   ├── VectorTileQuadtreeProvider.js
│   ├── VectorSurfaceTile.js
│   ├── TileVectorTile.js
│   ├── VectorTile.js
│   ├── VectorTileLodSelection.js
│   ├── VectorTileDecoder.js
│   ├── VectorTileDecodeWorker.js
│   ├── decodeVectorTile.js
│   ├── VectorTileGeometryUtils.js
│   ├── VectorTileGeometryPlacement.js
│   ├── VectorTileBucketFactory.js
│   ├── VectorTileBucketUtils.js
│   ├── VectorTileFillBucket.js
│   ├── VectorTileLineBucket.js
│   ├── VectorTileSymbolBucket.js
│   ├── SharedPointCollections.js
│   ├── VectorTileTaskScheduler.js
│   ├── VectorTileCache.js
│   ├── VectorTilePbfCache.js
│   ├── VectorTileDiagnostics.js
│   └── VectorTileBenchmark.js
├── test/                   # 轻量 Node 单元测试
│   ├── SharedPointCollections.test.js
│   ├── VectorStyleExpression.test.js
│   ├── VectorTile.test.js
│   ├── VectorTileBucketFactory.test.js
│   ├── VectorTileBucketUtils.test.js
│   ├── VectorTileCache.test.js
│   ├── VectorTileDiagnostics.test.js
│   ├── VectorTileCircleBucket.test.js
│   ├── VectorTileFillBucket.test.js
│   ├── VectorTileGeometry.test.js
│   ├── VectorTileGeometryPlacement.test.js
│   ├── VectorTileLayer.test.js
│   ├── VectorTileLayerManager.test.js
│   ├── VectorTileLineBucket.test.js
│   ├── VectorTileLodSelection.test.js
│   ├── VectorTilePrimitiveBucket.test.js
│   ├── VectorTileProvider.test.js
│   ├── VectorTilePbfCache.test.js
│   ├── VectorTileQuadtreePrimitive.test.js
│   ├── VectorTileStyle.test.js
│   ├── VectorTileStyleZoom.test.js
│   └── VectorTileSymbolBucket.test.js
└── src_old/                # 旧实验版本备份，仅作对照
```

日常调试入口是 `index.html`。运行时代码统一放在 `src/`，测试统一放在 `test/`；`src_old/` 不参与当前主链路。

## 1. 整体架构

```text
index.html
        │
        ▼
VectorTileLayerManager
        ├── _createProvider()
        ├── VectorTilePbfCache（所有 source 共享原始 PBF）
        ├── VectorTileLayerCollection
        │       ├── VectorTileLayer
        │       │       ├── VectorTileProvider
        │       │       │       ├── TileType / MVTLoader
        │       │       │       └── XYZ / WMTS / WMTSGeo
        │       │       ├── VectorTileCache
        │       │       └── network/decode/build 调度器
        │
        └── VectorTileQuadtreePrimitive
                └── VectorTileQuadtreeProvider
                        └── VectorSurfaceTile
                                └── TileVectorTile
                                        └── VectorTile

网络请求
  → VectorTileProvider.requestTile()
  → VectorTilePbfCache（ready hit / pending join / MVTLoader miss）
  → VectorTileDecoder
  → VectorTileDecodeWorker
  → decodeVectorTile
  → TypedArray 几何桶
  → Cesium Primitive
```

框架的核心边界如下：

1. Cesium 四叉树负责决定当前视角需要哪些 `(x, y, level)`。
2. Provider 负责把瓦片坐标转换成实际请求地址。
3. Worker 负责解码 PBF、裁剪 buffer 并生成紧凑 TypedArray。
4. Layer 负责把 TypedArray 转换为 Cesium 几何和 Primitive。
5. QuadtreePrimitive 每帧只提交当前 LOD 应显示的 Primitive。

## 2. 加载时序

```text
相机变化
  ↓
Cesium QuadtreePrimitive 遍历可见瓦片
  ↓
VectorTileQuadtreeProvider.loadTile()
  ↓
VectorSurfaceTile 为每个可见图层绑定 VectorTile
  ↓
PBF cache 查询：ready 复制 / pending 合并 / network 请求
  ↓
decode 队列将 ArrayBuffer 转交 Web Worker
  ↓
Worker 仅解析 style document 中启用的 source layer
  ↓
裁剪到 [0, extent]，投影为经纬度，返回 TypedArray
  ↓
build 队列创建 GeometryInstance/packed Geometry
  ↓
VectorTile 进入 READY
  ↓
VectorTileQuadtreePrimitive.renderTiles() 提交 Primitive
```

### VectorTile 状态机

```text
UNLOADED
   │ 发起网络任务
   ▼
TRANSITIONING
   │ 下载完成
   ▼
RECEIVED
   │ Worker 解码与 Primitive 建模
   ▼
TRANSITIONING
   │
   ▼
READY
```

终止分支：

- `UNAVAILABLE`：层级不在 `minimumLevel/maximumLevel` 范围内；
- `EMPTY`：服务返回空瓦片；
- `FAILED`：网络请求失败；
- `DECODE_FAILED`：PBF 解码或几何构建失败；
- `CANCELLED`：瓦片离开视野或缓存被清理，任务被取消。

这些原因记录在 `VectorTile.terminalReason`，Cesium 状态使用 `ImageryState.INVALID/FAILED` 表示终止。

## 3. 核心模块职责

| 模块                             | 职责                                                                                                                        |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `VectorTileLayerManager.js`      | 创建四叉树、图层集合、任务调度器、共享 PBF cache 和诊断器，对外提供图层、场景及缓存管理 API。                               |
| `VectorTileLayerCollection.js`   | 管理图层顺序、增删、显隐和样式变化事件。                                                                                    |
| `VectorTileLayer.js`             | 单个 source 对应的请求、解码、建桶、缓存和后端选择，并持有该图层的 style document、内容代和样式快照。                       |
| `VectorTileStyleUtils.js`        | 解析、校验 style document。                                                                                                 |
| `VectorTileStyleRule.js`         | 封装单个外部 `layers[]` 配置，包含 type、sourceLayer、filter、paint、layout、terrain。                                      |
| `VectorTileStyleExpression.js`   | 统一执行和校验样式表达式与可序列化 filter 表达式。                                                                          |
| `VectorTileBucketUtils.js`       | bucket 共享 helper，包含样式值求值、贴地判断、primitive 工厂和几何转换工具。                                                |
| `VectorTileGeometryPlacement.js` | 管理 `symbol-placement`、样式规则到源几何类型的映射、polygon center 派生和主线程过滤共享逻辑。                              |
| `VectorTileBucketFactory.js`     | 包含 `VectorTilePrimitiveBucket` 基类，并按样式类型把 style rule 路由到 fill/line/symbol bucket。                           |
| `VectorTileFillBucket.js`        | 基于面要素创建填充和 outline primitive，并支持将线绘制为强制闭合的单环面。                                                  |
| `VectorTileLineBucket.js`        | 基于线要素创建普通线、贴地线和 packed 线 primitive，并支持将 polygon 自动绘制为 outline。                                   |
| `VectorTileSymbolBucket.js`      | 基于点位输入创建 `BillboardCollection` 和 `LabelCollection`，可复用 polygon center 派生点。                                 |
| `SharedPointCollections.js`      | 统一管理 symbol/circle 共享点集合条目，按版本化瓦片 key 隔离跨代 billboard/label。                                          |
| `VectorTileQuadtreePrimitive.js` | 扩展 Cesium `QuadtreePrimitive`，收集并提交当前帧 Primitive。                                                               |
| `VectorTileQuadtreeProvider.js`  | 实现 Cesium 四叉树要求的可见性、误差、距离、层级细分和加载接口。                                                            |
| `VectorSurfaceTile.js`           | 对标 Cesium `GlobeSurfaceTile`，挂载到四叉树瓦片上的矢量数据容器。                                                          |
| `TileVectorTile.js`              | 对标 Cesium `TileImagery`，连接四叉树瓦片和矢量瓦片，管理加载对象、就绪对象和父级回退。                                     |
| `VectorTile.js`                  | 对标 Cesium `Imagery`，保存一个 `(x, y, level)` 矢量瓦片的状态、任务、Primitive 和引用计数。                                |
| `VectorTileProvider.js`          | 集中 Provider 基类、`TileType`、内部 `MVTLoader` 与 XYZ/WMTS/WMTSGeo 寻址实现，只负责数据源寻址与发起瓦片请求，不持有样式。 |
| `VectorTileTaskScheduler.js`     | 有界优先级任务队列，支持排队、调整优先级和取消。                                                                            |
| `VectorTileDecoder.js`           | 管理 Worker 请求和异步响应。                                                                                                |
| `VectorTileDecodeWorker.js`      | Worker 入口。                                                                                                               |
| `decodeVectorTile.js`            | 解码指定 source layer，并输出点、线、面 TypedArray 几何桶。                                                                 |
| `VectorTileGeometryUtils.js`     | MVT 环分类、WebMercator 投影、线段和面环矩形裁剪，并识别 fill-outline 的瓦片裁剪边。                                        |
| `VectorTileCache.js`             | 引用计数配合字节预算 LRU，负责确定性资源销毁。                                                                              |
| `VectorTilePbfCache.js`          | 按 manager 总预算保存原始 PBF master、为 Worker 创建副本，并合并同 key 的在途网络请求。                                     |
| `VectorTileLodSelection.js`      | 包含 `VectorTileCoverageState` 枚举，并在父子瓦片同时就绪时选择不重叠的 LOD 集合。                                          |
| `VectorTileDiagnostics.js`       | 收集帧耗时、请求、解码、Primitive、缓存和裁剪指标。                                                                         |
| `VectorTileBenchmark.js`         | 固定视角采样，以及 instances/packed A/B 测试。                                                                              |

## 4. 快速使用

```js
import VectorTileLayerManager from "./src/VectorTileLayerManager.js";

const manager = new VectorTileLayerManager({
  maximumNetworkTasks: 8,
  maximumDecodeTasks: 2,
  maximumBuildTasks: 1,
  tileCacheSize: 100,
  pbfCacheBytes: 64 * 1024 * 1024,
  diagnostics: { enabled: true },
});

manager.addToScene(viewer.scene);

manager.setStyle({
  version: 1,
  sources: {
    land: {
      type: "vector",
      url: "http://localhost:10101/tiles/{z}/{x}/{-y}.pbf",
      minimumLevel: 0,
      maximumLevel: 10,
      tileType: "XYZ",
      clipToTile: true,
      allowPicking: true,
      renderBackend: "instances",
      cacheBytes: 64 * 1024 * 1024,
    },
  },
  layers: [
    {
      id: "countries-fill",
      type: "fill",
      source: "land",
      sourceLayer: "countries",
      paint: {
        "fill-color": "#ff000077",
      },
    },
  ],
});

manager.addLayer("land", {
  id: "coastlines-line",
  type: "line",
  sourceLayer: "coastlines",
  paint: {
    "line-color": "#0000ffcc",
    "line-width": 2,
  },
});
```

注意：`manager.addLayer(sourceId, layerOptions)` 不会创建新的 provider；它会找到 `sourceId` 对应的 runtime layer，把 `{ ...layerOptions, source: sourceId }` 作为一个新的样式图层追加进该 layer 的 style document（样式由 layer 持有，provider 只提供数据源），并刷新渲染。也就是说，`addLayer()` 一次只追加一个 layer；如果要一次性初始化整套 `sources + layers`，请使用 `manager.setStyle(styleDocument)`。`sourceLayer` 必须与 PBF 内部 source-layer 名完全一致，请求成功但名称不匹配时，不会生成任何 Primitive。

### 新 style document 配置

推荐入口是：

- `manager.setStyle(styleDocument)`：一次性创建或替换整套 source/provider 和 layers
- `manager.addLayer(sourceId, layerOptions)`：向现有 source/provider 追加单个 style layer
- `manager.addLayerProvider(provider)`：高级场景下直接注入自定义 provider

外部配置沿用易理解的 `sources + layers` 结构，但内部会映射到 Cesium 风格的 `VectorTileProvider`、`VectorTileStyleRule` 和 `PrimitiveBucket`。

完整字段、`symbol-placement`、polygon center、polygon outline line、`circle` 预留语义、symbol 文字/图标配置、锚点映射、terrain 语义、表达式和完整示例，请直接查看 [STYLE.md](./STYLE.md)。

```js
manager.setStyle({
  version: 1,
  sources: {
    land: {
      type: "vector",
      url: "http://localhost:10101/tiles/{z}/{x}/{-y}.pbf",
      minimumLevel: 0,
      maximumLevel: 10,
      tileType: "XYZ",
      renderBackend: "instances",
    },
  },
  layers: [
    {
      id: "land-fill",
      type: "fill",
      source: "land",
      sourceLayer: "countries",
      filter: ["==", ["get", "kind"], "land"],
      paint: {
        "fill-color": [
          "match",
          ["get", "type"],
          "park",
          "#00ff0044",
          "#0088ff33",
        ],
        "fill-outline-color": "#ffffffaa",
        "fill-outline-width": 1,
      },
      terrain: {
        clampToGround: false,
        heightOffset: 1,
      },
    },
    {
      id: "coastline-line",
      type: "line",
      source: "land",
      sourceLayer: "coastlines",
      paint: {
        "line-color": "#0000ffcc",
        "line-width": ["interpolate", ["linear"], ["zoom"], 1, 1, 6, 4],
      },
    },
    {
      id: "place-label",
      type: "symbol",
      source: "land",
      sourceLayer: "populated_places",
      layout: {
        "text-field": ["get", "name"],
        "text-size": 14,
      },
      paint: {
        "text-color": "#ffffffff",
        "text-halo-color": "#000000cc",
        "text-halo-width": 2,
      },
      terrain: {
        clampToGround: true,
        heightOffset: 10,
      },
    },
  ],
});
```

关键关系：

- `sources` 只描述数据源、URL、层级、切片类型和渲染选项。
- `layers[]` 描述可见样式图层，一个 source 可以被多个 layer 复用。
- 内部实现中，同一个 `source` 的所有 `layers` 会合并到该 source 的一个 `VectorTileProvider` 和一个 `VectorTileLayer` 上；provider 负责 source 级 URL/tilingScheme/level/request，runtime layer 负责样式、解码、建桶与共享缓存。实现上 provider 构造期仍会携带一份单 source `styleDocument` 作为初始化参数，但运行时样式真源是 `VectorTileLayer` 的 `styleDocument`，样式增删改只作用在 layer 上。
- `sourceLayer` 指向 PBF 内部 source-layer 名称；名称不匹配时当前 layer 合法但为空。
- `filter` 在 worker 或建桶前尽早剔除不需要的要素。
- `minzoom/maxzoom` 使用相机离地高度估算出的全局 style zoom 控制 layer 可见性，语义为 `minzoom <= zoom < maxzoom`，同一帧内所有瓦片一致。
- `paint/layout/terrain` 按 style rule 独立生效，因此同一份 PBF 可以同时画面、画 polygon outline 线、画点标注，或通过 `symbol-placement: "polygon-center"` 在面中心画文字/图标。

### 为什么不照搬 Cesium 的 `ImageryProvider` / `ImageryLayer` 完整拆分

结论：当前不必为了“更像 Cesium”而把矢量瓦片设计强行改成 `1 provider -> N layer`。

- 这套设计按 `source` 合并，本质上更接近 Mapbox GL/MapLibre 的矢量样式模型：一个 source 可以派生多个 style layer，它们共享同一次瓦片请求和解码结果。
- 对 MVT 来说，最贵的是同一瓦片的 `ArrayBuffer` 拉取和 Worker 解码；当前实现把同一 `source` 的多个样式图层合并到一个 runtime layer 中，正好让这些成本只发生一次，然后由不同 style rule 分别建各自的 primitives。
- Cesium 影像层那种“多个 `ImageryLayer` 复用一个 `ImageryProvider`”的主要收益，是让多层共享同一张 GPU 纹理，只在渲染阶段做 alpha、brightness 之类的廉价显示变换。矢量瓦片没有这类共享纹理红利，因为每个 style layer 仍然要各自建桶、各自生成 primitives。
- 因此，如果把当前实现硬拆成 Cesium 式完整 `provider/layer` 1:N 关系，理论上最多也只是把 fetch/decode 复用显式化；而这一点现在已经通过“按 source 合并 + 共享缓存”拿到了，额外抽象收益有限。
- 真正值得保留的是“source 与样式解耦”的方向：`VectorTileProvider.requestTile()` 只按瓦片坐标取数，不参与样式判断；解码阶段读取的 `styledLayerNames/styleRules`、以及建桶阶段读取的 style rule，都来自 `VectorTileLayer` 的 `styleDocument`。
- 当前代码可以视为已经部分收敛到这个方向：provider 中那份单 source `styleDocument` 主要用于构造期初始化 runtime layer，而不应被视为运行时样式所有权；后续若继续轻量整理，可以进一步减少这份初始化副本带来的认知负担。
- 只有当产品明确需要“同一个数据源在同一场景里用两套完全独立的样式各画一遍”时，才值得再引入完整的 `provider -> 多个 runtime layer` 抽象。现阶段 API `addLayer(sourceId, layerOptions)` 的语义仍然是“向现有 source 追加 style layer”，不是“复制一份 source 再独立渲染一遍”。

旧版 `styles` 入口已移除，示例和调用方都应使用 `sources/layers` style document。

## 5. Manager 配置

| 参数                  |                    默认值 | 说明                                                                                       |
| --------------------- | ------------------------: | ------------------------------------------------------------------------------------------ |
| `tilingScheme`        | `WebMercatorTilingScheme` | Cesium 瓦片坐标系统类名。                                                                  |
| `maximumNetworkTasks` |                       `8` | 同时执行的网络任务上限。                                                                   |
| `maximumDecodeTasks`  |                       `2` | 同时进入 Worker 解码流程的任务上限。当前 Decoder 使用单 Worker，消息在 Worker 内顺序执行。 |
| `maximumBuildTasks`   |                       `1` | 主线程 Primitive 建模任务上限。                                                            |
| `tileCacheSize`       |                     `100` | Cesium 四叉树保留的 surface tile 数量。                                                    |
| `pbfCacheBytes`       |                  `64 MiB` | 所有 source 共用的 ready 原始 PBF master payload 字节预算；`0` 禁用 ready 驻留。           |
| `diagnostics`         |                      关闭 | `{ enabled: true }` 时收集性能指标。                                                       |

`tileCacheSize`、source `cacheBytes` 和 `pbfCacheBytes` 不可互换：前者按数量控制 Cesium surface tile 保留，`cacheBytes` 是单 runtime layer 的渲染缓存估算预算，`pbfCacheBytes` 是 manager 下所有 source 共用的压缩 PBF payload 严格预算。

## 6. Source / Provider 配置

这些字段写在 `styleDocument.sources[sourceId]` 中，或者直接作为自定义 `VectorTileProvider` 的构造参数传入。`manager.addLayer(sourceId, layerOptions)` 只追加样式图层，不负责配置 source/provider 本身。

| 参数                     |                默认值 | 说明                                                         |
| ------------------------ | --------------------: | ------------------------------------------------------------ |
| `url`                    |              空字符串 | PBF 地址模板。                                               |
| `tileType`               |                 `XYZ` | `XYZ` 或 `WMTS`。                                            |
| `minimumLevel`           |                   `0` | 最低请求层级。                                               |
| `maximumLevel`           |                  `20` | 最高请求和四叉树细分层级。设为 `0` 时只请求 `0/0/0`。        |
| `clipToTile`             |                `true` | 将 MVT buffer 几何裁剪到 `[0, extent]`，避免相邻瓦片面重叠。 |
| `allowPicking`           |               `false` | 是否保留逐要素 ID 和属性用于 `scene.pick()`。                |
| `renderBackend`          |           `instances` | 线渲染后端：`instances` 或实验性 `packed`。                  |
| `packedMinimumInstances` |                 `200` | packed 后端启用所需的最少线段/路径数量。                     |
| `cacheBytes`             |              `64 MiB` | 单 runtime layer 的渲染瓦片缓存预算估算值，不包含原始 PBF。  |
| `polygonHeight`          |                 `1.0` | 面相对椭球面的高度，减少与地球表面共面闪烁。                 |
| `asynchronous`           |                `true` | instances 后端是否使用 Cesium 异步 Primitive 构建。          |
| `shadows`                | `ShadowMode.DISABLED` | 是否参与阴影。                                               |

### `terrain` 贴地与高度偏移

新 style document 的每个 layer 可以配置 Cesium 三维扩展字段：

```js
terrain: {
  clampToGround: true,
  heightOffset: 0,
}
```

语义如下：

| 几何类型 | `clampToGround: false`                                                  | `clampToGround: true, heightOffset: 0`                    | `clampToGround: true, heightOffset != 0`                                            |
| -------- | ----------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `fill`   | 使用普通 `Primitive + PolygonGeometry`，高度为 `heightOffset`。         | 使用 `GroundPrimitive` 贴地绘制面。                       | Cesium 没有“贴地后再抬高”的 polygon primitive，降级为普通高度面并记录诊断。         |
| `line`   | 使用普通 `Primitive + PolylineGeometry`，高度为 `heightOffset`。        | 使用 `GroundPolylinePrimitive + GroundPolylineGeometry`。 | Cesium 没有“贴地后再抬高”的 ground polyline primitive，降级为普通高度线并记录诊断。 |
| `symbol` | 使用 `BillboardCollection` / `LabelCollection`，高度为 `heightOffset`。 | 使用 `HeightReference.CLAMP_TO_GROUND`。                  | 使用 `HeightReference.RELATIVE_TO_GROUND`，位置高度作为相对地面偏移。               |

诊断指标：

- `createdGroundPrimitives`：创建的贴地面 primitive 数；
- `createdGroundPolylinePrimitives`：创建的贴地线 primitive 数；
- `groundHeightOffsetFallbacks`：请求贴地且设置非零高度偏移时，线/面降级到普通高度渲染的次数。

### XYZ/TMS 模板变量

`VectorTileProvider.js` 内部的 `XYZVectorTileProvider` 支持：

- `{z}`：层级；
- `{x}`：列号；
- `{y}`：XYZ 行号；
- `{-y}`：反转后的 TMS 行号；
- `{s}`：子域名；
- `{layer}`、`{workspace}`：自定义模板值。

`{-y}` 的计算方式：

```js
reverseY = numberOfYTilesAtLevel - y - 1;
```

## 7. Worker 解码和瓦片裁剪

主线程把以下信息发给 Worker：

- PBF `ArrayBuffer`；
- 当前瓦片 `(x, y, level)`；
- 当前样式引用的 source-layer 名称；
- 是否需要属性和拾取 ID；
- 是否启用 `[0, extent]` 裁剪。

Worker 返回按类型组织的数据：

```text
points.positions: Float64Array

lines.positions: Float64Array
lines.offsets:   Uint32Array

polygons.positions:      Float64Array
polygons.ringOffsets:    Uint32Array
polygons.polygonOffsets: Uint32Array
```

这些 ArrayBuffer 通过 Transferable 传回主线程，避免复制大坐标数组。

MVT 服务通常会在瓦片边界外保留 buffer。框架会在投影前执行：

- 点：过滤 `[0, extent]` 外的坐标；
- 线：逐线段裁剪，出入瓦片时拆分路径；
- 面：裁剪每个环，再重新归组外环和洞。

如果关闭 `clipToTile`，相邻瓦片可能同时绘制彼此的 buffer，半透明大面会出现明显的宽重叠带。

## 8. 两种渲染后端

### instances

默认后端。

- 每条独立线或每个 Polygon 创建一个 `GeometryInstance`；
- 同一 source layer、同一几何类型进入一个 Cesium `Primitive`；
- Cesium 可在内部 Worker 中完成 Geometry 创建和合批；
- `allowPicking: true` 时可以返回 feature ID 和属性；
- 线和面都使用此后端。

### packed

实验性线后端。

- 先创建每条 `PolylineGeometry` 的原始 Geometry；
- 使用 `GeometryPipeline.combineInstances()` 合并为少量 Geometry；
- 使用统一 `PolylineMaterialAppearance`，减少 per-instance batch table 开销；
- 当前不支持逐要素拾取；
- 当前只优化具有统一 `lineColor` 的大量线；
- 面仍然使用 instances 后端。

满足以下条件才会真正启用 packed：

```text
renderBackend === "packed"
allowPicking === false
style.lineColor 已定义
线数量 >= packedMinimumInstances
```

否则自动回退到 instances。

切换后端：

```js
layer.setRenderBackend("packed");
layer.setRenderBackend("instances");
```

## 9. LOD、父级回退和重叠控制

子瓦片加载期间，`TileVectorTile` 会寻找已就绪的父级 `VectorTile` 作为临时回退。

由于父级 Primitive 表示完整父瓦片区域，不能同时绘制父级和它的局部子级。渲染前会按图层执行非重叠 LOD 选择：

1. 按层级从低到高排序候选瓦片；
2. 如果某候选已有被选中的祖先，则压制该候选；
3. 每个共享 Primitive 每帧最多提交一次。

这解决父子瓦片重复绘制。相邻同级瓦片的 buffer 重叠由 Worker 裁剪解决。

### 样式刷新和显隐切换

运行时调用 `setLayerStyle()`、`VectorTileLayer.setStyle()` 或 `VectorTileLayer.clearCache()` 时，图层会推进 `contentRevision` 并为后续瓦片绑定使用新的内容代。相同 `(x, y, level)` 的新旧瓦片因此可以短暂并存：旧代由上一帧 `committedRenderSet` 持有，继续作为已覆盖区域的兜底；当前代瓦片完成请求、解码、建桶并且 Primitive 实际可绘制后，才按 coverage 规则接管对应区域。

样式、filter、图标、scene 和 render backend 变化只清渲染内容，不清 manager 级 PBF。只要 source 数据身份与瓦片坐标未变，新内容代会从 PBF cache 取得独立工作副本并重新解码、建桶，不再重复下载。完整 `manager.setStyle()` 重建 runtime layer 时也遵守这一规则。

隐藏图层时不清空 committed render state，而是依赖 `_show` 在提交阶段立即停止绘制；重新显示时会重新失效四叉树绑定，并可在先前覆盖区域使用保留内容避免空白切换。图层删除、销毁和全量移除仍会清理 render state 和资源。

这个策略会在刷新窗口内提高短时内存/GPU 资源峰值，但只保留 committed set 所需旧代；旧代引用释放后仍走缓存 stale 淘汰和确定性销毁。

## 10. 任务调度和取消

network、decode、build 使用独立的 `VectorTileTaskScheduler`：

- 优先级较小的任务先执行；
- 四叉树根据相机距离设置加载优先级；
- 排队任务可重新排序；
- 瓦片离开视野、图层删除、样式变化和渲染缓存清理会取消对应消费者任务；
- 相同 PBF key 的消费者共享底层网络任务；单个消费者取消不会影响其他消费者，最后一个消费者取消时才调用 Cesium `Request.cancel()`；
- 已转交 Worker 的解码不能中断 Worker 当前函数，但每个瓦片使用创建时的样式快照；过期内容代的结果会被忽略，不会接管当前画面。

## 11. 缓存和资源释放

缓存分成两层：每个 `VectorTileLayer` 拥有独立的渲染 `VectorTileCache`，manager 持有所有 source 共享的原始 `VectorTilePbfCache`。

渲染缓存：

- key 为 `[contentRevision, x, y, level]`；
- 四叉树引用通过 `referenceCount` 维护；
- 未完成且引用归零的瓦片立即取消并销毁；
- READY 且引用归零的瓦片可以保留在 LRU 中复用；
- 超过 `cacheBytes` 后，从最久未使用且引用为零的瓦片开始淘汰；
- 淘汰时取消任务、释放父级引用并销毁所有 Primitive；
- 图层样式、后端变化和显式缓存刷新会先推进内容代，再把旧缓存标记为 stale，等引用释放后确定性销毁。

原始 PBF 缓存：

- key 包含 source namespace、解析后的资源身份和 `(level, x, y)`，不包含样式、filter 或 `contentRevision`；
- ready entry 私有保存不可变 master `ArrayBuffer`，每个解码消费者得到独立副本，只有副本会 transfer 给 Worker；
- 按 master `byteLength` 和 LRU 严格控制在 `pbfCacheBytes` 内；零字节不驻留，单个响应大于预算时直接服务消费者但不挤出已有小 entry；
- `pbfCacheBytes: 0` 只禁用 ready 驻留，同 key 的 pending 请求仍会合并；
- 同一 URL 背后的服务端数据原地更新时，应调用 `manager.clearPbfCache()` 或使用版本化 URL。

常用操作：

```js
layer.show = false;
layer.setStyle(newStyleDocument);
layer.clearCache();
manager.clearPbfCache(); // 只清 ready PBF，保留当前已绘制 Primitive
manager.clearCache();
manager.vectorTileLayers.remove(layer, true);
```

`manager.clearCache()` 会同时推进各 layer 的渲染内容代并清除 ready PBF，适用于冷启动测试。两种 manager 清理都会推进 PBF cache generation，清理前已在途的响应仍可服务既有消费者，但不会回填 ready cache。

`pbfCacheBytes` 只限制 ready master payload，不是浏览器进程总内存上限。样式切换期间可能同时存在 master、解码工作副本、Worker 输出及新旧渲染内容代，浏览器任务管理器也可能晚于 JS 引用释放才回落。

## 12. 性能诊断

Demo URL 添加 `?diagnostics`：

```text
index.html?diagnostics
```

读取当前快照：

```js
getVectorTileDiagnostics();
// 或
_vectorTileManager.diagnostics.snapshot();
```

常用指标：

```js
result.durations.frameCpu.p95Ms;
result.durations.request;
result.durations.workerDecodeRoundTrip;
result.durations.primitiveBuild;
result.durations.packedGeometryBuild;

result.gauges.residentCacheBytes;
result.gauges.residentPbfCacheBytes;
result.gauges.residentPbfCacheEntries;
result.gauges.queuedNetworkTasks;
result.gauges.queuedDecodeTasks;
result.gauges.queuedBuildTasks;
result.gauges.currentContentRevision;
result.gauges.refreshRetainedTiles;
result.gauges.retiredResidentTiles;
result.gauges.staleResidentTiles;

result.counters.clippedFeatures;
result.counters.outOfBoundsPositions;
result.counters.cacheHits;
result.counters.cacheEvictions;
result.counters.pbfCacheHits;
result.counters.pbfCacheMisses;
result.counters.pbfCacheEvictions;
result.counters.pbfCacheCopies;
result.counters.pbfCacheOversizeSkips;
result.counters.pbfRequestJoins;
result.counters.downloadedBytes; // 仅真实 fetch，PBF hit 不重复累计
result.counters.suppressedLodVectorTiles;
result.counters.packedLineBuckets;
```

## 13. 基准测试

固定视角冷/热采样：

```js
await vectorTileBenchmark.capture("world", {
  cold: true,
  sampleMs: 5000,
});

await vectorTileBenchmark.capture("regional", {
  warmupMs: 1000,
  sampleMs: 5000,
});
```

可用场景：`world`、`regional`、`close`。

instances/packed A/B 测试：

```js
const result = await vectorTileBenchmark.compareBackends(
  _vectorTileLayer,
  "world",
  { sampleMs: 5000 },
);

console.table(result.frameCpuP95);
```

结果包含：

```text
instancesMs
packedMs
improvementPercent
packedActivated
passesAdoptionThreshold
```

只有 `packedActivated === true` 且提升达到 20%，才建议将 packed 设为默认。

## 14. 当前 Demo

`index.html` 提供 style document 示例：

- `instances（可拾取）`：创建允许 picking 的图层；
- `packed（不可拾取）`：创建 packed 实验图层；
- style document 示例：演示同一 source 下的 fill、line、symbol、filter、表达式和 terrain 配置；
- 点击地图后，右侧面板显示拾取属性；
- `_vectorTileManager`、`_vectorTileLayer` 和 `vectorTileBenchmark` 暴露在 `window` 上，便于调试。

运行前需要：

1. 已构建 `Build/CesiumUnminified`；
2. PBF 服务允许浏览器跨域访问；
3. 修改 Demo 中的 URL 模板和 `sourceLayer` 为实际服务；
4. 使用 HTTP 服务打开页面，不要直接通过 `file://` 打开；
5. Worker 文件更新后强制刷新浏览器，避免旧模块缓存。

## 15. 已知限制

- symbol 已支持图标和文字，并补齐了图标锚点、图标宽高、文字锚点、文字背景和背景 padding；同时支持 `symbol-placement: "polygon-center"` 在面中心绘制标注，但当前仍未实现碰撞避让、沿线文字、图标旋转对齐和完整字体栈管理；
- `symbol-placement: "polygon-center"` 当前按瓦片内 polygon 片段计算中心，跨瓦片大面可能出现重复标注；
- `circle` 图层当前只是样式文档中的预留设计，尚未实现；后续第一版更适合用 Billboard 生成圆形纹理来保留贴地能力，PointPrimitive 方案需要额外高程策略；
- `clampToGround: true` 与非零 `heightOffset` 在线/面上不能同时严格满足，当前会降级为普通高度渲染；
- packed 当前只优化大量同色线，不支持逐要素拾取；当 `line` 图层同时需要绘制 polygon outline 时会自动回退到 instances；
- Worker 当前为单实例，`maximumDecodeTasks` 限制提交链路，但 Worker 内仍串行执行消息；
- 面裁剪按单环执行，不能修复源数据中的自相交、重复面或复杂拓扑错误；
- 源数据本身重叠时，客户端不会自动 dissolve；
- `WMTSGeoVectorTileProvider` 属于遗留实验分支，没有完整接入当前 MVT Worker/Primitive 主链；
- `@mapbox/vector-tile` 和 `pbf` 当前从 jsDelivr ESM 加载，离线部署应改为本地依赖并固定版本；
- 本目录使用 Cesium 内部四叉树类，升级 Cesium 时需要回归验证内部接口变化。

## 16. 推荐后续工作

1. 为线、面裁剪和状态机补充正式自动化测试；
2. 将 MVT/PBF 依赖本地化并固定版本；
3. 根据真实 A/B 数据决定是否保留 packed 后端；
4. 如 packed 确有收益，将宽线展开和 Geometry 合并进一步迁移到专用 Worker；
5. 增加 symbol 碰撞避让、沿线文字、图标旋转对齐和字体栈管理；
6. 完善 WMTS GeoJSON 分支或将其移出当前主框架。
