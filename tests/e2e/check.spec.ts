// Runs every generated fixture (npm run fixtures) through the built page and checks the
// verdicts, the loudness against ffmpeg's own meter, that nothing leaves the origin, and axe.
import { expect, test } from "@playwright/test";
import fs from "node:fs";

const DIR = "tests/fixtures";
const AXE = fs.readFileSync("node_modules/axe-core/axe.min.js", "utf8");

type Row = Record<"format" | "verdict" | "cutoff" | "lufs" | "truepeak" | "range" | "clipped" | "integrity", string>;
const number = (text: string) => Number(text.replace("−", "-").replaceAll(",", ""));

test("every fixture gets its expected verdict", async ({ page, baseURL }) => {
  test.setTimeout(180_000);
  const expected: Record<string, { lufs: number; truePeak: number }> = JSON.parse(fs.readFileSync(`${DIR}/expected.json`, "utf8"));
  const files = fs.readdirSync(DIR).filter((name) => !name.endsWith(".json"));

  const foreign: string[] = [];
  const errors: string[] = [];
  page.on("request", (request) => {
    if (!request.url().startsWith(baseURL!)) foreign.push(request.url());
  });
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
  await page.locator("#files").setInputFiles(files.map((name) => `${DIR}/${name}`));
  // The exact text also proves the decoder self-test passed: a failure adds a sentence.
  await expect(page.locator("#status")).toHaveText(`Checked ${files.length} files.`, { timeout: 150_000 });

  const rows: Record<string, Row> = await page.locator("#rows tr").evaluateAll((trs) =>
    Object.fromEntries(
      trs.map((tr) => [
        (tr as HTMLElement).dataset.file,
        Object.fromEntries([...tr.querySelectorAll("td")].map((td) => [td.dataset.col, td.textContent])),
      ]),
    ),
  );
  const row = (name: string) => rows[name] ?? ({} as Row);
  const findings = async (name: string) => {
    await page.getByRole("button", { name, exact: true }).click();
    return page.locator("#reading-findings").innerText();
  };

  // Genuine lossless, three sample rates.
  for (const name of ["genuine-44.flac", "genuine-48.flac", "genuine-96-24.flac"]) {
    expect.soft(row(name), name).toMatchObject({ verdict: "✓No problems found", cutoff: "none", integrity: "Checksum matches" });
  }
  expect.soft(await findings("genuine-96-24.flac")).toContain("Uses all 24 bits");

  // Lossy encodes dressed up as FLAC. LAME cuts 128 kbps at 17 kHz and 320 kbps at 20.5 kHz.
  expect.soft(row("mp3-128.flac").verdict).toContain("Suspicious source");
  expect.soft(Math.abs(number(row("mp3-128.flac").cutoff) - 17)).toBeLessThanOrEqual(1);
  expect.soft(row("mp3-320.flac").verdict).toContain("Possibly lossy");
  expect.soft(Math.abs(number(row("mp3-320.flac").cutoff) - 20.5)).toBeLessThanOrEqual(0.7);
  // An honest MP3 is not a problem.
  expect.soft(row("mp3-128.mp3")).toMatchObject({ verdict: "✓No problems found", integrity: "Decodes" });
  expect.soft(row("mp3-128.mp3").format).toMatch(/^MP3, 44\.1 kHz, 128 kbps$/);

  // Fake hi-res.
  expect.soft(row("upsampled-44-96.flac").verdict).toContain("Fake hi-res");
  expect.soft(await findings("upsampled-44-96.flac")).toContain("44.1 kHz source");
  expect.soft(row("upsampled-48-96.flac").verdict).toContain("Fake hi-res");
  expect.soft(await findings("upsampled-48-96.flac")).toContain("48 kHz source");
  expect.soft(row("padded-24.flac").verdict).toContain("Fake hi-res");
  expect.soft(await findings("padded-24.flac")).toContain("24-bit file holding 16-bit audio");

  // Clipping.
  expect.soft(row("clipped.wav").verdict).toContain("Clipping");
  expect.soft(number(row("clipped.wav").clipped)).toBeGreaterThan(1000);

  // Damage.
  expect.soft(row("truncated.flac").integrity).toBe("Damaged");
  expect.soft(await findings("truncated.flac")).toContain("Cut short");
  expect.soft(row("bitflip.flac").integrity).toBe("Damaged");
  expect.soft(await findings("bitflip.flac")).toContain("does not match the checksum");
  expect.soft(row("no-md5.flac")).toMatchObject({ verdict: "✓No problems found", integrity: "Decodes" });

  // Loudness: the EBU reference tone, then every file against ffmpeg's ebur128 filter.
  // EBU Tech 3341 allows +-0.1 LU. The meter reads -23.06, which the table shows as -23.1.
  expect.soft(["−23.0", "−23.1"]).toContain(row("tone-23.flac").lufs);
  for (const [name, reference] of Object.entries(expected)) {
    expect.soft(Math.abs(number(row(name).lufs) - reference.lufs), `${name} loudness`).toBeLessThanOrEqual(0.15);
    expect.soft(Math.abs(number(row(name).truepeak) - reference.truePeak), `${name} true peak`).toBeLessThanOrEqual(0.5);
  }

  // Held out: these two were not used to set any threshold.
  expect.soft(row("mp3-192.flac").verdict, "held-out 192 kbps").toContain("Suspicious source");
  // Known limit, kept visible: LAME's V0 preset applies no low-pass, so there is no edge to
  // find and this transcode passes. If detection ever improves, this line should change.
  expect.soft(row("mp3-v0.flac").verdict, "held-out VBR V0").toBe("✓No problems found");

  expect.soft(foreign, "requests to other origins").toEqual([]);
  expect.soft(errors, "console errors").toEqual([]);

  // Accessibility: WCAG 2.1 A and AA over the page with results in it.
  await page.evaluate(AXE);
  const violations = await page.evaluate(async () => {
    const { axe } = window as unknown as { axe: { run(context: Document, options: object): Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } };
    const result = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
    return result.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`);
  });
  expect.soft(violations, "axe violations").toEqual([]);

  console.table(rows);
  if (process.env.SCREENSHOTS) {
    // Reduced motion, so the picture is not caught halfway through its reveal.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByRole("button", { name: "mp3-128.flac", exact: true }).click();
    await page.screenshot({ path: "docs/screenshots/results.png", fullPage: true });
  }
});
