#!/usr/bin/env node
// Run the git-write hook against scripts/test-cases.txt and report pass/fail.
//
//     node scripts/run-tests.js
//
// (A Python twin lives at scripts/run-tests.py — either works, use whichever runs.)
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const hook = path.join(root, "scripts", "block-git-writes.py");
const cases = fs
  .readFileSync(path.join(root, "scripts", "test-cases.txt"), "utf8")
  .trim()
  .split("\n");

let failures = 0;
for (const line of cases) {
  const idx = line.indexOf("\t");
  const expected = line.slice(0, idx);
  const command = line.slice(idx + 1);
  const payload = JSON.stringify({ tool_name: "Bash", tool_input: { command } });
  const proc = spawnSync("/usr/bin/python3", [hook], { input: payload, encoding: "utf8" });
  const actual = proc.status === 2 ? "BLOCK" : "ALLOW";
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${actual.padEnd(5)}  ${command}`);
}

console.log(`\n${cases.length - failures}/${cases.length} passed`);
process.exit(failures ? 1 : 0);
