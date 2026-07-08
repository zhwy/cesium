## Why

当前 `Apps/Demos/LoadVectorTile` 矢量瓦片 Demo 已初步完成瓦片请求、解码、LOD 稳定渲染和线/面性能优化，但样式仍绑定在单个 `VectorTileLayer.styles` 上，数据源、样式图层和渲染桶没有清晰分层。

这会带来几个直接问题：同一份 PBF 数据难以复用多套样式，点数据缺少图标/文字渲染，过滤只能靠外部数据准备，样式值也不能根据要素属性或 zoom 动态计算。为了继续完善 Cesium 场景中的矢量瓦片能力，需要引入参考 Mapbox `sources + layers` 的样式配置文档，并补齐 3D 场景所需的贴地和高度偏移配置。

## What Changes

- 新增样式文档模型，外部配置参考 Mapbox 的 `sources + layers`：
  - `sources` 定义矢量瓦片数据源、URL、层级范围、切片类型和请求参数。
  - `layers` 定义样式图层，允许多个 layer 复用同一个 source。
  - 每个 layer 通过 `sourceLayer` 指向 PBF 内部的 source-layer。
- 新增样式图层类型：
  - `fill`：面填充、面线框颜色、面线框宽度。
  - `line`：线颜色、线宽。
  - `symbol`：点图标和点文字。
- 新增表达式能力：
  - 样式参数可以是常量。
  - 样式参数可以通过要素属性取值，例如 `["get", "name"]`。
  - 支持基础条件、匹配、zoom 插值等表达式子集。
- 新增过滤能力：
  - 每个 style layer 可配置 `filter`。
  - 过滤表达式支持要素属性判断。
  - 能够在解码/建桶阶段尽早剔除不需要的要素。
- 新增点数据渲染：
  - 图标使用 Cesium `BillboardCollection` 或等价渲染桶。
  - 文字使用 Cesium `LabelCollection` 或等价渲染桶。
  - 支持图标和文字从要素属性取值。
- 新增 3D 扩展配置：
  - `clampToGround` 控制贴地。
  - `heightOffset` 控制相对地表或椭球面的高度偏移。
- 保留现有 `styles` 简化配置的兼容路径，并提供向新 style document 的转换。
- 内部实现命名和职责向 Cesium 规约靠拢，优先使用 Provider、StyleRule、PrimitiveBucket、Appearance/Collection 等概念，而不是照搬 Mapbox 的 Source/Layer 类名。

## Capabilities

### New Capabilities

- `vector-style-document`: 定义矢量瓦片样式文档、数据 Provider 与样式规则分离、表达式样式、过滤、点渲染以及 3D 贴地/高度偏移行为。

### Modified Capabilities

- 无。

## Impact

- 影响 `Apps/Demos/LoadVectorTile` 下的矢量瓦片 Demo 架构：
  - `index.html`
  - `VectorTileLayerManager.js`
  - `VectorTileLayer.js`
  - `VectorTileLayerCollection.js`
  - `VectorTileDecoder.js`
  - `VectorTileDecodeWorker.js`
  - `decodeVectorTile.js`
  - `README.md`
- 可能新增模块：
  - `VectorTileStyle.js`
  - `VectorTileDataProvider.js`
  - `VectorTileStyleRule.js`
  - `VectorStyleExpression.js`
  - `VectorStyleFilter.js`
  - `VectorTilePrimitiveBucket.js`
  - `VectorTileSymbolBucket.js`
- 对外 API 将新增 `setStyle`、`getStyle` 等样式文档入口。
- 不引入新的服务端依赖；客户端仍使用现有 PBF 请求和 Cesium 渲染能力。
