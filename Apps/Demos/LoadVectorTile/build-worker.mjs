import { build, context } from "esbuild";
import { argv } from "node:process";
import { fileURLToPath, URL } from "node:url";

// Worker 不继承页面 import map；将源码及裸模块依赖一起打包。
// MVT 解码器原有的 CDN 模块继续由浏览器加载。
const options = {
  entryPoints: [
    fileURLToPath(
      new URL("./src/createDecodeVectorTileTask.js", import.meta.url),
    ),
  ],
  outfile: fileURLToPath(
    new URL(
      "../../../Build/LoadVectorTile/createDecodeVectorTileTask.js",
      import.meta.url,
    ),
  ),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  external: ["https://*"],
  sourcemap: true,
  logLevel: "info",
  legalComments: "eof",
};

if (argv.includes("--watch")) {
  const workerBuild = await context(options);
  await workerBuild.watch();
} else {
  await build(options);
}
