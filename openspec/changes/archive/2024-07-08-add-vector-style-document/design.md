## Context

`Apps/Demos/LoadVectorTile` 当前已经具备矢量瓦片请求、worker 解码、TypedArray 几何桶、GeometryInstance/packed 线渲染、LOD 稳定集合和缓存控制能力。当前结构中，`index.html` 是 Demo 入口，`src/` 存放运行时代码，`test/` 存放轻量 Node 测试，`src_old/` 仅作为旧实验版本备份。现有样式入口主要是 `VectorTileLayer` 的 `styles`：

```js
styles: {
  res_org_gr: {
    fill: true,
    fillColor: "#00ff0022",
  },
}
```

这个结构简单直接，但它把以下概念揉在了一起：

- 网络数据源：URL、层级、tile type、请求调度、缓存。
- PBF 内部 source-layer：例如 `res_org_gr`。
- 可见样式图层：面、线、文字、图标、过滤和排序。
- 渲染实现：Cesium Primitive、Polyline、Polygon、Billboard、Label。

随着需求进入“同一份瓦片数据多套样式规则、属性驱动样式、点渲染、过滤、贴地和高度偏移”，继续扩展现有 `styles` 会让数据复用和建桶边界越来越模糊。因此本变更引入参考 Mapbox `sources + layers` 的 style document，但内部实现命名和职责按 Cesium 规约组织：用 Provider 管数据加载，用 StyleRule 表达样式规则，用 PrimitiveBucket/Collection 管渲染结果。

## Goals / Non-Goals

**Goals:**

- 建立 `sources + layers` 的样式文档模型。
- 允许多个样式规则共享同一个矢量瓦片数据 Provider，避免重复请求和重复解码同一份 PBF。
- 支持 `fill`、`line`、`symbol` 三类样式图层。
- 支持面填充色、面线框色、面线框宽度，线颜色、线宽，点图标、点文字。
- 支持属性驱动样式值和基础表达式。
- 支持每个样式配置 layer 独立 `filter`，内部规范化为 `VectorTileStyleRule`。
- 支持 3D 扩展配置：`clampToGround` 和 `heightOffset`。
- 保留旧版 `styles` 配置的兼容转换，降低 Demo 迁移成本。

**Non-Goals:**

- 不完整实现 Mapbox Style Specification 的全部表达式、布局规则和碰撞检测。
- 不实现符号避让、沿线文字、图标旋转对齐、字体栈管理等高级 symbol 能力。
- 不新增服务端能力，不要求服务端按样式预处理瓦片。
- 不在本变更中解决面透明排序的所有通用问题；仅保证新样式架构不会引入重复绘制。
- 不把 `Apps/Demos/LoadVectorTile` 直接升级成 Cesium 正式 API；本变更仍限定在 Demo/实验框架。

## Decisions

### Decision 1: 使用 Style Document 作为外部配置入口，内部命名向 Cesium 靠拢

新增配置结构：

```js
{
  sources: {
    org: {
      type: "vector",
      url: ".../{z}/{x}/{y}.pbf",
      minimumLevel: 0,
      maximumLevel: 10,
      tileType: "XYZ"
    }
  },
  layers: [
    {
      id: "org-fill",
      type: "fill",
      source: "org",
      sourceLayer: "res_org_gr",
      filter: ["==", ["get", "status"], "active"],
      paint: {
        "fill-color": "#00ff0044",
        "fill-outline-color": "#00ff00",
        "fill-outline-width": 1
      },
      terrain: {
        clampToGround: false,
        heightOffset: 1.0
      }
    }
  ]
}
```

理由：

- 与 Mapbox 的 mental model 接近，用户容易理解。
- 能自然表达“同一 source 多个 layer”。
- 能把数据请求生命周期和样式生命周期分开。
- 外部字段保留 `sources/layers` 便于迁移和表达，内部类名不照搬 Mapbox；实现时使用 Cesium 更常见的 Provider、Appearance、Primitive、Collection 等语义。

备选方案：

- 继续扩展 `styles: { sourceLayerName: style }`：短期改动小，但无法优雅支持同 source 多 layer、layer 顺序和 filter。
- 每种几何类型单独 addLayer：容易造成同一 URL 重复请求/解码，性能上不划算。

### Decision 2: 引入 `VectorTileDataProvider` 和 `VectorTileStyleRule` 分离数据与样式

`VectorTileDataProvider` 负责：

- provider 创建和 URL 模板。
- tile availability。
- 网络请求。
- worker 解码。
- source-level tile cache。
- 解码结果按 source-layer 存储。

`VectorTileStyleRule` 负责：

- style document 中单个 layer 配置的规范化结果。
- filter。
- paint/layout/terrain。
- render bucket 构建策略。

这样外部同一个 `source` 被多个样式 layer 使用时，内部同一个 `VectorTileDataProvider` 只请求一次、只解码一次；每个 `VectorTileStyleRule` 再独立生成自己的渲染桶。

备选方案：

- 每个 style document layer 仍创建一个 `VectorTileLayer`：实现简单，但命名和职责容易与现有 Cesium-like layer 混淆，也会把性能瓶颈重新带回来，尤其是同一数据既画面又画边界和文字时。

### Decision 3: 表达式实现 Mapbox 子集，而不是完整兼容

第一阶段支持：

- `["get", name]`
- `["has", name]`
- `["==", a, b]`
- `["!=", a, b]`
- `[">", a, b]`
- `[">=", a, b]`
- `["<", a, b]`
- `["<=", a, b]`
- `["all", ...conditions]`
- `["any", ...conditions]`
- `["case", condition, value, fallback]`
- `["match", input, key1, value1, ..., fallback]`
- `["zoom"]`
- `["interpolate", ["linear"], ["zoom"], z1, v1, z2, v2, ...]`

