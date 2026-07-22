# LoadVectorTile 样式配置参考

本文档说明 `Apps/Demos/LoadVectorTile` demo 支持的完整 style document 配置。它沿用 `sources + layers` 的组织方式，但字段语义是围绕 Cesium 当前实现定义的，不等同于完整的 Mapbox Style 规范。

## 1. 顶层结构

```js
{
  version: 1,
  sources: {
    sourceId: {
      type: "vector",
      url: "http://localhost:10101/tiles/{z}/{x}/{-y}.pbf",
      minimumLevel: 0,
      maximumLevel: 10,
      tileType: "XYZ",
      renderBackend: "instances",
      clipToTile: true,
      allowPicking: false,
      pickProperties: ["name", "kind"],
    },
  },
  layers: [
    {
      id: "layer-id",
      type: "fill" | "line" | "symbol" | "circle",
      source: "sourceId",
      sourceLayer: "pbf-source-layer-name",
      minzoom: 0,
      maxzoom: 24,
      filter: ["==", ["get", "kind"], "park"],
      layout: {},
      paint: {},
      terrain: {},
      visibility: true,
      metadata: {},
    },
  ],
  metadata: {},
}
```

三个名字的关系：

- `source id`：`sources` 对象中的键，例如 `base`、`world`。
- `layer id`：单个样式图层的唯一标识，例如 `country-fill`。
- `sourceLayer`：PBF 瓦片内部的 source-layer 名称，必须和数据里的一致。

`source` 决定从哪个数据源取瓦片，`sourceLayer` 决定从瓦片里读哪一层要素，`id` 决定当前样式图层本身的身份。

## 2. source 配置

`sources[sourceId]` 目前只支持 `type: "vector"`。

常用字段：

| 字段                     | 说明                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------- |
| `type`                   | 固定为 `vector`。                                                                                       |
| `url`                    | 瓦片地址模板。                                                                                          |
| `minimumLevel`           | 最低请求层级。                                                                                          |
| `maximumLevel`           | 最高请求层级。                                                                                          |
| `tileType`               | `XYZ` 或 `WMTS`。                                                                                       |
| `renderBackend`          | 线渲染后端，`instances` 或 `packed`。                                                                   |
| `packedMinimumInstances` | packed 线后端的最少线数量阈值。                                                                         |
| `clipToTile`             | 是否裁剪到瓦片边界。建议保持 `true`。                                                                   |
| `allowPicking`           | 是否保留要素属性用于拾取。                                                                              |
| `pickProperties`         | `allowPicking: true` 时公开拾取属性。未配置返回全部属性；字符串数组只返回指定字段；空数组不返回属性值。 |
| `cacheBytes`             | 单 runtime layer 的渲染缓存预算估算值。                                                                 |
| `asynchronous`           | instances 后端是否允许 Cesium 异步建模。                                                                |
| `shadows`                | 是否参与阴影。                                                                                          |

这些字段写在 `manager.setStyle(styleDocument)` 的 `sources[sourceId]` 中；如果你已经创建了自定义 `VectorTileProvider`，也可以直接通过 `manager.addLayerProvider(provider)` 注入。`manager.addLayer(sourceId, layerOptions)` 只追加单个样式图层，不负责 source 配置。

原始 PBF 缓存使用 `VectorTileLayerManager` 构造参数 `pbfCacheBytes` 配置，它是 manager 下所有 source 共用的 ready PBF master payload 总预算，不属于 `sources[sourceId]` 字段，也不包含在 `cacheBytes` 中。`tileCacheSize` 则单独控制 Cesium 四叉树保留的 surface tile 数量。

## 3. 图层通用字段

每个 `layers[]` 元素都支持以下通用字段：

