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
- **THEN** 系统 SHALL 使用该 source layer 的面要素计算中心点，并在中心点绘制符合该 symbol 样式的文字和图标

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

### Requirement: 文档说明 placement 语义
系统 SHALL 在样式配置文档中说明 symbol placement、line 图层对 polygon outline 的支持范围，以及 `circle` 图层的预留状态。

#### Scenario: 样式文档包含 polygon placement 说明
- **WHEN** 用户阅读 `STYLE.md`
- **THEN** 文档 SHALL 说明 `symbol-placement: "point"`、`symbol-placement: "polygon-center"`、line 图层绘制 polygon outline、`clipToTile: true` 时 polygon center 的瓦片片段语义，以及 `circle` 当前为预留未实现类型
