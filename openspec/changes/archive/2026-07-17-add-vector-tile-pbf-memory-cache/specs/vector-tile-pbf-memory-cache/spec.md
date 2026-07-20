## ADDED Requirements

### Requirement: Manager 提供可配置的 PBF 内存预算

`VectorTileLayerManager` SHALL 持有一个由所有 vector source 共享的原始 PBF 内存缓存，并通过构造参数 `pbfCacheBytes` 限制 ready master buffer 的总字节数。未配置时 SHALL 使用 `64 * 1024 * 1024` 字节，配置为 `0` 时 SHALL 禁用 ready PBF 缓存，但不影响正常网络加载和渲染。

#### Scenario: 使用默认 PBF 缓存预算

- **WHEN** 创建 manager 时未传入 `pbfCacheBytes`
- **THEN** 系统 SHALL 使用 64 MiB 的 manager 级原始 PBF 缓存预算

#### Scenario: 使用自定义 PBF 缓存预算

- **WHEN** 创建 manager 时传入一个有限且非负的 `pbfCacheBytes`
- **THEN** 系统 SHALL 使用该值作为所有 source 共用的 ready PBF master buffer 总预算

#### Scenario: 禁用 PBF ready 缓存

- **WHEN** `pbfCacheBytes` 为 `0`
- **THEN** 系统 SHALL 继续请求和解码瓦片，但 SHALL NOT 在请求完成后保留 ready PBF master buffer

#### Scenario: 拒绝无效预算

- **WHEN** `pbfCacheBytes` 为负数、非有限数或非数字值
- **THEN** manager 构造 SHALL 抛出 `DeveloperError`

### Requirement: PBF 缓存身份与样式内容代解耦

系统 SHALL 使用稳定的 source 数据身份和瓦片坐标构造 PBF key。key SHALL 区分不同 source 数据配置，并 SHALL NOT 包含 `contentRevision`、source-layer、filter、paint、layout、图标、scene 或渲染后端状态。

#### Scenario: 样式热更新复用 PBF

- **WHEN** 已缓存的可见瓦片仅因样式或 filter 变化进入新的 `contentRevision`
- **THEN** 新内容代 SHALL 从 PBF 缓存取得数据并重新解码，且 SHALL NOT 为该缓存命中的瓦片再次发起网络请求

#### Scenario: 相同 source 的多个样式图层共享 PBF

- **WHEN** 多个样式图层引用同一 source 和瓦片坐标
- **THEN** 系统 SHALL 只保存一份对应的 PBF master buffer

#### Scenario: 不同数据源不会错误命中

- **WHEN** 两个 source 使用不同的数据 URL、瓦片寻址配置或 source 身份请求相同 `(z, x, y)`
- **THEN** 系统 SHALL 为它们生成不同 PBF key

### Requirement: PBF master buffer 在 Worker transfer 后保持可复用

缓存 SHALL 私有持有不可变的 PBF master `ArrayBuffer`，并 SHALL 为每个解码消费者提供独立的工作副本。只有工作副本可以 transfer 给 Worker。

#### Scenario: 首次请求后保存可复用 master

- **WHEN** 网络请求返回非空 PBF `ArrayBuffer`
- **THEN** 缓存 SHALL 保留 master buffer，并向当前解码任务返回一个内容相同但身份不同的工作副本

#### Scenario: Worker transfer 不会 detach master

- **WHEN** 解码器 transfer 缓存返回的工作副本
- **THEN** 缓存中的 master buffer SHALL 保持未 detach，并可继续为后续样式内容代创建副本

#### Scenario: 多个消费者获得独立副本

- **WHEN** 同一 ready PBF key 被连续读取多次
- **THEN** 每次读取 SHALL 返回独立 `ArrayBuffer`，且任一副本被 transfer SHALL NOT 影响其他副本或 master

### Requirement: PBF LRU 严格按 ready master 字节预算驱逐

缓存 SHALL 按 master `ArrayBuffer.byteLength` 计费并按最近访问顺序驱逐 ready entry，直到 ready master 总字节数不超过 `pbfCacheBytes`。解码工作副本和 pending 网络响应的瞬时内存 SHALL NOT 计入该缓存预算。

#### Scenario: 超过预算时驱逐最久未使用项

- **WHEN** 插入一个 ready PBF 后总字节数超过预算
- **THEN** 缓存 SHALL 从最久未使用的 ready entry 开始驱逐，直至回到预算内

