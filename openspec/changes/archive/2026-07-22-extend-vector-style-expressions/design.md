## Context

LoadVectorTile 使用 JSON 数组表示可序列化样式表达式，并由 `VectorTileStyleExpressionUtils` 统一承担求值、校验、worker 支持判断、feature property 依赖收集和 feature-state 依赖收集。样式值与 filter 都复用该模块；bucket 层只负责将求值结果适配为有限数字、Cesium 颜色和具体渲染路径。

当前实现以 `SUPPORTED_OPERATORS` 加求值 `switch` 维护最小子集，但多数操作符仅做递归可序列化检查，没有严格校验参数数量。`linear` 同时被登记为受支持操作符，却只在 `interpolate` 的第二项中有意义，因而存在校验通过、独立求值失败的语法缺口。本次扩展需要在不引入完整静态类型系统和新依赖的前提下，同时解决操作符能力与语法一致性。

## Goals / Non-Goals

**Goals:**

- 支持已确认的 `!`、`in`、`index-of`、`slice`、`length`、`at`、`concat`、`to-string`、`upcase`、`downcase`、`coalesce` 和 `id`。
- 为新增与既有操作符建立集中、可审计的参数数量校验，并限制特殊语法标记的出现位置。
- 保持常量值、样式值 fallback、filter、worker 前移、property 投影和 feature-state 依赖行为一致。
- 将主要逻辑和测试入口集中在 `VectorTileStyleExpressionUtils`，不把 Cesium 渲染值适配反向并入表达式层。
- 对动态属性脏数据采用安全失败，避免单个 feature 中断整块瓦片构建。

**Non-Goals:**

- 不实现完整 Mapbox 表达式类型检查器，也不保证接受 Mapbox Style Spec 的全部表达式。
- 不加入数学运算、`step`、`split`、`geometry-type`、`let`/`var`、富文本或 locale/collator。
- 不改变数字/颜色最终适配、几何类型匹配、贴地路径或 Primitive 创建职责。
- 不新增生产依赖，不改变现有 JSON 数组表达式格式。

## Decisions

### 1. 在表达式工具中集中维护操作符语法

在 `VectorTileStyleExpressionUtils` 内维护真正可独立求值的操作符集合和参数数量规则。固定参数操作符使用统一 arity 校验；`case`、`match`、`interpolate` 等结构化操作符继续使用专用校验器处理成对参数和特殊位置。

`linear` 不再属于顶层操作符集合，只允许作为 `interpolate` 的第二项 `['linear']`。属性依赖收集仍对 `interpolate` 采取专用遍历，因此不会把插值模式误识别为表达式。

采用集中规则而不是在每个求值分支中临时判断，可使 `validate`、`isWorkerSupported` 和运行期支持范围保持同源。不会引入独立解析器或操作符类层级，以避免为当前规模增加不必要抽象。

### 2. 语法错误与动态类型错误分层处理

表达式形状错误、参数数量错误、非法特殊标记和不可序列化值在样式规范化/校验阶段抛出带路径的错误。新增和既有操作符的基本 arity 如下：

- 无操作数：`id`、`zoom`。
- 一个操作数：`get`、`has`、`feature-state`、`!`、`length`、`to-string`、`upcase`、`downcase`；其中 `feature-state` key 必须是字符串。
- 两个操作数：六个比较操作符、`in`、`at`。
- 两个或三个操作数：`index-of`、`slice`。
- 可变参数：`all`、`any` 至少一个操作数，`concat` 至少一个输入，`coalesce` 至少两个候选值。
- 特殊结构：`boolean` 必须包含值与 fallback；`case` 至少一组条件/输出和最终 fallback；`match` 至少一组 label/输出和最终 fallback；`interpolate` 至少两个 stop/output 对。
- `literal` 只接受一个可序列化常量。

feature property 的运行时类型无法静态确定。字符串/数组操作遇到不支持的动态类型、非法索引或无法转换的值时返回 `undefined`，由现有样式值 fallback 或 filter 布尔转换处理，而不是抛出并中断瓦片处理。

