import CommonUtils from "./CommonUtils.js";

class VectorTileFeatureStateUtils {
  static normalizePromoteId(promoteId, sourceId) {
    if (promoteId === undefined) {
      return undefined;
    }
    if (CommonUtils.isNonEmptyString(promoteId)) {
      return promoteId;
    }
    if (!CommonUtils.isPlainObject(promoteId)) {
      throw new Error(
        `source "${sourceId}" promoteId must be a non-empty string or an object mapping source-layer names to property names.`,
      );
    }

    const result = {};
    for (const [sourceLayer, propertyName] of Object.entries(promoteId)) {
      if (!CommonUtils.isNonEmptyString(sourceLayer)) {
        throw new Error(
          `source "${sourceId}" promoteId source-layer names must be non-empty strings.`,
        );
      }
      if (!CommonUtils.isNonEmptyString(propertyName)) {
        throw new Error(
          `source "${sourceId}" promoteId["${sourceLayer}"] must be a non-empty string.`,
        );
      }
      result[sourceLayer] = propertyName;
    }
    return result;
  }

  static resolveFeatureStateId(sourceLayer, feature, promoteId) {
    const propertyName = getPromoteIdPropertyName(promoteId, sourceLayer);
    if (propertyName !== undefined) {
      const id = feature?.properties?.[propertyName];
      return {
        id: isValidFeatureStateId(id) ? id : undefined,
        unaddressable: !isValidFeatureStateId(id),
      };
    }
    const id = feature?.id;
    return {
      id: isValidFeatureStateId(id) ? id : undefined,
      unaddressable: !isValidFeatureStateId(id),
    };
  }

  static isValidFeatureStateId(id) {
    return isValidFeatureStateId(id);
  }

  static encodeFeatureStateKey(sourceLayer, id) {
    return `${sourceLayer}\u0000${typeof id}\u0000${String(id)}`;
  }
}

function getPromoteIdPropertyName(promoteId, sourceLayer) {
  if (typeof promoteId === "string") {
    return promoteId;
  }
  if (
    promoteId &&
    Object.prototype.hasOwnProperty.call(promoteId, sourceLayer)
  ) {
    return promoteId[sourceLayer];
  }
  return undefined;
}

function isValidFeatureStateId(id) {
  return typeof id === "string" || typeof id === "number";
}

export default VectorTileFeatureStateUtils;