#### Scenario: 访问更新 LRU 顺序

- **WHEN** 一个 ready PBF entry 被命中
- **THEN** 缓存 SHALL 将其标记为最近使用，使其他更旧 entry 优先被驱逐

#### Scenario: 单瓦片大于预算

- **WHEN** 一个成功请求的 PBF 大于整个 `pbfCacheBytes` 预算
- **THEN** 系统 SHALL 将数据交给当前消费者，但 SHALL NOT 把该 master 保留为 ready entry

#### Scenario: 不缓存空响应或失败响应

- **WHEN** 网络请求失败、被取消或返回零字节响应
- **THEN** 缓存 SHALL NOT 创建 ready PBF entry

### Requirement: 同一 PBF 的并发请求被安全合并

系统 SHALL 对同一 PBF key 的并发 miss 共享一次底层网络任务，并为每个消费者维持独立的取消、优先级和工作副本语义。

#### Scenario: 并发 miss 只请求一次

- **WHEN** 多个内容代或瓦片消费者在首个请求完成前请求同一 PBF key
- **THEN** 系统 SHALL 只发起一个底层网络请求，并在成功后为每个仍有效的消费者提供独立工作副本

#### Scenario: 单个消费者取消不影响其他消费者

- **WHEN** 一个共享请求的消费者被旧 `contentRevision` 取消，但仍有其他消费者等待
- **THEN** 系统 SHALL 只拒绝已取消的消费者，并 SHALL NOT 取消底层网络请求

#### Scenario: 所有消费者取消后终止请求

- **WHEN** 一个 pending PBF 请求的所有消费者均已取消
- **THEN** 系统 SHALL 取消底层网络任务，并 SHALL NOT 因该已取消任务创建 ready entry

#### Scenario: 请求失败后允许重试

- **WHEN** 共享底层请求失败
- **THEN** 系统 SHALL 向所有有效消费者传播失败，并移除 pending entry，使后续请求可以重新加载

### Requirement: 渲染失效与 PBF 数据清理相互独立

样式相关操作 SHALL 只使带 `contentRevision` 的渲染内容失效，不得清除 manager 级 PBF ready cache。系统 SHALL 提供显式 `clearPbfCache()` 入口用于清除原始数据缓存。

#### Scenario: 样式与渲染选项变化保留 PBF

- **WHEN** style、filter、visibility、icon、scene 或 render backend 变化导致渲染内容失效
- **THEN** 系统 SHALL 保留已缓存 PBF，并允许新内容代复用

#### Scenario: 完整 setStyle 复用未变化 source

- **WHEN** `manager.setStyle()` 重建 runtime layer，但 source 数据身份和瓦片坐标未变化
- **THEN** 新 runtime layer SHALL 可以命中 manager 仍持有的 PBF entry

#### Scenario: 显式清理 PBF 缓存

- **WHEN** 调用 `manager.clearPbfCache()`
- **THEN** 系统 SHALL 清除所有 ready PBF entry 但保留当前渲染内容，使后续 PBF 读取重新加载数据；清理时已被消费者持有的工作副本 SHALL 继续有效

#### Scenario: 显式清理全部缓存

- **WHEN** 调用 `manager.clearCache()`
- **THEN** 系统 SHALL 同时使渲染内容失效并清除 ready PBF entry，使后续瓦片加载成为冷启动

#### Scenario: 清理后旧 pending 不得回填

- **WHEN** `clearPbfCache()` 或 `clearCache()` 执行前创建的 pending 请求在清理后完成
- **THEN** 系统 SHALL 允许仍有效消费者使用其工作副本，但 SHALL NOT 将旧 generation 的响应重新写入 ready PBF cache

### Requirement: PBF 缓存行为可被独立诊断

启用 diagnostics 时，系统 SHALL 将原始 PBF 缓存指标与现有渲染瓦片缓存指标分开记录。

#### Scenario: 记录 PBF 缓存生命周期指标

- **WHEN** PBF 缓存发生命中、未命中、插入、驱逐、复制或共享 pending 请求
- **THEN** diagnostics SHALL 更新对应计数器，并报告 ready entry 数和 `residentPbfCacheBytes` gauge

#### Scenario: 网络字节只统计真实下载

- **WHEN** 瓦片从 PBF 缓存命中并重新解码
- **THEN** 系统 SHALL 记录 PBF cache hit，但 SHALL NOT 将该 buffer 计入本次网络下载字节
