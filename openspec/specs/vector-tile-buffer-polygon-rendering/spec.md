## Purpose

定义矢量瓦片 fill 图层的 BufferPolygon 渲染、更新、拾取及验证要求。

## Requirements

### Requirement: 独立 bucket 直接构建 BufferPolygon

启用 Buffer 路径的 fill 图层 MUST 使用独立 bucket，消费现有解码 Worker 准备的 packed 面几何和共享 feature table 直接构建 BufferPolygonCollection，不经过 GLB、Model、Cesium3DTileset。原有 fill/line bucket 实现文件 MUST 保持不变，现有请求、PBF 缓存、任务调度及四叉树选择/coverage 算法 SHALL 继续使用；解码 Worker SHALL 在当前解码流程内追加面准备阶段。

#### Scenario: 使用既有解码结果

- **WHEN** 一个瓦片包含匹配的启用 Buffer 的 fill 图层
- **THEN** 当前 Worker 解码任务 SHALL 同时返回其面准备结果，工厂 SHALL 使用该结果创建新 bucket，不新增原始瓦片重复解码或外部 tileset 加载步骤

### Requirement: 面几何保持外环洞及要素映射

新 bucket SHALL 保留现有 fill 的过滤、zoom、边界裁剪结果、外环、内洞、成面线及 geometry-to-feature 映射语义。Buffer 数据 MUST 提供匹配的三维顶点和洞起始索引；非贴地面 MUST 额外提供有效三角索引，贴地面 MUST 跳过切平面投影、三角剖分、椭球细分和三角缓冲分配。系统 SHALL 剔除退化环并按实际容量分配。非贴地大面 MUST 处理椭球曲率，不能以稀疏顶点的平面三角形代替地表几何后造成大面积遮蔽。

#### Scenario: 凹面带洞与多个片段

- **WHEN** 一个要素生成带洞凹面或多个被裁剪面片
- **THEN** 洞内不填充，片段索引不越界，所有片段映射到同一 feature 记录

#### Scenario: 成面线与空几何

- **WHEN** packed 数据包含符合原有 fill 条件的线环，或过滤后没有有效几何
- **THEN** 前者保留成面结果，后者沿用 READY_EMPTY 且不创建空 Buffer 集合和拾取记录

#### Scenario: 容量超过默认值

- **WHEN** 一个 bucket 的有效顶点、面、洞或三角数量超过集合默认容量
- **THEN** 构建仍按实际容量完成，不截断或越界

#### Scenario: 低层级非贴地大面

- **WHEN** 一个覆盖范围较大的非贴地面使用 Buffer 后端
- **THEN** 通过适当椭球细分保持预期地表几何，远近景均不因仅连接稀疏顶点而大面积陷入椭球

#### Scenario: 贴地面无需三角形

- **WHEN** 一个包含有效外环及洞的面按现有规则进入实际贴地路径
- **THEN** 系统 SHALL 仅用环和洞准备填充数据，不调用投影、剖分或细分算法，集合三角容量和数量 SHALL 为零，贴地填充及洞效果 SHALL 保持

### Requirement: 渲染对象适配现有就绪和预热接口

Buffer 渲染对象 SHALL 提供当前四叉树所需的 show、ready、update、isDestroyed 和 destroy 契约。ready MUST 反映 Worker 面准备、主线程集合填充及必要资源的准备状态，不能因集合没有 ready 属性而永久阻塞瓦片切换，也不能在只填入部分实例时报告 ready。隐藏预热 MUST NOT 产生实际绘制或贴地提交。ready SHALL NOT 被报告为贴地纹理烘焙完成。

#### Scenario: 子瓦片就绪后接替祖先

- **WHEN** 子瓦片 Buffer 对象完成准备且满足现有 coverage 规则
- **THEN** 当前四叉树允许其接替祖先，不永久保留 fallback

#### Scenario: 隐藏预热

- **WHEN** 新 bucket 或 replacement bucket 仅进行隐藏预热
- **THEN** 资源状态及待填充实例得到推进，但该对象不出现在实际绘制结果或本帧贴地标记集合中

#### Scenario: 集合仍在分帧填充

- **WHEN** 面集合只填入了一部分实例
- **THEN** ready SHALL 为 false，系统 SHALL 继续使用既有祖先或旧 bucket，且不得提交部分集合

### Requirement: 支持普通和逐帧贴地提交

非贴地 Buffer 面 SHALL 由现有提交链调用集合 update 绘制。贴地面 SHALL 仅在其瓦片属于本帧实际提交集合且图层可见时，以真正的 BufferPolygonCollection 注册到 scene.vectorProvider。clampToGround 与非零 heightOffset 的组合 SHALL 保留当前非贴地偏移回退行为。缺少所需 vectorProvider 时 MUST 明确报错或诊断，不静默伪装为成功贴地。