理由：

- 覆盖当前属性取值、分类设色、过滤和 zoom 线宽的核心需求。
- 控制实现复杂度，避免一次性引入完整 Mapbox 表达式的类型系统。

备选方案：

- 完整 Mapbox expression：兼容性最好，但实现和测试成本明显更高。
- 只支持函数回调：灵活但无法序列化到 worker，且不利于后续做样式缓存 key。

### Decision 4: filter 尽量在 worker 或建桶前执行，且不允许函数 filter

过滤策略：

- 静态属性 filter 在 worker 解码阶段或主线程建桶前执行。
- filter 命中的要素才进入对应 style rule 的 render bucket。
- 每个 style rule 拥有自己的 bucket；同一 source-layer 可以被多个 style rule 独立过滤。
- filter 表达式必须是可序列化数组表达式，不允许用户传函数。

理由：

- 尽早减少传输到主线程和创建 geometry instance 的成本。
- 保持每个 style rule 的过滤语义独立。
- 禁止函数 filter 可以保证配置可序列化、可下发 worker、可生成稳定 cache key，也避免主线程隐式执行任意用户逻辑。

备选方案：

- 在 primitive 创建后控制 show：能动态开关，但前期构建成本没有减少。

### Decision 5: 点渲染优先使用 Cesium Collection，并先支持 URL/Image/Canvas 图标资源

点图标使用 `BillboardCollection`，点文字使用 `LabelCollection`。每个 tile/style rule 可生成一个或多个 symbol bucket。

图标资源第一阶段支持 URL、`HTMLImageElement` 或 `HTMLCanvasElement` 注册/解析；不强制实现 sprite atlas。sprite atlas 可以作为后续性能优化。

理由：

- Billboard/Label 是 Cesium 对屏幕空间点符号更自然的抽象。
- 支持文字、图标、缩放、距离显示等后续扩展。
- 比给每个点创建几何体更适合标签类需求。
- URL/Image/Canvas 覆盖 Demo 阶段常见用法，复杂度低于一次性实现完整 sprite atlas。

备选方案：

- 用 GeometryInstance 渲染点：适合纯几何点，不适合图标和文字。
- 用 Entity：使用方便，但大量瓦片点数据下开销偏高。

### Decision 6: 3D 扩展放入 `terrain` 配置，polygon 默认不贴地

每个样式规则支持：

```js
terrain: {
  clampToGround: true,
  heightOffset: 1.0
}
```

理由：

- Mapbox 的 paint/layout 是 2D 地图语义，Cesium 的贴地、高度偏移属于 3D 场景扩展。
- 独立字段可以避免污染 paint 属性，也便于后续扩展 `height`、`extrudedHeight`、`distanceDisplayCondition`。
- polygon 默认不贴地，延续当前通过小高度偏移减少共面闪烁的行为；当 `clampToGround: true` 时，polygon 优先使用 Cesium `GroundPrimitive` 路径。

备选方案：

- 把 `clampToGround`、`heightOffset` 放进 paint：配置更少，但语义混杂。

### Decision 7: 兼容旧版 `styles`

`manager.addLayer({ url, styles })` 继续可用，但内部会转换为等价 style document：

- 每个 `styles` key 变成一个 sourceLayer。
- 每个旧 style 根据字段生成 `fill` 或 `line` layer。
- 如果同一个旧配置同时包含面和线，拆成两个 style rule。

理由：

- 不破坏当前 demo。
- 方便逐步迁移 README 和示例。

## Risks / Trade-offs

- [Risk] 拆分数据 Provider 和样式规则后，现有 `VectorTileLayer` 职责重构较大，容易引入生命周期 bug。 → Mitigation：分阶段实现，先通过兼容 adapter 保持旧 API，再逐步内聚到新类。
- [Risk] 同一 source 多个样式规则会增加每个瓦片的 bucket 数量。 → Mitigation：数据 Provider 请求/解码共享，bucket 按样式规则增量构建；诊断中增加 bucket 数和 style rule 数。
- [Risk] 属性表达式如果在主线程逐 feature 计算，可能造成卡顿。 → Mitigation：静态 filter 和可序列化表达式优先下放 worker；zoom 表达式只在必要时计算。
- [Risk] Cesium GroundPrimitive、Primitive、Polyline、Billboard、Label 的贴地/高度行为不完全一致。 → Mitigation：先定义统一语义，再按几何类型记录差异；无法完全贴地的组合在文档中明确。
- [Risk] symbol 点渲染缺少碰撞避让时，高密度数据会遮挡。 → Mitigation：第一阶段接受遮挡；后续可新增 declutter/collision 专项优化。

## Migration Plan

1. 新增 style document 解析与校验模块，不改变旧调用路径。
2. 新增旧 `styles` 到 style document 的兼容转换。
3. 引入 `VectorTileDataProvider`，先让单 source 单 layer 路径跑通。
4. 切换 manager 内部到 Provider/StyleRule 分离模型。
5. 增加 fill/line/symbol bucket。
6. 增加表达式和 filter。
7. 更新 Demo 和 README。

回滚策略：

- 保留旧 `manager.addLayer({ url, styles })` 路径作为兼容层。
- 若新 style document 路径出现问题，可以临时关闭 `manager.setStyle()` 示例，继续使用旧 API。

## Resolved Questions

- `clampToGround` 对 polygon 的策略：默认不贴地；设置 `clampToGround: true` 后使用 Cesium `GroundPrimitive` 路径。
- symbol 图标资源策略：第一阶段先支持 URL、`HTMLImageElement` 和 `HTMLCanvasElement`；暂不强制实现 sprite atlas。
- filter 表达式策略：不允许用户传函数；只支持可序列化表达式，确保可进入 worker 和 cache key。
