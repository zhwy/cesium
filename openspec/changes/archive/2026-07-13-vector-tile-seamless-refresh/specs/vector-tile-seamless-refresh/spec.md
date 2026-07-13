## ADDED Requirements

### Requirement: 刷新使用独立内容代

矢量瓦片图层 SHALL 为每次会改变瓦片输出的样式更新或显式缓存刷新创建新的内容代，并 SHALL 使相同坐标的新旧内容代能够同时存活且互不复用构建结果。

#### Scenario: 更新已有运行时图层样式

- **WHEN** 调用 `setLayerStyle()` 或 `VectorTileLayer.setStyle()` 更新已有 runtime layer 的样式
- **THEN** 系统 SHALL 为后续瓦片绑定使用新的内容代，并重新执行该代所需的请求、解码和建桶流程

#### Scenario: 显式刷新缓存

- **WHEN** 调用图层或 manager 的缓存刷新入口
- **THEN** 系统 SHALL 使用新的内容代请求当前视口瓦片，而不是从旧代缓存键返回已有瓦片

#### Scenario: 相同坐标的新旧瓦片并存

- **WHEN** 旧代瓦片仍被已提交渲染集引用且当前代请求相同 `(x, y, level)` 坐标
- **THEN** 系统 SHALL 返回两个不同的瓦片实例，并使其缓存和共享点条目身份互不冲突

### Requirement: 异步构建使用所属代样式快照

每个矢量瓦片 SHALL 使用创建时所属内容代的规范化样式快照完成过滤、解码和 Bucket 构建，过期代 SHALL NOT 在晚到后覆盖当前目标代。

#### Scenario: 请求期间再次修改样式

- **WHEN** 某瓦片请求或解码尚未完成时图层再次更新样式
- **THEN** 该瓦片的异步任务 SHALL 继续绑定其创建时样式快照或被取消，并 SHALL NOT 混用新的当前样式

#### Scenario: 连续快速更新样式

- **WHEN** 在前一内容代完成提交前连续创建多个新内容代
- **THEN** 系统 SHALL 只允许当前目标代作为新的提交候选，任何过期代 SHALL NOT 在稍后完成时接管画面

### Requirement: 样式刷新期间保持已覆盖区域连续

对刷新前已由可绘制瓦片覆盖的区域，系统 SHALL 在当前内容代提供 READY 且所有 Primitive 实际可绘制的替代覆盖之前继续提交旧代瓦片，并 SHALL 在替代覆盖就绪的同一帧完成区域切换。

#### Scenario: 新代瓦片仍在加载

- **WHEN** 样式刷新后当前内容代尚未为某个原已覆盖区域提供 READY 瓦片
- **THEN** 系统 SHALL 继续绘制该区域上一代已提交瓦片，不产生因刷新导致的空白帧

#### Scenario: Primitive 尚未完成 GPU 准备

- **WHEN** 当前代瓦片已完成建桶但其异步 Cesium Primitive 尚不能产生绘制命令
- **THEN** 系统 SHALL 继续保留旧代覆盖，并 SHALL NOT 因瓦片状态为 READY 而提前切换

#### Scenario: 当前代完成区域覆盖

- **WHEN** 当前代可绘制瓦片已完整覆盖某个由旧代保留的区域
- **THEN** 系统 SHALL 在同一帧提交当前代覆盖并移除该区域旧代覆盖，且 SHALL NOT 同时绘制重叠的新旧透明几何

### Requirement: 图层显隐切换保留可恢复状态

图层显隐切换 SHALL NOT 将普通隐藏操作视为销毁或硬重置；隐藏 SHALL 立即停止绘制，重新显示 SHALL 在先前覆盖区域利用保留状态避免空白切换。

#### Scenario: 隐藏可见图层

- **WHEN** 将可见 runtime layer 的 `show` 设置为 `false`
- **THEN** 系统 SHALL 从当前帧起停止提交该图层绘制命令，但 SHALL NOT 仅因隐藏而释放其已提交渲染集

#### Scenario: 在原视口重新显示图层

- **WHEN** 图层在相机仍处于先前已覆盖区域时从隐藏切换为显示
- **THEN** 系统 SHALL 立即使用保留的可绘制内容恢复显示，并在当前视口重新绑定完成后按正常提交规则更新

#### Scenario: 隐藏期间移动到未覆盖区域

- **WHEN** 图层隐藏期间相机移动到保留渲染集从未覆盖的区域后重新显示
- **THEN** 系统 SHALL 按正常流程加载该区域，并 SHALL NOT 将不相交的旧瓦片错误视为新区域的完整覆盖

### Requirement: 旧内容代资源最终释放

当前内容代接管或图层被删除后，系统 SHALL 正确释放不再提交的旧代瓦片引用、普通 Primitive、共享点条目和缓存字节，且 SHALL NOT 影响当前代资源。

#### Scenario: 新代接管旧代

- **WHEN** 当前代瓦片替换了 committed render set 中对应区域的旧代瓦片
- **THEN** 系统 SHALL 释放旧代提交引用，并在其引用计数归零时淘汰和销毁旧代资源

#### Scenario: 跨代共享点条目切换

- **WHEN** 相同坐标和样式规则的 billboard 或 label 从旧代切换到当前代
- **THEN** 系统 SHALL 删除旧代条目并保留当前代条目，不得因键冲突误删当前代对象

#### Scenario: 删除图层

- **WHEN** runtime layer 被移除或销毁
- **THEN** 系统 SHALL 清空该图层所有代的 committed 状态、缓存项、共享点条目和 Primitive

### Requirement: 无缝刷新保持公开 API 兼容

无缝刷新 SHALL 通过现有样式更新、缓存刷新和 `show` 属性入口生效，不要求调用方采用新的必选参数或修改样式文档结构。

#### Scenario: 使用现有调用方式更新样式

- **WHEN** 调用方按现有签名调用 `setLayerStyle()`、`VectorTileLayer.setStyle()` 或设置 runtime layer 的 `show`
- **THEN** 系统 SHALL 应用无缝刷新行为，并保持方法返回值和样式文档格式兼容