| 字段          | 必填 | 说明                                                                                           |
| ------------- | ---- | ---------------------------------------------------------------------------------------------- |
| `id`          | 是   | 当前样式图层唯一 id。                                                                          |
| `type`        | 是   | 当前可用值为 `fill`、`line`、`symbol` 或 `circle`。                                            |
| `source`      | 是   | 关联的 source id。                                                                             |
| `sourceLayer` | 是   | PBF 内部 source-layer 名称。                                                                   |
| `minzoom`     | 否   | 当前图层的最小可见 zoom。                                                                      |
| `maxzoom`     | 否   | 当前图层的最大可见 zoom，语义为排他上界。                                                      |
| `filter`      | 否   | 可序列化过滤表达式。                                                                           |
| `layout`      | 否   | 主要放几何布局和 symbol 相关字段。                                                             |
| `paint`       | 否   | 主要放颜色、宽度、文字外观等字段。                                                             |
| `terrain`     | 否   | Cesium 三维扩展，控制贴地和高度偏移。                                                          |
| `visibility`  | 否   | 顶层布尔显隐。`false` 时图层不会参与初始解码和建桶；运行时改变可走原地显隐或目标 bucket 构建。 |
| `metadata`    | 否   | 自定义透传数据。                                                                               |

`layout.visibility` 可作为兼容输入，接受 `true`、`false`、`"visible"` 和 `"none"`；规范化后同步到顶层布尔 `visibility`。如果顶层 `visibility` 和 `layout.visibility` 同时设置，以顶层为准。

## 4. 拾取属性与 feature 解析

开启拾取时，渲染对象只保存紧凑 id，公开结果需要通过 manager 解析：

```js
const picked = viewer.scene.pick(windowPosition);
const feature = manager.resolvePickedFeature(picked);
```

有效返回包含：

```js
{
  id,
  properties,
  sourceId,
  sourceLayer,
  styleLayerId,
  tile: { x, y, level },
  featureIndex,
  sourceFeatureIndex,
}
```

`picked.id.properties` 不再作为公开 API 使用。`resolvePickedFeature()` 是同步方法，不解析 PBF，也不发起网络请求；旧瓦片或已替换 bucket 的 picked 对象会返回 `undefined`。

`pickProperties` 的语义：

| source 配置                                    | Worker 长期保留             | `resolvePickedFeature().properties` |
| ---------------------------------------------- | --------------------------- | ----------------------------------- |
| `allowPicking: false`                          | 仅样式需要的属性            | 不注册拾取，返回 `undefined`        |
| `allowPicking: true` 且未配置 `pickProperties` | 样式需要属性 + 全部公开属性 | 全部 properties                     |
| `pickProperties: ["name", "kind"]`             | 样式需要属性 + `name/kind`  | 只返回存在的 `name/kind`            |
| `pickProperties: []`                           | 仅样式需要的属性            | `{}`                                |

样式表达式中 `["get", "field"]`、`["has", "field"]` 会被静态收集；动态属性名无法静态判断时会回退为保留全部属性，以保证样式正确。

## 5. 样式热更新矩阵

`manager.setLayerStyle(layerId, patch)` 会先规范化并分类差异：

| 变化                                                                                 | 行为                                                                                       |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| 规范化后无变化                                                                       | `NO_OP`，不推进 `contentRevision`，不请求、不解码、不建桶。                                |
| `line-color`、`fill-color`、`fill-outline-color`                                     | instances 通过 per-instance color attribute 更新；packed line 通过 material uniform 更新。 |
| `circle-color`、`circle-outline-color`                                               | 更新已提交 Billboard image；未提交描述在下次提交前同步。                                   |
| `text-color`、`text-halo-color`、`text-background-color`                             | 更新 Label 现有属性。                                                                      |
| 顶层 `visibility`                                                                    | 已构建 Primitive/点对象直接切换 `show`；隐藏不销毁 bucket。                                |
| 显示从未构建或已驱逐的 layer                                                         | 只重建目标 style layer bucket。                                                            |
| 新颜色表达式引用未驻留属性                                                           | 只重建目标 style layer bucket，并通过 PBF cache/request 重新投影所需属性。                 |
| fill alpha 与当前 Appearance render state 不兼容                                     | 只重建目标 style layer bucket。                                                            |
| `filter`、`sourceLayer`、`type`、线宽、高度、layout、图标资源、scene、render backend | source 级 rebuild，推进 `contentRevision`。                                                |

目标 bucket replacement 会保留旧 bucket 继续绘制，直到新 bucket 可用后再替换；替换时会注销旧 Primitive/Billboard/Label 的拾取上下文。离屏瓦片只标记 dirty，重新进入提交候选时才调度 replacement。

## 6. fill 图层

`type: "fill"` 用于绘制面。

### 6.1 `paint`

