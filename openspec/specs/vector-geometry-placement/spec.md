## 新增需求

### Requirement: `symbol-placement` 选择源几何
系统 SHALL 支持通过 `layout["symbol-placement"]` 控制 `symbol` 图层从哪类源几何派生 symbol 位置。未配置时 MUST 等同于 `point`。

#### Scenario: 默认点位 symbol 放置
- **WHEN** 一个 `symbol` 图层未配置 `layout["symbol-placement"]`
- **THEN** 系统 SHALL 使用该 source layer 的点要素绘制文字和图标，并保持现有点 symbol 行为

#### Scenario: 显式点位 symbol 放置
- **WHEN** 一个 `symbol` 图层配置 `layout["symbol-placement"]` 为 `point`
- **THEN** 系统 SHALL 使用该 source layer 的点要素绘制文字和图标

#### Scenario: 面中心 symbol 放置
- **WHEN** 一个 `symbol` 图层配置 `layout["symbol-placement"]` 为 `polygon-center`
- **THEN** 系统 SHALL 使用该 source layer 的 面要素计算中心点，并在中心点绘制符合该 symbol 样式的文字和图标

### Requirement: `polygon-center` 使用瓦片局部几何
系统 SHALL 基于当前已解码的 polygon 几何计算 `polygon-center`，并在 `clipToTile: true` 时将结果定义为瓦片内 polygon 片段的中心点。

#### Scenario: 裁剪后的面中心
- **WHEN** `clipToTile` 为 `true` 且一个 polygon feature 被裁剪为当前瓦片内片段
- **THEN** `polygon-center` SHALL 基于裁剪后的瓦片片段计算，而不是基于服务端原始完整面计算

#### Scenario: 退化面中心
- **WHEN** polygon feature 没有足够有效顶点或无法计算有限中心点
- **THEN** 系统 SHALL 跳过该 feature 的 symbol 创建

### Requirement: `line` 图层绘制 polygon outline
系统 SHALL 允许 `type: "line"` 图层绘制 source layer 中的 polygon 要素，并将 polygon 要素表示为 outline。

#### Scenario: 面数据源被 `line` 图层绘制
- **WHEN** 一个 `line` 图层的 source layer 包含 polygon 要素
- **THEN** 系统 SHALL 使用该图层的 `line-color`、`line-width` 和 terrain 配置绘制 polygon outline

#### Scenario: 混合几何源被 `line` 图层绘制
- **WHEN** 一个 `line` 图层的 source layer 同时包含 line 和 polygon 要素
- **THEN** 系统 SHALL 绘制 line 要素本身，并绘制 polygon 要素的 outline

### Requirement: 几何过滤保留所需源几何
系统 SHALL 在 worker decode 过滤和主线程过滤中保留样式图层需要的源几何类型。

#### Scenario: 面中心标注通过解码过滤
- **WHEN** 一个 `symbol` 图层配置 `layout["symbol-placement"]` 为 `polygon-center`
- **THEN** decode 过滤 SHALL 将匹配该图层 filter 的 polygon 要素作为所需源几何保留

#### Scenario: polygon outline 通过解码过滤
- **WHEN** 一个 `line` 图层匹配 polygon 要素
- **THEN** decode 过滤 SHALL 将匹配该图层 filter 的 polygon 要素作为 line 图层可绘制的源几何保留

### Requirement: `symbol-placement` 支持多种几何类型
系统 SHALL 支持更多几何类型的 symbol 放置策略。

#### Scenario: 线上 symbol 放置
- **WHEN** 一个 `symbol` 图层配置 `layout["symbol-placement"]` 为 `line`
- **THEN** 系统 SHALL 使用该 source layer 的线要素在线上绘制文字和图标

#### Scenario: 多点符号放置
- **WHEN** 一个 `symbol` 图层配置 `layout["symbol-placement"]` 为 `multipoint`
- **THEN** 系统 SHALL 使用该 source layer 的多点要素的每个点绘制符号

