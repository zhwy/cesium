## ADDED Requirements

### Requirement: setLayerStyle 分类样式差异

`VectorTileLayerManager.setLayerStyle()` SHALL 在规范化并合并新样式后比较目标 style layer 的旧值与新值，把更新分类为无变化、可原地更新或需要重建。无变化更新 MUST 返回成功但 SHALL NOT 推进 content revision、清理缓存、请求 PBF、解码或建桶。

#### Scenario: 重复设置相同颜色

- **WHEN** 调用方把目标 layer 的颜色设置为其当前规范化值
- **THEN** manager SHALL 保持现有 Primitive、内容代和所有请求计数不变

#### Scenario: 更新包含不支持原地修改的结构字段

- **WHEN** 更新改变 filter、source-layer、几何类型、线宽、高度或影响几何布局的字段
- **THEN** 系统 SHALL 选择安全重建路径，而不是错误地只修改现有渲染属性

### Requirement: 支持颜色原地热更新

系统 SHALL 对当前已实现的 `line-color`、`fill-color`、`fill-outline-color`、`circle-color`、`circle-outline-color`、`text-color`、`text-halo-color` 和 `text-background-color` 执行细粒度热更新。instances line/fill SHALL 更新 Cesium per-instance color attribute，packed line SHALL 更新 material color uniform，circle/symbol SHALL 更新现有 Billboard、Label 或其图像资源。成功原地更新时系统 MUST 保持目标 VectorTile 和无关 style layer 的 Primitive 身份不变，并 SHALL NOT 推进整个 runtime source 的 content revision。

#### Scenario: 更新 instances line 常量颜色

- **WHEN** `setLayerStyle()` 只把 instances line 的 `line-color` 从一个常量颜色改为另一个兼容颜色
- **THEN** 系统 SHALL 更新现有 GeometryInstance color attributes，且不请求、解码或重建 source 瓦片

#### Scenario: 更新 fill 与 outline 颜色

- **WHEN** 更新只改变 `fill-color` 或 `fill-outline-color`
- **THEN** 系统 SHALL 只更新 bucket 中对应角色的 Primitive attributes，不得把 fill 颜色错误应用到 outline 或反之

#### Scenario: 更新 packed line 颜色

- **WHEN** packed line bucket 的常量 `line-color` 改变
- **THEN** 系统 SHALL 更新现有 material uniform 并保留 combined geometry

#### Scenario: 更新 circle 或 symbol 颜色

- **WHEN** circle 或当前支持的 symbol 文字颜色字段改变
- **THEN** 系统 SHALL 更新已经提交的共享点对象，并使尚未提交的缓存条目在下次提交前应用最新样式

### Requirement: 支持图层显隐原地热更新

style layer 的顶层 `visibility` 变化 SHALL 立即更新当前已构建 bucket 的可见状态，而不推进整个 source 的 content revision。线面 bucket SHALL 使用 Primitive 级 `show`，circle/symbol SHALL 使用共享点条目成员关系或对象 `show`；图层级显隐 SHALL NOT 为此额外创建逐 GeometryInstance show attribute。

#### Scenario: 隐藏已经构建的图层

- **WHEN** 可见 style layer 的 `visibility` 更新为 `false`
- **THEN** 当前提交的线、面和点内容 SHALL 在下一渲染帧停止绘制，无关 layer 保持可见且不发生重建

#### Scenario: 重新显示仍驻留的 bucket

- **WHEN** 隐藏 layer 的既有 bucket 尚未被驱逐且 `visibility` 更新为 `true`
- **THEN** 系统 SHALL 直接恢复 bucket 可见性，不重新请求或构建

#### Scenario: 显示从未构建或已驱逐的 bucket

- **WHEN** `visibility` 更新为 `true`，但当前活动瓦片没有该 style layer 的 bucket
- **THEN** 系统 SHALL 只调度目标 style layer 的必要 bucket 构建，并保持同 source 其他 layer 的 Primitive 不变

### Requirement: 数据驱动颜色更新检查属性依赖

当颜色从常量或旧表达式更新为数据驱动表达式时，系统 MUST 在更新前检查新表达式的静态属性依赖。所有依赖都已驻留时 SHALL 按 feature 重新求值并原地更新；缺少依赖或存在无法静态解析的新增依赖时 SHALL 通过 PBF 路径重建目标 bucket，不得使用缺失属性产生错误颜色。

