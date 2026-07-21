import CommonUtils from "./CommonUtils.js";

const SUPPORTED_OPERATORS = new Set([
  "get",
  "has",
  "feature-state",
  "boolean",
  "==",
  "!=",
  ">",
  ">=",
  "<",
  "<=",
  "all",
  "any",
  "case",
  "match",
  "zoom",
  "interpolate",
  "linear",
  "literal",
]);

class VectorTileStyleExpressionUtils {
  static evaluateVectorStyleExpression(expression, context = {}) {
    return evaluateVectorStyleExpression(expression, context);
  }

  static validateVectorStyleExpression(expression, path = "expression") {
    return validateVectorStyleExpression(expression, path);
  }

  static isWorkerSupportedVectorStyleExpression(expression) {
    return isWorkerSupportedVectorStyleExpression(expression);
  }

  /**
   * 静态收集样式表达式读取的 feature property。
   * `all` 表示表达式包含动态属性名或无法保守分析的表达式结构。
   *
   * @param {...*} values 表达式、常量或包含表达式的样式值。
   * @returns {{all: boolean, properties: string[]}}
   */
  static collectVectorStylePropertyDependencies(...values) {
    const state = {
      all: false,
      properties: new Set(),
    };
    for (let i = 0; i < values.length && !state.all; ++i) {
      collectPropertyDependencies(values[i], state);
    }
    return {
      all: state.all,
      properties: [...state.properties].sort(),
    };
  }

  static hasVectorStyleFeatureStateDependency(...values) {
    return collectVectorStyleStateDependencies(...values).length > 0;
  }

  static evaluateVectorStyleFilter(filter, feature, context = {}) {
    if (filter === undefined || filter === null) {
      return true;
    }
    validateVectorStyleFilter(filter);
    return Boolean(
      evaluateVectorStyleExpression(filter, {
        ...context,
        properties: feature?.properties ?? context.properties ?? {},
        id: feature?.id,
      }),
    );
  }

  static validateVectorStyleFilter(filter, path = "filter") {
    return validateVectorStyleFilter(filter, path);
  }

  static isWorkerSupportedVectorStyleFilter(filter) {
    if (filter === undefined || filter === null) {
      return true;
    }
    return isWorkerSupportedVectorStyleExpression(filter);
  }
}

/**
 * 计算矢量瓦片示例中使用的可序列化表达式子集。
 * 语法有意保持与 Mapbox 表达式相近，但这里只实现当前 Cesium 实验所需的最小子集。
 *
 * @param {*} expression 常量值或表达式数组。
 * @param {object} [context]
 * @param {object} [context.properties]
 * @param {object} [context.state]
 * @param {number} [context.zoom]
 * @returns {*}
 */
function evaluateVectorStyleExpression(expression, context = {}) {
  if (!Array.isArray(expression)) {
    return expression;
  }

  const operator = expression[0];
  switch (operator) {
    case "literal":
      return expression[1];
    case "get":
      return getProperty(expression, context);
    case "has":
      return hasProperty(expression, context);
    case "feature-state":
      return getFeatureStateValue(expression, context);
    case "boolean":
      return evaluateBoolean(expression, context);
    case "==":
      return (
        evaluateVectorStyleExpression(expression[1], context) ===
        evaluateVectorStyleExpression(expression[2], context)
      );
    case "!=":
      return (
        evaluateVectorStyleExpression(expression[1], context) !==
        evaluateVectorStyleExpression(expression[2], context)
      );
    case ">":
      return (
        evaluateVectorStyleExpression(expression[1], context) >
        evaluateVectorStyleExpression(expression[2], context)
      );
    case ">=":
      return (
        evaluateVectorStyleExpression(expression[1], context) >=
        evaluateVectorStyleExpression(expression[2], context)
      );
    case "<":
      return (
        evaluateVectorStyleExpression(expression[1], context) <
        evaluateVectorStyleExpression(expression[2], context)
      );
    case "<=":
      return (
        evaluateVectorStyleExpression(expression[1], context) <=
        evaluateVectorStyleExpression(expression[2], context)
      );
    case "all":
      return evaluateAll(expression, context);
    case "any":
      return evaluateAny(expression, context);
    case "case":
      return evaluateCase(expression, context);
    case "match":
      return evaluateMatch(expression, context);
    case "zoom":
      return context.zoom ?? context.level ?? 0;
    case "interpolate":
      return evaluateInterpolate(expression, context);
    default:
      throw new Error(
        `Unsupported vector style expression operator: ${operator}`,
      );
  }
}