### Requirement: `symbol-placement` 支持偏移配置
系统 SHALL 支持在 symbol 放置时配置偏移量。

#### Scenario: 线上偏移放置
- **WHEN** 一个 `symbol` 图层配置 `layout["symbol-placement"]` 为 `line` 且配置了 `layout["text-offset"]`
- **THEN** 系统 SHALL 在线上按偏移量绘制文字和图标

#### Scenario: 面中心偏移放置
- **WHEN** 一个 `symbol` 图层配置 `layout["symbol-placement"]` 为 `polygon-center` 且配置了 `layout["text-offset"]`
- **THEN** 系统 SHALL 在面中心按偏移量绘制文字和图标

### Requirement: `symbol-placement` 支持旋转配置
系统 SHALL 支持在 symbol 放置时配置旋转角度。

#### Scenario: 线上旋转放置
- **WHEN** 一个 `symbol` 图层配置 `layout["symbol-placement"]` 为 `line` 且配置了 `layout["text-rotation"]`
- **THEN** 系统 SHALL 在线上按旋转角度绘制文字和图标

#### Scenario: 面中心旋转放置
- **WHEN** 一个 `symbol` 图层配置 `layout["symbol-placement"]` 为 `polygon-center` 且配置了 `layout["text-rotation"]`
- **THEN** 系统 SHALL 在面中心按旋转角度绘制文字和图标

### Requirement: `symbol-placement` 支持密度控制
系统 SHALL 支持控制 symbol 放置的密度。

#### Scenario: 线上密度控制
- **WHEN** 一个 `symbol` 图层配置 `layout["symbol-placement"]` 为 `line` 且配置了 `layout["symbol-spacing"]`
- **THEN** 系统 SHALL 按照间距要求在线上放置符号

#### Scenario: 面上密度控制
- **WHEN** 一个 `symbol` 图层配置 `layout["symbol-placement"]` 为 `polygon-center` 且配置了 `layout["symbol-spacing"]`
- **THEN** 系统 SHALL 按照间距要求在面上放置符号

### Requirement: `symbol-placement` 支持避让策略
系统 SHALL 支持在 symbol 放置时应用避让策略。

#### Scenario: 避让边缘
- **WHEN** 一个 `symbol` 图层配置 `layout["symbol-placement"]` 为 `polygon-center` 且配置了 `layout["symbol-avoid-edges"]`
- **THEN** 系统 SHALL 避免在地图边缘放置符号

#### Scenario: 避让重叠
- **WHEN** 一个 `symbol` 图层配置 `layout["symbol-placement"]` 为 `polygon-center` 且配置了 `layout["symbol-keep-upright"]`
- **THEN** 系统 SHALL 保持符号直立并避免重叠

### Requirement: `line` 图层支持多种几何类型
系统 SHALL 支持更多几何类型的 line 渲染。

#### Scenario: 点要素的 line 渲染
- **WHEN** 一个 `line` 图层的 source layer 包含点要素
- **THEN** 系统 SHALL 使用点要素的坐标绘制 line

#### Scenario: 多点要素的 line 渲染
- **WHEN** 一个 `line` 图层的 source layer 包含多点要素
- **THEN** 系统 SHALL 使用多点要素的坐标绘制 line

#### Scenario: 混合要素的 line 渲染
- **WHEN** 一个 `line` 图层的 source layer 同时包含点、线、面要素
- **THEN** 系统 SHALL 使用所有要素的坐标绘制 line

### Requirement: `line` 图层支持线帽样式
系统 SHALL 支持多种线帽样式。

#### Scenario: 平线帽
- **WHEN** 一个 `line` 图层配置 `paint["line-cap"]` 为 `butt`
- **THEN** 系统 SHALL 使用平线帽样式绘制线

#### Scenario: 方形线帽
- **WHEN** 一个 `line` 图层配置 `paint["line-cap"]` 为 `square`
- **THEN** 系统 SHALL 使用方形线帽样式绘制线

