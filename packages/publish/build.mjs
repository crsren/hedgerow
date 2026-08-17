import { build } from "tsup";

const shared = {
  format: ["esm"],
  dts: true,
  splitting: false,
  sourcemap: true,
  target: "node20",
};

// Build sequentially. Keeping site in its own declaration build prevents
// tsup from factoring browser-safe types into a private hashed chunk, while
// sequencing avoids concurrent clean/write races in dist/.
await build({
  ...shared,
  entry: ["src/index.ts", "src/node.ts"],
  clean: true,
});
await build({
  ...shared,
  entry: ["src/site.ts"],
  clean: false,
});
