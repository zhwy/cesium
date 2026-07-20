## Context

当前渲染缓存由每个 `VectorTileLayer` 的 `VectorTileCache` 管理，key 为 `[contentRevision, x, y, level]`。样式或 filter 变化会推进内容代并清理旧渲染缓存，因此相同瓦片会重新进入请求、解码和建桶流程。

网络返回的 PBF `ArrayBuffer` 目前只短暂挂在 `VectorTile` 上。解码开始时该引用被移除，随后 `VectorTileDecoder` 通过 transfer list 将 buffer 交给 Worker；主线程 buffer 被 detach，无法供下一个内容代复用。现有 `MVTLoader(cacheStore)` 留有缓存接入注释，但没有实现，且其全局单例不具备 manager 级预算和 source namespace。

本 change 需要在不保留 decoded geometry、GeometryInstance 或持久化数据的前提下，为样式热更新保留一份有上限的原始 PBF。缓存必须与旧/新渲染代并存机制、任务优先级和取消语义兼容。

## Goals / Non-Goals

**Goals:**

- 相同 source 瓦片的 PBF 命中时，样式和 filter 热更新不再发起网络请求。
- 用 manager 级 `pbfCacheBytes` 严格限制 ready PBF payload 的驻留字节数，并允许配置为 `0` 禁用。
- 保证传入 Worker 的 buffer 只会 detach 工作副本，不会破坏缓存 master。
- 合并跨内容代的同 key 在途请求，同时保持每个消费者独立取消和优先级更新。
- 将渲染缓存失效、PBF 数据清理和两类诊断指标明确分开。
- 保持当前解码、建桶和新旧内容代无闪烁切换行为。

**Non-Goals:**

- IndexedDB、Cache Storage、离线或跨页面持久化。
- decoded tile、feature geometry、Primitive 或 GeometryInstance 缓存。
- 颜色、显隐、线宽、高度等样式属性原地热更新。
- 高亮 API、feature-state、feature locator 或单要素 overlay。
- TTL、HTTP revalidation、后台刷新和瓦片预取。
- source 级独立 PBF 额度或运行时修改缓存预算。
- 精确限制浏览器进程总内存；`pbfCacheBytes` 仅约束 ready master payload。

## Decisions

### 1. 使用 manager 级独立 PBF cache

新增独立的 `VectorTilePbfCache`，由每个 `VectorTileLayerManager` 创建并持有，再注入 manager 创建或接收的 `VectorTileProvider`。所有 source 共用一个总预算，默认 64 MiB。

```text
VectorTileLayerManager
├─ VectorTilePbfCache                 source 数据，key 不含内容代
└─ VectorTileLayer[]
   └─ VectorTileCache                 渲染内容，key 包含 contentRevision
```

`VectorTileCache` 继续负责渲染瓦片引用计数、LRU 和 Primitive 销毁，不承载原始 PBF。这样避免把两种生命周期和字节统计混在一起，也避免多个 source 各自获得完整 PBF 预算后线性放大内存。

备选方案是把 PBF 放入现有 `VectorTileCache`。该方案会让样式清理一并删除 PBF，并且现有 `cacheBytes` 会在 PBF、decoded arrays 和渲染资源之间重复覆盖估算值，因此不采用。

### 2. `pbfCacheBytes` 是 manager 级 payload 上限

`VectorTileLayerManager` 新增构造参数：

```js
new VectorTileLayerManager({
  pbfCacheBytes: 64 * 1024 * 1024,
});
```

- 默认值为 64 MiB；`0` 禁用 ready entry 驻留，但在途请求仍可合并。
- 仅接受有限、非负数字，否则抛出 `Cesium.DeveloperError`。
- 预算只统计 ready master 的 `ArrayBuffer.byteLength`，不包含 `Map`/Promise 等对象开销、pending 网络 buffer、工作副本、Worker 内存或渲染内容代。
- 单个响应超过总预算时直接服务当前消费者但不进入 ready cache，也不驱逐已缓存的小 entry。
- 零字节、失败和取消响应不进入 ready cache，防止零成本 entry 无上限增长。

选择 manager 构造参数而不是 `sources[sourceId]` 字段，是为了让配置表达“所有 source 的总内存上限”。现有 source `cacheBytes` 保持为单 runtime layer 的渲染缓存预算。

### 3. 缓存 key 使用请求数据身份，不使用样式状态

