import {
  evaluateVectorStyleExpression,
  isWorkerSupportedVectorStyleExpression,
  validateVectorStyleExpression,
} from "./VectorStyleExpression.js";

/**
 * Evaluates a style-rule filter against a decoded feature.
 *
 * @param {*} filter Serializable expression or undefined.
 * @param {object} feature
 * @param {object} [context]
 * @returns {boolean}
 */
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
