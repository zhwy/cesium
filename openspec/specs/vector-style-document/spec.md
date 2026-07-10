## ADDED Requirements

### Requirement: Symbol layers support Cesium label presentation options

`symbol` 样式图层 SHALL 在现有 `text-field`、`text-size`、`text-color` 和文字描边字段之外，支持面向 Cesium 的文字表现配置。

#### Scenario: 使用配置字体渲染文字

- **WHEN** 一个匹配的点要素通过包含 `layout["text-field"]` 和 `layout["text-font"]` 的 `symbol` 图层进行渲染
- **THEN** 系统 SHALL 创建使用该 CSS 字体字符串的 Cesium label

#### Scenario: 渲染文字背景

- **WHEN** 一个匹配的点要素通过包含 `paint["text-background-color"]` 的 `symbol` 图层进行渲染
- **THEN** 系统 SHALL 创建开启背景渲染并使用该背景颜色的 Cesium label

#### Scenario: 渲染文字背景内边距

- **WHEN** 一个匹配的点要素通过包含 `paint["text-background-padding"]` 的 `symbol` 图层进行渲染
- **THEN** 系统 SHALL 将配置的横向和纵向内边距应用到 Cesium label 背景上

### Requirement: Symbol layers support text anchor and offset

`symbol` 样式图层 SHALL 支持点文字的锚点和像素偏移配置。

#### Scenario: 使用文字锚点渲染 label

- **WHEN** 一个匹配的点要素通过包含 `layout["text-anchor"]` 的 `symbol` 图层进行渲染
- **THEN** 系统 SHALL 将该锚点映射为 Cesium label 的水平和垂直 origin

#### Scenario: 使用文字偏移渲染 label

- **WHEN** 一个匹配的点要素通过包含 `layout["text-offset"]` 的 `symbol` 图层进行渲染
- **THEN** 系统 SHALL 将该偏移作为 Cesium label 的像素偏移应用

#### Scenario: 未配置文字锚点时使用稳定默认值

- **WHEN** 一个匹配的点要素通过未包含 `layout["text-anchor"]` 的 `symbol` 图层进行渲染
- **THEN** 系统 SHALL 使用与当前 symbol 渲染兼容的稳定默认 label origin

### Requirement: Symbol layers support icon anchor, offset, width, and height

`symbol` 样式图层 SHALL 支持点图标的位置和尺寸配置。

#### Scenario: 使用图标锚点渲染 icon

- **WHEN** 一个匹配的点要素通过包含 `layout["icon-image"]` 和 `layout["icon-anchor"]` 的 `symbol` 图层进行渲染
- **THEN** 系统 SHALL 将该锚点映射为 Cesium billboard 的水平和垂直 origin

#### Scenario: 使用图标偏移渲染 icon

- **WHEN** 一个匹配的点要素通过包含 `layout["icon-offset"]` 的 `symbol` 图层进行渲染
- **THEN** 系统 SHALL 将该偏移作为 Cesium billboard 的像素偏移应用

#### Scenario: 使用图标宽度和高度

- **WHEN** 一个匹配的点要素通过包含 `layout["icon-size"]` 的 `symbol` 图层进行渲染
- **THEN** 系统 SHALL 将该尺寸作为 Cesium billboard 的宽度和高度应用

### Requirement: Symbol layers support text rotation and alignment

`symbol` 样式图层 SHALL 支持文字旋转和对齐配置。

#### Scenario: 使用文字旋转角度

- **WHEN** 一个匹配的点要素通过包含 `layout["text-rotation"]` 的 `symbol` 图层进行渲染
- **THEN** 系统 SHALL 将该旋转角度作为 Cesium label 的旋转角度应用

#### Scenario: 使用文字对齐方式

- **WHEN** 一个匹配的点要素通过包含 `layout["text-justify"]` 的 `symbol` 图层进行渲染
- **THEN** 系统 SHALL 将该对齐方式映射为 Cesium label 的水平对齐

#### Scenario: 使用文字方向

- **WHEN** 一个匹配的点要素通过包含 `layout["text-writing-mode"]` 的 `symbol` 图层进行渲染
- **THEN** 系统 SHALL 将该方向映射为 Cesium label 的垂直对齐

### Requirement: Symbol layers support text halo and fade

`symbol` 样式图层 SHALL 支持文字描边和淡入淡出效果。

