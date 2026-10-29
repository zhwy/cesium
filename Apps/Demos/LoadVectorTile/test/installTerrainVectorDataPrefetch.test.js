import assert from "node:assert/strict";
import test from "node:test";
import installTerrainVectorDataPrefetch from "../src/installTerrainVectorDataPrefetch.js";

function createScene() {
  const shown = [];
  class TileProvider {
    showTileThisFrame(tile) {
      shown.push(tile);
    }
  }
  const tileProvider = new TileProvider();
  const requests = [];
  const stale = {};
  const fresh = {};
  const vectorProvider = {
    _heightReferenceByCollection: new Map([
      [stale, "stale"],
      [fresh, "fresh"],
    ]),
    _markedThisFrame: new Set([fresh]),
    requestTileData: (...args) => {
      requests.push({
        args,
        collections: [...vectorProvider._heightReferenceByCollection.keys()],
      });
      return { baked: true };
    },
  };
  const scene = {
    globe: { _surface: { tileProvider } },
    vectorProvider,
  };
  return { scene, tileProvider, shown, requests, vectorProvider, stale, fresh };
}

test("选中瓦片时只用本帧登记的集合补烘焙缺失数据，卸载后恢复", () => {
  const { scene, tileProvider, shown, requests, vectorProvider, stale, fresh } =
    createScene();
  const uninstall = installTerrainVectorDataPrefetch(scene);
  const frameState = { context: {} };
  const tile = { x: 1, y: 2, level: 3, data: {} };
  const baked = { x: 0, y: 0, level: 1, data: { vectorData: { keep: true } } };
  tileProvider.showTileThisFrame(tile, frameState);
  tileProvider.showTileThisFrame(baked, frameState);
  assert.deepEqual(shown, [tile, baked]);
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].args.slice(0, 3), [1, 2, 3]);
  assert.deepEqual(requests[0].collections, [fresh]);
  assert.equal(vectorProvider._heightReferenceByCollection.size, 2);
  assert.ok(vectorProvider._heightReferenceByCollection.has(stale));
  assert.deepEqual(tile.data.vectorData, { baked: true });
  assert.deepEqual(baked.data.vectorData, { keep: true });

  uninstall();
  assert.equal(Object.hasOwn(tileProvider, "showTileThisFrame"), false);
  tileProvider.showTileThisFrame({ data: {} }, frameState);
  assert.equal(requests.length, 1);
});

test("缺少私有字段或重复安装时不做任何事", () => {
  assert.doesNotThrow(() => installTerrainVectorDataPrefetch({})());
  const { scene, tileProvider } = createScene();
  const uninstall = installTerrainVectorDataPrefetch(scene);
  const patched = tileProvider.showTileThisFrame;
  installTerrainVectorDataPrefetch(scene)();
  assert.equal(tileProvider.showTileThisFrame, patched);
  uninstall();
});
