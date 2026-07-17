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

- **WHEN** 非 Demo 调用方没有配置 `tileCacheSize` 或 source `cacheBytes`
- **THEN** manager 和 source SHALL 继续使用 change 前的公共默认值

### Requirement: PBF 与渲染驻留预算保持独立

驱逐离屏 bucket 或 VectorTile SHALL NOT 自动删除 manager 级 PBF ready entry；PBF 仍由 `pbfCacheBytes` 和其独立 LRU 控制。被驱逐瓦片重新进入视野时 SHALL 通过正常 PBF cache/request 路径恢复，PBF 命中时不得产生真实网络下载。

#### Scenario: 驱逐 Primitive 后 PBF 仍命中

- **WHEN** 一个离屏 VectorTile 的 Primitive 已被渲染缓存驱逐，但对应 PBF master 仍在 manager cache 中
- **THEN** 该瓦片重新进入视野时 SHALL 从 PBF cache 工作副本解码，不发起真实网络请求

#### Scenario: 两类缓存分别清理

- **WHEN** 调用方只调用 `clearPbfCache()`
- **THEN** 当前和离屏渲染资源 SHALL 保持不变

### Requirement: 诊断区分可见与离屏运行时驻留

diagnostics SHALL 暴露当前驻留 style bucket、Primitive、共享点条目、feature table 记录、公开 pick property 值和引用为零的离屏 VectorTile 数量，并继续独立报告 PBF bytes/entries。计数 SHALL 在 bucket 替换、瓦片驱逐、图层删除和 manager 销毁后回落。

#### Scenario: 瓦片从可见转为离屏缓存

- **WHEN** 一个 READY VectorTile 释放最后一个渲染引用但仍保留在 LRU 中
- **THEN** 离屏驻留瓦片指标 SHALL 增加，同时 bucket、Primitive 和 feature table 驻留指标保持到实际驱逐为止

#### Scenario: 驱逐离屏瓦片

- **WHEN** 缓存实际销毁一个离屏 VectorTile
- **THEN** 对应 bucket、Primitive、点条目、feature table 和 pick property 驻留指标 SHALL 减少

#### Scenario: 样式原地更新

- **WHEN** 颜色或显隐通过原地路径更新
- **THEN** 驻留 bucket 和 Primitive 数量 SHALL 保持稳定，且不出现旧内容代驻留增加