#### Scenario: 贴地 LOD 切换

- **WHEN** 显示集合从父瓦片切换到子瓦片
- **THEN** 只有实际选中可见的面集合继续 markForFrame，旧集合按帧生命周期退出，避免重复烘焙覆盖

#### Scenario: 隐藏与重新显示

- **WHEN** 已提交贴地 fill 被隐藏，之后其驻留 bucket 又被显示
- **THEN** 隐藏期间停止贴地标记，再显示时重新标记且不无故下载或解码

#### Scenario: 非零偏移与缺失场景能力

- **WHEN** 图层有非零 heightOffset，或需要贴地但场景没有 vectorProvider
- **THEN** 前者遵循当前非贴地偏移规则，后者通过现有错误/诊断接口暴露能力缺失

### Requirement: 保留 fill 轮廓效果

启用 Buffer 面后，新 bucket MUST 保留现有 fill-outline-color、fill-outline-width、洞边界与瓦片裁剪轮廓语义。本期轮廓 SHALL 继续使用现有线 Primitive/GroundPolylinePrimitive 机制，不要求实现 BufferPolyline。未配置 outline 的图层 SHALL 不创建轮廓资源。

#### Scenario: 用户示例的贴地透明面

- **WHEN** res_org_gr-level2-fill 启用 useBufferPrimitive 且保持现有透明默认填充、outline 和 clampToGround 配置
- **THEN** 填充由 Buffer 路径承担，轮廓配置保持生效，hover/选中时两种颜色按各自表达式更新

### Requirement: Buffer 样式和 feature-state 更新保持兼容

新 bucket SHALL 按共享 feature table 和紧凑映射独立更新 fill、outline 颜色、显隐和 feature-state。完全透明要素 MUST 保留后续变为可见的能力。兼容颜色/显隐更新 SHALL 保持几何身份且不新增请求/解码；缺少新表达式依赖时 SHALL 沿用目标 bucket 重建和版本管理。

#### Scenario: 从透明变为 hover 颜色

- **WHEN** 默认 alpha 为零的面通过 feature-state API 获得可见颜色，随后清除状态
- **THEN** 同一 Buffer 面及其对应轮廓正确变色和恢复，不重建或下载数据

#### Scenario: 离屏期间更新样式

- **WHEN** 缓存 bucket 离屏期间发生兼容样式更新，随后重新提交
- **THEN** 首次实际显示前使用最新颜色和可见性，贴地缓存随材质变化正确更新

### Requirement: 保留紧凑拾取结果与资源清理

Buffer 面 SHALL 通过紧凑局部身份解析到既有共享 feature table，保持 resolvePickedFeature 的 id、properties、sourceId、sourceLayer、layerId、tile、featureIndex 和 sourceFeatureIndex 契约及 pickProperties/promoteId 行为。allowPicking=false SHALL 跳过拾取登记。销毁或替换 bucket MUST 注销拾取和贴地集合，释放面/轮廓资源并正确回退驻留计数。真实拾取测试 SHALL 使用可见面/轮廓，透明片元 discard 导致的拾取限制 MUST 明确记录，不得仅凭通过 API 显色就宣称透明面可鼠标命中。

#### Scenario: 同一要素多个片段的拾取

- **WHEN** 拾取同一个原始要素的不同 Buffer 面片段或轮廓
- **THEN** 返回相同要素身份和符合 pickProperties 的属性，不在各片段复制完整 properties

#### Scenario: 驱逐后不残留

- **WHEN** 关闭开关、替换 bucket、清缓存或驱逐瓦片
- **THEN** Buffer 集合在缓冲销毁前从 vectorProvider 移除，旧拾取对象不再解析，计数准确回退且重复清理安全

### Requirement: Polygon 验证隔离调度差异

系统 SHALL 提供旧 fill 与 BufferPolygon 的针对性验证和同调度链对比，并记录实际激活的 Buffer bucket/面数与缓冲字节。对比 SHALL 固定相机、样式和填充图层，说明冷/热缓存、瓦片层级/数量及贴地烘焙影响，不得把调度工作量减少或隐藏面缺失宣称为 Buffer 性能收益。

#### Scenario: 同一配置比较两个后端

- **WHEN** 在同一面图层集合上分别关闭和打开开关进行测量
- **THEN** 输出 Buffer 激活计数、工作量、构建耗时和帧指标，并区分贴地烘焙和稳定帧，保留原有 benchmark 入口

#### Scenario: 验证边界明确

- **WHEN** 只能完成纯数据/接口测试，或浏览器环境出现既有 Worker/WebGL 失败
- **THEN** 验证报告说明已通过项目、既有失败和未验证的贴地/视觉项目，不把成功下载或 mock 调用视为真实出图通过

### Requirement: 面准备在 Worker 内执行并复用