Provider 在拿到具体 tile resource 后生成 PBF key。默认 key 至少包含稳定的 source namespace、实际请求资源身份和 `(level, x, y)`；manager-managed source 的 namespace 由 `sourceId` 及会影响寻址的数据配置形成。自定义 provider 可以覆盖 key 生成钩子，把自定义 header、租户或其他请求身份纳入 namespace。

key 明确排除：

- `contentRevision`；
- source-layer 和 style layer id；
- filter、paint、layout、visibility；
- icon、scene、render backend 和 picking 设置。

完整 `manager.setStyle()` 即使重建 provider/runtime layer，只要请求数据身份不变，就能复用 manager 中的 PBF。URL、WMTS matrix 等身份变化会自然生成新 key；同一 URL 背后的服务端数据原地变化则要求调用 `clearPbfCache()` 或使用版本化 URL。

备选方案是只使用 `[sourceId, z, x, y]`。同名 source 更换 URL 时会错误命中，因此不采用。

### 4. cache master 永不直接交给 Worker

ready entry 保存不可变 master `ArrayBuffer`。每个消费者得到独立工作副本：

```text
ready master
    └─ slice(0) → consumer working buffer
                         └─ transfer → decode Worker
```

网络 miss 成功后，原响应成为候选 master；在写入 ready cache 后，为每个仍有效消费者创建副本。预算为 0 或响应过大时不保留 master，实现可以把原 buffer 交给一个消费者并为其余消费者复制，但对外仍保证不同消费者不会共享同一个可 detach buffer。

该选择每次解码增加一次原始 PBF 大小的内存复制，但复制对象是压缩 PBF，而不是 decoded geometry。它换取了后续内容代的零网络复用和清晰的所有权语义。把 master 直接 transfer 的方案会立即 detach 缓存，因此不采用。

### 5. ready LRU 与 pending 请求在同一协调器中管理

`VectorTilePbfCache` 维护两类状态：

- `ready`: key、master、byteLength、最近访问序号和创建时的 cache generation；
- `pending`: 底层网络 task、消费者集合、generation 和当前共享优先级。

ready hit 会更新 LRU 并立即为消费者复制。ready 插入后按最久未访问顺序驱逐，直到 payload 字节回到预算内。工作副本与 master 独立，因此 master 被驱逐不会影响已经开始的解码。

同 key pending miss 只创建一个底层 `MVTLoader` 网络 task。每个消费者获得兼容当前调用点的句柄：`promise`、`cancel()`、`setPriority()` 和 `cancelled`。共享网络 task 使用所有有效消费者中的最高加载优先级；消费者取消或更新优先级时重新计算。

- 取消一个消费者只拒绝该消费者。
- 最后一个消费者取消时才取消底层 task，并移除 pending entry。
- 请求失败会传播给所有有效消费者并移除 pending，使后续请求可重试。
- 请求成功后先完成缓存协调，再由 `VectorTileLayer` 判断消费者所属 `contentRevision` 是否仍有效；因此旧代刚完成的网络结果仍可被新代复用。

即使 `pbfCacheBytes` 为 0，pending 合并仍生效；完成后不保留 ready master。

### 6. Provider 负责确定资源，PBF cache 负责获取与复用

请求链调整为：

```text
VectorTileLayer._requestTile
  → VectorTileProvider.requestTile
      → getTileResource + getPbfCacheKey
      → VectorTilePbfCache.getOrLoad
          ├─ ready hit → copy
          ├─ pending hit → join
          └─ miss → MVTLoader.load / network
  → VectorTile 收到 disposable working buffer
  → VectorTileDecoder transfer
```

`VectorTileLayer` 仍只接收一个可转移的 `ArrayBuffer`，因此后续状态机和 Worker API 不需要知道 master cache。`downloadedBytes` 必须在真实网络成功路径记录，不能继续把 `VectorTileLayer` 收到的所有 buffer 都当成下载；现有 `request` duration 可继续表示取得 PBF 的端到端时间，同时增加独立缓存指标。

### 7. 渲染失效和原始数据清理使用不同入口

