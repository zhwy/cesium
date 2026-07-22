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

### Requirement: Style expressions support logical negation and membership

矢量瓦片样式系统 SHALL 支持 `!` 和 `in`，并允许它们用于可序列化样式值和 filter 表达式。

#### Scenario: 对布尔表达式取反

- **WHEN** 样式表达式为 `["!", ["has", "name"]]` 且当前 feature 不包含 `name`
- **THEN** 系统 SHALL 将表达式求值为 `true`

#### Scenario: 逻辑取反收到非布尔值

- **WHEN** `!` 的动态输入不是 boolean
- **THEN** 系统 SHALL 返回 `undefined` 并由现有样式 fallback 或 filter 结果处理该值

#### Scenario: 判断数组成员

- **WHEN** 表达式使用 `in` 在 feature property 返回的数组中查找 string、number 或 boolean 值
- **THEN** 系统 SHALL 使用严格成员匹配返回 boolean 结果

#### Scenario: 判断字符串子串

- **WHEN** 表达式使用 `in` 在字符串容器中查找字符串
- **THEN** 系统 SHALL 返回该字符串是否包含查询子串

#### Scenario: 成员判断收到错误动态类型

- **WHEN** `in` 的容器既不是字符串也不是数组，或字符串容器的查询值不是字符串
- **THEN** 系统 SHALL 返回 `undefined` 并由现有样式 fallback 或 filter 结果处理该值

### Requirement: Style expressions support string and array lookup

矢量瓦片样式系统 SHALL 支持 `index-of`、`slice`、`length` 和 `at`，并保持字符串与数组输入的结果语义明确。

#### Scenario: 查找字符串或数组中的位置

- **WHEN** `index-of` 在字符串或数组中找到查询值
- **THEN** 系统 SHALL 返回从可选起始索引开始的首个匹配位置

#### Scenario: 合法输入中未找到查询值

- **WHEN** `index-of` 的输入类型合法但没有匹配值
- **THEN** 系统 SHALL 返回 `-1`

#### Scenario: 截取字符串或数组

- **WHEN** `slice` 接收字符串或数组以及合法的起始索引和可选结束索引
- **THEN** 系统 SHALL 返回左闭右开的截取结果并支持 JavaScript 负索引语义

#### Scenario: 读取字符串或数组长度

- **WHEN** `length` 接收字符串或数组
- **THEN** 系统 SHALL 返回其元素或字符数量

#### Scenario: 按索引读取数组元素

- **WHEN** `at` 接收数组和范围内的非负整数索引
- **THEN** 系统 SHALL 返回对应数组元素

#### Scenario: 查找操作收到错误动态类型或索引

- **WHEN** 查找操作收到不支持的容器类型、非整数索引或 `at` 越界索引
- **THEN** 系统 SHALL 返回 `undefined` 而不是中断 feature 或瓦片处理

### Requirement: Style expressions support string construction and case conversion

矢量瓦片样式系统 SHALL 支持 `concat`、`to-string`、`upcase` 和 `downcase` 构造动态字符串。

#### Scenario: 拼接不同类型的表达式结果

- **WHEN** `concat` 接收一个或多个 string、number、boolean、null、数组或普通对象结果
- **THEN** 系统 SHALL 按 `to-string` 语义转换每项并按顺序拼接为字符串

#### Scenario: 转换基础值为字符串

- **WHEN** `to-string` 接收 string、number、boolean、null 或 `undefined`
- **THEN** 系统 SHALL 分别返回原字符串、稳定数字/布尔字符串或空字符串

#### Scenario: 转换可序列化复合值为字符串

- **WHEN** `to-string` 接收数组或普通对象
- **THEN** 系统 SHALL 返回该值的 JSON 字符串表示

#### Scenario: 转换字符串大小写

- **WHEN** `upcase` 或 `downcase` 接收字符串
- **THEN** 系统 SHALL 使用 locale-insensitive Unicode 大小写转换返回结果

#### Scenario: 大小写操作收到非字符串

- **WHEN** `upcase` 或 `downcase` 的动态输入不是字符串
- **THEN** 系统 SHALL 返回 `undefined` 并触发现有样式 fallback 或 filter 处理

### Requirement: Style expressions support missing-value fallback and feature id

矢量瓦片样式系统 SHALL 支持 `coalesce` 和 `id`，以组合缺失属性并访问 feature 身份。

#### Scenario: 选择首个存在的候选值

- **WHEN** `coalesce` 的候选值依次包含 `null`、`undefined` 和有效值
- **THEN** 系统 SHALL 返回首个既非 `null` 也非 `undefined` 的值

#### Scenario: 所有候选值均缺失

- **WHEN** `coalesce` 的所有候选值都是 `null` 或 `undefined`
- **THEN** 系统 SHALL 返回 `undefined` 并允许外层样式值使用既有 fallback

#### Scenario: 读取 feature id

- **WHEN** 表达式为 `["id"]` 且求值上下文包含 string 或 number feature id
- **THEN** 系统 SHALL 返回保持原类型的 feature id

#### Scenario: feature id 缺失

- **WHEN** 表达式为 `["id"]` 且求值上下文没有 feature id
- **THEN** 系统 SHALL 返回 `undefined`

### Requirement: Style expression grammar is strictly validated

矢量瓦片样式系统 MUST 在样式规范化和 worker 支持判断中使用同一套操作符与参数结构校验，并拒绝无法按已实现语义求值的表达式形状。

#### Scenario: 校验固定参数操作符

- **WHEN** 新增或既有固定参数操作符缺少参数或包含多余参数
- **THEN** 系统 MUST 抛出包含表达式路径和操作符名称的校验错误

#### Scenario: 校验可变参数操作符

- **WHEN** `all`、`any`、`concat` 或 `coalesce` 少于各自要求的最小操作数数量
- **THEN** 系统 MUST 在求值前拒绝该表达式

#### Scenario: 校验条件和匹配结构

- **WHEN** `case`、`match` 或 `interpolate` 缺少成对参数、最终 fallback 或要求数量的 stop/output 对
- **THEN** 系统 MUST 在求值前拒绝该表达式

#### Scenario: 禁止独立 linear 表达式

- **WHEN** `linear` 出现在 `interpolate` 第二项 `['linear']` 之外
- **THEN** 系统 MUST 将其视为不受支持的顶层表达式操作符

#### Scenario: 校验 literal 结构

- **WHEN** `literal` 未恰好包含一个可序列化常量
- **THEN** 系统 MUST 拒绝该表达式

### Requirement: Extended expressions preserve serialization and dependency behavior

新增表达式 SHALL 在主线程样式值、filter、worker filter 和属性投影中保持一致的可序列化求值与依赖分析行为。

#### Scenario: 在新增操作符中收集属性依赖

- **WHEN** 新增操作符的嵌套参数包含静态 `get` 或 `has`
- **THEN** 系统 SHALL 收集对应 property 名称供长期属性投影使用

#### Scenario: literal 数组不产生表达式依赖

- **WHEN** 字符串或数组操作接收 `["literal", [...]]` 数组常量
- **THEN** 系统 SHALL 将数组视为常量且 SHALL NOT 遍历其中形似表达式的内容

#### Scenario: id 不产生 property 依赖

- **WHEN** 样式值或 filter 使用 `["id"]`
- **THEN** 系统 SHALL NOT 为该表达式保留任何 feature property

#### Scenario: 新增表达式可前移到 worker

- **WHEN** filter 仅包含本变更支持的可序列化操作符且通过统一校验
- **THEN** 系统 SHALL 将其视为 worker 支持的表达式并保持与主线程相同的求值结果
