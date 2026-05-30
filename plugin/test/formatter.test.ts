import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { buildFormatterFixtureReport } from "./formatter.fixture.js"

const testDir = path.dirname(fileURLToPath(import.meta.url))

test("formats the full token report without changing layout", async () => {
  const expected = await fs.readFile(path.join(testDir, "fixtures", "formatter-full-report.txt"), "utf8")

  expect(buildFormatterFixtureReport()).toBe(expected)
})
