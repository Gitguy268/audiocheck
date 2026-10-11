import "./style.css";
import { label, SPEC_COLS, SPEC_ROWS, type Level } from "./analyze.ts";
import { checkFile, decoderIsExact, type Report } from "./decode.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = "", className = "") => {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
};

const AUDIO = /\.(flac|wav|wave|aiff?|mp3|m4a|mp4|aac|ogg|oga|opus|wma|ape|wv|dsf|dff|webm|mka)$/i;
const ICON: Record<Level, string> = { ok: "✓", note: "i", warn: "!", bad: "✕" };
const signed = (n: number, digits = 1) => (Number.isFinite(n) ? n.toFixed(digits).replace("-", "−") : "");

// Colour ramp of the spectrogram, quiet to loud.
const STOPS = [
  [10, 11, 24],
  [43, 42, 122],
  [180, 38, 107],
  [242, 163, 58],
  [255, 243, 196],
] as const;
const RAMP = new Uint8Array(256 * 3);
for (let i = 0; i < 256; i++) {
  const t = (i / 255) * (STOPS.length - 1);
  const a = STOPS[Math.floor(t)]!;
  const b = STOPS[Math.min(STOPS.length - 1, Math.floor(t) + 1)]!;
  for (let c = 0; c < 3; c++) RAMP[i * 3 + c] = a[c]! + (b[c]! - a[c]!) * (t % 1);
}

const canvas = $<HTMLCanvasElement>("spectrogram");
const pen = canvas.getContext("2d")!;

function drawAxis(nyquist: number) {
  $("axis").replaceChildren(...[1, 0.75, 0.5, 0.25, 0].map((f) => el("li", `${Math.round((nyquist * f) / 100) / 10} kHz`)));
}

let selected: HTMLButtonElement | undefined;

function show(report: Report, button: HTMLButtonElement) {
  selected?.removeAttribute("aria-current");
  selected = button;
  button.setAttribute("aria-current", "true");

  const nyquist = report.sampleRate / 2;
  drawAxis(nyquist);
  const cutoff = $("cutoff");
  cutoff.hidden = !report.cutoff;
  if (report.cutoff) {
    cutoff.textContent = `Content stops at ${(report.cutoff.hz / 1000).toFixed(1)} kHz`;
    cutoff.style.bottom = `${(report.cutoff.hz / nyquist) * 100}%`;
    // Near the top of the graph the label would stick out above it, so it goes under the line.
    cutoff.classList.toggle("high", report.cutoff.hz / nyquist > 0.8);
  }

  const prompt = $("prompt");
  prompt.hidden = !!report.spectrum;
  prompt.textContent = "No audio could be decoded from this file";
  if (report.spectrum) {
    const pixels = pen.createImageData(SPEC_COLS, SPEC_ROWS);
    for (let row = 0; row < SPEC_ROWS; row++) {
      for (let col = 0; col < SPEC_COLS; col++) {
        // Row 0 of the data is the lowest frequency; the picture has it at the bottom.
        const value = report.spectrum.image[(SPEC_ROWS - 1 - row) * SPEC_COLS + col]!;
        pixels.data.set([RAMP[value * 3]!, RAMP[value * 3 + 1]!, RAMP[value * 3 + 2]!, 255], (row * SPEC_COLS + col) * 4);
      }
    }
    pen.putImageData(pixels, 0, 0);
  } else {
    pen.clearRect(0, 0, SPEC_COLS, SPEC_ROWS);
  }
  canvas.setAttribute(
    "aria-label",
    !report.spectrum
      ? `No spectrogram for ${report.name}`
      : `Spectrogram of ${report.name}, 0 to ${nyquist / 1000} kHz. ${report.cutoff ? cutoff.textContent : "Content reaches the top of the band."}`,
  );
  // Restart the wipe that reveals a new picture.
  canvas.classList.remove("fresh");
  void canvas.offsetWidth;
  canvas.classList.add("fresh");

  $("reading-name").textContent = report.name;
  $("reading-format").textContent = report.format;
  $("reading-findings").replaceChildren(
    ...report.findings.map((finding) => {
      const item = el("li", "", finding.level);
      const icon = el("span", ICON[finding.level], "icon");
      icon.setAttribute("aria-hidden", "true");
      item.append(icon, el("span", finding.text));
      return item;
    }),
  );
}

let userPicked = false;

