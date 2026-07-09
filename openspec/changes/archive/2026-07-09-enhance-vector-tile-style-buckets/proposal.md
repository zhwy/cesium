## 变更缘由

`Apps/Demos/LoadVectorTile` 已经支持 `sources + layers` 风格的样式文档，但 `symbol` 样式对 Cesium 点标注和图标的支持还不够完整，线和面的 primitive 构建逻辑也仍然集中在 `VectorTileLayer` 中。这让样式能力离真实地图使用场景还有距离，也让后续扩展渲染行为时更难保持结构清晰和实现稳定。

## 变更内容

- 扩展点要素的 `symbol` 样式支持：
  - 文字背景色与背景内边距；
  - CSS 字体字符串，以及可选的字体族配置；
  - 文字锚点与屏幕像素偏移；
  - 图标锚点、屏幕像素偏移、宽度和高度。
- 保持 `symbol` 渲染继续由 `VectorTileSymbolBucket` 负责，把样式文档字段映射为 Cesium `LabelCollection` 与 `BillboardCollection` 的配置。
- 为线和面引入独立的 primitive bucket，并从 `VectorTilePrimitiveBucket` 派生：
  - `VectorTileLineBucket` 负责普通线 primitive、贴地线、packed 线后端选择、线过滤与线诊断指标。
  - `VectorTileFillBucket` 负责面填充 primitive、面轮廓线、贴地面路径选择、瓦片边界轮廓裁剪与面诊断指标。
- 将 `VectorTileLayer` 的 primitive 构建职责收缩为瓦片生命周期管理、样式规则路由与 bucket 编排。
- 为 LoadVectorTile demo 增加完整的样式配置文档，覆盖数据源、图层通用字段、fill/line/symbol 属性、表达式、过滤、terrain 行为、图标注册与完整示例。
- 保持现有 `styles` 兼容路径，以及既有 style document 字段语义不变。

## 能力范围

### 新增能力

- `vector-style-document`：扩展 LoadVectorTile 的样式文档契约，补齐 Cesium 导向的 symbol 配置、按 bucket 分离的线/面渲染职责，以及面向用户的完整样式说明文档。

### 修改能力

- 无。当前仓库下没有活动中的 `openspec/specs/` capability；这次变更是在仓库本地以新的 change 形式延续已归档的 `vector-style-document` 工作。

## 影响范围

- 受影响的运行时代码：
  - `Apps/Demos/LoadVectorTile/src/VectorTileLayer.js`
  - `Apps/Demos/LoadVectorTile/src/VectorTilePrimitiveBucket.js`
  - `Apps/Demos/LoadVectorTile/src/VectorTileSymbolBucket.js`
  - 以及可能新增的 `VectorTileLineBucket.js`、`VectorTileFillBucket.js` 和共享 bucket 工具模块。
- 受影响的测试：
  - `Apps/Demos/LoadVectorTile/test/VectorTileSymbolBucket.test.js`
  - 以及新增的 line/fill bucket 构建与路由测试。
- 受影响的文档：
  - `Apps/Demos/LoadVectorTile/README.md`
  - 新增完整样式参考文档，例如 `Apps/Demos/LoadVectorTile/STYLE.md`。
- 不需要新增服务端依赖。
- 不计划引入对 legacy `styles` 或现有 `styleDocument` 用法的破坏性变更。