#### Scenario: 使用文字描边颜色

- **WHEN** 一个匹配的点要素通过包含 `paint["text-halo-color"]` 的 `symbol` 图层进行渲染
- **THEN** 系统 SHALL 创建使用该描边颜色的 Cesium label

#### Scenario: 使用文字描边宽度

- **WHEN** 一个匹配的点要素通过包含 `paint["text-halo-width"]` 的 `symbol` 图层进行渲染
- **THEN** 系统 SHALL 使用该描边宽度创建 Cesium label

#### Scenario: 使用文字描边模糊

- **WHEN** 一个匹配的点要素通过包含 `paint["text-halo-blur"]` 的 `symbol` 图层进行渲染
- **THEN** 系统 SHALL 使用该模糊值创建 Cesium label

#### Scenario: 使用文字淡入淡出

- **WHEN** 一个匹配的点要素通过包含 `paint["text-opacity"]` 的 `symbol` 图层进行渲染
- **THEN** 系统 SHALL 使用该透明度创建 Cesium label

### Requirement: Symbol layers support icon rotation and opacity

`symbol` 样式图层 SHALL 支持图标旋转和透明度配置。

#### Scenario: 使用图标旋转角度

- **WHEN** 一个匹配的点要素通过包含 `layout["icon-rotation"]` 的 `symbol` 图层进行渲染
- **THEN** 系统 SHALL 将该旋转角度作为 Cesium billboard 的旋转角度应用

#### Scenario: 使用图标透明度

- **WHEN** 一个匹配的点要素通过包含 `paint["icon-opacity"]` 的 `symbol` 图层进行渲染
- **THEN** 系统 SHALL 使用该透明度创建 Cesium billboard

#### Scenario: 使用图标淡入淡出

- **WHEN** 一个匹配的点要素通过包含 `paint["icon-halo-color"]` 的 `symbol` 图层进行渲染
- **THEN** 系统 SHALL 创建使用该描边颜色的 Cesium billboard

### Requirement: Symbol layers support text-field expressions

`symbol` 样式图层 SHALL 支持基于表达式的文字字段配置。

#### Scenario: 使用简单文字表达式

- **WHEN** 一个匹配的点要素通过包含 `layout["text-field"]` 表达式的 `symbol` 图层进行渲染
- **THEN** 系统 SHALL 解析表达式并应用相应的文字内容

#### Scenario: 使用文字颜色表达式

- **WHEN** 一个匹配的点要素通过包含 `paint["text-color"]` 表达式的 `symbol` 图层进行渲染
- **THEN** 系统 SHALL 解析表达式并应用相应的文字颜色

#### Scenario: 使用文字大小表达式

- **WHEN** 一个匹配的点要素通过包含 `paint["text-size"]` 表达式的 `symbol` 图层进行渲染
- **THEN** 系统 SHALL 解析表达式并应用相应的文字大小

### Requirement: Symbol layers support icon-field expressions

`symbol` 样式图层 SHALL 支持基于表达式的图标字段配置。

#### Scenario: 使用图标表达式

- **WHEN** 一个匹配的点要素通过包含 `layout["icon-image"]` 表达式的 `symbol` 图层进行渲染
- **THEN** 系统 SHALL 解析表达式并应用相应的图标

#### Scenario: 使用图标大小表达式

- **WHEN** 一个匹配的点要素通过包含 `layout["icon-size"]` 表达式的 `symbol` 图层进行渲染
- **THEN** 系统 SHALL 解析表达式并应用相应的图标大小

#### Scenario: 使用图标颜色表达式

- **WHEN** 一个匹配的点要素通过包含 `paint["icon-color"]` 表达式的 `symbol` 图层进行渲染
- **THEN** 系统 SHALL 解析表达式并应用相应的图标颜色

### Requirement: Symbol layers support visibility based on zoom

`symbol` 样式图层 SHALL 支持基于缩放级别的可见性控制。

#### Scenario: 使用缩放级别可见性

- **WHEN** 一个匹配的点要素通过包含 `minzoom` 和 `maxzoom` 的 `symbol` 图层进行渲染
- **THEN** 系统 SHALL 根据当前缩放级别决定是否渲染该要素

#### Scenario: 使用缩放级别过渡

- **WHEN** 一个匹配的点要素通过包含 `transition` 的 `symbol` 图层进行渲染
- **THEN** 系统 SHALL 在缩放级别变化时平滑过渡

