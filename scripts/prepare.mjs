// Runs before dev and build. Both outputs land in public/ and are gitignored.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// 1. Self-host the loudness worklet so script-src can be 'self' only. The package exports
//    only its main entry, so the file cannot be imported as an asset.
fs.copyFileSync("node_modules/loudness-worklet/packages/lib/dist/loudness.worklet.js", "public/loudness.worklet.js");

// 2. The bundle contains other people's MIT code, and their licences ask that the notice
//    travels with every copy. Collect the licence text of every production package into one
//    file that ships with the site, so it stays right when a dependency changes.
const dirs = execFileSync("npm", ["ls", "--omit=dev", "--all", "--parseable"], { encoding: "utf8" }).trim().split("\n").slice(1);
const sections = dirs.sort().map((dir) => {
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  const file = fs.readdirSync(dir).find((name) => /^(licen[cs]e|copying)/i.test(name));
  let text = file && fs.readFileSync(path.join(dir, file), "utf8");
  if (!text) {
    // fft.js keeps its licence in the README, under a "LICENSE" heading.
    const readme = fs.readFileSync(path.join(dir, "README.md"), "utf8");
    const at = readme.search(/^#+ *licen[cs]e/im);
    if (at < 0) throw new Error(`No licence text found for ${pkg.name}`);
    text = readme.slice(at);
  }
  const home = typeof pkg.repository === "string" ? pkg.repository : (pkg.repository?.url ?? pkg.homepage ?? "");
  return `${pkg.name} ${pkg.version} (${pkg.license})\n${home.replace(/^git\+/, "").replace(/^ssh:\/\/git@/, "https://").replace(/\.git$/, "")}\n\n${text.trim()}\n`;
});
const header =
  "audiocheck is built on the open-source packages below. Each one's code is part of this site's\n" +
  "bundle and is used under its own licence, reproduced here in full.\n";
fs.writeFileSync("public/THIRD_PARTY_LICENSES.txt", [header, ...sections].join(`\n${"-".repeat(78)}\n\n`));