function addRow(report: Report) {
  const row = el("tr");
  row.dataset.file = report.name;
  row.dataset.level = report.level;
  const cell = (name: string, content: string | Node, className = "") => {
    const td = el("td", "", className);
    td.dataset.col = name;
    td.append(content);
    row.append(td);
  };

  const open = el("button", report.name, "file");
  open.type = "button";
  open.addEventListener("click", () => {
    userPicked = true;
    show(report, open);
  });
  cell("file", open);
  cell("format", report.format);

  const verdict = el("span", "", `verdict ${report.level}`);
  const icon = el("span", ICON[report.level], "icon");
  icon.setAttribute("aria-hidden", "true");
  const labels = report.findings.map(label).filter(Boolean);
  verdict.append(icon, labels.join(", ") || "No problems found");
  cell("verdict", verdict);

  cell("cutoff", report.cutoff ? (report.cutoff.hz / 1000).toFixed(1) : report.spectrum ? "none" : "", "num");
  cell("lufs", report.loudness ? signed(report.loudness.lufs) : "", "num");
  cell("truepeak", report.loudness ? signed(report.loudness.truePeak) : "", "num");
  cell("range", report.loudness ? signed(report.loudness.range) : "", "num");
  cell("clipped", report.stats ? report.stats.clippedSamples.toLocaleString("en") : "", "num");
  const integrity = report.findings.find((finding) => finding.check === "integrity");
  cell(
    "integrity",
    integrity?.level === "bad"
      ? "Damaged"
      : integrity?.level === "note"
        ? "Not decoded"
        : report.checksum === "match"
          ? "Checksum matches"
          : "Decodes",
  );

  $("rows").append(row);
  $("results").hidden = false;
  // Follow the newest result until the user picks a row themselves.
  if (!userPicked) show(report, open);
}

const queue: File[] = [];
let total = 0;
let done = 0;
let running = false;

async function run() {
  if (running) return;
  running = true;
  for (let file = queue.shift(); file; file = queue.shift()) {
    $("status").textContent = `Checking ${done + 1} of ${total}: ${file.name}`;
    addRow(await checkFile(file));
    done++;
  }
  running = false;
  const exact = await decoderIsExact();
  $("status").textContent =
    `Checked ${total} ${total === 1 ? "file" : "files"}.` +
    (exact
      ? ""
      : " This browser does not return exact sample values, so the bit-depth and checksum checks were skipped." +
        // Brave Shields scales decoded audio by a small random factor against fingerprinting.
        ("brave" in navigator ? " Brave Shields causes this; turning Shields off for this page may bring them back." : ""));
}

function enqueue(files: File[]) {
  const audio = files
    .filter((file) => file.type.startsWith("audio/") || AUDIO.test(file.name))
    .sort((a, b) => (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name));
  if (audio.length === 0) {
    $("status").textContent = files.length ? "None of those are audio files." : "";
    return;
  }
  queue.push(...audio);
  total += audio.length;
  void run();
}

async function walk(entry: FileSystemEntry | null): Promise<File[]> {
  if (!entry) return [];
  if (entry.isFile) {
    return [
      await new Promise<File>((resolve, reject) => {
        (entry as FileSystemFileEntry).file(resolve, reject);
      }),
    ];
  }
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const files: File[] = [];
  // readEntries hands back a folder in batches; an empty batch means the end.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    if (batch.length === 0) return files;
    for (const child of batch) files.push(...(await walk(child)));
  }
}

for (const [button, input] of [
  ["choose-files", "files"],
  ["choose-folder", "folder"],
] as const) {
  const picker = $<HTMLInputElement>(input);
  $(button).addEventListener("click", () => picker.click());
  picker.addEventListener("change", () => {
    enqueue([...(picker.files ?? [])]);
    picker.value = "";
  });
}

const scope = $("scope");
addEventListener("dragover", (event) => {
  event.preventDefault();
  scope.classList.add("over");
});
addEventListener("dragleave", () => scope.classList.remove("over"));
addEventListener("drop", (event) => {
  event.preventDefault();
  scope.classList.remove("over");
  const transfer = event.dataTransfer;
  if (!transfer) return;
  // Entries must be taken before the event ends; folders are only reachable through them.
  const entries = [...transfer.items].map((item) => item.webkitGetAsEntry?.() ?? null);
  const loose = [...transfer.files];
  void Promise.all(entries.map(walk)).then(
    (found) => enqueue(found.flat().length ? found.flat() : loose),
    () => enqueue(loose),
  );
});

drawAxis(22050);