| 字段                 | 类型            | 默认值                    | 说明                                   |
| -------------------- | --------------- | ------------------------- | -------------------------------------- |
| `fill-color`         | 颜色或表达式    | `#ff000077`               | 面颜色。                               |
| `fill-outline-color` | 颜色或表达式    | 无                        | 面轮廓线颜色。未配置时不绘制 outline。 |
| `fill-outline-width` | 数字或表达式    | `1`                       | 面轮廓线宽。                           |
| `arcType`            | Cesium 弧线类型 | `Cesium.ArcType.GEODESIC` | 轮廓线弧线类型。                       |

### 6.2 行为说明

- `fill` 当前由 `VectorTileFillBucket` 负责。
- `fill` 会绘制 polygon / multipolygon；当 source layer 中是 line / multiline 时，会把至少 3 个点的线作为单环面绘制，不闭合的线会自动追加起点强制闭合。
- 当 `terrain.clampToGround: true` 且 `heightOffset === 0` 时，使用 `GroundPrimitive`。
- 当配置 `fill-outline-color` 时，会额外生成 outline primitive。
- `clipToTile: true` 且存在瓦片边界信息时，落在瓦片边界上的 outline 线段会被跳过，避免相邻瓦片重复描边。

## 7. line 图层

`type: "line"` 用于绘制线。

### 7.1 `paint`

| 字段         | 类型            | 默认值                    | 说明           |
| ------------ | --------------- | ------------------------- | -------------- |
| `line-color` | 颜色或表达式    | `#ffff00ff`               | 线颜色。       |
| `line-width` | 数字或表达式    | `2`                       | 线宽。         |
| `arcType`    | Cesium 弧线类型 | `Cesium.ArcType.GEODESIC` | 线的弧线类型。 |

### 7.2 行为说明

- `line` 当前由 `VectorTileLineBucket` 负责。
- `line` 图层会自动绘制 source layer 中所有可线化几何：
  - line / multiline 按原始线要素绘制；
  - polygon / multipolygon 按 polygon outline 绘制。
- 当 `terrain.clampToGround: true` 且 `heightOffset === 0` 时，使用 `GroundPolylinePrimitive`。
- 当 `clipToTile: true` 且存在瓦片边界信息时，由 polygon 派生的 outline 会跳过落在瓦片边界上的线段，避免相邻瓦片重复描边。
- 当 source 配置 `renderBackend: "packed"`，且满足以下条件时，线会走 packed 后端：
  - `allowPicking === false`
  - 线数量达到 `packedMinimumInstances`
  - `line-color` 和 `line-width` 不是表达式
  - 当前不是贴地线
- 当当前图层需要同时绘制 polygon outline 时，会回退到普通 instances 后端。
- 不满足条件时会自动回退到普通 instances 后端。

## 8. symbol 图层

`type: "symbol"` 用于绘制点图标和文字。

### 8.1 placement

| 字段               | 类型   | 默认值  | 说明                                                                         |
| ------------------ | ------ | ------- | ---------------------------------------------------------------------------- |
| `symbol-placement` | 字符串 | `point` | 控制 symbol 从哪类源几何派生位置。第一阶段支持 `point` 和 `polygon-center`。 |

`symbol-placement` 语义：

- `point`：读取点要素，保持当前 point symbol 行为。
- `polygon-center`：读取面要素，基于每个已解码 polygon 片段计算中心点，然后在该中心点绘制图标和文字。

### 8.2 icon layout

| 字段          | 类型              | 默认值   | 说明                                            |
| ------------- | ----------------- | -------- | ----------------------------------------------- |
| `icon-image`  | 字符串或表达式    | 无       | 图标名、URL，或已注册图像。未配置时不绘制图标。 |
| `icon-size`   | 数字或表达式      | `1`      | Cesium billboard `scale`。                      |
| `icon-width`  | 数字或表达式      | 无       | billboard 宽度，单位像素。                      |
| `icon-height` | 数字或表达式      | 无       | billboard 高度，单位像素。                      |
| `icon-anchor` | 字符串或表达式    | `center` | 图标锚点。                                      |
| `icon-offset` | `[x, y]` 或表达式 | 无       | 图标像素偏移，单位像素。                        |

### 8.3 text layout

