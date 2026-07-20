/**
 * Unit tests for VectorTileLodSelectionUtils.js
 *
 * Run with:
 *   node Apps/Demos/LoadVectorTile/src_test/VectorTileLodSelection.test.js
 */
import assert from "node:assert/strict";
import VectorTileLodSelectionUtils from "../src/VectorTileLodSelectionUtils.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tile(x, y, level, coverageComplete = true) {
  return { x, y, level, coverageComplete };
}

function keys(tiles) {
  return new Set(
    tiles.map((t) => VectorTileLodSelectionUtils.tileKey(t.x, t.y, t.level)),
  );
}

function assertSameKeys(actual, expectedTiles, label) {
  const actualKeys = keys(actual);
  const expectedKeys = keys(expectedTiles);
  assert.deepEqual(
    [...actualKeys].sort(),
    [...expectedKeys].sort(),
    `${label}: expected [${[...expectedKeys].join(", ")}] but got [${[...actualKeys].join(", ")}]`,
  );
}

// ---------------------------------------------------------------------------
// tileKey
// ---------------------------------------------------------------------------

{
  const t = tile(3, 7, 10);
  assert.equal(
    VectorTileLodSelectionUtils.tileKey(t.x, t.y, t.level),
    "10/3/7",
  );
  assert.notEqual(
    VectorTileLodSelectionUtils.tileKey(0, 1, 2),
    VectorTileLodSelectionUtils.tileKey(1, 0, 2),
  );
  assert.notEqual(
    VectorTileLodSelectionUtils.tileKey(0, 0, 1),
    VectorTileLodSelectionUtils.tileKey(0, 0, 2),
  );
  console.log("✓ tileKey");
}

// ---------------------------------------------------------------------------
// getDirectChildCoords
// ---------------------------------------------------------------------------

{
  const children = VectorTileLodSelectionUtils.getDirectChildCoords(1, 2, 5);
  assert.equal(children.length, 4);
  assert.equal(children[0].level, 6);
  const expected = [
    { x: 2, y: 4, level: 6 },
    { x: 3, y: 4, level: 6 },
    { x: 2, y: 5, level: 6 },
    { x: 3, y: 5, level: 6 },
  ];
  assert.deepEqual(children, expected);
  console.log("✓ getDirectChildCoords");
}

// ---------------------------------------------------------------------------
// isAncestorOrSame
// ---------------------------------------------------------------------------

{
  const parent = tile(0, 0, 8);
  const child = tile(1, 0, 9);
  const sibling = tile(1, 1, 8);
  const unrelated = tile(2, 0, 9);
  assert.ok(
    VectorTileLodSelectionUtils.isAncestorOrSame(parent, parent),
    "same tile",
  );
  assert.ok(
    VectorTileLodSelectionUtils.isAncestorOrSame(parent, child),
    "direct child",
  );
  assert.ok(
    !VectorTileLodSelectionUtils.isAncestorOrSame(parent, sibling),
    "sibling at same level",
  );
  assert.ok(
    !VectorTileLodSelectionUtils.isAncestorOrSame(parent, unrelated),
    "unrelated child",
  );
  assert.ok(
    !VectorTileLodSelectionUtils.isAncestorOrSame(child, parent),
    "child is not ancestor of parent",
  );
  console.log("✓ isAncestorOrSame");
}

// ---------------------------------------------------------------------------
// isRegionFullyCovered
// ---------------------------------------------------------------------------

