import assert from "node:assert/strict";

class FakeCollection {
  constructor() {
    this.items = [];
    this.ready = true;
    this.destroyed = false;
  }

  add(options) {
    const handle = { ...options };
    this.items.push(handle);
    return handle;
  }

  remove(handle) {
    const index = this.items.indexOf(handle);
    if (index === -1) {
      return false;
    }
    this.items.splice(index, 1);
    return true;
  }

  isDestroyed() {
    return this.destroyed;
  }

  destroy() {
    this.destroyed = true;
  }
}

globalThis.Cesium = {
  BillboardCollection: FakeCollection,
  LabelCollection: FakeCollection,
};

const { default: SharedPointCollections } =
  await import("../src/SharedPointCollections.js");

{
  const diagnostics = createDiagnostics();
  const shared = new SharedPointCollections({
    scene: {},
    diagnostics,
  });

  shared.addTileEntries("tile-a", {
    billboards: [{ id: "a-1" }, { id: "a-2" }],
    labels: [{ text: "Alpha" }],
  });
  shared.addTileEntries("tile-b", {
    billboards: [{ id: "b-1" }],
  });

  const primitives = shared.getPrimitives();
  assert.equal(primitives.length, 2);
  assert.equal(primitives[0].items.length, 3);
  assert.equal(primitives[1].items.length, 1);
  assert.equal(shared.hasTileEntries("tile-a"), true);
  assert.equal(shared.hasTileEntries("tile-b"), true);
  assert.equal(diagnostics.gauges.sharedPointCollections, 2);
  assert.equal(diagnostics.gauges.liveSharedBillboards, 3);
  assert.equal(diagnostics.gauges.liveSharedLabels, 1);

  shared.removeTileEntries("tile-a");
  assert.equal(primitives[0].items.length, 1);
  assert.equal(primitives[1].items.length, 0);
  assert.equal(shared.hasTileEntries("tile-a"), false);
  assert.equal(shared.hasTileEntries("tile-b"), true);
  assert.equal(diagnostics.gauges.liveSharedBillboards, 1);
  assert.equal(diagnostics.gauges.liveSharedLabels, 0);

  shared.destroy();
  assert.equal(primitives[0].destroyed, true);
  assert.equal(primitives[1].destroyed, true);
  assert.equal(diagnostics.gauges.sharedPointCollections, 0);
  assert.equal(diagnostics.gauges.liveSharedBillboards, 0);
  assert.equal(diagnostics.gauges.liveSharedLabels, 0);
  console.log("✓ shared point collections keep add/remove handles consistent");
}

console.log("SharedPointCollections tests passed.");

function createDiagnostics() {
  return {
    gauges: {},
    addGauge(name, amount) {
      this.gauges[name] = Math.max(0, (this.gauges[name] ?? 0) + amount);
    },
  };
}
