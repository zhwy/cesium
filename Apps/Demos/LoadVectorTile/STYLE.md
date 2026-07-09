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
    },
  },
  layers: [
    {
      id: "layer-id",
      type: "fill" | "line" | "symbol",
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

| 字段                     | 说明                                     |
| ------------------------ | ---------------------------------------- |
| `type`                   | 固定为 `vector`。                        |
| `url`                    | 瓦片地址模板。                           |
| `minimumLevel`           | 最低请求层级。                           |
| `maximumLevel`           | 最高请求层级。                           |
| `tileType`               | `XYZ` 或 `WMTS`。                        |
| `renderBackend`          | 线渲染后端，`instances` 或 `packed`。    |
| `packedMinimumInstances` | packed 线后端的最少线数量阈值。          |
| `clipToTile`             | 是否裁剪到瓦片边界。建议保持 `true`。    |
| `allowPicking`           | 是否保留要素属性用于拾取。               |
| `cacheBytes`             | 单图层缓存预算。                         |
| `asynchronous`           | instances 后端是否允许 Cesium 异步建模。 |
| `shadows`                | 是否参与阴影。                           |

这些字段和 `manager.addLayer()` 旧配置里的同名项一致；当你用 style document 时，它们仍然放在 `source` 上。

## 3. 图层通用字段

每个 `layers[]` 元素都支持以下通用字段：

| 字段          | 必填 | 说明                                      |
| ------------- | ---- | ----------------------------------------- |
| `id`          | 是   | 当前样式图层唯一 id。                     |
| `type`        | 是   | `fill`、`line` 或 `symbol`。              |
| `source`      | 是   | 关联的 source id。                        |
| `sourceLayer` | 是   | PBF 内部 source-layer 名称。              |
| `minzoom`     | 否   | 当前图层的最小可见 zoom。                 |
| `maxzoom`     | 否   | 当前图层的最大可见 zoom，语义为排他上界。 |
| `filter`      | 否   | 可序列化过滤表达式。                      |
| `layout`      | 否   | 主要放几何布局和 symbol 相关字段。        |
| `paint`       | 否   | 主要放颜色、宽度、文字外观等字段。        |
| `terrain`     | 否   | Cesium 三维扩展，控制贴地和高度偏移。     |
| `visibility`  | 否   | `false` 时图层不会参与解码和建桶。        |
| `metadata`    | 否   | 自定义透传数据。                          |

## 4. fill 图层

`type: "fill"` 用于绘制面。

### 4.1 `paint`

| 字段                 | 类型            | 默认值                    | 说明                                   |
| -------------------- | --------------- | ------------------------- | -------------------------------------- |
| `fill-color`         | 颜色或表达式    | `#ff000077`               | 面颜色。                               |
| `fill-outline-color` | 颜色或表达式    | 无                        | 面轮廓线颜色。未配置时不绘制 outline。 |
| `fill-outline-width` | 数字或表达式    | `1`                       | 面轮廓线宽。                           |
| `arcType`            | Cesium 弧线类型 | `Cesium.ArcType.GEODESIC` | 轮廓线弧线类型。                       |

### 4.2 行为说明

- `fill` 当前由 `VectorTileFillBucket` 负责。
- 当 `terrain.clampToGround: true` 且 `heightOffset === 0` 时，使用 `GroundPrimitive`。
- 当配置 `fill-outline-color` 时，会额外生成 outline primitive。
- `clipToTile: true` 且存在瓦片边界信息时，落在瓦片边界上的 outline 线段会被跳过，避免相邻瓦片重复描边。

## 5. line 图层

`type: "line"` 用于绘制线。

### 5.1 `paint`

| 字段         | 类型            | 默认值                    | 说明           |
| ------------ | --------------- | ------------------------- | -------------- |
| `line-color` | 颜色或表达式    | `#ffff00ff`               | 线颜色。       |
| `line-width` | 数字或表达式    | `2`                       | 线宽。         |
| `arcType`    | Cesium 弧线类型 | `Cesium.ArcType.GEODESIC` | 线的弧线类型。 |

### 5.2 行为说明

- `line` 当前由 `VectorTileLineBucket` 负责。
- 当 `terrain.clampToGround: true` 且 `heightOffset === 0` 时，使用 `GroundPolylinePrimitive`。
- 当 source 配置 `renderBackend: "packed"`，且满足以下条件时，线会走 packed 后端：
  - `allowPicking === false`
  - 线数量达到 `packedMinimumInstances`
  - `line-color` 和 `line-width` 不是表达式
  - 当前不是贴地线
- 不满足条件时会自动回退到普通 instances 后端。

## 6. symbol 图层

`type: "symbol"` 用于绘制点图标和文字。

### 6.1 icon layout

| 字段          | 类型              | 默认值   | 说明                                            |
| ------------- | ----------------- | -------- | ----------------------------------------------- |
| `icon-image`  | 字符串或表达式    | 无       | 图标名、URL，或已注册图像。未配置时不绘制图标。 |
| `icon-size`   | 数字或表达式      | `1`      | Cesium billboard `scale`。                      |
| `icon-width`  | 数字或表达式      | 无       | billboard 宽度，单位像素。                      |
| `icon-height` | 数字或表达式      | 无       | billboard 高度，单位像素。                      |
| `icon-anchor` | 字符串或表达式    | `center` | 图标锚点。                                      |
| `icon-offset` | `[x, y]` 或表达式 | 无       | 图标像素偏移，单位像素。                        |

### 6.2 text layout

| 字段               | 类型                   | 默认值       | 说明                                                          |
| ------------------ | ---------------------- | ------------ | ------------------------------------------------------------- |
| `text-field`       | 字符串或表达式         | 无           | 文字内容。未配置时不绘制文字。                                |
| `text-size`        | 数字或表达式           | `16`         | 字号。                                                        |
| `text-font`        | CSS 字体字符串或表达式 | 无           | 直接写入 Cesium `Label.font`。                                |
| `text-font-family` | 字体族字符串或表达式   | `sans-serif` | 当未提供 `text-font` 时，和 `text-size` 组合成 `Label.font`。 |
| `text-anchor`      | 字符串或表达式         | `center`     | 文字锚点。                                                    |
| `text-offset`      | `[x, y]` 或表达式      | 无           | 文字像素偏移，单位像素。                                      |

### 6.3 text paint

| 字段                      | 类型                    | 默认值      | 说明                                              |
| ------------------------- | ----------------------- | ----------- | ------------------------------------------------- |
| `text-color`              | 颜色或表达式            | `#ffffffff` | 文字填充色。                                      |
| `text-halo-color`         | 颜色或表达式            | `#000000ff` | 文字描边色。                                      |
| `text-halo-width`         | 数字或表达式            | `0`         | 文字描边宽度。                                    |
| `text-background-color`   | 颜色或表达式            | 无          | 文字背景色。配置后会启用 `Label.showBackground`。 |
| `text-background-padding` | 数字、`[x, y]` 或表达式 | 无          | 文字背景内边距，单位像素。                        |

### 6.4 锚点取值

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

### 6.5 偏移与尺寸回退

- `icon-offset` 和 `text-offset` 都按 Cesium `Cartesian2` 语义解释。
- `[x, y]` 中 `x` 为向右，`y` 为向上。
- `icon-width`、`icon-height`、`text-size`、`text-halo-width`、`text-background-padding` 的求值结果如果不是有限数：
  - 有默认值的字段回退到默认值；
  - 没有默认值的字段会被省略。
- 未配置 `icon-width` / `icon-height` 时，Cesium 会使用源图像尺寸。
- `text-font` 优先级高于 `text-font-family`。

## 7. terrain 三维扩展

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
- `disableDepthTestDistance`：当前主要对 symbol 生效，透传到 Cesium label / billboard。

几何类型行为如下：

| 几何类型 | `clampToGround: false`                    | `clampToGround: true, heightOffset: 0` | `clampToGround: true, heightOffset != 0` |
| -------- | ----------------------------------------- | -------------------------------------- | ---------------------------------------- |
| `fill`   | 普通 `Primitive + PolygonGeometry`        | `GroundPrimitive`                      | 回退到普通高度面，并记录诊断             |
| `line`   | 普通 `Primitive + PolylineGeometry`       | `GroundPolylinePrimitive`              | 回退到普通高度线，并记录诊断             |
| `symbol` | `BillboardCollection` / `LabelCollection` | `HeightReference.CLAMP_TO_GROUND`      | `HeightReference.RELATIVE_TO_GROUND`     |

## 8. 表达式

当前样式值支持和 demo 现有实现一致的可序列化表达式子集，例如：

- `["get", "name"]`
- `["has", "kind"]`
- `["match", ["get", "type"], "park", "#00ff0044", "#0088ff33"]`
- `["case", [">", ["get", "population"], 1000000], 18, 14]`
- `["interpolate", ["linear"], ["zoom"], 1, 1, 6, 4]`

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

说明：

- `packed` 线后端要求 `line-color` 和 `line-width` 为常量，表达式会让该图层自动回退到 instances。
- `text-background-padding`、`icon-offset`、`text-offset` 的数组值当前建议直接写常量数组。

## 9. filter

`filter` 使用可序列化过滤表达式。常见示例：

```js
["==", ["get", "kind"], "park"][
  ("all", ["has", "name"], [">", ["get", "population"], 100000])
][("match", ["get", "class"], ["motorway", "trunk"], true, false)];
```

过滤在 worker 可支持时会尽量前移；如果表达式不在 worker 支持范围内，会回退到主线程过滤。

## 10. 图标注册

`icon-image` 可以直接写 URL，也可以写注册名。

### 10.1 初始化时传入

```js
const layer = manager.addLayer({
  styleDocument,
  iconImages: {
    capital: "http://localhost:10101/icons/capital.png",
  },
});
```

### 10.2 运行时注册

```js
layer.registerIconImage("capital", imageOrCanvasOrUrl);
```

支持的图像来源：

- 已注册名称
- URL 字符串
- `HTMLImageElement`
- `HTMLCanvasElement`

## 11. 完整示例

下面的示例覆盖面、线、图标、文字、背景、锚点、尺寸、表达式、过滤和 terrain：

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
  ],
});
```

## 12. 已知限制

- 已支持 symbol 的图标锚点、图标宽高、文字锚点、文字背景和文字背景 padding。
- 当前仍未实现碰撞避让、沿线文字、复杂文本 shaping、sprite atlas 打包和完整字体栈管理。
- `fill` / `line` 在 `clampToGround: true` 且 `heightOffset != 0` 时会回退到普通高度渲染。
- `packed` 当前只优化大量常量样式线，不支持逐要素拾取。
