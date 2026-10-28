import assert from "node:assert/strict";
import protobuf from "protobufjs/dist/minimal/protobuf.js";
import Rectangle from "../../../../packages/core/Source/Rectangle.js";
import Cesium3DTileset from "../../../../packages/engine/Source/Scene/Cesium3DTileset.js";
import Empty3DTileContent from "../../../../packages/engine/Source/Scene/Empty3DTileContent.js";
import VectorGltf3DTileContent from "../../../../packages/engine/Source/Scene/VectorGltf3DTileContent.js";
import buildVectorGltfFromMVT from "../../../../packages/engine/Source/Scene/buildVectorGltfFromMVT.js";
import VectorGltfTilesetProvider, {
  buildVectorGltfTilesetJson,
  decodeVectorGltfTile,
  prepareDecodedTileForStyle,
} from "../src/VectorGltfTilesetProvider.js";

const template = "https://example.com/{z}/{x}/{y}.pbf";
const extent = Rectangle.fromDegrees(-170, 70, -160, 75);
const rule = { id: "roads", type: "line", sourceLayer: "transport" };
const ring = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 0 },
];
const feature = {
  id: 0,
  type: "Polygon",
  geometry: [ring],
  properties: { kind: "road", color: "red", secret: "discard", promoted: "p1" },
};
const decoded = {
  layers: [
    {
      name: "transport",
      extent: 4096,
      features: [
        feature,
        { ...feature, id: 2, properties: { kind: "park" } },
        { type: "Point", geometry: [{ x: 5, y: 5 }], properties: {} },
      ],
    },
  ],
};

function encodeTile(ids = [7]) {
  const writer = protobuf.Writer.create();
  writer.uint32(26).fork().uint32(10).string("transport");
  for (const id of ids) {
    writer.uint32(18).fork();
    if (id !== undefined) {
      writer.uint32(8).uint64(id);
    }
    writer.uint32(24).uint32(2);
    writer.uint32(34).fork();
    for (const command of [9, 0, 0, 10, 20, 20]) {
      writer.uint32(command);
    }
    writer.ldelim().ldelim();
  }
  writer.uint32(40).uint32(4096).ldelim();
  return Uint8Array.from(writer.finish()).buffer;
}

{
  const json = buildVectorGltfTilesetJson(template, {
    minZoom: 0,
    maxZoom: 2,
    maximumNodes: 22,
  });
  const queue = [json.root];
  let count = 0;
  while (queue.length) {
    const node = queue.shift();
    count++;
    assert.equal(node.refine, "REPLACE");
    assert.deepEqual(node.boundingVolume.region.slice(4), [-1000, 10000]);
    if (node.extras?.tileZ === 2) {
      assert.equal(node.geometricError, 0);
      assert.equal(node.children, undefined);
    } else {
      assert.ok(node.geometricError > 0);
      queue.push(...node.children);
    }
  }
  assert.equal(count, 22);
  assert.throws(
    () =>
      buildVectorGltfTilesetJson(template, { maxZoom: 2, maximumNodes: 21 }),
    /节点上限/,
  );
  assert.throws(
    () => buildVectorGltfTilesetJson(template, { maxZoom: 30 }),
    /节点上限/,
  );
  for (const options of [
    { minZoom: -1 },
    { minZoom: 3, maxZoom: 2 },
    { maxZoom: 31 },
    { maxZoom: NaN },
    { minZoom: 0.5 },
    { maximumNodes: Infinity },
  ]) {
    assert.throws(() => buildVectorGltfTilesetJson(template, options), /无效/);
  }
  for (const invalidExtent of [
    Rectangle.fromDegrees(170, 0, -170, 10),
    Rectangle.fromDegrees(0, -90, 10, 90),
    new Rectangle(NaN, 0, 1, 1),
  ]) {
    assert.throws(
      () => buildVectorGltfTilesetJson(template, { extent: invalidExtent }),
      /范围/,
    );
  }
}

