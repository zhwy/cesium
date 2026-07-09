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

- **WHEN** 一个匹配的点要素通过包含 `layout["icon-image"]` 和 `layout["icon-offset"]` 的 `symbol` 图层进行渲染
- **THEN** 系统 SHALL 将该偏移作为 Cesium billboard 的像素偏移应用

#### Scenario: 使用显式尺寸渲染 icon

- **WHEN** 一个匹配的点要素通过包含 `layout["icon-image"]`、`layout["icon-width"]` 和 `layout["icon-height"]` 的 `symbol` 图层进行渲染
- **THEN** 系统 SHALL 创建使用配置宽度和高度的 Cesium billboard

#### Scenario: 未配置图标尺寸时使用源图像尺寸

- **WHEN** 一个匹配的点要素通过包含 `layout["icon-image"]` 但未显式配置图标宽度或高度的 `symbol` 图层进行渲染
- **THEN** 系统 SHALL 保持 billboard 的 width 和 height 未设置，以便 Cesium 使用源图像自身尺寸

### Requirement: Symbol style option values support constants and expressions

新的 symbol 样式选项值 SHALL 继续支持与现有 symbol 样式一致的常量和可序列化表达式求值模型。

#### Scenario: 使用要素属性设置图标宽度

- **WHEN** `layout["icon-width"]` 被配置为 `["get", "iconWidth"]`
- **THEN** 系统 SHALL 从每个匹配要素的属性中求得对应宽度

#### Scenario: 使用常量文字锚点

- **WHEN** `layout["text-anchor"]` 被配置为 `"bottom"`
- **THEN** 系统 SHALL 对每个匹配 label 使用该常量锚点值

#### Scenario: 非法数值样式值安全回退

- **WHEN** 某个数值型 symbol 选项求值结果为非有限数
- **THEN** 系统 SHALL 回退到文档定义的默认值，或省略对应的 Cesium option

### Requirement: Line rendering is managed by a line primitive bucket

线样式规则 SHALL 通过从 `VectorTilePrimitiveBucket` 派生的 bucket 渲染，而不是继续由 `VectorTileLayer` 内部的线 primitive 创建方法直接负责。

#### Scenario: 通过 line bucket 构建普通线 primitive

- **WHEN** 一个 `line` 样式规则在普通 instances 后端下为已解码瓦片构建渲染结果
- **THEN** 系统 SHALL 通过 line bucket 创建线 primitive，并通过 bucket primitive 列表暴露结果

#### Scenario: 通过 line bucket 构建贴地线 primitive

- **WHEN** 一个 `line` 样式规则配置了 `terrain.clampToGround: true` 且没有非零高度偏移
- **THEN** 系统 SHALL 通过 line bucket 创建 ground polyline primitive

#### Scenario: 通过 line bucket 构建 packed 线 primitive

- **WHEN** 一个 `line` 样式规则满足 packed 后端启用条件
- **THEN** 系统 SHALL 在 line bucket 内选择并构建 packed 线渲染路径

#### Scenario: 保持线诊断指标

- **WHEN** line bucket 创建 primitive，或使用 packed / ground 渲染路径
- **THEN** 系统 SHALL 继续记录 created primitives、geometry instances、packed line buckets 和 ground polyline primitives 等既有诊断计数

### Requirement: Fill rendering is managed by a fill primitive bucket

面样式规则 SHALL 通过从 `VectorTilePrimitiveBucket` 派生的 bucket 渲染，而不是继续由 `VectorTileLayer` 内部的面 primitive 创建方法直接负责。

#### Scenario: 通过 fill bucket 构建面填充 primitive

- **WHEN** 一个 `fill` 样式规则为已解码的 polygon 数据构建渲染结果
- **THEN** 系统 SHALL 通过 fill bucket 创建 polygon fill primitive，并通过 bucket primitive 列表暴露结果

#### Scenario: 通过 fill bucket 构建面轮廓 primitive

- **WHEN** 一个 `fill` 样式规则包含 `paint["fill-outline-color"]`
- **THEN** 系统 SHALL 通过 fill bucket 创建 fill outline 线 primitive

#### Scenario: 保持面轮廓的瓦片裁剪行为

- **WHEN** fill outline 针对已裁剪瓦片 polygon ring 构建渲染结果
- **THEN** 系统 SHALL 保持现有行为，在可用 tile bounds 存在时跳过落在裁剪瓦片边界上的 outline 线段

#### Scenario: 保持面 terrain 回退诊断

- **WHEN** 一个 fill 样式规则请求 `terrain.clampToGround: true` 且配置了非零高度偏移
- **THEN** 系统 SHALL 保持现有不支持组合的回退行为，并继续记录对应的诊断计数

### Requirement: Vector tile layer routes style rules to geometry-specific buckets

`VectorTileLayer` SHALL 将每个受支持的样式规则类型路由到对应的 primitive bucket，同时继续负责瓦片生命周期和缓存状态管理。

#### Scenario: 路由 fill 样式规则

- **WHEN** `VectorTileLayer` 为一个 `fill` 样式规则构建瓦片 primitive bucket
- **THEN** 它 SHALL 对匹配的已解码 polygon 数据使用 fill bucket

#### Scenario: 路由 line 样式规则

- **WHEN** `VectorTileLayer` 为一个 `line` 样式规则构建瓦片 primitive bucket
- **THEN** 它 SHALL 对匹配的已解码 line 数据使用 line bucket

#### Scenario: 路由 symbol 样式规则

- **WHEN** `VectorTileLayer` 为一个 `symbol` 样式规则构建瓦片 primitive bucket
- **THEN** 它 SHALL 继续对匹配的已解码点数据使用 symbol bucket

#### Scenario: 保持 primitive 存储结构不变

- **WHEN** 某个几何类型 bucket 创建了一个或多个 primitive
- **THEN** `VectorTileLayer` SHALL 继续将 `bucket.primitives` 存储到 `vectorTile.primitives[bucket.id]` 中，以保持 render submission 和 cache destruction 兼容

### Requirement: Complete style reference documentation is provided

LoadVectorTile demo SHALL 为用户提供一份完整的样式配置参考文档。

#### Scenario: 说明顶层样式结构

- **WHEN** 用户打开样式参考文档
- **THEN** 文档 SHALL 说明 `version`、`sources`、`layers`，以及 source id、style layer id 和 PBF `sourceLayer` 之间的关系

#### Scenario: 说明图层属性

- **WHEN** 用户阅读样式参考文档
- **THEN** 文档 SHALL 说明图层通用字段、fill 字段、line 字段、symbol 字段、terrain 字段、expressions、filters、icon 注册方式、默认值和已知限制

#### Scenario: 从 README 链接样式参考文档

- **WHEN** 用户阅读 LoadVectorTile README
- **THEN** README SHALL 链接到完整的样式参考文档，而不是要求 README 自身包含全部样式选项
