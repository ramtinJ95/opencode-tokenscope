import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import * as v1 from "../../tokenscope.ts"
import v2 from "../tokenscope.ts"

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

// One package serves both OpenCode majors by routing each to its own module:
//
// - OpenCode V1 never uses standard package resolution. Its loader reads `exports["./server"]`
//   and then `main` (1.3.4+), or imports the package directory, which resolves `main` (older).
//   A V1 script install also has this package.json beside the copied sources and only builds
//   dist/tokenscope.js, so `main` must stay the V1 module and "./server" must stay unset.
// - OpenCode V2 resolves "<package>/server" and then "<package>" through `exports`.
test("package.json routes OpenCode V1 to main and OpenCode V2 to exports", async () => {
  const pkg = JSON.parse(await fs.readFile(path.join(pluginRoot, "package.json"), "utf8"))

  expect(pkg.main).toBe("./dist/tokenscope.js")
  expect(pkg.exports["./server"]).toBeUndefined()
  expect(pkg.exports["."].import).toBe("./dist/v2/tokenscope.js")
})

test("the V1 module only exports plugin functions", () => {
  // Legacy V1 loaders call every export of the module as a plugin function.
  expect(Object.values(v1).every((value) => typeof value === "function")).toBe(true)
  expect(v1.default).toBe(v1.TokenAnalyzerPlugin)
})

test("the V2 module default-exports a plugin definition", () => {
  expect(Object.keys(v2).sort()).toEqual(["id", "setup"])
  expect(v2.id).toBe("tokenscope")
  expect(typeof v2.setup).toBe("function")
})
