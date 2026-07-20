## ADDED Requirements

### Requirement: 初始加载只构建必要样式桶

VectorTile 初始解码和建桶 SHALL 只处理 `visibility !== false`、类型受支持且构建 style zoom 位于 `[minzoom, maxzoom)` 的 style layer。构建 style zoom SHALL 使用当前 source VectorTile 的 level；没有匹配 feature 的 bucket SHALL 不驻留 Primitive、点描述或拾取上下文。

#### Scenario: 跳过 zoom 范围外的 layer

- **WHEN** level 8 的 VectorTile 所属 style layer 配置 `minzoom: 10`
- **THEN** 初次构建 SHALL 不为该 layer 创建 bucket 或 Primitive

#### Scenario: 跳过初始隐藏 layer

- **WHEN** style layer 在 VectorTile 初次构建时 `visibility` 为 `false`
- **THEN** 初次构建 SHALL 不为该 layer 创建 bucket，同时保留以后通过目标 bucket 构建显示该 layer 的能力

#### Scenario: 匹配当前构建 zoom

- **WHEN** VectorTile level 位于 style layer 的 minzoom/maxzoom 范围内且存在匹配 feature
- **THEN** 系统 SHALL 构建并登记该 layer 的 bucket

### Requirement: LOD 回退使用祖先已构建样式

当当前相机 style zoom 与祖先 fallback VectorTile 的构建 level 不同时，系统 SHALL 继续绘制祖先已经构建且当时有效的 bucket，直到当前精确 VectorTile 的必要 bucket 可绘制后再按 coverage 规则切换。系统 SHALL NOT 仅为了潜在的未来 fallback 给每个 VectorTile 预建全部 zoom 范围的 bucket。

#### Scenario: 子瓦片仍在加载

- **WHEN** 当前视图需要 level 12 瓦片但只有 level 10 祖先可绘制
- **THEN** 系统 SHALL 使用祖先 level 10 已构建样式覆盖该区域，而不是因 level 12 样式范围隐藏祖先并产生空洞

#### Scenario: 精确瓦片接管

- **WHEN** level 12 精确瓦片的必要 bucket 已经 ready
- **THEN** coverage 提交 SHALL 释放祖先回退引用并显示 level 12 对应样式

### Requirement: 离屏渲染缓存采用更低的 Demo 预算

LoadVectorTile Demo SHALL 显式把 manager `tileCacheSize` 配置为 `50`，并把示例 vector source 的 `cacheBytes` 配置为 `16 * 1024 * 1024`。公共构造器默认值 SHALL 在本 change 中保持不变。降低预算只 SHALL 驱逐引用为零的离屏资源；当前 committed、loading 或祖先回退瓦片 MUST 继续受引用计数保护。

#### Scenario: 离屏瓦片超过预算

- **WHEN** 引用为零的 READY VectorTile 使单 source 渲染缓存超过 Demo 配置预算
- **THEN** 缓存 SHALL 按现有 LRU 语义销毁最久未使用的离屏资源

#### Scenario: 当前可见资源超过预算

- **WHEN** 当前 committed 瓦片本身的估算成本超过配置预算
- **THEN** 系统 SHALL 保留这些有引用资源，直到其离开 committed/fallback/loading 状态后再参与驱逐

#### Scenario: 公共默认值兼容

- **WHEN** 用户使用公共构造器创建 VectorTileLayerManager
- **THEN** 系统 SHALL 保持现有默认值不变，只对 Demo 应用特殊配置

### Requirement: 驻留资源精确统计

系统 SHALL 准确统计 resident style buckets、render primitives 和引用为零离屏 VectorTile 的内存使用。当资源被驱逐或销毁时，系统 SHALL 准确回退相关计数。

#### Scenario: 统计驻留样式桶

- **WHEN** style bucket 被创建且驻留
- **THEN** 系统 SHALL 增加对应的驻留 bucket 计数

#### Scenario: 统计渲染图元

- **WHEN** Primitive 被创建并关联到 bucket
- **THEN** 系统 SHALL 增加对应的渲染图元计数

#### Scenario: 统计离屏瓦片

- **WHEN** VectorTile 处于离屏状态且引用为零
- **THEN** 系统 SHALL 增加对应的离屏瓦片计数

### Requirement: 驻留状态诊断输出

系统 SHALL 提供详细的驻留状态诊断信息，包括各类资源的数量、大小和状态。诊断 SHALL 在资源创建、销毁和状态变更时实时更新。

#### Scenario: 输出当前驻留状态

- **WHEN** 用户请求驻留状态信息
- **THEN** 系统 SHALL 显示当前各类驻留资源的详细统计

#### Scenario: 监控驻留状态变化

- **WHEN** 资源被创建或销毁
- **THEN** 系统 SHALL 更新诊断输出并记录变化事件

### Requirement: 离屏瓦片独立驻留

每个 VectorTile SHALL 独立管理其离屏驻留状态，不受同 source 其他瓦片影响。当瓦片离开 committed 状态且引用为零时， SHALL 按独立 LRU 语义决定是否保留。

#### Scenario: 瓦片独立驻留决策

- **WHEN** 某个 VectorTile 离开 committed 状态
- **THEN** 系统 SHALL 根据该瓦片自身的使用历史决定是否保留离屏版本

#### Scenario: 同源瓦片互不影响

- **WHEN** 同一 source 的不同瓦片有不同的使用模式
- **THEN** 系统 SHALL 为每个瓦片独立计算驻留价值，不统一考虑整个 source
