import { build } from "esbuild";
import { cp, mkdir } from "node:fs/promises";
await mkdir("dist/vendor", { recursive: true });
await build({
  entryPoints: ["scripts/vendor.mjs"],
  bundle: true,
  format: "esm",
  minify: true,
  outfile: "dist/vendor/engine.js",
});
await cp("node_modules/@sparkjsdev/spark/dist/assets", "dist/vendor/assets", {
  recursive: true,
});
await build({ entryPoints: ["scripts/cloud-worker.mjs"], bundle: true, format: "esm", minify: true, outfile: "dist/vendor/cloud-worker.js" });
console.log("Static site ready: dist/");
