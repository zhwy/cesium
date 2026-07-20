## ADDED Requirements

### Requirement: 运行时必须提供逐要素状态 API

`VectorTileLayerManager` MUST 提供 `setFeatureState(target, state)`、`getFeatureState(target)` 和 `removeFeatureState(target, key)`，并使用 `source`、`sourceLayer` 与 string/number `id` 共同寻址一个要素。set MUST 浅合并顶层状态键，get MUST 返回不可用于直接修改内部状态的浅拷贝，remove MUST 支持删除单键或整个要素状态。

#### Scenario: 状态补丁浅合并

- **WHEN** 调用方先为同一 target 设置 `{ hover: true, rank: 1 }`，再设置 `{ rank: 2 }`
- **THEN** `getFeatureState(target)` MUST 返回 `{ hover: true, rank: 2 }`
- **THEN** 第二次设置 MUST NOT 删除补丁中未出现的 `hover`

#### Scenario: 删除状态键和完整状态

- **WHEN** 调用方传入 key 删除某一状态键
- **THEN** 运行时 MUST 保留该要素的其他状态键
- **WHEN** 调用方不传 key 删除该 target 的状态
- **THEN** 后续 get MUST 返回空对象

#### Scenario: 输入校验和 no-op

- **WHEN** target 缺少 source、sourceLayer 或有效的 string/number id，或 state 不是普通对象
- **THEN** API MUST 抛出 `DeveloperError`
- **WHEN** set/remove 没有改变任何值
- **THEN** API MUST 返回 false 且 MUST NOT 调度颜色更新

#### Scenario: get 返回隔离副本

- **WHEN** 调用方修改 `getFeatureState()` 返回对象
- **THEN** 后续 get MUST NOT 包含该次直接修改

### Requirement: 状态身份必须跨渲染副本保持一致

运行时 MUST 使用不包含样式图层 id 和瓦片坐标的 `(source, sourceLayer, typedId)` 作为逻辑状态身份，并 MUST 区分数值 id 与同文本的字符串 id。

#### Scenario: 同一要素跨瓦片同步

- **WHEN** 相同稳定 id 的源要素同时出现在两个驻留瓦片或多个裁剪片段中
- **THEN** 一次状态变化 MUST 更新这些表示中的全部相关实例

#### Scenario: 同一要素由多个样式图层绘制

- **WHEN** 多个样式图层引用同一 source、source-layer 和 id
- **THEN** 所有读取该状态的样式图层 MUST 看到同一状态值

#### Scenario: 字符串和数值身份不冲突

- **WHEN** 同一 source-layer 同时存在 id 为数字 `1` 和字符串 `"1"` 的要素
- **THEN** 设置其中一个要素的状态 MUST NOT 更新另一个要素

### Requirement: 状态变化必须执行目标化的原地颜色更新

对于支持 feature-state 的 instances 线、面颜色字段，运行时 MUST 只重新求值目标身份的颜色，并 MUST 通过既有 per-instance color attribute 原地更新所有相关 GeometryInstance。

#### Scenario: 悬浮状态只更新目标实例

- **WHEN** 一个驻留 bucket 中只有一个要素的 `hover` 状态发生变化
- **THEN** 运行时 MUST 只写入该要素绑定的 line、fill 或既有 outline 实例属性
- **THEN** 同 bucket 中未绑定该身份的实例属性 MUST 保持不变

#### Scenario: 状态变化不重建数据管线

- **WHEN** 对已建立可原地更新绑定的要素调用 set 或 remove
- **THEN** 运行时 MUST NOT 发起 PBF 请求、重新解码瓦片或重建几何/bucket

#### Scenario: 状态颜色改变透明度

- **WHEN** feature-state 颜色表达式从不透明结果切换为透明结果，或反向切换
- **THEN** 已建立的兼容渲染路径 MUST 原地显示新 alpha，且 MUST NOT 因该状态变化替换 Primitive

### Requirement: 状态与异步瓦片生命周期必须收敛

状态表 MUST 独立于瓦片 cache，所有新建或尚未 ready 的 bucket MUST 在可见前应用该 source 的最新状态 revision，销毁的 bucket MUST 确定性注销绑定和待处理更新。

#### Scenario: 先设置状态再加载瓦片

- **WHEN** 状态在包含该要素的瓦片请求或构建之前写入
- **THEN** 新实例第一次可见时 MUST 使用该状态计算颜色

#### Scenario: Primitive ready 前连续更新

- **WHEN** 同一要素在 Primitive ready 前收到多次状态写入或删除
- **THEN** 运行时 MUST 合并待处理工作并在 ready 后应用最终状态
- **THEN** 中间状态 MUST NOT 在较晚时刻覆盖最终状态

#### Scenario: 瓦片驱逐后重新加载

- **WHEN** 含有已设状态要素的瓦片被 cache 驱逐后再次加载，而 runtime source 未被替换
- **THEN** 重新创建的实例 MUST 恢复该要素的当前状态样式

#### Scenario: source 销毁清理状态

- **WHEN** runtime source 被移除、替换或 manager 被销毁
- **THEN** 该 source 的状态表、驻留绑定和待处理更新 MUST 被清空
- **THEN** 已销毁 bucket 的异步路径 MUST NOT 再写入 Primitive 属性

### Requirement: 状态必须遵循 source 运行时生命周期

状态 MUST 在同一 runtime source 的瓦片缓存变化和样式图层热更新期间保留，但 MUST NOT 自动迁移到替换后的新 runtime source。

#### Scenario: 样式图层热更新保留状态

- **WHEN** manager 在不替换 runtime source 的情况下更新、增加或移除样式图层
- **THEN** source 状态 MUST 保留，并由新建的相关 bucket 读取

#### Scenario: 替换 source 不复用旧状态

- **WHEN** 同名 source 的配置变化导致旧 runtime source 被销毁并创建新 runtime source
- **THEN** 新 runtime source MUST 从空状态表开始

### Requirement: 状态更新必须可诊断

诊断 MUST 分别记录状态写入、no-op、删除、实例属性更新、延迟更新和不可寻址要素，并 MUST 暴露当前状态条目数和驻留绑定数。

#### Scenario: 成功的状态更新产生诊断

- **WHEN** 一次 set 改变状态并更新多个跨瓦片实例
- **THEN** 状态写入计数 MUST 增加一次
- **THEN** 实例更新计数 MUST 按实际写入的实例数量增加

#### Scenario: no-op 不产生渲染工作

- **WHEN** 一次 set 写入与当前状态浅相等的值
- **THEN** no-op 计数 MUST 增加
- **THEN** 实例更新、请求、解码和 bucket build 计数 MUST 保持不变

### Requirement: 示例必须演示悬浮和点击状态

LoadVectorTile Demo MUST 使用拾取结果的稳定 target 分别维护 `hover` 和 `selected` 状态，并 MUST 避免在鼠标仍停留于同一 target 时重复写入状态。

#### Scenario: 鼠标从一个要素移动到另一个要素

- **WHEN** 鼠标拾取 target 从 A 变化为 B
- **THEN** Demo MUST 删除 A 的 `hover` 状态键并为 B 设置 `hover: true`

#### Scenario: 仅保留拾取身份

- **WHEN** Demo 不需要展示任意业务属性
- **THEN** Demo MUST 能在开启 picking 且 `pickProperties` 为空数组时完成 hover 和 selected 交互
