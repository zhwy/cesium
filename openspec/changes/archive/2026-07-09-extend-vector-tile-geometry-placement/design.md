## 背景

LoadVectorTile 已经将 fill、line、symbol 的 primitive 创建拆到独立 bucket 中，但当前 build 和 decode 逻辑仍把样式类型与单一 MVT 几何类型绑定：`symbol` 读取 points，`line` 读取 lines，`fill` 读取 polygons。这个模型无法直接表达“面中心标注”和“面边界线图层”这两类常见地图样式。

当前解码流程会在 worker 内按样式规则过滤 feature，并在 `clipToTile: true` 时把 polygon 裁剪成瓦片内片段。因此 build 阶段计算出的 polygon center 天然是瓦片片段中心，而不是服务端原始完整面的中心。

## 目标 / 非目标

**目标：**

- 让 `symbol` 图层通过 `layout["symbol-placement"]` 支持点标注和面中心标注。
- 让 `line` 图层自动将 polygon 源要素作为 outline 绘制，不要求用户额外声明 source geometry。
- 复用现有 symbol bucket 和 polygon outline 创建逻辑，避免复制 label、billboard、polyline 的样式求值代码。
- 更新 worker 过滤和主线程过滤，使需要 polygon 的 symbol/line 图层不会在解码阶段被丢弃。
- 文档明确 `clipToTile: true` 下 polygon center 的瓦片片段语义和重复标注风险。

**非目标：**

- 不实现 `symbol-placement: "line"`。
- 不实现 `polygon-visual-center`、polylabel 或 point-on-surface。
- 不实现跨瓦片 polygon 聚合、标注去重、碰撞避让或动态视口内重新放置。
- 不实现 circle 图层或 PointPrimitive 贴地策略。

## 设计决策

### 使用 `symbol-placement` 表达 symbol 派生位置

`layout["symbol-placement"]` 第一阶段支持：

- `point`：默认值，读取 MVT point 要素，保持既有行为。
- `polygon-center`：读取 MVT polygon 要素，计算瓦片内 polygon 片段的中心点，再交给 symbol bucket 绘制文字和图标。

备选方案是引入 `source-geometry` 或 `line-placement`。我们不采用，因为用户真正关心的是 symbol 的放置语义，而不是内部读取哪类源几何；line 对 polygon 也只有 outline 这一种第一阶段语义，额外字段会增加配置负担。

### `line` 图层自动绘制 polygon outline

`type: "line"` 表示把源图层中可线化的几何绘制成线：

- MVT LineString / MultiLineString 按现有 line path 绘制。
- MVT Polygon / MultiPolygon 按 polygon outline 绘制。
- 如果同一个 source layer 同时包含 line 和 polygon，则两者都使用当前 line 图层的 paint/terrain 配置。

polygon outline 的几何创建应复用 fill outline 使用的线段生成能力，但样式字段来自 `line-color`、`line-width`、`arcType`，而不是 `fill-outline-*`。

### 中心点计算在 build 阶段完成

`polygon-center` 不要求 worker 额外输出新数组；build 阶段从 `packedLayer.polygons` 计算 points-like 数据：

```text
packedLayer.polygons
        │
        ▼
polygon center 适配器
        │
        ▼
{ positions: Float64Array, metadata: [] }
        │
        ▼
VectorTileSymbolBucket
```

中心点算法第一阶段采用面积加权 centroid。对多 polygon 或多外环结果，按外环面积加权合并；空几何、退化 ring 或无法计算有限中心时跳过该 feature。

### 源几何判定集中管理

新增或集中封装 style rule 到 MVT geometry type 的判定：

```text
fill                         -> polygon
line                         -> line + polygon
symbol placement point       -> point
symbol placement polygon-center -> polygon
```

这套判定同时用于：

- worker decode 过滤。
- main-thread filter fallback。
- bucket factory 选择传入 points、lines、polygons 的方式。

这样可以避免 decode 阶段和 build 阶段对同一规则理解不一致。

### `circle` 作为文档预留类型

`circle` 图层本次不进入实现范围，因为它涉及 Cesium `BillboardCollection`、`PointPrimitiveCollection` 和地形贴地策略之间的取舍。文档中只记录预留配置和实现方向：

- 第一版更适合使用 `BillboardCollection` 加动态圆形 canvas，以复用 billboard 的 `HeightReference`。
- `PointPrimitiveCollection` 更接近点 primitive，但贴地和高度偏移需要额外高程策略。
- 动态地形高程采样不应默认每帧执行，后续需要明确采样频率和缓存策略。

## 风险 / 权衡

- `clipToTile: true` 时 polygon center 是瓦片片段中心，跨瓦片大面可能出现重复 label。→ 在 `STYLE.md` 中明确语义；后续通过服务端 label point、跨瓦片去重或动态 placement 解决。
- line 图层同时绘制 line 和 polygon outline 可能让混合几何 source layer 产生更多 primitive。→ 保持 Mapbox 风格的“线性表示”语义，并用测试覆盖混合几何。
- polygon center 使用面积 centroid 时可能落在凹多边形外部。→ 第一阶段接受该限制，预留 `polygon-visual-center` 做后续增强。
- worker 过滤规则变复杂，可能导致要素被错误丢弃或多保留。→ 将 source geometry 判定封装为共享函数并覆盖 decode/main-thread/bucket 测试。