启用 Buffer 的 fill SHALL 在当前解码 Worker 中执行环清理、坐标转换和对应模式的几何准备，主线程 MUST NOT 重复进行面投影、三角剖分或细分。相同任务、sourceLayer、输入几何及实际几何参数的准备结果 MUST 复用。返回结果 MUST 使用可转移 TypedArray，转移列表 MUST 按底层 ArrayBuffer 去重。首次加载及目标 bucket 重建 SHALL 使用相同契约。

#### Scenario: 多个样式层共享面几何

- **WHEN** 同一任务内多个启用 Buffer 的 fill 使用相同源几何、实际贴地模式和高度，但颜色或过滤条件不同
- **THEN** 同一候选面的数值几何 SHALL 只准备一次，各 bucket SHALL 独立保留其过滤、材质和要素映射

#### Scenario: 不启用 Buffer 面

- **WHEN** 解码任务只包含旧 fill、line、circle 或 symbol
- **THEN** 系统 SHALL 不执行新增面准备、不返回新增面准备缓冲，现有后端行为 SHALL 保持

#### Scenario: 主线程过滤回退

- **WHEN** Worker 不支持某个现有 filter，主线程过滤并压缩几何及 feature table
- **THEN** 面准备请求 SHALL 不丢失，准备结果 SHALL 同步筛选并重映射到最终 feature table，成面线与多片段身份 SHALL 正确

#### Scenario: 非贴地偏移回退

- **WHEN** 现有规则将 clampToGround 与非零 heightOffset 组合回退到非贴地面
- **THEN** Worker SHALL 准备非贴地三角形、细分及高度数据，不得误用无三角形贴地结果

### Requirement: 主线程面填充限制每帧工作量

主线程 SHALL 通过现有预热/更新流程分批填充 Buffer 面集合，同一 manager 的填充 SHALL 共享按 frameNumber 重置的内部每帧 4 ms 软预算。处理完整个面后 SHALL 检查剩余预算，每个获得预算的推进帧 SHALL 至少处理一个面；同帧重复 update/pick MUST NOT 重置预算。系统 MUST 保证后续帧继续推进，不能仅通过 Promise 微任务让出执行。单面处理、GPU 上传及地表打包不属于严格实时保证。

#### Scenario: 大量面分帧完成

- **WHEN** 一个瓦片的面填充工作量超过一帧预算
- **THEN** 工作 SHALL 延续到后续帧，后续任务不会在同一帧重新获得完整预算，全部完成前 SHALL 不替换旧覆盖

#### Scenario: 静态按需渲染仍有待填充工作

- **WHEN** 存在尚未填充完的面集合且相机没有变化
- **THEN** 系统 SHALL 请求后续帧直至完成或取消，不得永久停在 not-ready

### Requirement: 异步面构建保持样式版本和清理正确

Worker 结果消费、分帧填充和首次提交 MUST 检查现有 content/style revision、rebuild identity 与取消/释放状态。尚未填入的实例 SHALL 在填充时使用最新有效颜色及 feature-state，已填入实例 SHALL 沿用当前原地更新语义。取消或销毁 MUST 停止后续填充、释放临时数组及部分集合并准确回退资源计数。

#### Scenario: 填充期间修改颜色

- **WHEN** bucket 已部分填充，用户更新 fill-color 或 hover/selected 状态
- **THEN** 系统 SHALL 不访问尚不存在的集合条目，首次实际提交时所有实例 SHALL 使用最新样式，不重新执行几何准备

#### Scenario: 旧任务晚到

- **WHEN** Worker 结果返回或填充继续前，该瓦片已释放、内容已换代或 replacement 已被更新版本取代
- **THEN** 旧任务 SHALL 不提交或覆盖当前 bucket，关联临时及部分资源 SHALL 被释放

### Requirement: 面构建验证区分计算量和主线程阻塞

诊断 SHALL 区分 Worker 面准备时长、主线程填充实际 CPU 时长、到 ready 的墙钟时长及临时缓冲字节。性能对比 MUST 固定相同数据、视野、样式、贴地方式及工作量，使用 load/steady 的 frameInterval 和 longTasks 评估掉帧，不得仅凭同步 build 时间下降宣称总加载或帧率改善。

#### Scenario: Worker 耗时增加但帧间隔改善

- **WHEN** 优化后主线程尖峰减少但解码往返或总加载时间增加
- **THEN** 报告 SHALL 分别列出这些指标，不得隐藏总加载时间或声称计算总量按相同比例下降

#### Scenario: 未配置轮廓

- **WHEN** 启用 Buffer 的 fill 没有配置 fill-outline-color
- **THEN** bucket SHALL 不分配额外的轮廓中间位置数组，配置了轮廓时 SHALL 继续使用现有线渲染路径并保持视觉契约
