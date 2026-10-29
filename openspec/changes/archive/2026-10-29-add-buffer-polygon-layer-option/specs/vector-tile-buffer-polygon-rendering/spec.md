## ADDED Requirements

### Requirement: 独立 bucket 直接构建 BufferPolygon

启用 Buffer 路径的 fill 图层 MUST 使用新建 bucket，从现有 packed 几何和共享 feature table 直接构建 BufferPolygonCollection，不经过 GLB、Model、Cesium3DTileset。原有 bucket 实现文件 MUST 保持不变，现有请求、解码、缓存、任务调度及四叉树选择/coverage 算法 SHALL 继续使用。

#### Scenario: 使用既有解码结果

- **WHEN** 一个已完成现有 Worker 解码的瓦片包含匹配的启用 Buffer 的 fill 图层
- **THEN** 工厂使用该 packedLayer 创建新 bucket，不新增原始瓦片解码或外部 tileset 加载步骤

### Requirement: 面几何保持外环洞及要素映射

新 bucket SHALL 保留现有 fill 的过滤、zoom、边界裁剪结果、外环、内洞、成面线及 geometry-to-feature 映射语义。Buffer 数据 MUST 提供匹配的三维顶点、洞起始索引和三角索引，剔除退化环并按实际容量分配。非贴地大面 MUST 处理椭球曲率，不能以稀疏顶点的平面三角形代替地表几何后造成大面积遮蔽。

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

### Requirement: 渲染对象适配现有就绪和预热接口

Buffer 渲染对象 SHALL 提供当前四叉树所需的 show、ready、update、isDestroyed 和 destroy 契约。ready MUST 反映数据及必要资源准备状态，不能因集合没有 ready 属性而永久阻塞瓦片切换；隐藏预热 MUST NOT 产生实际绘制或贴地提交。ready SHALL NOT 被报告为贴地纹理烘焙完成。

#### Scenario: 子瓦片就绪后接替祖先

- **WHEN** 子瓦片 Buffer 对象完成准备且满足现有 coverage 规则
- **THEN** 当前四叉树允许其接替祖先，不永久保留 fallback

#### Scenario: 隐藏预热

- **WHEN** 新 bucket 或 replacement bucket 仅进行隐藏预热
- **THEN** 资源状态得到推进，但该对象不出现在实际绘制结果或本帧贴地标记集合中

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
