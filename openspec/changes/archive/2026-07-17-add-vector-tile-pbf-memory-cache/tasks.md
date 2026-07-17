## 1. PBF 缓存核心

- [x] 1.1 新增 `VectorTilePbfCache`，实现 manager 级 `maximumBytes` 校验、默认 64 MiB、`0` 禁用 ready 驻留以及独立统计接口
- [x] 1.2 实现 ready master `ArrayBuffer` 的私有保存、逐消费者副本、访问顺序更新和按 `byteLength` 计费的 LRU 驱逐
- [x] 1.3 实现零字节/失败/取消不缓存、单条 oversize bypass 且不驱逐已有 entry，以及 `clear()` 的 generation 防回填语义
- [x] 1.4 新增 `VectorTilePbfCache.test.js`，覆盖预算校验、默认/零预算、LRU、oversize、clear 和副本所有权

## 2. 在途请求协调

- [x] 2.1 为 PBF cache 实现同 key pending 请求合并，并为每个消费者返回兼容 `promise/cancel/setPriority/cancelled` 的独立句柄
- [x] 2.2 实现共享优先级重算、单消费者取消隔离、最后消费者取消底层任务以及失败后移除 pending 并允许重试
- [x] 2.3 扩展 PBF cache 单元测试，覆盖并发只请求一次、独立工作副本、部分/全部取消、优先级变化、失败重试和零预算下仍合并 pending

## 3. Manager 与 Provider 请求链接入

- [x] 3.1 在 `VectorTileLayerManager` 增加 `pbfCacheBytes` 配置并创建共享 `VectorTilePbfCache`，向 manager 创建和外部加入的 provider 注入同一 cache
- [x] 3.2 在 `VectorTileProvider` 增加稳定且可覆盖的 PBF key 生成逻辑，默认 key 覆盖 source namespace、解析后的资源身份和 `(z, x, y)`，并明确排除样式与 `contentRevision`
- [x] 3.3 将 `requestTile()` 接到 ready hit、pending join 和真实网络 miss 流程，确保网络结果在 `VectorTileLayer` 的内容代检查前进入缓存协调
- [x] 3.4 保持 `VectorTileLayer` 只接收 disposable 工作 buffer，并确认传给 `VectorTileDecoder` 后 cache master 不会被 detach
- [x] 3.5 扩展 Provider、Layer 和 Manager 测试，覆盖跨 source 隔离、相同 source 复用、URL/寻址身份变化 miss，以及 filter/style 内容代更新时零额外网络请求

## 4. 失效、清理与诊断

- [x] 4.1 保持 layer 级 style/filter/icon/scene/render backend 变化只清渲染内容，并验证完整 `manager.setStyle()` 对未变化 source 仍可复用 PBF
- [x] 4.2 新增 `manager.clearPbfCache()` 只清 ready PBF，并使 `manager.clearCache()` 同时清渲染与 PBF；使用 generation 阻止清理前 pending 结果回填
- [x] 4.3 增加 `pbfCacheHits`、`pbfCacheMisses`、`pbfCacheEvictions`、`pbfCacheCopies`、`pbfCacheOversizeSkips`、`pbfRequestJoins`、`residentPbfCacheBytes` 和 `residentPbfCacheEntries` 指标
- [x] 4.4 调整网络统计位置，确保 `downloadedBytes` 只累计真实 fetch，PBF cache hit 不重复计入网络下载
- [x] 4.5 增加清理和诊断集成测试，覆盖 raw-only clear、全量 clear、旧 pending 防回填、缓存/渲染指标隔离和冷启动重新请求

## 5. 文档与验证

- [x] 5.1 更新 README 的请求链、双缓存生命周期、manager 配置示例、清理 API、内存峰值说明和诊断指标
- [x] 5.2 更新 STYLE，明确 source `cacheBytes` 是单 runtime layer 渲染预算，而 manager `pbfCacheBytes` 是所有 source 共用的 raw PBF payload 预算且不属于 style source 字段
- [x] 5.3 运行 PBF cache、Provider、Layer、Manager 和 Diagnostics 定向测试，并确认既有相关测试无回归
- [x] 5.4 对变更的 JS 与 Markdown 文件运行项目 ESLint/Prettier 检查，并记录任何与本 change 无关的既有失败