| 字段               | 类型                   | 默认值       | 说明                                                          |
| ------------------ | ---------------------- | ------------ | ------------------------------------------------------------- |
| `text-field`       | 字符串或表达式         | 无           | 文字内容。未配置时不绘制文字。                                |
| `text-size`        | 数字或表达式           | `16`         | 字号。                                                        |
| `text-font`        | CSS 字体字符串或表达式 | 无           | 直接写入 Cesium `Label.font`。                                |
| `text-font-family` | 字体族字符串或表达式   | `sans-serif` | 当未提供 `text-font` 时，和 `text-size` 组合成 `Label.font`。 |
| `text-anchor`      | 字符串或表达式         | `center`     | 文字锚点。                                                    |
| `text-offset`      | `[x, y]` 或表达式      | 无           | 文字像素偏移，单位像素。                                      |

### 8.4 text paint

| 字段                      | 类型                    | 默认值      | 说明                                              |
| ------------------------- | ----------------------- | ----------- | ------------------------------------------------- |
| `text-color`              | 颜色或表达式            | `#ffffffff` | 文字填充色。                                      |
| `text-halo-color`         | 颜色或表达式            | `#000000ff` | 文字描边色。                                      |
| `text-halo-width`         | 数字或表达式            | `0`         | 文字描边宽度。                                    |
| `text-background-color`   | 颜色或表达式            | 无          | 文字背景色。配置后会启用 `Label.showBackground`。 |
| `text-background-padding` | 数字、`[x, y]` 或表达式 | 无          | 文字背景内边距，单位像素。                        |

### 8.5 锚点取值

`text-anchor` 和 `icon-anchor` 都支持以下取值：

| 值             | HorizontalOrigin | VerticalOrigin |
| -------------- | ---------------- | -------------- |
| `center`       | `CENTER`         | `CENTER`       |
| `left`         | `LEFT`           | `CENTER`       |
| `right`        | `RIGHT`          | `CENTER`       |
| `top`          | `CENTER`         | `TOP`          |
| `bottom`       | `CENTER`         | `BOTTOM`       |
| `top-left`     | `LEFT`           | `TOP`          |
| `top-right`    | `RIGHT`          | `TOP`          |
| `bottom-left`  | `LEFT`           | `BOTTOM`       |
| `bottom-right` | `RIGHT`          | `BOTTOM`       |

未配置或值非法时，回退到 `center`。

### 8.6 偏移与尺寸回退

- `icon-offset` 和 `text-offset` 都按 Cesium `Cartesian2` 语义解释。
- `[x, y]` 中 `x` 为向右，`y` 为向上。
- `icon-width`、`icon-height`、`text-size`、`text-halo-width`、`text-background-padding` 的求值结果如果不是有限数：
  - 有默认值的字段回退到默认值；
  - 没有默认值的字段会被省略。
- 未配置 `icon-width` / `icon-height` 时，Cesium 会使用源图像尺寸。
- `text-font` 优先级高于 `text-font-family`。
- `symbol-placement: "polygon-center"` 时，`icon-*` 和 `text-*` 字段仍按普通 symbol 规则求值，只是位置来自 polygon center。

## 9. circle 图层

`type: "circle"` 用于绘制点要素的屏幕空间圆点。当前实现使用 `BillboardCollection + 动态圆形 canvas`，因此可以复用 billboard 的贴地能力。

推荐配置形态：

```js
{
  id: "city-circle",
  type: "circle",
  source: "base",
  sourceLayer: "places",
  filter: ["==", ["get", "kind"], "city"],
  paint: {
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 3, 10, 8],
    "circle-color": "#ff6600cc",
    "circle-outline-color": "#ffffffff",
    "circle-outline-width": 1,
  },
  terrain: {
    clampToGround: true,
    heightOffset: 0,
  },
}
```

### 9.1 `paint`

| 字段                   | 别名            | 类型              | 默认值      | 说明                           |
| ---------------------- | --------------- | ----------------- | ----------- | ------------------------------ |
| `circle-radius`        | `pixelSize / 2` | 数字或表达式      | `5`         | 圆点半径，单位像素。           |
| `circle-color`         | `color`         | 颜色或表达式      | `#000000ff` | 圆点填充色。                   |
| `circle-outline-color` | `outlineColor`  | 颜色或表达式      | 无          | 圆点描边色。                   |
| `circle-outline-width` | `outlineWidth`  | 数字或表达式      | `0`         | 圆点描边宽度，单位像素。       |
| `circle-offset`        | `offset`        | `[x, y]` 或表达式 | 无          | billboard 像素偏移，单位像素。 |

