#!/usr/bin/env node
// Generates / verifies THIRD_PARTY_NOTICES.md.
//
//   node scripts/third-party-notices.mjs generate   write THIRD_PARTY_NOTICES.md
//   node scripts/third-party-notices.mjs check      fail if the tracked file is stale
//
// Inputs (nothing is hand-maintained):
//   JS   : the license report of a production `vite build` (build.license in vite.config.ts),
//          i.e. exactly the node_modules packages that ended up in the bundle.
//   Rust : `cargo about generate --format json` for the shipped desktop targets
//          (src-tauri/about.toml decides which licenses are acceptable).
// Plain Node, no npm dependencies. Output has no timestamps and no absolute paths.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const OUTPUT_FILE_NAME = "THIRD_PARTY_NOTICES.md";
const OUTPUT_PATH = path.join(REPO_ROOT, OUTPUT_FILE_NAME);
const VITE_BIN = path.join(REPO_ROOT, "node_modules", "vite", "bin", "vite.js");
const VITE_LICENSE_REPORT = path.join(".vite", "license.json");
const CARGO_MANIFEST = path.join(REPO_ROOT, "src-tauri", "Cargo.toml");
const NODE_MODULES = path.join(REPO_ROOT, "node_modules");
const REGENERATE_COMMAND = "npm run licenses:generate";
const MAX_NESTED_NODE_MODULES_DEPTH = 3;
const BUFFER_BYTES = 64 * 1024 * 1024;

// Extra license-like files that Vite ignores (it only reads the first match). SPDX and
// script files are not license texts.
const LICENSE_FILE_PATTERN = /^(licen[cs]e|copying|notice|patents)([-._].*)?$/i;
const LICENSE_FILE_IGNORED_EXTENSIONS = new Set([
  ".spdx",
  ".mjs",
  ".js",
  ".cjs",
  ".ts",
  ".json",
]);

// Packages that offer a choice (SPDX "OR"). We record the choice made, so the notice says
// which terms the app relies on. The other license text is still shown if the package ships it.
const CHOSEN_LICENSE = new Map([
  ["dompurify", "Apache-2.0"],
  ["@tauri-apps/api", "Apache-2.0 or MIT (either may be used)"],
]);

// EPL-2.0 source availability. A version missing here makes `check` fail, so a bump of
// elkjs forces the source offer to be reviewed instead of silently going stale.
const ELKJS_PACKAGE_NAME = "elkjs";
const ELKJS_KNOWN_TAG_COMMITS = new Map([
  ["0.9.3", "a8304cf79fde75bc2ab1a89d28320f53f8637436"],
]);
const ELKJS_REPOSITORY = "https://github.com/kieler/elkjs";
const ELKJS_TARBALL_BASE = "https://registry.npmjs.org/elkjs/-/";
const ELK_REPOSITORY = "https://github.com/eclipse-elk/elk";

// MPL-2.0 source availability (accepted per crate in src-tauri/about.toml, not globally).
// Each crate is named with its exact version and the crates.io archive of that version,
// which is the source the build used.
const MPL_LICENSE_PATTERN = /\bMPL-2\.0\b/;
const CRATES_IO_SOURCE =
  "registry+https://github.com/rust-lang/crates.io-index";
const CRATES_IO_ARCHIVE_BASE = "https://static.crates.io/crates/";

function fail(message) {
  console.error(`\n[third-party-notices] ERROR: ${message}`);
  process.exit(1);
}

function run(command, args, label) {
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: BUFFER_BYTES,
  });
  if (result.status !== 0) {
    console.error(result.stdout);
    console.error(result.stderr);
    fail(`${label} failed (exit ${result.status ?? result.signal}).`);
  }
}

// Trailing spaces at line ends carry no meaning in a license text and would trip
// `git diff --check` on the tracked notices file, so they are dropped.
function normalizeText(text) {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/^\n+/, "")
    .trimEnd();
}

