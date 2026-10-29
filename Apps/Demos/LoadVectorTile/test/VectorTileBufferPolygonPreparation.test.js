import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import Cartesian3 from "../../../../packages/core/Source/Cartesian3.js";
import Ellipsoid from "../../../../packages/core/Source/Ellipsoid.js";
import EllipsoidTangentPlane from "../../../../packages/core/Source/EllipsoidTangentPlane.js";
import PolygonPipeline from "../../../../packages/core/Source/PolygonPipeline.js";
import Geometry from "../src/VectorTileBufferPolygonGeometry.js";
import Placement from "../src/VectorTileGeometryPlacementUtils.js";
import Diagnostics from "../src/VectorTileDiagnostics.js";

const outer = [0, 0, 4, 0, 4, 4, 2, 2, 0, 4, 0, 0];
const hole = [0.5, 0.5, 0.5, 1, 1, 1, 1, 0.5, 0.5, 0.5];

function createLayer() {
  return {
    features: [0, 1, 2].map((id) => ({ id, properties: { kind: id } })),
    points: {
      positions: new Float64Array(),
      featureIndices: new Uint32Array(),
    },
    lines: {
      positions: Float64Array.from(outer),
      offsets: new Uint32Array([0, outer.length / 2]),
      featureIndices: new Uint32Array([2]),
    },
    polygons: {
      positions: Float64Array.from([...outer, ...hole, ...outer, ...outer]),
      ringOffsets: new Uint32Array([0, 6, 11, 17, 23]),
      polygonOffsets: new Uint32Array([0, 2, 3, 4]),
      featureIndices: new Uint32Array([0, 1, 1]),
    },
  };
}

test("面请求独立去重，非零贴地高度规范化，其他后端无需准备", () => {
  const rule = { sourceLayer: "land", type: "fill", useBufferPrimitive: true };
  const rules = [
    rule,
    { ...rule, filter: ["==", ["get", "kind"], 1] },
    { ...rule, terrain: { clampToGround: true, heightOffset: 5 } },
    { ...rule, terrain: { clampToGround: true } },
    { ...rule, type: "line" },
    { ...rule, useBufferPrimitive: false },
  ];
  assert.deepEqual(Geometry.createRequests(rules), [
    { sourceLayer: "land", ground: false, height: 0 },
    { sourceLayer: "land", ground: false, height: 5 },
    { sourceLayer: "land", ground: true, height: 0 },
  ]);
  assert.deepEqual(Geometry.createRequests(rules.slice(-2)), []);
  assert.equal(
    Geometry.getParameters({ terrain: { heightOffset: "invalid" } }).height,
    0,
  );
});

test("贴地带洞凹面、成面线和多片段不调用投影剖分细分", (t) => {
  for (const [target, method] of [
    [EllipsoidTangentPlane, "fromPoints"],
    [PolygonPipeline, "triangulate"],
    [PolygonPipeline, "computeSubdivision"],
    [PolygonPipeline, "scaleToGeodeticHeight"],
  ]) {
    t.mock.method(target, method, () => {
      throw new Error("贴地不应访问几何算法");
    });
  }
  const group = Geometry.prepareLayer(createLayer(), {
    ground: true,
    height: 0,
  });
  assert.equal(group.triangles, undefined);
  assert.equal(group.triangleOffsets, undefined);
  assert.deepEqual([...group.geometryTypes], [3, 3, 3, 2]);
  assert.deepEqual([...group.geometryIndices], [0, 1, 2, 0]);
  assert.deepEqual([...group.featureIndices], [0, 1, 1, 2]);
  assert.deepEqual([...group.vertexOffsets], [0, 9, 14, 19, 24]);
  assert.deepEqual([...group.holes], [5]);
  assert.ok([...group.positions].every(Number.isFinite));
  assert.equal(
    Geometry.prepareGeometry([[0, 0, 1, 1, 2, 2]], new Cartesian3(), true, 0),
    undefined,
  );
  const clean = Geometry.prepareGeometry(
    [[NaN, 0, 0, 0, 0, 0, 1, 0, 1, 1, 0, 0]],
    new Cartesian3(),
    true,
    0,
  );
  assert.equal(clean.positions.length, 9);
});

test("非贴地保持洞、细分和高度，所有局部三角索引有效", () => {
  const group = Geometry.prepareLayer(createLayer(), {
    ground: false,
    height: 100,
  });
  for (let i = 0; i < group.featureIndices.length; i++) {
    const count = group.vertexOffsets[i + 1] - group.vertexOffsets[i];
    const indices = group.triangles.subarray(
      group.triangleOffsets[i],
      group.triangleOffsets[i + 1],
    );
    assert.ok(indices.length > 0);
    assert.ok([...indices].every((index) => index < count));
  }
  const position = Cartesian3.fromArray(group.positions);
  Cartesian3.add(position, Cartesian3.fromArray(group.origin), position);
  assert.ok(
    Math.abs(Ellipsoid.WGS84.cartesianToCartographic(position).height - 100) <
      1e-5,
  );
  assert.ok(group.positions.length / 3 > 24);
});

