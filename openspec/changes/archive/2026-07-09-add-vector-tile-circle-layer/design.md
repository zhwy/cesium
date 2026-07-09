## Context

LoadVectorTile 的样式文档已经采用 Mapbox-like `sources` / `layers` 结构，并把 `fill`、`line`、`symbol` 分别路由到独立 bucket。`symbol` bucket 已通过 `BillboardCollection` 和 `HeightReference` 支持贴地，这为 `circle` 图层提供了可复用的 Cesium 贴地路径。

归档设计中曾把 `circle` 标记为预留类型，并建议第一版使用 `BillboardCollection + 动态圆形 canvas`，避免 `PointPrimitiveCollection` 贴地能力不足带来的高程采样复杂度。本变更将该预留能力落地。

## Goals / Non-Goals

**Goals:**

- 支持 `type: "circle"` 图层，并让它读取 MVT point / multipoint 要素。
- 使用 `BillboardCollection` 生成屏幕空间圆点，支持 `terrain.clampToGround`、`heightOffset` 和 `disableDepthTestDistance`。
- 支持 Mapbox 风格字段和简写别名，并允许属性表达式与 zoom 表达式动态求值。
- 明确半径和像素尺寸关系：创建圆点时 `pixelSize = radius * 2`。
- 覆盖 style 校验、decode 过滤、bucket 构建、文档和单元测试。

**Non-Goals:**

- 不使用 `PointPrimitiveCollection` 作为第一版实现。
- 不实现地形高程采样缓存或每帧高程更新。
- 不实现碰撞避让、点聚合、sprite atlas 打包或跨 tile 去重。
- 不让 `circle` 从 line 或 polygon 几何派生位置。

## Decisions

### 使用 BillboardCollection 承载 circle

`circle` bucket 新建 `VectorTileCircleBucket`，遍历 `packedLayer.points` 并为匹配样式的点创建 billboard。billboard 的 `image` 来自动生成的圆形 canvas，`position` 使用 `Cartesian3.fromDegrees` 加 `terrain.heightOffset`，`heightReference` 规则与 symbol billboard 保持一致：

- `clampToGround !== true` 时使用 `HeightReference.NONE`。
- `clampToGround: true` 且 `heightOffset === 0` 时使用 `HeightReference.CLAMP_TO_GROUND`。
- `clampToGround: true` 且 `heightOffset !== 0` 时使用 `HeightReference.RELATIVE_TO_GROUND`。

备选方案是 `PointPrimitiveCollection`。它更像点 primitive，但无法直接复用 billboard 的贴地语义，后续需要额外地形采样策略；第一版不采用。

### 样式字段以 Mapbox 命名为主，兼容简写别名

第一版支持以下字段，建议都放在 `paint` 中：

| 主字段 | 简写别名 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `circle-radius` | `pixelSize / 2` | `5` | 半径，单位像素 |
| `circle-color` | `color` | `#000000ff` | 填充色 |
| `circle-outline-color` | `outlineColor` | 无 | 描边色 |
| `circle-outline-width` | `outlineWidth` | `0` | 描边宽度，单位像素 |
| `circle-offset` | `offset` | 无 | billboard 像素偏移 `[x, y]` |

当主字段和别名同时存在时，主字段优先。这样既保留 Mapbox 风格习惯，也兼容现有 Cesium 风格配置口径。

### 半径到 pixelSize 的转换

`circle-radius` 的语义保持为半径。创建 circle point / billboard 图像选项时计算：

```text
radius = evaluate(circle-radius, metadata, zoom, fallback)
pixelSize = radius * 2
```

如果只配置 `pixelSize` 别名，则先把它解释为直径，再计算 `radius = pixelSize / 2`。无论来源是哪一个，最终创建点圆时都使用 `pixelSize = radius * 2`。

canvas 生成时需要为描边留出内部绘制空间，避免描边被裁剪；但对外的 circle 尺寸语义仍以 `radius * 2` 为核心，不把 `outlineWidth` 计入 `pixelSize`。

### 接入现有过滤和构建链路

`circle` 图层只使用 MVT geometry type `1`。需要在统一 geometry 判定中增加：

```text
circle -> point
```

这会同时驱动 worker decode 过滤和 main-thread filter fallback，避免 circle 要素在解码阶段被丢弃。

bucket factory 增加 `circle` 分支，将 `packedLayer.points` 传给 `VectorTileCircleBucket`。`VectorTileLayer` 的 build 白名单也加入 `circle`。

### 动态样式求值和图像复用

circle bucket 复用 `evaluateStyleValue`、`evaluateFiniteStyleNumber`、`evaluateColorStyleValue` 处理常量、属性表达式和 zoom 表达式。每个点在当前 tile build 的 style zoom 下求值。

动态 canvas 应按求值后的 `pixelSize`、填充色、描边色、描边宽度生成。为避免同一 tile 内重复创建相同图像，bucket 可维护局部 image cache，key 使用这些求值后的样式值。

## Risks / Trade-offs

- 大量逐要素动态样式可能生成较多 canvas → 在 bucket 内按求值后的样式 key 缓存 canvas。
- `circle` 使用 billboard 后拾取和贴地能力较好，但不是 Cesium 原生 point primitive → 接受该取舍，换取第一版贴地行为稳定。
- `outlineWidth` 不计入 `pixelSize` 可能让视觉外径略大于 `radius * 2` → 文档明确 `pixelSize` 是圆点主体直径，描边按 canvas 绘制处理。
- zoom 变化后已有 tile 的 circle 尺寸不会自动逐帧重算 → 沿用当前 vector tile style zoom/build 机制，通过 tile rebuild 或样式刷新更新。
