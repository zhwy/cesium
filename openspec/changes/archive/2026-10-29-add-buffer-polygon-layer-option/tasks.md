## 1. 基线与配置贯通

- [x] 1.1 记录工作树现状并运行相关旧路径测试基线，区分已有 ESM/Worker/运行环境失败；确认旧 bucket 文件的保护范围。
- [x] 1.2 在 VectorTileStyleUtils 和 VectorTileStyleRule 中贯通 useBufferPrimitive boolean 校验、默认 false、运行时表示与序列化。
- [x] 1.3 补充配置往返、非法值、同源不同图层独立配置、非 fill 保持原路径的测试；验证省略与 false 等价。
- [x] 1.4 验证 setLayerStyle 合并/替换保留字段，true/false 切换沿用现有 REBUILD_SOURCE，初始和 replacement 构建均读取最新配置。

## 2. 新建 BufferPolygon 几何和渲染对象

- [x] 2.1 新建 VectorTileBufferPolygonBucket，消费现有 packed polygons/lines 与共享 feature table，保留过滤、环/洞、成面线、裁剪结果及要素映射；不修改旧 bucket 文件。
- [x] 2.2 复用现有投影和 PolygonPipeline 实现二维剖分及非贴地椭球细分，生成局部三维坐标、modelMatrix、洞和三角索引，按实际容量分配 BufferPolygonCollection。
- [x] 2.3 新建 VectorTileBufferPolygonPrimitive，提供 show/ready/update/isDestroyed/destroy，保留空几何 READY_EMPTY 语义；验证超过默认容量、多面片、凹面/洞及低层级大面。
- [x] 2.4 在 bucket 工厂仅对 fill 且 useBufferPrimitive=true 选择新 bucket；检查原实例、packed 线、circle/symbol 路由不变。
- [x] 2.5 在新 bucket 内保留 fill-outline-color/width、洞及瓦片裁剪轮廓，复用现有线几何与 Primitive/GroundPolylinePrimitive 工厂，不新增 BufferPolyline 后端。

## 3. 调度接入与贴地生命周期

- [x] 3.1 在四叉树实际可见 committed 提交位置增加可选渲染对象 hook，使用真正的 BufferPolygonCollection 调用 markForFrame；保持原 LOD、coverage、回退与去重逻辑。
- [x] 3.2 覆盖普通 update、隐藏预热、replacement 预热与 ready 转换；确保预热不标记贴地、不实际出图，子瓦片准备后可接替祖先。
- [x] 3.3 验证 clampToGround、非零 heightOffset 原有回退规则、显隐、父子瓦片切换与缺失 vectorProvider 的明确错误/诊断。
- [x] 3.4 在销毁/替换/驱逐前 remove 贴地集合，释放面和轮廓资源；补充重复销毁、清缓存及关闭开关后的无残留测试。

## 4. 样式、状态、拾取与诊断

- [x] 4.1 在新 bucket 内实现独立的 Buffer 面材质更新、轮廓实例颜色更新与显隐，覆盖属性依赖检查、最新 style revision、离屏惰性更新及目标 bucket 重建回退。
- [x] 4.2 建立 featureIndex 到面/轮廓片段的紧凑映射，实现 feature-state 增删及透明到显色的更新，验证无额外请求/解码且 Buffer 几何身份保持。
- [x] 4.3 为 VectorTilePickRegistry 增加必要的 Buffer 紧凑身份登记适配，保持 resolvePickedFeature 返回结构、pickProperties/promoteId 和 allowPicking=false 行为，验证销毁旧身份失效。
- [x] 4.4 新增实际 Buffer bucket、面数量及 CPU 缓冲容量字节诊断，明确 wrapper、DrawCommand、贴地/GPU 内存统计边界，验证创建和销毁计数配对。

## 5. Demo 与同调度验证

- [x] 5.1 在 index.html 的 res_org_gr-level2-fill 配置增加 useBufferPrimitive:true，保留原 filter、paint/outline 和 terrain，按用户确认将 maxzoom 调整为 6；提供非贴地配置用于手动验证，不改变其他图层的后端选择。
- [x] 5.2 在 createVectorTileBenchmark 增加 polygon 专用对比入口，通过图层开关切换旧 fill/Buffer 后端，固定相机和填充图层、区分冷/热缓存并恢复原配置；保留已有线和 vector glTF benchmark 行为。
- [x] 5.3 运行针对性 Node 测试及适当的格式/lint 检查，回归配置、旧 fill、热更新、feature-state、拾取和四叉树测试；报告基线失败与新回归，不进行 git 写操作。
- [x] 5.4 在真实浏览器验证贴地/非贴地的简单面、凹面/洞、重叠面、低层级大面、LOD、显隐、清缓存和可见面拾取；通过 API 检查透明默认面的状态显色并单独记录透明拾取限制。已完成局部浏览器验证，剩余人工验收由用户接管，详见 validation.md。
- [x] 5.5 记录真实 Buffer 激活、瓦片层级/数量、构建耗时、帧 CPU p95、command 数及缓冲字节；区分贴地初次烘焙与稳定帧，对工作量或视觉结果不一致的比较明确标记不可比。
- [x] 5.6 更新 STYLE.md/README.md，说明字段层级、默认值、fill 支持范围、轮廓路径、结构切换成本、透明拾取限制及回退方法；最终自检新增函数及调用次数，遵循函数内联约定。

- [x] 5.7 按用户最新要求，在 index.html 补齐手动验证面板、有效视野定位、Buffer/贴地/高度/配色切换、隔离、ID 状态测试、对比、还原及实际提交诊断；用户自行执行剩余浏览器验收。