说明：

- 主字段和别名同时存在时，优先使用 `circle-*` 主字段。
- `pixelSize` 别名表示直径；如果只配置 `pixelSize`，内部会按 `radius = pixelSize / 2` 解释。
- 创建圆点图像时始终使用 `pixelSize = radius * 2`。
- 当前未实现 `circle-opacity`、`circle-blur` 等附加字段。

### 9.2 行为说明

- `circle` 当前由 `VectorTileCircleBucket` 负责。
- `circle` 图层只匹配 point / multipoint 要素，不读取 line 或 polygon。
- `circle` 的颜色、尺寸、描边和 offset 都支持常量、属性表达式和动态 zoom 表达式。
- 圆点图像会按求值后的尺寸和颜色缓存复用，避免同一瓦片内重复创建相同 canvas。
- 描边绘制在圆点主体内部，因此 `circle-radius` 的外径语义保持稳定，不把描边额外计入 `pixelSize`。

## 10. terrain 三维扩展

每个样式图层都可以配置：

```js
terrain: {
  clampToGround: true,
  heightOffset: 0,
  disableDepthTestDistance: 1000000,
}
```

其中：

- `clampToGround`：是否尽量贴地。
- `heightOffset`：高度偏移。
- `disableDepthTestDistance`：当前对 `symbol` 和 `circle` 生效，透传到 Cesium billboard / label。

几何类型行为如下：

| 几何类型 | `clampToGround: false`                    | `clampToGround: true, heightOffset: 0` | `clampToGround: true, heightOffset != 0` |
| -------- | ----------------------------------------- | -------------------------------------- | ---------------------------------------- |
| `fill`   | 普通 `Primitive + PolygonGeometry`        | `GroundPrimitive`                      | 回退到普通高度面，并记录诊断             |
| `line`   | 普通 `Primitive + PolylineGeometry`       | `GroundPolylinePrimitive`              | 回退到普通高度线，并记录诊断             |
| `symbol` | `BillboardCollection` / `LabelCollection` | `HeightReference.CLAMP_TO_GROUND`      | `HeightReference.RELATIVE_TO_GROUND`     |
| `circle` | `BillboardCollection`                     | `HeightReference.CLAMP_TO_GROUND`      | `HeightReference.RELATIVE_TO_GROUND`     |

## 11. 表达式

当前样式值支持以下可序列化表达式子集：

- `["get", "name"]`
- `["has", "kind"]`
- `["match", ["get", "type"], "park", "#00ff0044", "#0088ff33"]`
- `["case", [">", ["get", "population"], 1000000], 18, 14]`
- `["interpolate", ["linear"], ["zoom"], 1, 1, 6, 4]`
- `["concat", ["upcase", ["coalesce", ["get", "name"], "unknown"]], " #", ["to-string", ["id"]]]`

### 11.1 合法签名

| 类别         | 合法签名                                                                                                                                           |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 属性与上下文 | `["get", key]`、`["has", key]`、`["feature-state", key]`、`["id"]`、`["zoom"]`                                                                     |
| 布尔与比较   | `["boolean", value, fallback]`、`["!", value]`、`["==", a, b]`、`["!=", a, b]`、`[">", a, b]`、`[">=", a, b]`、`["<", a, b]`、`["<=", a, b]`       |
| 组合与分支   | `["all", value, ...]`、`["any", value, ...]`、`["case", condition, output, ..., fallback]`、`["match", input, label, output, ..., fallback]`       |
| 成员与查找   | `["in", needle, haystack]`、`["index-of", needle, haystack, start?]`、`["slice", input, start, end?]`、`["length", input]`、`["at", index, array]` |
| 字符串       | `["to-string", value]`、`["concat", value, ...]`、`["upcase", string]`、`["downcase", string]`                                                     |
| 缺失值与常量 | `["coalesce", value1, value2, ...]`、`["literal", value]`                                                                                          |
| 插值         | `["interpolate", ["linear"], input, stop1, output1, stop2, output2, ...]`                                                                          |

