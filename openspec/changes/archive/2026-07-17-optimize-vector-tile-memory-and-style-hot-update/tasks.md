## 1. 属性依赖与 source 配置

- [x] 1.1 在样式表达式模块中实现 filter/paint/layout 静态属性依赖收集，覆盖 `get`、`has`、`literal`、嵌套表达式和动态属性名回退 `all`，并添加单元测试
- [x] 1.2 在 style source 规范化中校验并复制 `pickProperties`，覆盖未配置、部分字符串数组、空数组、重复/空字符串和无效类型测试
- [x] 1.3 生成 Worker property projection 配置，区分样式内部依赖与公开 pick 字段，并测试 `allowPicking: false` 不会因默认语义保留全部属性

## 2. Worker feature table 与 packed geometry

- [x] 2.1 把 `decodeVectorTile` 的 source-layer 输出改为共享 feature table，保留 feature id、原始 source feature index 和投影 properties
- [x] 2.2 把 point/line/polygon metadata 数组改为 `Uint32Array featureIndices`，保证裁剪或多片段几何共享同一 feature table 行，并更新 Worker transfer list
- [x] 2.3 更新 Worker filter、主线程 fallback filter、polygon-center 和 geometry placement 工具，使其通过 feature index 查询 feature table 且不复制 metadata wrapper
- [x] 2.4 更新 decoded tile 字节/驻留估算和诊断，统计 feature table entries、公开 pick property values，并在销毁时准确回落
- [x] 2.5 更新 decode、geometry placement、line/fill/circle/symbol bucket 测试，验证属性投影、feature identity 和 typed index 边界

## 3. Bucket 状态与紧凑实例身份

- [x] 3.1 扩展 bucket 存储为带 `buildZoom`、bucket/style revision、Primitive role、instance feature indices 和 point descriptors 的状态，同时保留统一销毁入口
- [x] 3.2 为 instances line、polygon fill 和 outline 分配 Primitive 内唯一数字 id，记录与 feature table 对齐的 instance-to-feature 映射，不保留 GeometryInstance 引用
- [x] 3.3 为 packed line 记录独立 `packed-line` role，为 fill 本体和 outline 记录不同 role，并添加角色映射与资源销毁测试
- [x] 3.4 更新 VectorTile 构建、缓存驱逐、旧内容代释放和 layer 销毁路径，确保 bucket、Primitive、feature table 与诊断只创建和释放一次

## 4. 紧凑拾取解析

- [x] 4.1 新增 manager 级弱拾取注册表，支持 Geometry Primitive 的数字 instance id 和 Billboard/Label handle 上下文，且不强引用保活已销毁对象
- [x] 4.2 在 Primitive bucket 创建和 SharedPointCollections add/remove 生命周期中注册、替换和注销拾取上下文
- [x] 4.3 实现同步 `VectorTileLayerManager.resolvePickedFeature(picked)`，按 `pickProperties` 返回新 properties 对象及 source、style layer、tile、feature index 信息，非本 manager/失效对象返回 `undefined`
- [x] 4.4 迁移 Demo 拾取展示到 `resolvePickedFeature()`，添加未配置默认全部、部分字段、空字段、禁用拾取和旧上下文失效测试

## 5. 必要样式桶与离屏驻留

- [x] 5.1 让 decode/build style rule 选择按 VectorTile level 同时过滤 visibility、支持类型和 minzoom/maxzoom，并验证 zoom 范围外和初始隐藏 layer 不创建 bucket
- [x] 5.2 调整四叉树提交和共享点同步，使祖先 fallback 使用自身 `buildZoom` 已构建样式，直到精确瓦片可绘制后再按 coverage 原子接管
- [x] 5.3 在 Demo manager 显式配置 `tileCacheSize: 50`，为全部示例 vector source 配置 `cacheBytes: 16 * 1024 * 1024`，保持公共默认值不变
- [x] 5.4 增加 resident style buckets、render primitives 和引用为零离屏 VectorTile gauges，覆盖可见转离屏、LRU 驱逐、PBF 独立驻留和 manager 销毁测试

