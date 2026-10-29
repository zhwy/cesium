/* global window */
// window 仅用于 page.evaluate 内的浏览器上下文。
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import console from "node:console";
import protobuf from "protobufjs";
import assert from "node:assert/strict";

const mode = process.argv[2] ?? "smoke";
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.stack));
  if (mode === "baseline") {
    // 只替换浏览器响应以复现 HEAD 同步算法，不修改工作区和 Git 状态。
    for (const name of [
      "VectorTileBufferPolygonBucket.js",
      "VectorTileBufferPolygonPrimitive.js",
      "createDecodeVectorTileTask.js",
    ]) {
      const source = execFileSync(
        "git",
        ["show", `HEAD:Apps/Demos/LoadVectorTile/src/${name}`],
        { encoding: "utf8" },
      );
      await page.route(`**/Apps/Demos/LoadVectorTile/src/${name}`, (route) =>
        route.fulfill({ body: source, contentType: "application/javascript" }),
      );
    }
  }
  await page.goto("http://localhost:8080/Apps/Demos/LoadVectorTile/", {
    waitUntil: "domcontentloaded",
  });
  await page.waitForFunction(() => !!window._vectorTileBenchmark, {
    timeout: 45000,
  });
  if (mode === "fixture") {
    const { root } = protobuf.parse(
      'syntax="proto2"; message Tile { message Value { optional string string_value=1; } message Feature { optional uint64 id=1; repeated uint32 tags=2 [packed=true]; optional uint32 type=3; repeated uint32 geometry=4 [packed=true]; } message Layer { required uint32 version=15; required string name=1; repeated Feature features=2; repeated string keys=3; repeated Value values=4; optional uint32 extent=5; } repeated Layer layers=3; }',
    );
    const features = [];
    for (const rings of [
      [
        [
          [3200, 1000],
          [3800, 1000],
          [3800, 1800],
          [3200, 1800],
        ],
        [
          [3400, 1200],
          [3400, 1600],
          [3600, 1600],
          [3600, 1200],
        ],
      ],
      [
        [
          [2300, 1000],
          [2900, 1000],
          [2900, 1800],
        ],
      ],
    ]) {
      let x = 0;
      let y = 0;
      const geometry = [];
      for (const ring of rings) {
        for (let i = 0; i < ring.length; i++) {
          if (i === 0) {
            geometry.push(9);
          }
          if (i === 1) {
            geometry.push(((ring.length - 1) << 3) | 2);
          }
          const dx = ring[i][0] - x;
          const dy = ring[i][1] - y;
          geometry.push((dx << 1) ^ (dx >> 31), (dy << 1) ^ (dy >> 31));
          [x, y] = ring[i];
        }
        if (features.length === 0) {
          geometry.push(15);
        }
      }
      features.push({
        id: features.length + 1,
        tags: [0, features.length],
        type: features.length === 0 ? 3 : 2,
        geometry,
      });
    }
    const body = root
      .lookupType("Tile")
      .encode({
        layers: [
          {
            name: "res_org_gr",
            version: 2,
            extent: 4096,
            features,
            keys: ["org_code"],
            values: [{ stringValue: "1" }, { stringValue: "2" }],
          },
        ],
      })
      .finish();
    await page.route("**/geoservice-rvt-api/maps/res_org_gr/**", (route) =>
      route.fulfill({
        body,
        contentType: "application/vnd.mapbox-vector-tile",
      }),
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !!window._vectorTileBenchmark);
    const results = [];
    for (const ground of [true, false]) {
      await page.evaluate((ground) => {
        const manager = window._vectorTileManager;
        for (const layer of manager.getStyle().layers) {
          manager.setLayerStyle(
            layer.id,
            {
              ...layer,
              visibility: layer.id === "res_org_gr-level2-fill",
              ...(layer.id === "res_org_gr-level2-fill"
                ? {
                    useBufferPrimitive: true,
                    filter: undefined,
                    paint: {
                      "fill-color": "#3388ffff",
                      "fill-outline-color": "#000000ff",
                      "fill-outline-width": 3,
                    },
                    terrain: {
                      clampToGround: ground,
                      heightOffset: ground ? 0 : 10,
                    },
                  }
                : {}),
            },
            false,
          );
        }
        manager.clearCache();
      }, ground);
      try {
        await page.waitForFunction(
          () =>
            window._vectorTileManager.diagnostics.snapshot().gauges
              .residentBufferPolygons >= 2,
          { timeout: 20000 },
        );
      } catch (error) {
        console.log(
          JSON.stringify({
            errors,
            state: await page.evaluate(() =>
              window._vectorTileManager.diagnostics.snapshot(),
            ),
          }),
        );
        throw error;
      }
      await page.waitForTimeout(4000);
      results.push(
        await page.evaluate((ground) => {
          const C = window.Cesium;
          const picks = [];
          for (const [x, y] of [
            [3250, 1100],
            [3500, 1400],
            [2750, 1150],
          ]) {
            const longitude = ((55 + x / 4096) / 64) * 360 - 180;
            const latitude =
              (Math.atan(
                Math.sinh(Math.PI * (1 - (2 * (22 + y / 4096)) / 64)),
              ) *
                180) /
              Math.PI;
            const point = C.SceneTransforms.worldToWindowCoordinates(
              window._viewer.scene,
              C.Cartesian3.fromDegrees(longitude, latitude),
            );
            picks.push(
              window._vectorTileManager.resolvePickedFeature(
                window._viewer.scene.pick(point),
              )?.id ?? null,
            );
          }
          return {
            ground,
            picks,
            snapshot: window._vectorTileManager.diagnostics.snapshot(),
          };
        }, ground),
      );
      await page.screenshot({
        path: fileURLToPath(
          new URL(
            `./fixture-${ground ? "ground" : "elevated"}.png`,
            import.meta.url,
          ),
        ),
      });
    }
    await fs.writeFile(
      new URL("./fixture.json", import.meta.url),
      JSON.stringify({ results, errors }, null, 2),
    );
    console.log(
      JSON.stringify({
        results: results.map(({ ground, picks }) => ({ ground, picks })),
        errors,
      }),
    );
    for (const result of results) {
      assert.deepEqual(result.picks, ["1", null, "2"]);
    }
    assert.deepEqual(errors, []);
  } else if (mode !== "smoke") {
    const results = {};
    for (const ground of [true, false]) {
      results[ground ? "ground" : "elevated"] = await page.evaluate(
        async (ground) =>
          window._vectorTileBenchmark.compareBufferPolygons(
            ["res_org_gr-level2-fill"],
            "current",
            {
              clampToGround: ground,
              heightOffset: ground ? 0 : 10,
              fillColor: "#3388ff80",
              cold: true,
              timeoutMs: 30000,
              steadyMs: 1500,
              stableFrames: 5,
              minFrames: 10,
            },
          ),
        ground,
      );
    }
    await fs.writeFile(
      new URL(`./${mode}.json`, import.meta.url),
      JSON.stringify({ mode, results, errors }, null, 2),
    );
    console.log(
      JSON.stringify({
        mode,
        errors,
        comparable: Object.values(results).map((result) => result.comparable),
      }),
    );
  } else {
    await page.evaluate(() => {
      const manager = window._vectorTileManager;
      for (const layer of manager.getStyle().layers) {
        manager.setLayerStyle(
          layer.id,
          {
            ...layer,
            visibility: layer.id === "res_org_gr-level2-fill",
            ...(layer.id === "res_org_gr-level2-fill"
              ? {
                  useBufferPrimitive: true,
                  paint: {
                    ...layer.paint,
                    "fill-color": [
                      "case",
                      ["boolean", ["feature-state", "hover"], false],
                      "#ff0000ff",
                      "#3388ff80",
                    ],
                  },
                  terrain: { clampToGround: true, heightOffset: 0 },
                }
              : {}),
          },
          false,
        );
      }
      manager.clearCache();
    });
    await page.waitForTimeout(14000);
    await page.screenshot({
      path: new URL("./ground.png", import.meta.url).pathname.replace(
        /^\/(\w:)/,
        "$1",
      ),
    });
    const hover = await page.evaluate(() => {
      const manager = window._vectorTileManager;
      const feature = manager.resolvePickedFeature(
        window._viewer.scene.pick(new window.Cesium.Cartesian2(820, 300)),
      );
      const target = {
        source: feature.sourceId,
        sourceLayer: feature.sourceLayer,
        id: feature.id,
      };
      const bucketsBefore =
        manager.diagnostics.snapshot().counters.bufferPolygonBuckets;
      manager.setFeatureState(target, { hover: true });
      return { feature, bucketsBefore, state: manager.getFeatureState(target) };
    });
    await page.waitForTimeout(1000);
    await page.screenshot({
      path: new URL("./hover.png", import.meta.url).pathname.replace(
        /^\/(\w:)/,
        "$1",
      ),
    });
    hover.bucketsAfter = await page.evaluate(
      () =>
        window._vectorTileManager.diagnostics.snapshot().counters
          .bufferPolygonBuckets,
    );
    await page.evaluate(() => {
      const manager = window._vectorTileManager;
      const layer = manager
        .getStyle()
        .layers.find((layer) => layer.id === "res_org_gr-level2-fill");
      manager.setLayerStyle(layer.id, {
        ...layer,
        terrain: { clampToGround: false, heightOffset: 10 },
      });
    });
    await page.waitForTimeout(10000);
    await page.screenshot({
      path: new URL("./elevated.png", import.meta.url).pathname.replace(
        /^\/(\w:)/,
        "$1",
      ),
    });
    const elevated = await page.evaluate(() =>
      window._vectorTileManager.resolvePickedFeature(
        window._viewer.scene.pick(new window.Cesium.Cartesian2(820, 300)),
      ),
    );
    await fs.writeFile(
      new URL("./smoke.json", import.meta.url),
      JSON.stringify({ hover, elevated, errors }, null, 2),
    );
    console.log(JSON.stringify({ hover, elevated, errors }));
  }
} finally {
  await browser.close();
}
