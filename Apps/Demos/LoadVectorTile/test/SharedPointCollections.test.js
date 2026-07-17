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
const { createSharedPointEntryKey } =
  await import("../src/SharedPointCollections.js");

{
  const diagnostics = createDiagnostics();
  const pickRegistry = createPickRegistry();
  const shared = new SharedPointCollections({
    scene: {},
    diagnostics,
    pickRegistry,
  });

  const pickContext = { sourceId: "demo" };
  shared.addTileEntries(
    "tile-a",
    {
      billboards: [
        { id: 3, _vectorTileFeatureIndex: 3 },
        { id: 4, _vectorTileFeatureIndex: 4 },
      ],
      labels: [{ text: "Alpha", _vectorTileFeatureIndex: 5 }],
    },
    pickContext,
  );
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
  assert.deepEqual(
    pickRegistry.registrations.map(({ context, featureIndex }) => ({
      context,
      featureIndex,
    })),
    [
      { context: pickContext, featureIndex: 3 },
      { context: pickContext, featureIndex: 4 },
      { context: pickContext, featureIndex: 5 },
    ],
  );

  const firstBillboard = primitives[0].items[0];
  const firstLabel = primitives[1].items[0];
  shared.updateTileEntries("tile-a", {
    billboards: [{ image: "updated.png", show: false }],
    labels: [{ text: "Updated", fillColor: "green" }],
  });
  assert.equal(primitives[0].items[0], firstBillboard);
  assert.equal(primitives[1].items[0], firstLabel);
  assert.equal(firstBillboard.image, "updated.png");
  assert.equal(firstBillboard.show, false);
  assert.equal(firstLabel.text, "Updated");
  assert.equal(firstLabel.fillColor, "green");

  shared.updateTileEntries(
    "tile-a",
    {
      billboards: [{ image: "must-not-reload.png", show: true }],
      labels: [{ text: "Must not change", show: false }],
    },
    ["show"],
  );
  assert.equal(firstBillboard.image, "updated.png");
  assert.equal(firstBillboard.show, true);
  assert.equal(firstLabel.text, "Updated");
  assert.equal(firstLabel.show, false);

  shared.removeTileEntries("tile-a");
  assert.equal(primitives[0].items.length, 1);
  assert.equal(primitives[1].items.length, 0);
  assert.equal(shared.hasTileEntries("tile-a"), false);
  assert.equal(shared.hasTileEntries("tile-b"), true);
  assert.equal(diagnostics.gauges.liveSharedBillboards, 1);
  assert.equal(diagnostics.gauges.liveSharedLabels, 0);
  assert.equal(pickRegistry.unregistrations.length, 3);

  shared.destroy();
  assert.equal(primitives[0].destroyed, true);
  assert.equal(primitives[1].destroyed, true);
  assert.equal(diagnostics.gauges.sharedPointCollections, 0);
  assert.equal(diagnostics.gauges.liveSharedBillboards, 0);
  assert.equal(diagnostics.gauges.liveSharedLabels, 0);
  console.log("✓ shared point collections keep add/remove handles consistent");
}

{
  const oldTile = {
    cacheKey: "[0,4,5,6]",
    x: 4,
    y: 5,
    level: 6,
  };
  const newTile = {
    cacheKey: "[1,4,5,6]",
    x: 4,
    y: 5,
    level: 6,
  };

  assert.notEqual(
    createSharedPointEntryKey(oldTile, "labels"),
    createSharedPointEntryKey(newTile, "labels"),
  );
  console.log("✓ shared point entry keys include the revisioned tile key");
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

function createPickRegistry() {
  return {
    registrations: [],
    unregistrations: [],
    registerPoint(handle, context, featureIndex) {
      this.registrations.push({ handle, context, featureIndex });
    },
    unregister(handle) {
      this.unregistrations.push(handle);
    },
  };
}