### Requirement: Symbol layers support symbol placement strategies

`symbol` 样式图层 SHALL 支持多种符号放置策略。

#### Scenario: 使用点放置

- **WHEN** 一个匹配的点要素通过包含 `layout["symbol-placement"]` 为 "point" 的 `symbol` 图层进行渲染
- **THEN** 系统 SHALL 在点位置放置符号

#### Scenario: 使用线放置

- **WHEN** 一个匹配的点要素通过包含 `layout["symbol-placement"]` 为 "line" 的 `symbol` 图层进行渲染
- **THEN** 系统 SHALL 在线位置放置符号

#### Scenario: 使用自动放置

- **WHEN** 一个匹配的点要素通过包含 `layout["symbol-placement"]` 为 "auto" 的 `symbol` 图层进行渲染
- **THEN** 系统 SHALL 自动选择最佳放置位置

### Requirement: Symbol layers support symbol avoid edges

`symbol` 样式图层 SHALL 支持避免边缘放置的策略。

#### Scenario: 使用避免边缘

- **WHEN** 一个匹配的点要素通过包含 `layout["symbol-avoid-edges"]` 为 true 的 `symbol` 图层进行渲染
- **THEN** 系统 SHALL 避免在地图边缘放置符号

#### Scenario: 不使用避免边缘

- **WHEN** 一个匹配的点要素通过包含 `layout["symbol-avoid-edges"]` 为 false 的 `symbol` 图层进行渲染
- **THEN** 系统 SHALL 允许在地图边缘放置符号

### Requirement: Symbol layers support symbol sort key

`symbol` 样式图层 SHALL 支持符号排序键配置。

#### Scenario: 使用排序键

- **WHEN** 一个匹配的点要素通过包含 `layout["symbol-sort-key"]` 的 `symbol` 图层进行渲染
- **THEN** 系统 SHALL 使用该键对符号进行排序

#### Scenario: 不使用排序键

- **WHEN** 一个匹配的点要素通过未包含 `layout["symbol-sort-key"]` 的 `symbol` 图层进行渲染
- **THEN** 系统 SHALL 使用默认排序方式

### Requirement: Symbol layers support symbol z-order

`symbol` 样式图层 SHALL 支持符号 z-order 配置。

#### Scenario: 使用 z-order

- **WHEN** 一个匹配的点要素通过包含 `layout["symbol-z-order"]` 的 `symbol` 图层进行渲染
- **THEN** 系统 SHALL 使用该 z-order 控制符号的渲染顺序

#### Scenario: 使用自动 z-order

- **WHEN** 一个匹配的点要素通过包含 `layout["symbol-z-order"]` 为 "auto" 的 `symbol` 图层进行渲染
- **THEN** 系统 SHALL 自动计算 z-order

### Requirement: Style document layers are removable by layer id

The vector tile manager SHALL remove a single style document layer by matching the layer id against provider style rules instead of removing the source-backed runtime layer unconditionally.

#### Scenario: Remove one layer from a multi-layer source

- **WHEN** a style document contains two or more layers that reference the same source and `removeLayer(layerId)` is called with one of those layer ids
- **THEN** the manager SHALL remove only the matching style rule from that source provider and keep the provider and runtime vector tile layer active for the remaining style rules

#### Scenario: Remove the final layer from a source

- **WHEN** `removeLayer(layerId)` removes the last style rule owned by a source provider
- **THEN** the manager SHALL remove that provider's runtime vector tile layer from the collection and delete the source provider entry

#### Scenario: Remove an unknown layer

- **WHEN** `removeLayer(layerId)` is called with an id that does not match any provider style rule
- **THEN** the manager SHALL return `false` and leave all providers, style rules, and runtime layers unchanged

### Requirement: Style state is sourced from normalized style documents

The vector tile style system SHALL use normalized style documents as the source of style layer state and SHALL NOT require legacy `styles` option conversion for manager-managed style layers.

#### Scenario: Apply a style document

- **WHEN** `setStyle(styleDocument)` is called with valid sources and layers
- **THEN** the manager SHALL create source providers with style rules derived from the normalized style document layers

#### Scenario: Read a style document after layer removal

- **WHEN** a style layer has been removed from a provider and `getStyle()` is called
- **THEN** the returned style document SHALL include the provider's source and only its remaining style rules