#### Scenario: 新表达式依赖已经驻留

- **WHEN** 新颜色表达式只引用当前 feature table 已驻留的字段
- **THEN** 系统 SHALL 对目标 bucket 的每个 feature 求值并原地更新颜色

#### Scenario: 新表达式依赖未驻留

- **WHEN** 新颜色表达式引用一个当前 feature table 未保存的字段
- **THEN** 系统 SHALL 从正常 PBF cache/request 路径重新解码并替换目标 bucket，且不重建同 source 的其他 bucket

### Requirement: 热更新保持渲染状态正确

系统 MUST 检查颜色变化是否跨越现有 Appearance 的不透明/透明渲染状态能力。无法通过当前 Appearance 正确表达的新 alpha 状态 SHALL 触发目标 bucket 重建。尚未 ready 的 Primitive 或尚未提交的离屏 bucket SHALL 记录待应用样式版本，并在首次可修改或提交前同步到最新版本。

#### Scenario: fill 从不透明变为透明

- **WHEN** 一个以不透明 render state 创建的 fill bucket 更新为带透明度的颜色
- **THEN** 系统 SHALL 重建目标 bucket 或创建兼容 render state，不得只修改 color attribute 后继续以错误 pass 绘制

#### Scenario: Primitive 尚未 ready 时更新颜色

- **WHEN** style 更新发生在 Cesium Primitive 完成异步构建之前
- **THEN** 系统 SHALL 保留最新样式版本，并在 Primitive ready 后、首次实际绘制前应用该版本

#### Scenario: 离屏缓存瓦片重新进入视野

- **WHEN** 一个未被立即遍历更新的离屏 bucket 以后重新进入 committed render set
- **THEN** 系统 SHALL 在提交前惰性应用该 layer 的最新颜色与显隐版本

### Requirement: 热更新具有独立诊断

系统 SHALL 分别记录无变化更新、成功原地更新、更新的 instance/点对象数量、bucket 重建回退和 source 全量重建次数。颜色或显隐原地更新 SHALL 不增加 PBF cache miss、真实下载字节、decode 或 primitive build 计数。

#### Scenario: 观测成功颜色热更新

- **WHEN** 一次兼容颜色更新完成
- **THEN** diagnostics SHALL 增加原地更新相关计数，且请求、解码和 bucket build 相关计数保持不变

### Requirement: 目标 bucket 重建回退

当样式更新无法原地执行时，系统 SHALL 通过重建目标 bucket 来回退。重建 SHALL 只解码和构建目标 source-layer/style rule，不重建整个 source。重建 SHALL 支持并发、优先级和取消，并在完成后原子替换现有 bucket。

#### Scenario: 只重建目标 bucket

- **WHEN** 某个 style layer 需要重建但其他 layer 不需要
- **THEN** 系统 SHALL 只重建目标 style layer 的 bucket，保持其他 layer 不变

#### Scenario: 并发重建合并

- **WHEN** 同一瓦片的多个 layer 同时需要重建
- **THEN** 系统 SHALL 合并并发请求，避免重复解码同一瓦片

#### Scenario: 重建完成后原子替换

- **WHEN** replacement bucket 构建完成
- **THEN** 系统 SHALL 原子交换 Primitive 和拾取上下文，确保无闪烁切换

### Requirement: 热更新性能优化

系统 SHALL 优化热更新路径，减少不必要的计算和内存分配。对于可原地更新的样式变化，系统 SHALL 尽可能复用现有资源。

#### Scenario: 最小化内存分配

- **WHEN** 执行颜色原地更新
- **THEN** 系统 SHALL 尽可能复用现有 attribute buffers，避免重新分配

#### Scenario: 避免不必要的同步

- **WHEN** 样式更新不涉及渲染状态变化
- **THEN** 系统 SHALL 跳过不必要的 GPU 同步操作

### Requirement: 热更新兼容性保证

热更新 SHALL 保持与现有 API 的完全兼容，现有代码 SHALL 不需要任何修改即可获得热更新带来的性能提升。

#### Scenario: 现有代码继续工作

- **WHEN** 用户使用现有的 setLayerStyle() API
- **THEN** 所有现有功能 SHALL 继续正常工作，同时获得热更新优化

#### Scenario: 渐进式性能提升

- **WHEN** 用户逐步更新样式
- **THEN** 系统 SHALL 自动应用热优化，无需用户额外配置