### 3. 字符串和数组操作采用有限、明确的 JavaScript 语义

- `!`：仅接受 boolean；其他动态类型返回 `undefined`。
- `in`：数组使用严格成员匹配；字符串容器要求查询值也是字符串。
- `index-of`：支持字符串和数组以及可选起始索引；合法输入未找到返回 `-1`，非法输入返回 `undefined`。
- `slice`：支持字符串和数组、可选结束索引、左闭右开以及 JavaScript 负索引语义。
- `length`：仅接受字符串或数组。
- `at`：仅接受数组和非负整数；越界返回 `undefined`。
- `concat`：按 `to-string` 规则转换每个输入后拼接。
- `to-string`：字符串原样返回；`null`/`undefined` 返回空字符串；布尔和数字使用稳定字符串形式；数组和普通对象使用 JSON 序列化。
- `upcase`/`downcase`：仅接受字符串并使用 JavaScript Unicode 大小写转换。

不增加 `starts-with`、`ends-with` 或 `includes` 等别名；前缀、子串和成员判断由 `index-of`、`in` 与比较操作符组合完成。

### 4. 缺失值回退与 feature id 沿用现有上下文

`coalesce` 从左到右返回首个既非 `null` 也非 `undefined` 的结果；所有候选都缺失时返回 `undefined`。这同时兼容当前缺失 property 返回 `undefined`、缺失 feature-state 返回 `null` 的现状。

`id` 返回求值上下文中的 feature id，并保留 string/number 类型；上下文没有 id 时返回 `undefined`。样式值和 filter 已通过统一入口注入 feature id，不增加新的 bucket 参数。

### 5. 保持依赖分析与 worker 行为保守一致

新增操作符参数默认递归参与 property 和 feature-state 依赖收集，`literal` 仍然停止遍历，`id` 不产生 property 依赖。动态 `get`/`has` key 继续令 property 投影进入 `all: true` 的保守模式。

`isWorkerSupportedVectorStyleExpression` 继续以统一校验器为准。所有首批操作符都是纯同步、可序列化运算，因此通过校验后可在现有 worker 过滤路径执行，不设置独立的主线程专用白名单。

### 6. 测试围绕语义矩阵而不是逐分支快照

表达式测试覆盖每个操作符的正常输入、边界值、嵌套 `get`、字面量数组、错误 arity、错误动态类型和 fallback。另通过 property projection、worker filter 及至少一个 symbol 文本场景验证集成行为；渲染值适配测试保持现有职责，不复制表达式语义断言。

## Risks / Trade-offs

- [收紧校验会拒绝过去偶然通过的畸形表达式] → 在文档中列出合法签名，并为错误路径提供包含操作符和参数位置的诊断。
- [使用 `undefined` 表示动态类型错误会隐藏部分脏数据] → 保持瓦片渲染健壮性，并通过单元测试锁定 fallback；本次不引入跨 worker 的错误对象或诊断通道。
- [`to-string` 的对象序列化可能生成较长文本] → 仅处理可序列化值并沿用 JSON 结果，不加入隐式截断；样式作者负责控制输入。
- [JavaScript Unicode 大小写转换不支持 locale 定制] → 明确属于 locale-insensitive 基础能力，collator/locale 不在本次范围。
- [集中单文件会继续增大工具文件] → 只集中表达式语言本身；Cesium Color、有限数字、几何和 Primitive 逻辑仍留在外层，后续只有在操作符规模显著增长时再考虑表驱动拆分。

## Migration Plan

1. 先补充校验与求值测试，锁定既有合法表达式行为。
2. 在表达式工具中加入集中 arity 规则、特殊结构校验和首批操作符求值。
3. 验证 property/state 依赖、worker filter 和样式值 fallback 集成。
4. 更新 `STYLE.md` 与必要的 `README.md` 示例和合法签名。
5. 若出现兼容性问题，可整体回退操作符与严格校验变更；样式文档数据格式和 bucket 接口没有迁移步骤。

## Open Questions

无。操作符范围、错误处理策略和模块边界已在本变更中确定。
