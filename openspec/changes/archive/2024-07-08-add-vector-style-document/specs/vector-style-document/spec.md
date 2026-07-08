## ADDED Requirements

### Requirement: Style document defines vector sources and style layers

系统 SHALL 支持一个样式文档对象，该对象包含 `sources` 和 `layers` 两个顶层字段。`sources` SHALL 以 source id 为 key 定义矢量瓦片数据源；`layers` SHALL 以数组形式定义有序样式图层。

#### Scenario: Load style document with one source and multiple layers

- **WHEN** 用户提供一个包含单个 vector source 和多个引用该 source 的 style layer 的样式文档
- **THEN** 系统 SHALL 接受该样式文档，并按 `layers` 数组顺序创建样式图层

#### Scenario: Reject layer with missing source

- **WHEN** 样式图层引用的 `source` 不存在于 `sources` 中
- **THEN** 系统 SHALL 抛出可诊断错误或通过错误事件报告该配置无效

### Requirement: Multiple style layers share one vector source

系统 SHALL 允许多个 style layer 引用同一个 vector source，并 SHALL 对同一个 source tile 共享请求、解码和缓存结果。

#### Scenario: Reuse source tile for fill and line layers

- **WHEN** 一个 `fill` layer 和一个 `line` layer 引用相同的 source、相同 tile 坐标和相同 PBF URL
- **THEN** 系统 SHALL 对该 tile 只执行一次网络请求和一次基础解码

#### Scenario: Preserve independent layer rendering

- **WHEN** 多个 style layer 共享同一个 source tile
- **THEN** 系统 SHALL 为每个 style layer 独立应用其 `sourceLayer`、`filter`、`paint`、`layout` 和 `terrain` 配置

### Requirement: Style layers support sourceLayer selection

每个 style layer SHALL 通过 `sourceLayer` 指定 PBF 内部 source-layer 名称。系统 SHALL 只从对应 source-layer 中读取要素。

#### Scenario: Render matching sourceLayer only

- **WHEN** PBF 中包含 `roads` 和 `buildings` 两个 source-layer，style layer 的 `sourceLayer` 为 `roads`
- **THEN** 系统 SHALL 只使用 `roads` 中的要素构建该 style layer 的渲染桶

#### Scenario: Missing sourceLayer becomes empty coverage

- **WHEN** PBF 中不存在 style layer 指定的 `sourceLayer`
- **THEN** 系统 SHALL 将该 style layer 在当前 tile 上视为合法空结果，而不是请求失败

### Requirement: Fill layers support polygon paint properties

`fill` 类型 style layer SHALL 支持面填充色、面线框色和面线框宽度。面线框 SHALL 与面填充保持独立渲染语义。

#### Scenario: Render polygon fill color

- **WHEN** `fill` layer 设置 `paint["fill-color"]`
- **THEN** 系统 SHALL 使用该颜色渲染 polygon 填充

#### Scenario: Render polygon outline

- **WHEN** `fill` layer 设置 `paint["fill-outline-color"]` 和 `paint["fill-outline-width"]`
- **THEN** 系统 SHALL 为 polygon 边界生成线框渲染结果，并使用配置的颜色和宽度

### Requirement: Line layers support line paint properties

`line` 类型 style layer SHALL 支持线颜色和线宽。

#### Scenario: Render line color and width

- **WHEN** `line` layer 设置 `paint["line-color"]` 和 `paint["line-width"]`
- **THEN** 系统 SHALL 使用配置的颜色和宽度渲染线要素

### Requirement: Symbol layers support point icons and text

`symbol` 类型 style layer SHALL 支持点图标和点文字。图标 SHALL 通过 `layout["icon-image"]` 配置，文字 SHALL 通过 `layout["text-field"]` 配置。

#### Scenario: Render point icon

- **WHEN** 点要素所在 style layer 设置 `layout["icon-image"]`
- **THEN** 系统 SHALL 为匹配点要素创建图标渲染项

#### Scenario: Render point text

- **WHEN** 点要素所在 style layer 设置 `layout["text-field"]`
- **THEN** 系统 SHALL 为匹配点要素创建文字渲染项

#### Scenario: Render icon and text together

- **WHEN** 同一个 `symbol` layer 同时设置 `layout["icon-image"]` 和 `layout["text-field"]`
- **THEN** 系统 SHALL 为匹配点要素同时创建图标和文字渲染项

### Requirement: Style values support constants and expressions

样式值 SHALL 支持常量和可序列化表达式。表达式 SHALL 能从要素属性、zoom 或字面量中计算最终样式值。

#### Scenario: Use constant paint value

- **WHEN** `paint["fill-color"]` 设置为 `"#00ff0044"`
- **THEN** 系统 SHALL 将该字符串解析为固定填充色

#### Scenario: Use feature property value

- **WHEN** `layout["text-field"]` 设置为 `["get", "name"]`
- **THEN** 系统 SHALL 使用每个要素 `properties.name` 的值作为文字内容

#### Scenario: Use matched property value

- **WHEN** `paint["fill-color"]` 设置为基于 `["match", ["get", "type"], ...]` 的表达式
- **THEN** 系统 SHALL 根据每个要素的 `type` 属性计算填充色

#### Scenario: Use zoom interpolation

- **WHEN** `paint["line-width"]` 设置为基于 `["interpolate", ["linear"], ["zoom"], ...]` 的表达式
- **THEN** 系统 SHALL 根据当前 tile level 或视图 zoom 计算线宽

### Requirement: Style layers support filters

每个 style layer MAY 配置 `filter` 表达式。系统 SHALL 只为 filter 结果为 truthy 的要素构建该 style layer 的渲染结果。

#### Scenario: Filter features by equality

- **WHEN** style layer 设置 `filter: ["==", ["get", "status"], "active"]`
- **THEN** 系统 SHALL 只渲染 `properties.status` 等于 `"active"` 的要素

#### Scenario: Filter features by compound condition

- **WHEN** style layer 设置 `filter: ["all", [">", ["get", "area"], 100], ["==", ["get", "kind"], "park"]]`
- **THEN** 系统 SHALL 只渲染同时满足面积和类型条件的要素

### Requirement: 3D terrain options are supported per style layer

每个 style layer SHALL 支持 `terrain.clampToGround` 和 `terrain.heightOffset`。系统 SHALL 按几何类型应用这些配置，并在无法完全支持某种组合时保持稳定渲染且提供可诊断行为。

#### Scenario: Apply height offset

- **WHEN** style layer 设置 `terrain.heightOffset: 2.0`
- **THEN** 系统 SHALL 将该 style layer 的渲染结果相对基础地表或椭球面偏移 2.0 米

#### Scenario: Apply clamp to ground

- **WHEN** style layer 设置 `terrain.clampToGround: true`
- **THEN** 系统 SHALL 使用对应几何类型可用的贴地渲染路径

### Requirement: Legacy styles configuration remains compatible

系统 SHALL 继续接受现有 `manager.addLayer({ url, styles })` 简化配置，并 SHALL 将其转换为等价 style document 或等价内部结构。

#### Scenario: Use existing styles option

- **WHEN** 用户继续传入旧版 `styles: { sourceLayerName: style }`
- **THEN** 系统 SHALL 保持 demo 可运行，并渲染与旧版本等价的线/面结果

#### Scenario: Convert mixed fill and line style

- **WHEN** 旧版 style 同时包含面填充和线样式字段
- **THEN** 系统 SHALL 将其拆分为可独立处理的 fill/line style layer 或等价渲染桶
