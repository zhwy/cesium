/**
 * Cesium-oriented render bucket for one vector tile style rule.
 *
 * A bucket is intentionally lightweight: it owns the primitives created for a
 * single style rule on a single vector tile.  VectorTile still stores
 * `bucket.primitives` in its existing primitive map so the current cache and
 * render submission lifecycle can stay unchanged while rendering becomes
 * style-rule scoped.
 */
export default class VectorTilePrimitiveBucket {
  constructor(styleRule) {
    this.id = styleRule.id;
    this.type = styleRule.type;
    this.sourceLayer = styleRule.sourceLayer;
    this.styleRule = styleRule;
    this.primitives = [];
  }

  addPrimitive(primitive) {
    if (primitive) {
      this.primitives.push(primitive);
    }
  }

  addPrimitives(primitives) {
    primitives.forEach((primitive) => this.addPrimitive(primitive));
  }

  get length() {
    return this.primitives.length;
  }

  destroy() {
    this.primitives.forEach((primitive) => {
      if (!primitive.isDestroyed()) {
        primitive.destroy();
      }
    });
    this.primitives.length = 0;
  }
}
