## 1. 校验基线与语法框架

- [x] 1.1 对齐 `VectorStyleExpression.test.js` 与当前表达式工具公开 API，建立既有合法表达式、property/state 依赖和 fallback 的可执行基线，不改变现有求值结果
- [x] 1.2 在 `VectorTileStyleExpressionUtils` 中集中定义可独立求值操作符及固定/可变 arity 规则，并为所有既有操作符补充缺参、多参测试
- [x] 1.3 收紧 `literal`、`boolean`、`case`、`match` 和 `interpolate` 专用结构校验，要求完整配对和 fallback，并禁止 `linear` 作为顶层操作符
- [x] 1.4 验证校验错误包含表达式路径和操作符信息，且 `isWorkerSupportedVectorStyleExpression` 与统一校验结果一致

## 2. 首批操作符求值

- [x] 2.1 实现并测试 `!` 与 `in` 的布尔、字符串、数组及错误动态类型语义
- [x] 2.2 实现并测试 `index-of`、`slice`、`length` 和 `at` 的正常结果、可选参数、负索引、未找到、越界及错误类型语义
- [x] 2.3 实现并测试 `to-string` 和 `concat` 对基础值、`null`/`undefined`、数组与普通对象的稳定转换和拼接语义
- [x] 2.4 实现并测试 `upcase` 与 `downcase` 的 Unicode 字符串转换和非字符串安全失败语义
- [x] 2.5 实现并测试 `coalesce` 对 `null`/`undefined` 的跳过规则、全缺失结果以及外层样式 fallback
- [x] 2.6 实现并测试 `id` 对 string/number feature id 的原类型返回、缺失结果和零 property 依赖

## 3. 依赖分析与集成验证

- [x] 3.1 扩充 property/state 依赖测试，覆盖新增操作符的递归参数、嵌套 `get`/`has`、动态 key 保守投影和 `literal` 停止边界
- [x] 3.2 扩充属性投影与 worker filter 测试，验证新增 filter 可前移且与主线程求值结果一致
- [x] 3.3 增加至少一个 symbol `text-field` 集成场景，组合 `coalesce`、`concat`、`to-string` 或大小写操作并验证最终文本与 fallback
- [x] 3.4 复核 bucket/placement 消费方只调用统一表达式接口，不将有限数字、Cesium Color、几何匹配、贴地或 Primitive 逻辑迁入表达式工具

## 4. 文档与质量门禁

- [x] 4.1 更新 `STYLE.md` 的操作符清单、合法签名、字面量数组、错误类型和组合示例，并仅在 README 需要同步入口说明时做最小更新
- [x] 4.2 运行表达式、属性投影、几何放置、symbol 和受影响 bucket 的定向 Node 测试，区分并记录与本变更无关的既有基线失败
- [x] 4.3 对所有修改文件运行 Prettier、ESLint 和 `git diff --check`，确认没有新增生产依赖或越界改动