{
  // Direct hit
  const map = new Map([
    [VectorTileLodSelectionUtils.tileKey(0, 0, 8), tile(0, 0, 8)],
  ]);
  assert.ok(
    VectorTileLodSelectionUtils.isRegionFullyCovered(
      { x: 0, y: 0, level: 8 },
      map,
    ),
  );
  assert.ok(
    !VectorTileLodSelectionUtils.isRegionFullyCovered(
      { x: 1, y: 0, level: 8 },
      map,
    ),
  );

  // Not covered by incomplete tile
  const notReady = tile(0, 0, 8, false);
  const map2 = new Map([
    [VectorTileLodSelectionUtils.tileKey(0, 0, 8), notReady],
  ]);
  assert.ok(
    !VectorTileLodSelectionUtils.isRegionFullyCovered(
      { x: 0, y: 0, level: 8 },
      map2,
    ),
  );

  // Covered by children
  const childMap = new Map([
    [VectorTileLodSelectionUtils.tileKey(0, 0, 9), tile(0, 0, 9)],
    [VectorTileLodSelectionUtils.tileKey(1, 0, 9), tile(1, 0, 9)],
    [VectorTileLodSelectionUtils.tileKey(0, 1, 9), tile(0, 1, 9)],
    [VectorTileLodSelectionUtils.tileKey(1, 1, 9), tile(1, 1, 9)],
  ]);
  assert.ok(
    VectorTileLodSelectionUtils.isRegionFullyCovered(
      { x: 0, y: 0, level: 8 },
      childMap,
    ),
  );

  // Only 3 children present – not covered
  const partial = new Map([
    [VectorTileLodSelectionUtils.tileKey(0, 0, 9), tile(0, 0, 9)],
    [VectorTileLodSelectionUtils.tileKey(1, 0, 9), tile(1, 0, 9)],
    [VectorTileLodSelectionUtils.tileKey(0, 1, 9), tile(0, 1, 9)],
    // missing (1,1,9)
  ]);
  assert.ok(
    !VectorTileLodSelectionUtils.isRegionFullyCovered(
      { x: 0, y: 0, level: 8 },
      partial,
    ),
  );

  // Covered by grandchildren (2 levels deep)
  const grandMap = new Map();
  for (const c of VectorTileLodSelectionUtils.getDirectChildCoords(0, 0, 8)) {
    for (const gc of VectorTileLodSelectionUtils.getDirectChildCoords(
      c.x,
      c.y,
      c.level,
    )) {
      grandMap.set(
        VectorTileLodSelectionUtils.tileKey(gc.x, gc.y, gc.level),
        tile(gc.x, gc.y, gc.level),
      );
    }
  }
  assert.ok(
    VectorTileLodSelectionUtils.isRegionFullyCovered(
      { x: 0, y: 0, level: 8 },
      grandMap,
    ),
  );

  // Depth limit prevents runaway recursion
  assert.ok(
    !VectorTileLodSelectionUtils.isRegionFullyCovered(
      { x: 0, y: 0, level: 8 },
      grandMap,
      1 /* maxDepth */,
    ),
    "depth 1 cannot reach grandchildren",
  );

  // READY_EMPTY tile (coverageComplete = true) counts as covered
  const emptyMap = new Map([
    [VectorTileLodSelectionUtils.tileKey(0, 0, 9), tile(0, 0, 9, true)], // coverageComplete even with no primitives
    [VectorTileLodSelectionUtils.tileKey(1, 0, 9), tile(1, 0, 9)],
    [VectorTileLodSelectionUtils.tileKey(0, 1, 9), tile(0, 1, 9)],
    [VectorTileLodSelectionUtils.tileKey(1, 1, 9), tile(1, 1, 9)],
  ]);
  assert.ok(
    VectorTileLodSelectionUtils.isRegionFullyCovered(
      { x: 0, y: 0, level: 8 },
      emptyMap,
    ),
  );

  console.log("✓ isRegionFullyCovered");
}

// ---------------------------------------------------------------------------
// selectByCoverage
// ---------------------------------------------------------------------------

{
  // --- Single tile, no parent/children in set ---
  const solo = tile(0, 0, 8);
  assertSameKeys(
    VectorTileLodSelectionUtils.selectByCoverage([solo]),
    [solo],
    "single tile",
  );
}