参数数量会在样式规范化时严格校验。`case`、`match` 必须包含完整的成对参数和最终 fallback；`interpolate` 至少包含两组 stop/output。`["linear"]` 只能作为 `interpolate` 的插值模式，不能独立使用。

### 11.2 字符串、数组与缺失值

- 表达式中的数组常量必须写成 `["literal", [...]]`，其内容不会被当作表达式或属性依赖继续遍历。
- `in` 对数组使用严格成员匹配；字符串容器只接受字符串查询值。
- `index-of` 未找到时返回 `-1`；`slice` 使用 JavaScript 左闭右开与负索引语义；`at` 只接受非负整数数组索引。
- `length` 只接受字符串或数组。`upcase`、`downcase` 只接受字符串，并使用 JavaScript 的非 locale 定制 Unicode 大小写转换。
- `to-string` 将 `null`/`undefined` 转成空字符串，string/number/boolean 转成稳定字符串，数组和普通对象转成 JSON；`concat` 对每个输入复用同一规则。
- `coalesce` 返回首个既不是 `null` 也不是 `undefined` 的值；`false`、`0` 和空字符串都是有效结果。`id` 保持 feature id 原有的 string/number 类型。
- feature property 的运行时类型错误、非法索引和越界读取返回 `undefined`，由样式值 fallback 或 filter 的布尔结果处理，不中断瓦片构建。表达式形状、参数数量、非法 `literal` 或不可序列化常量则会在样式校验阶段报出包含路径和操作符的错误。

可用于：

- `fill-color`
- `fill-outline-color`
- `fill-outline-width`
- `line-color`
- `line-width`
- `icon-image`
- `icon-size`
- `icon-width`
- `icon-height`
- `icon-offset`
- `text-field`
- `text-size`
- `text-font`
- `text-font-family`
- `text-anchor`
- `text-offset`
- `text-color`
- `text-halo-color`
- `text-halo-width`
- `text-background-color`
- `text-background-padding`
- `circle-radius`
- `circle-color`
- `circle-outline-color`
- `circle-outline-width`
- `circle-offset`
- `pixelSize`
- `color`
- `outlineColor`
- `outlineWidth`
- `offset`

说明：

- `packed` 线后端要求 `line-color` 和 `line-width` 为常量，表达式会让该图层自动回退到 instances。
- `text-background-padding`、`icon-offset`、`text-offset` 的数组值当前建议直接写常量数组。

## 12. filter

`filter` 使用可序列化过滤表达式。常见示例：

```js
["==", ["get", "kind"], "park"];
["all", ["has", "name"], [">", ["get", "population"], 100000]];
["match", ["get", "class"], ["motorway", "trunk"], true, false];
["in", ["get", "kind"], ["literal", ["park", "water"]]];
```

过滤在 worker 可支持时会尽量前移；如果表达式不在 worker 支持范围内，会回退到主线程过滤。

几何类型和 filter 的组合规则：

- `fill` 图层匹配 polygon 要素，也匹配 line 要素；line 要素至少 3 个点时会被填充为面，不闭合时会自动补闭合点。
- `line` 图层匹配 line 要素，也匹配 polygon 要素并将其渲染为 outline。
- `symbol-placement: "point"` 匹配 point 要素。
- `symbol-placement: "polygon-center"` 匹配 polygon 要素。
- `circle` 图层只匹配 point 要素。

## 13. 图标注册

`icon-image` 可以直接写 URL，也可以写注册名。

### 13.1 初始化时传入

```js
const manager = new VectorTileLayerManager({
  iconImages: {
    capital: "http://localhost:10101/icons/capital.png",
  },
});
```

`manager.addLayer(sourceId, layerOptions)` 用于向现有 source 对应的 layer 追加单个样式图层（样式由 layer 持有，provider 只负责数据源）；多 source 组合初始化请使用 `manager.setStyle(styleDocument)`。如果你已经手里有自定义 `VectorTileProvider`，可以直接调用 `manager.addLayerProvider(provider)`。

### 13.2 运行时注册

```js
layer.registerIconImage("capital", imageOrCanvasOrUrl);
```

支持的图像来源：

- 已注册名称
- URL 字符串
- `HTMLImageElement`
- `HTMLCanvasElement`

## 14. 完整示例

下面的示例覆盖面、线、polygon outline、图标、文字、背景、锚点、尺寸、表达式、过滤和 terrain：