// Longest backtick run + 1 (min 3) so license text can never close the fence.
function fenced(text) {
  const longestRun = Math.max(
    0,
    ...(text.match(/`+/g) ?? []).map((run) => run.length),
  );
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  return `${fence}text\n${text}\n${fence}`;
}

function compareStrings(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

// ---- JS ---------------------------------------------------------------------------

function findPackageDirectory(
  name,
  version,
  directory = NODE_MODULES,
  depth = 0,
) {
  const candidate = path.join(directory, name);
  const manifestPath = path.join(candidate, "package.json");
  if (fs.existsSync(manifestPath)) {
    if (JSON.parse(fs.readFileSync(manifestPath, "utf8")).version === version)
      return candidate;
  }
  if (depth >= MAX_NESTED_NODE_MODULES_DEPTH) return undefined;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === ".bin") continue;
    const scopeOrPackage = path.join(directory, entry.name);
    const nested = path.join(scopeOrPackage, "node_modules");
    const roots = [];
    if (fs.existsSync(nested)) roots.push(nested);
    if (entry.name.startsWith("@")) {
      for (const scoped of fs.readdirSync(scopeOrPackage, {
        withFileTypes: true,
      })) {
        const scopedNested = path.join(
          scopeOrPackage,
          scoped.name,
          "node_modules",
        );
        if (scoped.isDirectory() && fs.existsSync(scopedNested))
          roots.push(scopedNested);
      }
    }
    for (const root of roots) {
      const found = findPackageDirectory(name, version, root, depth + 1);
      if (found) return found;
    }
  }
  return undefined;
}

function readLicenseFiles(packageDirectory) {
  return fs
    .readdirSync(packageDirectory, { withFileTypes: true })
    .filter(
      (file) =>
        file.isFile() &&
        LICENSE_FILE_PATTERN.test(file.name) &&
        !LICENSE_FILE_IGNORED_EXTENSIONS.has(
          path.extname(file.name).toLowerCase(),
        ),
    )
    .map((file) => file.name)
    .sort(compareStrings)
    .map((fileName) => ({
      fileName,
      text: normalizeText(
        fs.readFileSync(path.join(packageDirectory, fileName), "utf8"),
      ),
    }));
}

function collectJsPackages() {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "dawn-licenses-"));
  try {
    run(
      process.execPath,
      [VITE_BIN, "build", "--outDir", outDir, "--emptyOutDir"],
      "production vite build",
    );
    const reportPath = path.join(outDir, VITE_LICENSE_REPORT);
    if (!fs.existsSync(reportPath))
      fail(`vite did not emit ${VITE_LICENSE_REPORT}.`);
    const entries = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    return entries
      .map((entry) => {
        const directory = findPackageDirectory(entry.name, entry.version);
        const files = directory ? readLicenseFiles(directory) : [];
        const viteText = entry.text ? normalizeText(entry.text) : undefined;
        // Vite's own text is the fallback when the package cannot be located again.
        if (files.length === 0 && viteText)
          files.push({ fileName: "(from vite)", text: viteText });
        return {
          name: entry.name,
          version: entry.version,
          identifier: entry.identifier,
          files,
        };
      })
      .sort((left, right) =>
        compareStrings(
          `${left.name}@${left.version}`,
          `${right.name}@${right.version}`,
        ),
      );
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}

// ---- Rust -------------------------------------------------------------------------

function collectRustLicenses() {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "dawn-cargo-about-"));
  try {
    const outFile = path.join(outDir, "about.json");
    run(
      "cargo",
      [
        "about",
        "generate",
        "--manifest-path",
        CARGO_MANIFEST,
        "--locked",
        "--fail",
        "--format",
        "json",
        "--output-file",
        outFile,
      ],
      "cargo about generate",
    );
    const report = JSON.parse(fs.readFileSync(outFile, "utf8"));
    const mplCrates = collectMplCrates(report.licenses);
    const groups = report.licenses.map((license) => ({
      id: license.id,
      name: license.name,
      text: normalizeText(license.text),
      crates: [
        ...new Set(
          license.used_by.map(
            (usage) => `${usage.crate.name} ${usage.crate.version}`,
          ),
        ),
      ].sort(compareStrings),
    }));
    groups.sort(
      (left, right) =>
        compareStrings(left.id, right.id) ||
        compareStrings(left.text, right.text) ||
        compareStrings(left.crates[0], right.crates[0]),
    );
    return { groups, mplCrates };
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}

// Crates under MPL-2.0 with where their exact source can be obtained. Only crates.io
// crates are expected; any other source fails, so a git or path dependency under MPL-2.0
// cannot ship without a reviewed source offer.
function collectMplCrates(licenses) {
  const crates = new Map();
  for (const license of licenses) {
    if (!MPL_LICENSE_PATTERN.test(license.id)) continue;
    for (const { crate } of license.used_by) {
      if (crate.source !== CRATES_IO_SOURCE) {
        fail(
          `${crate.name} ${crate.version}: MPL-2.0 crate not from crates.io (${crate.source}). Review its source offer.`,
        );
      }
      crates.set(`${crate.name} ${crate.version}`, {
        name: crate.name,
        version: crate.version,
        repository: crate.repository ?? null,
      });
    }
  }
  return [...crates.values()].sort(
    (left, right) =>
      compareStrings(left.name, right.name) ||
      compareStrings(left.version, right.version),
  );
}

// ---- Rendering --------------------------------------------------------------------

function renderElkjsNotice(elkjs) {
  const commit = ELKJS_KNOWN_TAG_COMMITS.get(elkjs.version);
  return `## Source availability for EPL-2.0 code

\`${elkjs.name}\` ${elkjs.version} (the Eclipse Layout Kernel compiled to JavaScript, used by Mermaid) is licensed under the Eclipse Public License 2.0 (EPL-2.0). The full license text is included in the JavaScript section below.

It is included **unmodified**. Its source code is available from:

- ${ELKJS_REPOSITORY} (tag \`${elkjs.version}\`, commit \`${commit}\`)
- ${ELKJS_TARBALL_BASE}${elkjs.name}-${elkjs.version}.tgz (the exact package that is bundled)
- Eclipse Layout Kernel, the origin of the compiled code: ${ELK_REPOSITORY}`;
}

function renderMplNotice(mplCrates) {
  const items = mplCrates.map((crate) => {
    const archive = `${CRATES_IO_ARCHIVE_BASE}${crate.name}/${crate.name}-${crate.version}.crate`;
    const repository = crate.repository
      ? `; repository: ${crate.repository}`
      : "";
    return `- \`${crate.name}\` ${crate.version}: ${archive}${repository}`;
  });
  return `## Source availability for MPL-2.0 code

The following Rust crates are licensed under the Mozilla Public License 2.0 (MPL-2.0). They are used **unmodified**; the full license text is included in the Rust section below. The source code of each exact version is available from crates.io:

${items.join("\n")}`;
}

function renderJs(packages) {
  const sections = packages.map((pkg) => {
    const lines = [`### ${pkg.name}@${pkg.version}`, ""];
    const identifier =
      pkg.identifier ??
      "no SPDX identifier in package.json; license file below";
    const chosen = CHOSEN_LICENSE.get(pkg.name);
    lines.push(
      `License: ${identifier}${chosen ? `; used under ${chosen}` : ""}`,
    );
    for (const file of pkg.files) {
      lines.push("", `\`${file.fileName}\``, "", fenced(file.text));
    }
    return lines.join("\n");
  });
  return sections.join("\n\n");
}

function renderRust(groups) {
  const crateCount = new Set(groups.flatMap((group) => group.crates)).size;
  const sections = groups.map((group) => {
    const crates = group.crates.map((crate) => `- ${crate}`).join("\n");
    return `### ${group.name} (${group.id})\n\nUsed by:\n\n${crates}\n\n${fenced(group.text)}`;
  });
  return { crateCount, text: sections.join("\n\n") };
}

function renderDocument(jsPackages, { groups: rustGroups, mplCrates }) {
  const rust = renderRust(rustGroups);
  const elkjs = jsPackages.find((pkg) => pkg.name === ELKJS_PACKAGE_NAME);
  const parts = [
    `# Third-Party Notices

Design Dawn includes third-party software. This file lists it together with the license texts and copyright notices that accompany it.

**Do not edit this file by hand.** It is generated from what is actually shipped and verified by an automated check:

- JavaScript: the packages that ended up in the production bundle (Vite \`build.license\`). Development-only tools (build, test, lint) are not bundled and not listed. Where a package ships several license files they are all shown.
- Rust: the non-development crates of \`src-tauri\` for the shipped desktop targets (Linux, Windows, macOS) according to \`cargo-about\`. Compile-time-only crates that \`cargo-about\` cannot tell apart from runtime crates (for example proc-macro dependencies) may be listed as well.
- Regenerate with \`${REGENERATE_COMMAND}\`; \`npm run licenses:check\` fails when this file is stale.

Contents: ${jsPackages.length} JavaScript packages, ${rust.crateCount} Rust crates.`,
  ];
  if (elkjs) parts.push(renderElkjsNotice(elkjs));
  if (mplCrates.length > 0) parts.push(renderMplNotice(mplCrates));
  parts.push(`## JavaScript packages\n\n${renderJs(jsPackages)}`);
  parts.push(`## Rust crates\n\n${rust.text}`);
  return `${parts.join("\n\n")}\n`;
}

// ---- Validation -------------------------------------------------------------------

function validateJs(jsPackages) {
  const errors = [];
  const warnings = [];
  for (const pkg of jsPackages) {
    const label = `${pkg.name}@${pkg.version}`;
    if (!pkg.identifier && pkg.files.length === 0) {
      errors.push(`${label}: no license identifier and no license text`);
    } else if (!pkg.identifier) {
      warnings.push(
        `${label}: no SPDX identifier in package.json (license text is present)`,
      );
    } else if (pkg.files.length === 0) {
      warnings.push(
        `${label}: ${pkg.identifier} but no license text found in the package`,
      );
    }
  }
  const elkjs = jsPackages.find((pkg) => pkg.name === ELKJS_PACKAGE_NAME);
  if (elkjs && !ELKJS_KNOWN_TAG_COMMITS.has(elkjs.version)) {
    errors.push(
      `${ELKJS_PACKAGE_NAME}@${elkjs.version}: unknown version. Verify the EPL-2.0 source offer and add the tag commit to ELKJS_KNOWN_TAG_COMMITS in this script.`,
    );
  }
  return { errors, warnings };
}

// ---- Main -------------------------------------------------------------------------

const mode = process.argv[2];
if (mode !== "generate" && mode !== "check") {
  fail(`usage: node scripts/third-party-notices.mjs <generate|check>`);
}

const jsPackages = collectJsPackages();
const { errors, warnings } = validateJs(jsPackages);
for (const warning of warnings)
  console.warn(`[third-party-notices] warning: ${warning}`);
if (errors.length > 0)
  fail(`unresolved license information:\n  - ${errors.join("\n  - ")}`);

const document = renderDocument(jsPackages, collectRustLicenses());

if (mode === "generate") {
  fs.writeFileSync(OUTPUT_PATH, document);
  console.log(
    `[third-party-notices] wrote ${OUTPUT_FILE_NAME} (${document.length} bytes)`,
  );
} else {
  const tracked = fs.existsSync(OUTPUT_PATH)
    ? fs.readFileSync(OUTPUT_PATH, "utf8")
    : undefined;
  if (tracked !== document) {
    fail(
      `${OUTPUT_FILE_NAME} is ${tracked === undefined ? "missing" : "out of date"}. Run \`${REGENERATE_COMMAND}\` and commit the result.`,
    );
  }
  console.log(`[third-party-notices] ${OUTPUT_FILE_NAME} is up to date`);
}