{
  // --- All 4 children ready → children replace parent ---
  const parent = tile(0, 0, 8);
  const c0 = tile(0, 0, 9);
  const c1 = tile(1, 0, 9);
  const c2 = tile(0, 1, 9);
  const c3 = tile(1, 1, 9);
  const result = VectorTileLodSelectionUtils.selectByCoverage([
    parent,
    c0,
    c1,
    c2,
    c3,
  ]);
  assertSameKeys(result, [c0, c1, c2, c3], "all 4 children replace parent");
  assert.ok(!result.includes(parent), "parent must not be in result");
}

{
  // --- Only 3 children ready → parent retained ---
  const parent = tile(0, 0, 8);
  const c0 = tile(0, 0, 9);
  const c1 = tile(1, 0, 9);
  const c2 = tile(0, 1, 9);
  // c3 missing
  const result = VectorTileLodSelectionUtils.selectByCoverage([
    parent,
    c0,
    c1,
    c2,
  ]);
  assertSameKeys(result, [parent], "parent retained when 1 sibling missing");
}

{
  // --- READY_EMPTY sibling counts toward coverage ---
  const parent = tile(0, 0, 8);
  const c0 = tile(0, 0, 9, true); // READY_EMPTY – coverageComplete but no primitives
  const c1 = tile(1, 0, 9);
  const c2 = tile(0, 1, 9);
  const c3 = tile(1, 1, 9);
  const result = VectorTileLodSelectionUtils.selectByCoverage([
    parent,
    c0,
    c1,
    c2,
    c3,
  ]);
  assertSameKeys(
    result,
    [c0, c1, c2, c3],
    "READY_EMPTY sibling completes coverage",
  );
  assert.ok(
    !result.includes(parent),
    "parent suppressed by READY_EMPTY sibling",
  );
}

{
  // --- coverageComplete === false tiles are ignored ---
  const parent = tile(0, 0, 8);
  const notReady = tile(0, 0, 9, false);
  const c1 = tile(1, 0, 9);
  const c2 = tile(0, 1, 9);
  const c3 = tile(1, 1, 9);
  const result = VectorTileLodSelectionUtils.selectByCoverage([
    parent,
    notReady,
    c1,
    c2,
    c3,
  ]);
  assertSameKeys(result, [parent], "pending sibling does not satisfy coverage");
}

{
  // --- Recursive: grandchildren replace children which replace parent ---
  const parent = tile(0, 0, 8);
  // All 4 grandchildren of each child are present; children themselves are absent
  const grandchildren = [];
  for (const child of VectorTileLodSelectionUtils.getDirectChildCoords(
    0,
    0,
    8,
  )) {
    for (const gc of VectorTileLodSelectionUtils.getDirectChildCoords(
      child.x,
      child.y,
      child.level,
    )) {
      grandchildren.push(tile(gc.x, gc.y, gc.level));
    }
  }
  const result = VectorTileLodSelectionUtils.selectByCoverage([
    parent,
    ...grandchildren,
  ]);
  assertSameKeys(
    result,
    grandchildren,
    "grandchildren recursively replace parent",
  );
}

{
  // --- Sibling tiles (no parent in set) → all selected ---
  const c0 = tile(0, 0, 9);
  const c1 = tile(1, 0, 9);
  const c2 = tile(0, 1, 9);
  const c3 = tile(1, 1, 9);
  const result = VectorTileLodSelectionUtils.selectByCoverage([c0, c1, c2, c3]);
  assertSameKeys(
    result,
    [c0, c1, c2, c3],
    "siblings without parent all selected",
  );
}

{
  // --- Ancestor fallback: ancestor suppresses partially-ready children ---
  const ancestor = tile(0, 0, 7);
  const c0 = tile(0, 0, 9);
  const c1 = tile(1, 0, 9);
  // Siblings c2 and c3 at level 9 are missing; ancestor covers the full region
  const result = VectorTileLodSelectionUtils.selectByCoverage([
    ancestor,
    c0,
    c1,
  ]);
  assertSameKeys(result, [ancestor], "ancestor wins when siblings incomplete");
}

console.log("✓ selectByCoverage");

// ---------------------------------------------------------------------------
console.log("\nAll tests passed.");
