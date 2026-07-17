import { getPublicPickProperties } from "./VectorTilePropertyProjectionUtils.js";

export default class VectorTilePickRegistry {
  constructor() {
    this._contexts = new WeakMap();
  }

  registerPrimitive(primitive, context) {
    if (primitive && context) {
      this._contexts.set(primitive, {
        ...context,
        kind: "primitive",
      });
    }
  }

  registerPoint(handle, context, featureIndex) {
    if (handle && context) {
      this._contexts.set(handle, {
        ...context,
        kind: "point",
        featureIndex,
      });
    }
  }

  unregister(object) {
    if (object) {
      this._contexts.delete(object);
    }
  }

  resolve(picked) {
    const context = this._contexts.get(picked?.primitive);
    if (!context) {
      return undefined;
    }

    const featureIndex =
      context.kind === "primitive"
        ? resolvePrimitiveFeatureIndex(context, picked.id)
        : context.featureIndex;
    if (!Number.isInteger(featureIndex) || featureIndex < 0) {
      return undefined;
    }

    const feature = context.featureTable?.[featureIndex];
    if (!feature) {
      return undefined;
    }

    return {
      id: feature.id,
      properties: getPublicPickProperties(
        feature.properties,
        context.pickProperties,
      ),
      sourceId: context.sourceId,
      sourceLayer: context.sourceLayer,
      layerId: context.styleLayerId,
      tile: { ...context.tile },
      featureIndex,
      sourceFeatureIndex: feature.sourceFeatureIndex,
    };
  }
}

function resolvePrimitiveFeatureIndex(context, instanceId) {
  if (!Number.isInteger(instanceId) || instanceId < 0) {
    return undefined;
  }
  return context.instanceFeatureIndices?.[instanceId];
}
