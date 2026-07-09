## 背景

LoadVectorTile 当前把样式图层类型和 MVT 源几何类型绑定得比较紧：`symbol` 只读取点，`line` 只读取线，`fill` 只读取面。实际制图里常见的行政区名称、地块名称、面边界线等都来自面数据源，需要让渲染类型能基于源几何自动选择合适的派生表示。

## 变更内容

- `symbol` 图层新增 `layout["symbol-placement"]` 配置，第一阶段支持 `point` 和 `polygon-center`。
- `symbol-placement: "point"` 保持现有行为，从点要素绘制文字和图标。
- `symbol-placement: "polygon-center"` 从面要素的瓦片内几何片段计算中心点，再复用 symbol bucket 绘制文字和图标。
- `line` 图层内部自动支持面要素：当源图层包含 polygon 时，将 polygon outline 按 `line-color`、`line-width` 等线样式绘制。
- 解码和主线程过滤逻辑从“样式类型固定匹配一种几何类型”调整为“样式类型决定需要哪些源几何类型”。
- `STYLE.md` 和 README 更新样式说明，明确 `clipToTile: true` 时 polygon center 是瓦片片段中心，可能产生跨瓦片重复标注，并补充 `circle` 图层的预留语义。
- 不实现 `symbol-placement: "line"` 和 `polygon-visual-center`，但在设计中预留语义。

## 能力范围

### 新增能力

- `vector-geometry-placement`: 描述 vector tile 样式图层如何从点、线、面源几何派生 symbol 和 line 渲染几何。

### 修改已有能力

无。

## 影响范围

- 影响 `Apps/Demos/LoadVectorTile/src` 中的 decode 过滤、bucket factory、line bucket、symbol bucket 或新增几何派生工具。
- 影响 `Apps/Demos/LoadVectorTile/test` 中对 worker 过滤、bucket 构建、polygon center、polygon outline line 的测试覆盖。
- 影响 `Apps/Demos/LoadVectorTile/STYLE.md` 和 README 的样式配置说明。
- 不引入新的第三方依赖，不改变既有 `point` symbol、line、fill 的默认视觉行为。
