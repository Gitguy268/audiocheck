// Generates the test audio in tests/fixtures (gitignored) with ffmpeg. No real music: seeded
// pink noise and sine tones only. Also writes expected.json with ffmpeg's own loudness and
// true-peak readings, which the end-to-end test compares the app against.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";

const DIR = "tests/fixtures";
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

function ffmpeg(...args) {
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: ["ignore", "inherit", "inherit"] });
}

const SECONDS = 8;
const noise = (rate) =>
  `anoisesrc=c=pink:r=${rate}:a=0.3:d=${SECONDS}:s=1[l];anoisesrc=c=pink:r=${rate}:a=0.3:d=${SECONDS}:s=2[r];[l][r]amerge=inputs=2`;
const out = (name) => `${DIR}/${name}`;
const s16 = ["-c:a", "flac", "-sample_fmt", "s16"];
const s24 = ["-c:a", "flac", "-sample_fmt", "s32", "-bits_per_raw_sample", "24"];

// Genuine lossless at three sample rates.
ffmpeg("-f", "lavfi", "-i", noise(44100), ...s16, out("genuine-44.flac"));
ffmpeg("-f", "lavfi", "-i", noise(48000), ...s16, out("genuine-48.flac"));
ffmpeg("-f", "lavfi", "-i", noise(96000), ...s24, out("genuine-96-24.flac"));

// Lossy encodes, and the same audio dressed up as FLAC.
for (const [name, quality] of [
  ["mp3-128", ["-b:a", "128k"]],
  ["mp3-192", ["-b:a", "192k"]],
  ["mp3-320", ["-b:a", "320k"]],
  ["mp3-v0", ["-q:a", "0"]],
]) {
  ffmpeg("-i", out("genuine-44.flac"), "-c:a", "libmp3lame", ...quality, out(`${name}.mp3`));
  ffmpeg("-i", out(`${name}.mp3`), ...s16, out(`${name}.flac`));
  if (name !== "mp3-128") fs.rmSync(out(`${name}.mp3`));
}

// Fake hi-res: upsampled, and 16-bit audio padded to 24 bits.
ffmpeg("-i", out("genuine-44.flac"), "-ar", "96000", ...s24, out("upsampled-44-96.flac"));
ffmpeg("-i", out("genuine-48.flac"), "-ar", "96000", ...s24, out("upsampled-48-96.flac"));
ffmpeg("-i", out("genuine-44.flac"), ...s24, out("padded-24.flac"));

// A sine pushed 20 dB past full scale, and the EBU reference tone (-23 dBFS, 997 Hz, stereo).
ffmpeg("-f", "lavfi", "-i", `sine=f=220:r=44100:d=${SECONDS},volume=20dB`, "-c:a", "pcm_s16le", out("clipped.wav"));
const tone = `${10 ** (-23 / 20)}*sin(2*PI*997*t)`;
ffmpeg("-f", "lavfi", "-i", `aevalsrc=${tone}|${tone}:s=48000:d=20`, ...s24, out("tone-23.flac"));

// Damaged copies of the genuine file.
const genuine = fs.readFileSync(out("genuine-44.flac"));
fs.writeFileSync(out("truncated.flac"), genuine.subarray(0, Math.floor(genuine.length * 0.6)));
const flipped = Buffer.from(genuine);
flipped[Math.floor(flipped.length * 0.7)] ^= 0x10;
fs.writeFileSync(out("bitflip.flac"), flipped);
// STREAMINFO is always the first block, so its MD5 sits at bytes 26-41. All zeros means "not set".
const unsigned = Buffer.from(genuine);
unsigned.fill(0, 26, 42);
fs.writeFileSync(out("no-md5.flac"), unsigned);

// Reference readings from ffmpeg, independent of the app: loudness from its EBU R128 meter,
// true peak as the highest sample after 8x oversampling with a long filter. (The meter's own
// peak figure is not used: on these files it comes out below the plain sample peak.)
function measure(name, filter, pattern) {
  const { stderr } = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", out(name), "-af", filter, "-f", "null", "-"], { encoding: "utf8" });
  const value = Number(pattern.exec(stderr.slice(stderr.lastIndexOf("Summary:") + 1))?.[1]);
  if (Number.isNaN(value)) throw new Error(`ffmpeg gave no reading for ${name} with ${filter}`);
  return value;
}
const expected = {};
for (const name of fs.readdirSync(DIR).sort()) {
  if (name === "truncated.flac" || name === "bitflip.flac") continue;
  const rate = measure(name, "anull", /(\d+) Hz/);
  expected[name] = {
    lufs: measure(name, "ebur128", /I:\s+(-?[\d.]+) LUFS/),
    truePeak: measure(name, `aresample=${rate * 8}:filter_size=512:cutoff=0.99,astats=measure_overall=Peak_level:measure_perchannel=none`, /Peak level dB: (-?[\d.]+)/),
  };
}
fs.writeFileSync(out("expected.json"), `${JSON.stringify(expected, null, 2)}\n`);
console.log(`Wrote ${fs.readdirSync(DIR).length} files to ${DIR}`);