{
  const options = { extent, minZoom: 2, maxZoom: 3 };
  const json = buildVectorGltfTilesetJson(
    "https://example.com/{z}/{x}/{-y}.pbf?reverse={reverseY}&xyz={y}",
    options,
  );
  const node = json.root.children[0];
  assert.deepEqual(node.extras, { tileX: 0, tileY: 0, tileZ: 2 });
  assert.equal(
    node.content.uri,
    "https://example.com/2/0/3.pbf?reverse=3&xyz=0",
  );
  assert.ok(
    node.children.every(
      (child) =>
        Math.floor(child.extras.tileX / 2) === 0 &&
        Math.floor(child.extras.tileY / 2) === 0,
    ),
  );
  const wmts = buildVectorGltfTilesetJson(
    "https://example.com/wmts?matrix={TileMatrix}&row={TileRow}&col={TileCol}&set={TileMatrixSet}",
    {
      ...options,
      tileMatrixSetID: "mercator",
      tileMatrixLabels: ["zero", "one", "two", "three"],
    },
  );
  assert.equal(
    wmts.root.children[0].content.uri,
    "https://example.com/wmts?matrix=two&row=0&col=0&set=mercator",
  );
  assert.throws(
    () => buildVectorGltfTilesetJson("https://example.com/{missing}", options),
    /占位符/,
  );
}

{
  const rules = [
    {
      ...rule,
      minzoom: 2,
      maxzoom: 4,
      filter: ["==", ["get", "kind"], "road"],
      paint: { "line-color": ["get", "color"] },
    },
    { ...rule, id: "fill", type: "fill", filter: ["==", ["id"], 0] },
    { ...rule, id: "hidden", visibility: false },
    { ...rule, id: "missing", sourceLayer: "absent" },
    { ...rule, id: "points", type: "circle" },
  ];
  const original = structuredClone(decoded);
  const prepared = prepareDecodedTileForStyle(decoded, 2, rules, {
    pickProperties: ["promoted"],
  });
  assert.deepEqual(
    prepared.layers.map((layer) => layer.name),
    ["roads", "fill"],
  );
  const line = prepared.layers[0].features[0];
  const fill = prepared.layers[1].features[0];
  assert.equal(line.type, "LineString");
  assert.deepEqual(line.geometry, feature.geometry);
  assert.deepEqual(line.properties, {
    kind: "road",
    color: "red",
    promoted: "p1",
    _fid: "roads:0",
    _id: 0,
  });
  assert.equal(fill.type, "Polygon");
  assert.notEqual(line, fill);
  assert.notEqual(line.properties, fill.properties);
  assert.notEqual(line.properties._fid, fill.properties._fid);
  assert.deepEqual(decoded, original);
  assert.equal(
    prepareDecodedTileForStyle(decoded, 1, [rules[0]]).layers.length,
    0,
  );
  assert.equal(
    prepareDecodedTileForStyle(decoded, 4, [rules[0]]).layers.length,
    0,
  );
  const promoteRule = { ...rule, filter: ["==", ["id"], "p1"] };
  for (const promoteId of ["promoted", { transport: "promoted" }]) {
    assert.equal(
      prepareDecodedTileForStyle(decoded, 2, [promoteRule], { promoteId })
        .layers[0].features[0].properties._id,
      "p1",
    );
  }
  const dynamic = { ...rule, paint: { custom: ["properties"] } };
  assert.equal(
    prepareDecodedTileForStyle(decoded, 2, [dynamic]).layers[0].features[0]
      .properties.secret,
    "discard",
  );
}

{
  const open = ring.slice(0, -1).reverse();
  const input = {
    layers: [
      {
        name: "transport",
        extent: 4096,
        features: [
          {
            ...feature,
            type: "LineString",
            geometry: [open, [...open].reverse()],
          },
        ],
      },
    ],
  };
  const prepared = prepareDecodedTileForStyle(input, 2, [
    { ...rule, type: "fill" },
  ]);
  for (const converted of prepared.layers[0].features[0].geometry) {
    assert.deepEqual(converted[0], converted.at(-1));
    assert.equal(converted.length, 4);
  }
  assert.equal(open.length, 3);
  const glb = buildVectorGltfFromMVT(
    prepared,
    { tileX: 0, tileY: 0, tileZ: 2 },
    { featureIdProperty: "_fid" },
  );
  assert.ok(glb.byteLength > 0);
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  const gltf = JSON.parse(
    new TextDecoder().decode(glb.subarray(20, 20 + view.getUint32(12, true))),
  );
  assert.equal(
    gltf.extensions.EXT_structural_metadata.propertyTables[0].count,
    1,
  );
  const polygonCount =
    gltf.meshes[0].primitives[0].extensions.CESIUM_mesh_vector.count;
  assert.equal(polygonCount, 2);
}

