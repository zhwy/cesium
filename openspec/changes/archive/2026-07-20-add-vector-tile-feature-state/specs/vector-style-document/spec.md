## ADDED Requirements

### Requirement: vector source 必须支持稳定要素身份提升

vector source MUST 接受可选 `promoteId`。字符串值 MUST 把同名属性用作所有 source-layer 的最终 feature id；对象值 MUST 按 source-layer 映射属性名。最终 id MUST 在属性投影前解析并保留，且只允许 string 或 number。

#### Scenario: 字符串 promoteId 应用于全部 source-layer

- **WHEN** vector source 配置 `promoteId: "object_id"`
- **THEN** 每个 source-layer 的要素 MUST 使用其 `object_id` 属性作为最终 id
- **THEN** `resolvePickedFeature()` 返回的 id MUST 是该提升值

#### Scenario: 对象 promoteId 按 source-layer 应用

- **WHEN** vector source 配置 `promoteId: { roads: "road_id", parcels: "parcel_id" }`
- **THEN** roads 和 parcels 要素 MUST 分别使用对应属性作为最终 id

#### Scenario: 未映射的 source-layer 使用原生 id

- **WHEN** 对象形式的 `promoteId` 没有包含某一 source-layer
- **THEN** 该 source-layer MUST 继续使用 PBF 原生 feature id

#### Scenario: 配置的提升属性无效

- **WHEN** 已映射 source-layer 的要素缺少提升属性，或属性值不是 string/number
- **THEN** 该要素 MUST 被标记为不可由 feature-state 寻址
- **THEN** 实现 MUST NOT 使用 `sourceFeatureIndex` 或其他瓦片局部序号代替稳定 id

### Requirement: paint 表达式必须能够读取 feature-state

样式表达式子集 MUST 支持 `['feature-state', key]`，其中 key 必须是字符串。求值上下文 MUST 将 feature-state 与源 properties 分离；状态键缺失时操作符 MUST 返回 `null`，且状态键 MUST NOT 被加入源属性投影依赖。

#### Scenario: 状态键存在

- **WHEN** 表达式 `['feature-state', 'hover']` 对状态 `{ hover: true }` 求值
- **THEN** 表达式 MUST 返回 `true`

#### Scenario: 状态键缺失

- **WHEN** 要素没有状态或状态中没有请求的 key
- **THEN** `feature-state` 表达式 MUST 返回 `null`

#### Scenario: 状态读取与属性读取组合

- **WHEN** 一个允许的颜色表达式同时包含 `['feature-state', 'selected']` 和 `['get', 'class']`
- **THEN** 两个操作符 MUST 分别从运行时状态和源 properties 读取值

### Requirement: 表达式必须支持布尔类型断言及兜底

样式表达式子集 MUST 支持 `['boolean', value, fallback]`。当 value 是 boolean 时 MUST 返回 value；否则 MUST 返回 fallback，以允许缺失 feature-state 安全参与 `case` 等表达式。

#### Scenario: 布尔状态通过断言

- **WHEN** `['boolean', ['feature-state', 'hover'], false]` 的 hover 状态为 true
- **THEN** 表达式 MUST 返回 true

#### Scenario: 缺失状态使用兜底值

- **WHEN** `['boolean', ['feature-state', 'hover'], false]` 的 hover 状态缺失
- **THEN** 表达式 MUST 返回 false

#### Scenario: 非布尔状态使用兜底值

- **WHEN** boolean 操作符的 value 求值为字符串或数值
- **THEN** 表达式 MUST 返回 fallback，而不是执行 truthy 强制转换

### Requirement: feature-state 必须限定在可原地更新的颜色字段

首期样式规范化 MUST 只允许 feature-state 出现在 instances 路径的 `line-color`、`fill-color` 和已有轮廓表示的 `fill-outline-color` paint 表达式中。它 MUST 被拒绝于 filter、layout、circle/symbol 字段以及线宽、轮廓宽度、高度、显隐等几何或批次相关 paint 字段。

#### Scenario: 合法的线面颜色状态表达式

- **WHEN** line-color 或 fill-color 使用 `case` 与 feature-state 选择颜色
- **THEN** 样式规范化 MUST 接受表达式并把图层标记为需要逐实例状态绑定

#### Scenario: packed line 必须切换到 instances 路径

- **WHEN** line-color 包含 feature-state
- **THEN** line bucket MUST NOT 使用 packed line 后端
- **THEN** 样式热更新首次引入该表达式时 MAY 执行一次后端兼容性重建

#### Scenario: 非法字段引用状态

- **WHEN** filter、layout、line-width、fill-outline-width 或其他不支持的字段包含 feature-state
- **THEN** 样式规范化 MUST 拒绝该样式
- **THEN** 错误 MUST 指出样式图层、字段和 feature-state 使用限制

#### Scenario: 状态更新不创建轮廓几何

- **WHEN** fill-outline-color 读取 feature-state，但当前 bucket 没有轮廓表示
- **THEN** 单次状态写入 MUST NOT 创建轮廓几何
- **THEN** 需要新增轮廓表示的样式热更新 MUST 走既有兼容性判断和 bucket 重建路径