function validateVectorStyleExpression(expression, path = "expression") {
  if (typeof expression === "function") {
    throw new Error(`${path} must be serializable and cannot be a function.`);
  }
  if (!Array.isArray(expression)) {
    validateSerializableConstant(expression, path);
    return;
  }

  if (expression.length === 0) {
    throw new Error(`${path} expression array cannot be empty.`);
  }
  const operator = expression[0];
  if (typeof operator !== "string" || !SUPPORTED_OPERATORS.has(operator)) {
    throw new Error(
      `${path} uses unsupported vector style expression operator: ${operator}`,
    );
  }

  if (operator === "match") {
    validateVectorStyleExpression(expression[1], `${path}[1]`);
    for (let i = 2; i + 1 < expression.length; i += 2) {
      validateSerializableConstant(expression[i], `${path}[${i}]`);
      validateVectorStyleExpression(expression[i + 1], `${path}[${i + 1}]`);
    }
    if (expression.length > 2) {
      validateVectorStyleExpression(
        expression[expression.length - 1],
        `${path}[${expression.length - 1}]`,
      );
    }
    return;
  }

  if (operator === "interpolate") {
    validateInterpolation(expression, path);
    return;
  }

  if (operator === "feature-state") {
    if (expression.length !== 2 || typeof expression[1] !== "string") {
      throw new Error(`${path} feature-state key must be a string.`);
    }
    return;
  }

  if (operator === "boolean") {
    if (expression.length !== 3) {
      throw new Error(`${path} boolean expression must include a fallback.`);
    }
    validateVectorStyleExpression(expression[1], `${path}[1]`);
    validateVectorStyleExpression(expression[2], `${path}[2]`);
    return;
  }

  expression.forEach((value, index) => {
    if (index === 0 && operator !== "literal") {
      return;
    }
    if (operator === "literal" && index === 1) {
      validateSerializableConstant(value, `${path}[${index}]`);
      return;
    }
    validateVectorStyleExpression(value, `${path}[${index}]`);
  });
}

function isWorkerSupportedVectorStyleExpression(expression) {
  try {
    validateVectorStyleExpression(expression);
    return true;
  } catch {
    return false;
  }
}

function collectVectorStyleStateDependencies(...values) {
  const keys = new Set();
  for (const value of values) {
    collectStateDependencies(value, keys);
  }
  return [...keys].sort();
}

function validateVectorStyleFilter(filter, path = "filter") {
  if (filter === undefined || filter === null) {
    return;
  }
  if (typeof filter === "function") {
    throw new Error(`${path} must be serializable and cannot be a function.`);
  }
  validateVectorStyleExpression(filter, path);
}

function getProperty(expression, context) {
  const key = getPropertyKey(expression[1], context);
  if (key === undefined || key === null) {
    return undefined;
  }
  return context.properties?.[key];
}

function collectPropertyDependencies(value, state) {
  if (!Array.isArray(value) || value.length === 0 || state.all) {
    return;
  }

  const operator = value[0];
  if (operator === "literal") {
    return;
  }

  if (operator === "feature-state") {
    return;
  }

  if (typeof operator === "string" && !SUPPORTED_OPERATORS.has(operator)) {
    state.all = true;
    return;
  }

  if (operator === "get" || operator === "has") {
    const propertyName = value[1];
    if (typeof propertyName !== "string" || propertyName.length === 0) {
      state.all = true;
      return;
    }
    state.properties.add(propertyName);
    for (let i = 2; i < value.length; ++i) {
      collectPropertyDependencies(value[i], state);
    }
    return;
  }

  if (operator === "match") {
    collectPropertyDependencies(value[1], state);
    for (let i = 3; i < value.length && !state.all; i += 2) {
      collectPropertyDependencies(value[i], state);
    }
    if (value.length % 2 === 1) {
      collectPropertyDependencies(value[value.length - 1], state);
    }
    return;
  }

  if (operator === "interpolate") {
    collectPropertyDependencies(value[2], state);
    for (let i = 4; i < value.length && !state.all; i += 2) {
      collectPropertyDependencies(value[i], state);
    }
    return;
  }

  const startIndex = typeof operator === "string" ? 1 : 0;
  for (let i = startIndex; i < value.length && !state.all; ++i) {
    collectPropertyDependencies(value[i], state);
  }
}

function collectStateDependencies(value, keys) {
  if (!Array.isArray(value) || value.length === 0) {
    return;
  }

  const operator = value[0];
  if (operator === "literal") {
    return;
  }

  if (operator === "feature-state") {
    if (typeof value[1] === "string") {
      keys.add(value[1]);
    }
    return;
  }

  const startIndex = typeof operator === "string" ? 1 : 0;
  for (let i = startIndex; i < value.length; ++i) {
    collectStateDependencies(value[i], keys);
  }
}