## 6. 样式差异分类与轻量更新入口

- [x] 6.1 实现规范化 style layer 差异分类器，输出 NO_OP、IN_PLACE_APPEARANCE、REBUILD_BUCKET 或 REBUILD_SOURCE，并覆盖全部受支持颜色、visibility 和结构字段测试
- [x] 6.2 为 runtime layer 维护每 style layer revision 与最新规则，使 `setLayerStyle()` 的 NO_OP/原地路径不调用 `clearCache()`、不推进 content revision、不使四叉树全部失效
- [x] 6.3 增加轻量样式变化通知与 `scene.requestRender()` 集成，保持现有 changedEvent 专用于内容失效，并验证无变化更新不增加请求、decode 或 build 计数

## 7. 颜色与显隐原地更新

- [x] 7.1 为 instances line/fill/outline 实现 ready 后 per-instance color attribute 更新，按 Primitive role 选择字段，并支持常量和已驻留属性的数据驱动表达式
- [x] 7.2 为 packed line 实现 material uniform 颜色更新，保持 combined geometry 和 Primitive 身份不变
- [x] 7.3 为 circle、Billboard 和 Label 实现颜色资源/属性更新，扩展 SharedPointCollections 以更新已提交 handle 并让未提交描述在下次提交前惰性同步
- [x] 7.4 实现 style layer visibility 的 Primitive/共享点级切换，不创建逐实例 show attribute，并覆盖隐藏、快速重显和无关 layer 身份稳定测试
- [x] 7.5 在 warmup/submit 前按 style revision 应用 pending 与离屏惰性更新，避免 Primitive 未 ready 时调用 `getGeometryInstanceAttributes()`，并覆盖异步 ready 竞态
- [x] 7.6 检测 fill/其他 Appearance 的 alpha render state 兼容性；兼容时原地更新，不兼容时生成 bucket rebuild 计划并记录原因

## 8. 目标 bucket 重建回退

- [x] 8.1 为 VectorTileLayer 增加按 style layer 和 bucket revision 管理的 rebuild/dirty 状态，活动瓦片立即调度、离屏瓦片重新提交时惰性调度
- [x] 8.2 通过现有 provider/PBF cache 路径只解码目标 source-layer/style rule 并构建 replacement bucket，支持同 tile 并发消费者合并、优先级和取消
- [x] 8.3 在 replacement 可绘制后原子交换 Primitive/点条目/拾取上下文，再销毁旧 bucket；旧 bucket 在等待期间继续绘制且不得影响同 source 其他 layer
- [x] 8.4 将缺少新颜色表达式依赖、透明状态不兼容和显示未构建 bucket 接入目标 rebuild；filter、宽度、高度和其他结构变化继续走 source rebuild
- [x] 8.5 添加 PBF hit 无下载、PBF miss 正常请求、旧 revision 结果丢弃、失败/取消、离屏 dirty 和新旧 bucket 无闪烁切换测试

## 9. 诊断、文档与验证

- [x] 9.1 实现并测试 style no-op、原地 instance/point 更新、bucket property/render-state fallback 和 source rebuild counters
- [x] 9.2 更新 README 与 STYLE：记录 `pickProperties` 默认/数组/空数组、`resolvePickedFeature()` breaking 迁移、必要 zoom 桶、祖先 fallback、热更新矩阵和 Demo 缓存预算
- [x] 9.3 更新 Demo/benchmark 诊断输出，固定视角比较更新前后 PBF 请求、content revision、Primitive 数、feature/pick 属性驻留和离屏瓦片驻留
- [x] 9.4 运行 LoadVectorTile 定向测试、完整可运行测试、ESLint 和 Prettier 检查；记录任何与本 change 无关的既有失败
- [x] 9.5 手工验证 instances/packed、line/fill/circle/symbol 拾取与颜色/显隐更新，确认稳定视角颜色/显隐不发请求且多次更新不累积 stale/retired 内容代
