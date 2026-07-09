## Why

LoadVectorTile 目前支持 `fill`、`line` 和 `symbol`，但无法用 Mapbox 风格的 `circle` 图层表达点要素的屏幕空间圆点。用户需要一种可贴地、可按属性和 zoom 动态配置的点圆渲染能力，用于城市点、POI、聚合点等常见矢量瓦片样式。

## What Changes

- 新增 `type: "circle"` 样式图层，读取 MVT point / multipoint 要素并绘制屏幕空间圆点。
- 使用 Cesium `BillboardCollection` 承载动态生成的圆形 canvas 图像，复用 billboard 的贴地能力。
- 支持 Mapbox 风格字段：`circle-radius`、`circle-color`、`circle-outline-color`、`circle-outline-width`、`circle-offset`。
- 支持兼容别名：`pixelSize`、`color`、`outlineColor`、`outlineWidth`、`offset`。
- 创建圆点图像时按 `pixelSize = radius * 2` 生成直径尺寸；`pixelSize` 别名直接表示直径，并反推出半径。
- 所有 circle 样式字段可通过要素属性表达式和动态 zoom 表达式求值。
- 更新样式校验、decode 过滤、main-thread fallback 过滤、bucket factory、文档和测试。

## Capabilities

### New Capabilities

- `vector-circle-layer`: 定义 LoadVectorTile circle 图层的样式字段、源几何、贴地行为、表达式能力和渲染约定。

### Modified Capabilities

- 无。

## Impact

- 影响 `Apps/Demos/LoadVectorTile/src` 中的 style document 校验、geometry placement 判定、bucket factory 和新增 circle bucket。
- 影响 `Apps/Demos/LoadVectorTile/STYLE.md`，将 circle 从预留类型更新为已支持类型。
- 影响 `Apps/Demos/LoadVectorTile/test` 中的 style、geometry placement、bucket factory 和新增 circle bucket 测试。
- 不引入新的外部运行时依赖。
