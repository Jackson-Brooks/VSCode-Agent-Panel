const esbuild = require("esbuild");

const args = process.argv.slice(2);
const minify = args.includes("--minify");
const watch = args.includes("--watch");

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    format: "cjs",
    minify: minify,
    sourcemap: !minify,
    sourcesContent: false,
    platform: "node",
    outfile: "dist/extension.js",
    external: ["vscode"],
    logLevel: "info",
  });

  if (watch) {
    await ctx.watch();
    console.log("esbuild: watching...");
  } else {
    await ctx.rebuild();
    await ctx.dispose();
    console.log("esbuild: built successfully");
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
