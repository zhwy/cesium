const SUPPORTED_OPERATORS = new Set([
  "get",
  "has",
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

/**
 * Evaluates the serializable expression subset used by the vector tile demo.
 * The syntax intentionally follows the familiar Mapbox expression shape, but
 * only implements the small subset needed by the current Cesium experiment.
 *
 * @param {*} expression Constant value or expression array.
 * @param {object} [context]
 * @param {object} [context.properties]
 * @param {number} [context.zoom]
 * @returns {*}
 */
export function evaluateVectorStyleExpression(expression, context = {}) {
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

export function validateVectorStyleExpression(expression, path = "expression") {
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

export function isWorkerSupportedVectorStyleExpression(expression) {
  try {
    validateVectorStyleExpression(expression);
    return true;
  } catch {
    return false;
  }
}

export function evaluateVectorStyleFilter(filter, feature, context = {}) {
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

export function validateVectorStyleFilter(filter, path = "filter") {
  if (filter === undefined || filter === null) {
    return;
  }
  if (typeof filter === "function") {
    throw new Error(`${path} must be serializable and cannot be a function.`);
  }
  validateVectorStyleExpression(filter, path);
}

export function isWorkerSupportedVectorStyleFilter(filter) {
  if (filter === undefined || filter === null) {
    return true;
  }
  return isWorkerSupportedVectorStyleExpression(filter);
}

function getProperty(expression, context) {
  const key = getPropertyKey(expression[1], context);
  if (key === undefined || key === null) {
    return undefined;
  }
  return context.properties?.[key];
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
  if (isPlainObject(value)) {
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

function isPlainObject(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}