function hasProperty(expression, context) {
  const key = getPropertyKey(expression[1], context);
  if (key === undefined || key === null) {
    return false;
  }
  return Object.prototype.hasOwnProperty.call(context.properties ?? {}, key);
}

function getPropertyKey(value, context) {
  return Array.isArray(value)
    ? evaluateVectorStyleExpression(value, context)
    : value;
}

function getFeatureStateValue(expression, context) {
  const key = expression[1];
  if (typeof key !== "string") {
    return null;
  }
  const state = context.state ?? {};
  return Object.prototype.hasOwnProperty.call(state, key) ? state[key] : null;
}

function evaluateBoolean(expression, context) {
  const value = evaluateVectorStyleExpression(expression[1], context);
  if (typeof value === "boolean") {
    return value;
  }
  return evaluateVectorStyleExpression(expression[2], context);
}

function evaluateAll(expression, context) {
  for (let i = 1; i < expression.length; ++i) {
    if (!evaluateVectorStyleExpression(expression[i], context)) {
      return false;
    }
  }
  return true;
}

function evaluateAny(expression, context) {
  for (let i = 1; i < expression.length; ++i) {
    if (evaluateVectorStyleExpression(expression[i], context)) {
      return true;
    }
  }
  return false;
}

function evaluateCase(expression, context) {
  for (let i = 1; i + 1 < expression.length; i += 2) {
    if (evaluateVectorStyleExpression(expression[i], context)) {
      return evaluateVectorStyleExpression(expression[i + 1], context);
    }
  }
  if (expression.length % 2 === 0) {
    return evaluateVectorStyleExpression(
      expression[expression.length - 1],
      context,
    );
  }
  return undefined;
}

function evaluateMatch(expression, context) {
  const input = evaluateVectorStyleExpression(expression[1], context);
  for (let i = 2; i + 1 < expression.length; i += 2) {
    const label = expression[i];
    const matches = Array.isArray(label)
      ? label.includes(input)
      : Object.is(label, input);
    if (matches) {
      return evaluateVectorStyleExpression(expression[i + 1], context);
    }
  }
  if (expression.length > 2) {
    return evaluateVectorStyleExpression(
      expression[expression.length - 1],
      context,
    );
  }
  return undefined;
}

function evaluateInterpolate(expression, context) {
  const interpolation = expression[1];
  if (!Array.isArray(interpolation) || interpolation[0] !== "linear") {
    throw new Error("Only linear vector style interpolation is supported.");
  }

  const input = Number(evaluateVectorStyleExpression(expression[2], context));
  if (!Number.isFinite(input)) {
    return evaluateVectorStyleExpression(expression[4], context);
  }

  let previousStop = Number(expression[3]);
  let previousValue = evaluateVectorStyleExpression(expression[4], context);
  if (input <= previousStop) {
    return previousValue;
  }

  for (let i = 5; i + 1 < expression.length; i += 2) {
    const stop = Number(expression[i]);
    const value = evaluateVectorStyleExpression(expression[i + 1], context);
    if (input <= stop) {
      return interpolateValues(
        previousValue,
        value,
        (input - previousStop) / (stop - previousStop),
      );
    }
    previousStop = stop;
    previousValue = value;
  }

  return previousValue;
}

function interpolateValues(a, b, t) {
  if (typeof a === "number" && typeof b === "number") {
    return a + (b - a) * t;
  }
  return t < 0.5 ? a : b;
}

function validateSerializableConstant(value, path) {
  if (typeof value === "function") {
    throw new Error(`${path} must be serializable and cannot be a function.`);
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      validateSerializableConstant(item, `${path}[${index}]`);
    });
    return;
  }
  if (CommonUtils.isPlainObject(value)) {
    Object.keys(value).forEach((key) => {
      validateSerializableConstant(value[key], `${path}.${key}`);
    });
  }
}

function validateInterpolation(expression, path) {
  const interpolation = expression[1];
  if (!Array.isArray(interpolation) || interpolation[0] !== "linear") {
    throw new Error(`${path} only supports ["linear"] interpolation.`);
  }
  validateVectorStyleExpression(expression[2], `${path}[2]`);
  for (let i = 3; i + 1 < expression.length; i += 2) {
    validateSerializableConstant(expression[i], `${path}[${i}]`);
    validateVectorStyleExpression(expression[i + 1], `${path}[${i + 1}]`);
  }
}

export default VectorTileStyleExpressionUtils;
