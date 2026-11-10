// Compiles the TUI part (v2/tui.tsx) to dist/v2/tui.js.
//
// OpenCode's runtime Solid transform skips every file under node_modules, so a published package
// cannot ship its TUI part as TSX: Bun would fall back to React JSX and fail to load it. The JSX
// is therefore compiled here with OpenTUI's own transform. Packages stay external; the host
// rewrites them to its own instances when it loads the file.
//
// This is a separate step from `npm run build` on purpose: the OpenCode V1 script installer runs
// `npm run build` on a machine that has neither Bun nor the V2 sources.

import solidTransformPlugin from "@opentui/solid/bun-plugin"

const result = await Bun.build({
  entrypoints: ["v2/tui.tsx"],
  outdir: "dist/v2",
  target: "bun",
  format: "esm",
  packages: "external",
  plugins: [solidTransformPlugin],
})

for (const log of result.logs) console.error(log)
if (!result.success) process.exit(1)

// Without the Solid transform Bun compiles JSX for React, which the host cannot load.
const output = await result.outputs[0].text()
if (/from\s+["']react/.test(output)) {
  console.error("dist/v2/tui.js imports React: the Solid transform was not applied to v2/tui.tsx")
  process.exit(1)
}
