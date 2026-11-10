import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
await rm("dist", { recursive: true, force: true });
await mkdir("dist");
await cp("public", "dist", { recursive: true });
for (const name of ["background", "content", "ui"])
  await build({
    entryPoints: [`src/${name}.ts`],
    bundle: true,
    outfile: `dist/${name}.js`,
    format: "iife",
    target: "chrome120",
    minify: true,
    sourcemap: true,
  });
