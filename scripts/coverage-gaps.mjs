// Lists what the tests do not reach in the given files: every statement, branch arm and
// function never run, by line, from the last `npm run coverage` (coverage/coverage-final.json).
// Usage: node scripts/coverage-gaps.mjs src/domain/sheet/sheet.ts [more files...]
// With `--summary <folder>`: the files under it with something not reached, most first.

import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

const REPORT = "coverage/coverage-final.json";
const SUMMARY_FLAG = "--summary";
const report = JSON.parse(readFileSync(REPORT, "utf8"));
const entries = Object.entries(report).map(([file, data]) => [
  relative(process.cwd(), file).replaceAll("\\", "/"),
  data,
]);

function missedLines(data) {
  const lines = new Set();
  for (const [key, count] of Object.entries(data.s)) {
    if (count === 0) lines.add(data.statementMap[key].start.line);
  }
  for (const [key, counts] of Object.entries(data.b)) {
    const map = data.branchMap[key];
    counts.forEach((count, arm) => {
      if (count !== 0) return;
      const location = map.locations[arm];
      lines.add(location?.start?.line ?? map.loc.start.line);
    });
  }
  for (const [key, count] of Object.entries(data.f)) {
    if (count === 0) lines.add(data.fnMap[key].loc.start.line);
  }
  return [...lines].sort((left, right) => left - right);
}

const args = process.argv.slice(2);
if (args[0] === SUMMARY_FLAG) {
  const folder = args[1] ?? "src";
  const rows = entries
    .filter(([file]) => file.startsWith(folder))
    .map(([file, data]) => [file, missedLines(data).length])
    .filter(([, missed]) => missed > 0)
    .sort((left, right) => right[1] - left[1]);
  for (const [file, missed] of rows) console.log(`${missed}\t${file}`);
} else {
  for (const target of args) {
    const wanted = relative(process.cwd(), resolve(target)).replaceAll(
      "\\",
      "/",
    );
    const found = entries.find(([file]) => file === wanted);
    if (found === undefined) {
      console.log(`== ${wanted}: not in the report`);
      continue;
    }
    const source = readFileSync(wanted, "utf8").split("\n");
    console.log(`== ${wanted}`);
    for (const line of missedLines(found[1])) {
      console.log(`${String(line).padStart(5)}: ${source[line - 1]?.trim()}`);
    }
  }
}
