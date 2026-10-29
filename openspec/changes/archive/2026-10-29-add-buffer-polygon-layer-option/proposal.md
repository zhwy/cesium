## Why

LoadVectorTile 当前使用 GeometryInstance 和 Primitive/GroundPrimitive 绘制面，无法在保留现有加载、解码、缓存和瓦片调度的条件下单独验证 BufferPolygon。需要一个样式图层级开关，让同一 source 的不同 fill 图层可以分别选择原有渲染或直接构建 Buffer 集合。

## What Changes

- 在 `layers[]` 顶层增加可选布尔字段 `useBufferPrimitive`，默认 `false`；本期仅 `fill` 图层启用 Buffer 路径，其他类型继续使用原路径。
- 新建 BufferPolygon bucket 和适配当前 primitive 接口的渲染对象，直接消费现有 packed polygon 数据，不经过 GLB、Model 或 Cesium3DTileset。
- 同时支持非贴地和贴地面，保留过滤、颜色表达式、feature-state、显隐、紧凑拾取与资源释放语义。
- 保留用户示例中的 fill outline：本期轮廓仍使用现有线 Primitive/GroundPolylinePrimitive 机制，由新 bucket 管理，不扩展独立 line 图层的 Buffer 支持。
- 原有 bucket 文件保持不变，只在配置、工厂及必要的提交接口增加接入；开关变化沿用现有结构样式重建流程。
- 实现阶段在 `res_org_gr-level2-fill` 示例上增加 `useBufferPrimitive: true`，覆盖完全透明默认色、hover/选中色和贴地组合，并提供同调度链下的 polygon 对比测试。

## Capabilities

### New Capabilities

- `vector-tile-buffer-polygon-rendering`：独立 BufferPolygon bucket 的直接构建、非贴地/贴地提交、样式、拾取、释放与验证要求。

### Modified Capabilities

- `vector-style-document`：支持样式图层级 `useBufferPrimitive` 的类型校验、默认值、序列化、路由及运行时切换。

## Impact

- 主要涉及 `Apps/Demos/LoadVectorTile/src/VectorTileStyleUtils.js`、`VectorTileStyleRule.js`、`createVectorTilePrimitiveBucket.js`、`VectorTileQuadtreePrimitive.js`、`VectorTilePickRegistry.js`、必要的 `VectorTileLayer.js` 接口，以及新增 bucket/渲染对象。
- 实现阶段更新 `index.html`、`STYLE.md`、`README.md`、针对性测试及 polygon benchmark 入口。
- 复用引擎现有 BufferPolygonCollection、几何管线和 VectorProvider；不新增生产依赖，不修改现有 bucket 实现，不替换加载或调度体系。
- 本期不实现 BufferPolyline/BufferPoint 后端、不重构通用 bucket 框架、不改动 vector glTF benchmark 路径。