```js
manager.setStyle({
  version: 1,
  sources: {
    base: {
      type: "vector",
      url: "http://localhost:10101/tiles/{z}/{x}/{-y}.pbf",
      minimumLevel: 0,
      maximumLevel: 10,
      tileType: "XYZ",
      renderBackend: "packed",
      packedMinimumInstances: 200,
      clipToTile: true,
      allowPicking: true,
    },
  },
  layers: [
    {
      id: "country-fill",
      type: "fill",
      source: "base",
      sourceLayer: "countries",
      filter: ["==", ["get", "kind"], "land"],
      paint: {
        "fill-color": [
          "match",
          ["get", "class"],
          "park",
          "#00aa4444",
          "#2255ff33",
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
      id: "road-line",
      type: "line",
      source: "base",
      sourceLayer: "roads",
      filter: ["match", ["get", "class"], ["motorway", "trunk"], true, false],
      paint: {
        "line-color": "#ffcc00ff",
        "line-width": ["interpolate", ["linear"], ["zoom"], 4, 1, 10, 4],
      },
      terrain: {
        clampToGround: true,
        heightOffset: 0,
      },
    },
    {
      id: "country-boundary-line",
      type: "line",
      source: "base",
      sourceLayer: "countries",
      filter: ["==", ["get", "kind"], "land"],
      paint: {
        "line-color": "#ffffffaa",
        "line-width": 1,
      },
    },
    {
      id: "city-circle",
      type: "circle",
      source: "base",
      sourceLayer: "places",
      filter: ["==", ["get", "kind"], "city"],
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 3, 10, 8],
        "circle-color": ["get", "color"],
        "circle-outline-color": "#ffffffff",
        "circle-outline-width": 1,
        "circle-offset": [0, 4],
      },
      terrain: {
        clampToGround: true,
        heightOffset: 0,
        disableDepthTestDistance: 1000000,
      },
    },
    {
      id: "capital-symbol",
      type: "symbol",
      source: "base",
      sourceLayer: "places",
      filter: ["==", ["get", "capital"], true],
      layout: {
        "icon-image": ["get", "icon"],
        "icon-size": 1,
        "icon-width": ["get", "iconWidth"],
        "icon-height": ["get", "iconHeight"],
        "icon-anchor": "bottom",
        "icon-offset": [0, 8],
        "text-field": ["get", "name"],
        "text-size": ["case", [">", ["get", "population"], 5000000], 18, 14],
        "text-font-family": '"Noto Sans SC", sans-serif',
        "text-anchor": "top",
        "text-offset": [0, -18],
      },
      paint: {
        "text-color": "#ffffffff",
        "text-halo-color": "#000000cc",
        "text-halo-width": 2,
        "text-background-color": "#102030cc",
        "text-background-padding": [6, 4],
      },
      terrain: {
        clampToGround: true,
        heightOffset: 12,
        disableDepthTestDistance: 1000000,
      },
    },
    {
      id: "country-label",
      type: "symbol",
      source: "base",
      sourceLayer: "countries",
      filter: ["has", "name"],
      layout: {
        "symbol-placement": "polygon-center",
        "text-field": ["get", "name"],
        "text-size": 12,
      },
      paint: {
        "text-color": "#dde8ffff",
        "text-halo-color": "#102030ff",
        "text-halo-width": 2,
      },
    },
  ],
});
```

## 15. 已知限制

- `circle` 当前使用 billboard + canvas 路径，而不是 Cesium `PointPrimitiveCollection`。
- `circle` 的描边绘制在主体半径内部，`circle-radius` 语义保持为外径的一半。
- 已支持 symbol 的图标锚点、图标宽高、文字锚点、文字背景和文字背景 padding。
- `symbol-placement: "polygon-center"` 当前使用瓦片内 polygon 片段中心；跨瓦片大面可能出现重复标注。
- `symbol-placement: "polygon-center"` 当前使用面积 centroid，凹多边形时中心点可能落在面外部。
- 当前仍未实现碰撞避让、沿线文字、复杂文本 shaping、sprite atlas 打包和完整字体栈管理。
- `fill` / `line` 在 `clampToGround: true` 且 `heightOffset != 0` 时会回退到普通高度渲染。
- `packed` 当前只优化大量常量样式线，不支持逐要素拾取。