#### Scenario: 圆形线帽
- **WHEN** 一个 `line` 图层配置 `paint["line-cap"]` 为 `round`
- **THEN** 系统 SHALL 使用圆形线帽样式绘制线

### Requirement: `line` 图层支持连接样式
系统 SHALL 支持多种连接样式。

#### Scenario: 尖角连接
- **WHEN** 一个 `line` 图层配置 `paint["line-join"]` 为 `miter`
- **THEN** 系统 SHALL 使用尖角连接样式绘制线

#### Scenario: 圆角连接
- **WHEN** 一个 `line` 图层配置 `paint["line-join"]` 为 `round`
- **THEN** 系统 SHALL 使用圆角连接样式绘制线

#### Scenario: 斜角连接
- **WHEN** 一个 `line` 图层配置 `paint["line-join"]` 为 `bevel`
- **THEN** 系统 SHALL 使用斜角连接样式绘制线

### Requirement: `line` 图层支持虚线模式
系统 SHALL 支持虚线模式。

#### Scenario: 简单虚线
- **WHEN** 一个 `line` 图层配置 `paint["line-dasharray"]` 为 `[5, 5]`
- **THEN** 系统 SHALL 使用 5 像素实线和 5 像素空白的虚线模式

#### Scenario: 复杂虚线
- **WHEN** 一个 `line` 图层配置 `paint["line-dasharray"]` 为 `[10, 5, 2, 5]`
- **THEN** 系统 SHALL 使用 10 像素实线、5 像素空白、2 像素实线和 5 像素空白的虚线模式

### Requirement: `line` 图层支持线偏移
系统 SHALL 支持线的偏移。

#### Scenario: 左偏移
- **WHEN** 一个 `line` 图层配置 `paint["line-offset"]` 为负值
- **THEN** 系统 SHALL 向左偏移线

#### Scenario: 右偏移
- **WHEN** 一个 `line` 图层配置 `paint["line-offset"]` 为正值
- **THEN** 系统 SHALL 向右偏移线

### Requirement: `line` 图层支持线透明度
系统 SHALL 支持线的透明度。

#### Scenario: 固定透明度
- **WHEN** 一个 `line` 图层配置 `paint["line-opacity"]` 为 0.5
- **THEN** 系统 SHALL 使用 0.5 的透明度绘制线

#### Scenario: 数据驱动透明度
- **WHEN** 一个 `line` 图层配置 `paint["line-opacity"]` 为数据驱动表达式
- **THEN** 系统 SHALL 根据要素属性计算透明度

### Requirement: `line` 图层支持线模糊
系统 SHALL 支持线的模糊效果。

#### Scenario: 线模糊
- **WHEN** 一个 `line` 图层配置 `paint["line-blur"]` 为 2
- **THEN** 系统 SHALL 使用 2 像素的模糊效果绘制线

#### Scenario: 数据驱动模糊
- **WHEN** 一个 `line` 图层配置 `paint["line-blur"]` 为数据驱动表达式
- **THEN** 系统 SHALL 根据要素属性计算模糊值

### Requirement: 几何过滤性能优化
系统 SHALL 优化几何过滤的性能。

#### Scenario: 过滤缓存
- **WHEN** 多个图层使用相同的过滤条件
- **THEN** 系统 SHALL 缓存过滤结果以提高性能

#### Scenario: 增量过滤
- **WHEN** 数据源发生增量变化
- **THEN** 系统 SHALL 只重新过滤变化的部分

### Requirement: 几何过滤错误处理
系统 SHALL 提供适当的错误处理。

#### Scenario: 无效几何过滤
- **WHEN** 几何过滤条件无效
- **THEN** 系统 SHALL 记录错误并使用默认过滤条件

#### Scenario: 过滤失败处理
- **WHEN** 几何过滤过程失败
- **THEN** 系统 SHALL 记录错误并尝试继续处理
