## Why

当前 LoadVectorTile 仅实现属性读取、比较、条件与线性插值等最小表达式子集，无法直接完成常见的否定、成员判断、字符串拼接和数组查找操作。补齐一组可组合的 Mapbox 风格基础操作符，并同时收紧表达式语法校验，可以减少样式侧的临时逻辑并避免“校验通过但运行时无法求值”的不一致。

## What Changes

- 新增 `!`、`in`、`index-of`、`slice`、`length`、`at` 表达式，支持常见逻辑、字符串和数组查找操作。
- 新增 `concat`、`to-string`、`upcase`、`downcase`、`coalesce` 表达式，支持动态标签构造、大小写转换与缺失值回退。
- 新增 `id` 表达式，读取求值上下文中已经存在的 feature id。
- 为新增与既有操作符定义准确的参数数量和特殊语法位置；`linear` 仅作为 `interpolate` 的插值模式标记，不再作为可独立求值的顶层操作符。
- 明确错误类型、缺失值、越界、未找到以及字面量数组的运行语义，并保持样式值 fallback、filter、worker 前移和属性依赖收集行为一致。
- 补充表达式单元测试和 LoadVectorTile 表达式文档。
- **BREAKING（仅非法表达式）**：过去因宽松校验而被接受的缺参、多参或错误位置表达式将改为在样式校验阶段被拒绝。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `vector-style-document`：扩展可序列化样式值与 filter 表达式子集，并收紧表达式语法及运行期错误处理要求。

## Impact

- 主要影响 `Apps/Demos/LoadVectorTile/src/VectorTileStyleExpressionUtils.js` 中的操作符注册、求值、校验和依赖遍历逻辑。
- 可能少量调整表达式消费方或测试，但数字/颜色适配、几何匹配、贴地路径和 Primitive 创建职责继续留在现有 bucket/placement 模块。
- 更新 `Apps/Demos/LoadVectorTile/test/VectorStyleExpression.test.js` 及相关集成测试、`STYLE.md` 和必要的 `README.md` 表达式说明。
- 不新增生产依赖，不改变样式文档的 JSON 数组表达式表示形式。
