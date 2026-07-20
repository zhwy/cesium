## Why

当前矢量瓦片可以拾取要素并原地更新整层或逐实例颜色，但交互代码仍缺少独立于源数据和样式文档的逐要素运行时状态。点击选中、悬浮高亮等高频交互需要一种稳定、声明式且不触发 PBF 请求、解码或几何重建的状态驱动样式机制。

## What Changes

- 为 `VectorTileLayerManager` 增加类似 Mapbox 的 `setFeatureState()`、`getFeatureState()` 和 `removeFeatureState()` API，状态按 source、source-layer 和稳定 feature id 寻址并采用浅合并语义。
- 为 vector source 增加 `promoteId` 配置，使没有可跨瓦片复用 PBF id 的数据可以从属性中取得稳定状态身份。
- 在样式表达式子集中增加 `feature-state` 和配套布尔类型断言，并限制 feature-state 只用于首期支持原地更新的 paint 颜色字段。
- 为驻留 bucket 建立稳定 feature id 到 GeometryInstance 的反向绑定；状态变化时只重新计算受影响要素的颜色，并同步更新该要素的跨瓦片副本、裁剪片段和多个样式图层表示。
- 新瓦片和异步尚未 ready 的 Primitive 使用最新状态初始化或延迟补应用；bucket 替换、缓存驱逐和 source 销毁时确定性注销状态绑定。
- 为悬浮和点击选中补充 Demo、文档、诊断与自动化测试。
- 首期不支持 packed line 后端、状态驱动 filter/layout/几何宽度/高度、逐要素显隐和自定义 shader 状态纹理。

## Capabilities

### New Capabilities

- `vector-tile-feature-state`: 定义逐要素状态 API、稳定身份、状态生命周期、跨瓦片渲染绑定、原地颜色更新和交互行为。

### Modified Capabilities

- `vector-style-document`: 为 vector source 增加 `promoteId`，并为受支持 paint 颜色字段增加 `feature-state` 表达式语义与校验限制。

## Impact

- 主要影响 `Apps/Demos/LoadVectorTile/src` 下的 manager、runtime layer、解码属性投影、表达式求值、Primitive bucket、线面 bucket、拾取注册表和诊断模块。
- `VectorTileLayerManager` 增加新的公共方法，现有样式和拾取 API 保持兼容。
- source 配置和样式文档获得可选字段及表达式操作符；未使用 feature-state 的调用方行为不变。
- instances 线面继续复用 Cesium `GeometryInstance` per-instance color attribute；不修改 Cesium engine Primitive，不新增生产依赖。
