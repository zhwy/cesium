## 1. 稳定要素身份

- [x] 1.1 在 vector source 规范化和 worker 参数中加入字符串/按 source-layer 映射两种 `promoteId`，并对配置类型和属性名执行校验
- [x] 1.2 在 `decodeVectorTile` 的属性投影前解析 typed feature id，保留原生 id 兜底规则，将提升后的 id 传入 feature table 与拾取结果，并记录不可寻址要素
- [x] 1.3 为 `promoteId` 的字符串、对象、未映射图层、缺失/非法属性、空属性投影及 string/number id 区分补充解码和拾取测试

## 2. 状态表达式与样式校验

- [x] 2.1 扩展 `VectorTileStyleExpression` 的求值上下文，实现 `feature-state` 与带 fallback 的 `boolean` 操作符，并把状态依赖和源属性依赖分离
- [x] 2.2 在样式规范化与热更新兼容性判断中只允许 line/fill/已有 outline 颜色读取 feature-state，对非法 filter、layout 和几何字段返回包含图层及字段的错误
- [x] 2.3 当线颜色依赖 feature-state 时禁用 packed line，并让相关颜色表达式选择支持 alpha 变化的 instances 渲染路径
- [x] 2.4 为状态键存在/缺失、布尔 fallback、状态与属性组合、属性投影排除、合法颜色字段和非法字段补充表达式及样式测试

## 3. Source 状态存储与公共 API

- [x] 3.1 实现 source 级 feature-state 存储、typed key 编码、浅相等/no-op、浅合并、隔离读取和单键/整项删除语义
- [x] 3.2 在 `VectorTileLayerManager` 实现并路由 `setFeatureState`、`getFeatureState`、`removeFeatureState`，覆盖 target/state/key 校验、未知 source 返回值及 `DeveloperError`
- [x] 3.3 将状态表生命周期绑定到 runtime source，使缓存与图层热更新保留状态，而 source 替换、移除和 manager destroy 清空状态
- [x] 3.4 为 API 浅合并、读取隔离、删除、no-op、非法参数、未知 source、typed id 和 source 生命周期补充 manager/layer 单元测试

## 4. 驻留实例反向绑定与更新

- [x] 4.1 在 instances `VectorTilePrimitiveBucket` 中建立 typed feature id 到一个或多个 GeometryInstance binding 的局部反向索引，并保留重新求值所需的 feature/style 上下文
- [x] 4.2 在 `VectorTileLayer` 建立 feature key 到驻留 bucket 的索引，并让 bucket 创建、替换、驱逐和销毁路径确定性注册或注销绑定
- [x] 4.3 在线、面及已有轮廓实例创建时读取最新 feature-state 计算初始颜色，并让单次状态变化仅重新求值和写入目标身份的 color attribute
- [x] 4.4 为单 bucket 目标更新、同身份多个裁剪实例、跨瓦片副本、多个样式图层、fill/outline 组合及无关实例不变补充 bucket/layer 测试

## 5. 异步时序与渲染兼容性

- [x] 5.1 为尚未 ready 的 Primitive 增加按身份合并的待处理状态更新和 revision 检查，并在 update/ready 路径应用最终状态
- [x] 5.2 确保状态先于瓦片加载、瓦片驱逐后重载和样式热更新重建 bucket 时，新实例在首次可见前读取当前状态
- [x] 5.3 处理透明度切换与轮廓表示兼容性：状态写入不替换 Primitive，首次样式引入不兼容后端或新轮廓时只走一次既有重建路径
- [x] 5.4 为 ready 前连续写入/删除、销毁竞态、先 set 后加载、驱逐重载、透明度切换、packed-to-instances 热更新和状态更新零重建补充回归测试

## 6. 诊断、示例与文档

- [x] 6.1 在 `VectorTileDiagnostics` 增加状态写入、no-op、删除、实例更新、延迟更新、不可寻址要素计数，以及状态条目和驻留绑定 gauge
- [x] 6.2 更新 LoadVectorTile Demo，使用稳定拾取 target 和 `ScreenSpaceEventHandler` 实现去重的 hover/selected 状态切换，并验证 `pickProperties: []` 可工作
- [x] 6.3 更新 `Apps/Demos/LoadVectorTile/README.md`，记录 API、`promoteId`、表达式示例、支持字段、生命周期、picking 前提和首期限制
- [x] 6.4 增加诊断与性能断言，证明 set/remove 不增加请求、解码和 bucket build 计数，并运行 LoadVectorTile 相关测试、lint 与 OpenSpec 严格校验
