## ADDED Requirements

### Requirement: 样式图层支持 useBufferPrimitive 开关

系统 SHALL 在 `layers[]` 每条样式图层的顶层接受可选 boolean 字段 `useBufferPrimitive`，省略时默认 `false`。该字段 SHALL 与 `paint`、`terrain` 同级，不属于 source 配置。显式非 boolean 值 MUST 被拒绝并提供包含图层 id 的配置错误。样式规范化、运行时 rule、`toJSON()`、`getStyle()` 及合并/替换更新 MUST 保留该值。

#### Scenario: 配置字段完整往返

- **WHEN** 一个 fill 图层设置 `useBufferPrimitive: true` 并经过规范化和运行时样式序列化
- **THEN** 该图层输出仍包含 `useBufferPrimitive: true`，其他图层值保持独立

#### Scenario: 省略开关保持兼容

- **WHEN** 现有图层未配置 useBufferPrimitive
- **THEN** 规范化结果为 false，继续使用原有 bucket

#### Scenario: 非法类型

- **WHEN** 任意图层显式配置字符串、数字、null、数组或对象作为 useBufferPrimitive
- **THEN** 系统拒绝该文档并指明对应图层字段，不按真值隐式启用

### Requirement: Buffer 开关仅路由本期支持的 fill 图层

系统 SHALL 仅在 `type === "fill"` 且 `useBufferPrimitive === true` 时选择新的 BufferPolygon bucket。显式 false 或省略时 MUST 继续选择原有 fill bucket。line/circle/symbol 本期 SHALL 保持原有渲染，即使配置为 true；该支持范围 MUST 在样式文档中说明。source.renderBackend SHALL 保留现有 instances/packed 语义。

#### Scenario: 同源新旧 fill 并存

- **WHEN** 同 source 的两个 fill 图层分别配置 true 和 false
- **THEN** 前者构建新 BufferPolygon bucket，后者构建原有 fill bucket，双方不改变对方配置

#### Scenario: 非 fill 配置为 true

- **WHEN** line、circle 或 symbol 图层配置 useBufferPrimitive 为 true
- **THEN** 字段被保留但仍构建该类型原有 bucket，不尝试创建 BufferPolygon

### Requirement: 开关变化沿用结构样式重建

系统 SHALL 将规范化后 true/false 的变化视为结构样式变化，沿用现有 source 重建和资源清理流程；省略与 false SHALL 视为同值。初次建桶及后续 replacement bucket MUST 根据最新图层配置选择路径。开关配置本身 SHALL NOT 引入第二套加载或调度体系。

#### Scenario: 运行时启用和关闭

- **WHEN** 通过 setLayerStyle 将已有 fill 的 useBufferPrimitive 从 false 改为 true，之后改回 false
- **THEN** 两次更新分别按现有结构重建流程选择 Buffer 和原有 bucket，清理被替换资源并保持原有请求、解码、缓存和调度接口

#### Scenario: 默认值变化不造成重建

- **WHEN** 图层从省略 useBufferPrimitive 更新为显式 false 且其他字段不变
- **THEN** 系统按规范化后的相同样式处理，不触发额外重建