{
  const native = decodeVectorGltfTile(encodeTile([0, 7, undefined]));
  assert.deepEqual(
    native.layers[0].features.map((item) => item.id),
    [0, 7, undefined],
  );
  assert.equal(
    prepareDecodedTileForStyle(native, 2, [
      { ...rule, filter: ["==", ["id"], 7] },
    ]).layers[0].features.length,
    1,
  );
  assert.deepEqual(decodeVectorGltfTile(new ArrayBuffer(0)), { layers: [] });
}

{
  const calls = [];
  const fakeTileset = {
    show: true,
    update(value) {
      calls.push(["update", value]);
    },
    prePassesUpdate(value) {
      calls.push(["pre", value]);
    },
    postPassesUpdate(value) {
      calls.push(["post", value]);
    },
    updateForPass(value, pass) {
      calls.push(["pass", value, pass]);
    },
    destroy() {
      calls.push(["destroy"]);
    },
  };
  const originalLoad = Cesium3DTileset.fromUrl;
  const originalRevoke = URL.revokeObjectURL;
  const originalContent = VectorGltf3DTileContent.fromGltf;
  const revoked = [];
  URL.revokeObjectURL = (url) => {
    revoked.push(url);
    originalRevoke(url);
  };
  try {
    Cesium3DTileset.fromUrl = async (url, options) => {
      assert.equal(options.skipLevelOfDetail, false);
      assert.equal(options.enablePick, true);
      assert.equal(options.featureIdLabel, "featureId_0");
      const json = await (await fetch(url)).json();
      assert.equal(json.root.children[0].extras.tileZ, 2);
      return fakeTileset;
    };
    const provider = await VectorGltfTilesetProvider.fromUrl(template, {
      extent,
      minZoom: 2,
      maxZoom: 2,
      rules: [rule],
    });
    assert.equal(revoked.length, 1);
    const codec = fakeTileset._runtimeContentCodec;
    assert.deepEqual(codec.missingTilePolicy.statusCodes, [404, 204]);
    const tile = { extras: { tileX: 0, tileY: 0, tileZ: 2 } };
    assert.ok(
      (await codec.createContent(
        fakeTileset,
        tile,
        {},
        new ArrayBuffer(0),
      )) instanceof Empty3DTileContent,
    );
    VectorGltf3DTileContent.fromGltf = (
      tileset,
      contentTile,
      resource,
      glb,
    ) => ({ tileset, contentTile, glb });
    const content = await codec.createContent(
      fakeTileset,
      tile,
      {},
      encodeTile(),
    );
    assert.equal(content.contentTile, tile);
    assert.ok(content.glb.byteLength > 0);
    const snapshot = provider.diagnostics.snapshot();
    assert.equal(snapshot.counters.decodedFeatures, 1);
    assert.equal(snapshot.counters.filteredFeatures, 1);
    assert.equal(snapshot.counters.decodedTilesAtLevel2, 2);
    assert.equal(snapshot.counters.glbBytes, content.glb.byteLength);
    assert.equal(snapshot.durations.buildGltf.count, 2);
    provider.show = false;
    assert.equal(provider.show, false);
    provider.update(1);
    provider.prePassesUpdate(2);
    provider.postPassesUpdate(3);
    provider.updateForPass(4, 5);
    provider.destroy();
    assert.equal(provider.isDestroyed(), true);
    assert.deepEqual(calls, [
      ["update", 1],
      ["pre", 2],
      ["post", 3],
      ["pass", 4, 5],
      ["destroy"],
    ]);
    Cesium3DTileset.fromUrl = async () => {
      throw new Error("load failed");
    };
    await assert.rejects(
      VectorGltfTilesetProvider.fromUrl(template, { maxZoom: 0 }),
      /load failed/,
    );
    assert.equal(revoked.length, 2);
  } finally {
    Cesium3DTileset.fromUrl = originalLoad;
    URL.revokeObjectURL = originalRevoke;
    VectorGltf3DTileContent.fromGltf = originalContent;
  }
}

console.log("VectorGltfTilesetProvider tests passed");