test("主线程多样式过滤同步压缩面及 feature，保留洞、片段和线身份", () => {
  const layer = createLayer();
  layer.bufferPolygons = [
    Geometry.prepareLayer(layer, { ground: true, height: 0 }),
  ];
  const result = Placement.filterPackedLayerByStyleRules(
    layer,
    [
      { type: "fill", filter: ["==", ["get", "kind"], 1] },
      { type: "fill", filter: ["==", ["get", "kind"], 2] },
    ],
    4,
  );
  const group = result.bufferPolygons[0];
  assert.deepEqual(
    result.features.map((feature) => feature.id),
    [1, 2],
  );
  assert.deepEqual([...group.featureIndices], [0, 0, 1]);
  assert.deepEqual([...group.geometryIndices], [0, 1, 0]);
  assert.deepEqual([...group.geometryTypes], [3, 3, 2]);
  assert.equal(group.positions.length, 45);
  const withHole = Placement.filterPackedLayerByStyleRules(
    layer,
    [{ type: "fill", filter: ["==", ["get", "kind"], 0] }],
    4,
  );
  assert.deepEqual([...withHole.bufferPolygons[0].holes], [5]);
  const empty = Placement.filterPackedLayerByStyleRules(
    layer,
    [{ type: "fill", filter: ["==", ["get", "kind"], 99] }],
    4,
  );
  assert.equal(empty.bufferPolygons[0].positions.length, 0);
  assert.equal(empty.features.length, 0);
});

test("共享准备缓冲按底层 buffer 核算，最后消费者释放后归零", () => {
  const layer = createLayer();
  const group = Geometry.prepareLayer(layer, { ground: true, height: 0 });
  const diagnostics = new Diagnostics(true);
  diagnostics.retainBufferPolygonGeometry(group);
  const bytes = diagnostics.snapshot().gauges.bufferPolygonPreparedBytes;
  assert.ok(bytes > 0);
  diagnostics.retainBufferPolygonGeometry(group);
  assert.equal(diagnostics.snapshot().gauges.bufferPolygonPreparedBytes, bytes);
  diagnostics.reset();
  assert.equal(diagnostics.snapshot().gauges.bufferPolygonPreparedBytes, bytes);
  diagnostics.releaseBufferPolygonGeometry(group);
  assert.equal(diagnostics.snapshot().gauges.bufferPolygonPreparedBytes, bytes);
  diagnostics.releaseBufferPolygonGeometry(group);
  assert.equal(diagnostics.snapshot().gauges.bufferPolygonPreparedBytes, 0);
});

test("Worker 契约：任务内复用、可转移数组去重、不启用时不准备", async () => {
  const bundle = await build({
    entryPoints: [
      fileURLToPath(
        new URL("../src/createDecodeVectorTileTask.js", import.meta.url),
      ),
    ],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    plugins: [
      {
        name: "worker-test",
        setup(build) {
          build.onResolve({ filter: /createTaskProcessorWorker\.js$/ }, () => ({
            path: "adapter",
            namespace: "fixture",
          }));
          build.onResolve({ filter: /\/decodeVectorTile\.js$/ }, () => ({
            path: "decode",
            namespace: "fixture",
          }));
          build.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({
            contents:
              path === "adapter"
                ? "export default (fn) => fn;"
                : "export default (value) => structuredClone(value);",
          }));
        },
      },
    ],
  });
  const { default: task } = await import(
    `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
  );
  const layer = createLayer();
  const input = { layers: { land: layer } };
  const request = { sourceLayer: "land", ground: true, height: 0 };
  const transfers = [];
  const result = await task(
    { arrayBuffer: input, bufferPolygonRequests: [request, request] },
    transfers,
  );
  assert.equal(result.layers.land.bufferPolygons.length, 1);
  assert.ok(result.bufferPolygonPrepareMs >= 0);
  assert.equal(new Set(transfers).size, transfers.length);
  const moved = structuredClone(result, { transfer: transfers });
  assert.ok(moved.layers.land.bufferPolygons[0].positions.length > 0);
  assert.ok(moved.layers.land.polygons.positions.length > 0);
  assert.ok(layer.polygons.positions.byteLength > 0);
  assert.equal(result.layers.land.polygons.positions.byteLength, 0);
  const old = await task({ arrayBuffer: input }, []);
  assert.equal(old.layers.land.bufferPolygons, undefined);
  assert.equal(old.bufferPolygonPrepareMs, undefined);
});