- `VectorTileLayer.setStyle()`、`setLayerStyle()`、render backend、icon、scene 和 visibility 相关操作只推进/失效渲染内容，不触碰 PBF cache。
- 现有 `manager.clearCache()` 扩展为清理渲染缓存和 PBF cache，保持“显式冷启动/清空全部缓存”的直观语义，也保证 benchmark 的 `cold` 模式仍然包含真实网络加载。
- 新增 `manager.clearPbfCache()`，只清理全部 PBF ready entry 并推进 PBF cache generation，不销毁当前已经绘制的 Primitive。
- clear 发生前已经返回给消费者的工作副本继续有效；旧 generation 的 pending 请求可以完成当前消费者，但完成结果不得重新写回已经清理的 ready cache。
- `removeAll()` 和完整 `setStyle()` 不自动清 PBF；不再使用的 source entry 由总预算 LRU 淘汰。

样式更新继续调用 runtime layer 的渲染失效入口，不调用 manager 的全量 `clearCache()`。备选方案是让 layer 级样式清理也同时清 PBF；该方案会使样式重建再次产生网络请求，因此不采用。

### 8. 诊断区分网络、PBF cache 和渲染 cache

新增并文档化以下独立指标：

- counters：`pbfCacheHits`、`pbfCacheMisses`、`pbfCacheEvictions`、`pbfCacheCopies`、`pbfCacheOversizeSkips`、`pbfRequestJoins`；
- gauges：`residentPbfCacheBytes`、`residentPbfCacheEntries`。

现有 `cacheHits/cacheEvictions/residentCacheBytes` 继续只表示渲染瓦片缓存。`downloadedBytes` 只累计真实网络响应，cache hit 不重复累计。

### 9. 文档明确两类预算和内存峰值

README 更新请求链、缓存生命周期、配置示例、清理 API 和诊断项。STYLE 的 source 配置表继续说明 `cacheBytes` 是每个 runtime layer 的渲染预算，并补充 manager `pbfCacheBytes` 不属于 style source 字段。

文档必须说明：`pbfCacheBytes` 不是浏览器总内存硬上限。样式切换窗口可能同时存在 PBF master、解码工作副本、Worker 输出以及新旧渲染内容代；浏览器任务管理器的进程内存也可能晚于 JS 引用释放而下降。

## Risks / Trade-offs

- **[常驻内存增加]** 缓存会额外保留压缩 PBF master。→ 使用 manager 级严格预算、`0` 禁用、oversize bypass 和独立驻留指标。
- **[解码前增加复制]** 每次 cacheable decode 需要复制 PBF。→ 继续用 transfer 交给 Worker，并通过诊断/benchmark 比较节省的网络时间与复制成本。
- **[样式切换瞬时峰值]** master、工作副本、Worker 输出和新旧 Primitive 可能短暂并存。→ 限制 ready payload，避免缓存 decoded geometry，并保持旧代在新代可绘制后尽快释放。
- **[同 URL 数据陈旧]** 内存缓存无法知道服务端是否原地更新。→ 提供 `clearPbfCache()`，推荐数据 URL/version 变化时显式清理或使用版本化 URL。
- **[共享取消竞态]** 旧内容代取消可能误伤新内容代请求。→ 使用消费者集合和“最后消费者才取消”规则，并覆盖跨 revision 测试。
- **[clear 后旧请求回填]** pending 请求可能在显式清理后完成。→ 使用 cache generation 阻止旧 generation 写回。
- **[自定义 provider key 不完整]** 自定义 header 或租户状态未进入 key 可能串数据。→ 提供可覆盖的 key hook，并在文档中要求所有请求身份进入 namespace。
- **[预算不等于总进程内存]** JS 对象开销、瞬时副本和浏览器回收时机不受该值精确控制。→ 对外把选项定义为 ready PBF payload 预算并明确记录口径。

## Migration Plan

1. 新增 PBF cache 模块和独立单元测试，不改变现有请求链。
2. 在 manager 中创建共享 cache、注入 provider，并接入请求合并与 buffer copy。
3. 调整网络字节诊断、渲染/PBF 清理入口和集成测试。
4. 更新 README、STYLE，并用定向测试和 diagnostics 验证样式/filter 更新不再请求网络。
5. 如出现兼容或性能问题，调用方可设置 `pbfCacheBytes: 0` 回退到原有网络路径；本 change 不涉及持久数据迁移。

## Open Questions

无。本 change 固定为 manager 级 64 MiB 默认预算、内存-only 和全量 `clearPbfCache()`；source 级预算、持久化与更细粒度清理留给后续需求。
