// Screenshots of the Interrail pass for the PR description, against the live train-api.
//   npm run build && node scripts/shot-pr.mjs <out-dir>
import http from "node:http";
import { readFileSync, existsSync, statSync, mkdtempSync, mkdirSync } from "node:fs";
import { join, extname } from "node:path";
import { tmpdir } from "node:os";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

const DIST = join(process.cwd(), "dist");
const OUT = process.argv[2] || "shots";
mkdirSync(OUT, { recursive: true });
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const server = http.createServer((req, res) => {
  let pathname = decodeURIComponent((req.url || "/").split("?")[0]).replace(/^\/MAX-Finder\//, "/").replace(/^\/+/, "");
  let file = join(DIST, pathname);
  if (!file.startsWith(DIST)) return res.writeHead(403).end();
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, "index.html");
  res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}/MAX-Finder/`;
const enc = encodeURIComponent;
const DATE = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
const P = enc("PARIS (intramuros)");

const shots = [
  { name: "interrail-where-to", card: "interrail", url: `${BASE}?mode=from&from=${P}&date=${DATE}` },
  { name: "max-jeune-where-to", card: "jeune", url: `${BASE}?mode=from&from=${P}&date=${DATE}` },
  { name: "interrail-trip", card: "interrail", url: `${BASE}?mode=od&from=${P}&to=${enc("MARSEILLE ST CHARLES")}&date=${DATE}` },
  { name: "interrail-mobile", card: "interrail", url: `${BASE}?mode=from&from=${P}&date=${DATE}`, mobile: true },
];

const args = chromium.args.filter((a) => !a.startsWith("--user-data-dir") && !a.startsWith("--proxy"));
const browser = await puppeteer.launch({
  args: [...args, "--no-sandbox", "--disable-setuid-sandbox"],
  executablePath: await chromium.executablePath(),
  headless: true,
  userDataDir: mkdtempSync(join(tmpdir(), "shot-")),
});
for (const s of shots) {
  const page = await browser.newPage();
  const api = [];
  page.on("response", (r) => { if (r.url().includes("train-api")) api.push(`${r.status()} ${r.url()}`); });
  await page.setViewport(s.mobile ? { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { width: 1120, height: 1400, deviceScaleFactor: 2 });
  await page.evaluateOnNewDocument((card) => localStorage.setItem("mj.settings", JSON.stringify({ lang: "en", theme: "light", card })), s.card);
  await page.goto(s.url, { waitUntil: "networkidle2", timeout: 60000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 15000));
  const el = await page.$("#app");
  const box = el ? await el.boundingBox() : null;
  const cap = s.mobile ? 900 : 1320;
  const path = join(OUT, `${s.name}.png`);
  if (box) await page.screenshot({ path, clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, cap) } });
  else await page.screenshot({ path });
  console.log("captured", s.name, s.url);
  console.log("  train-api:", api.slice(0, 4).join(" | ") || "none");
  console.log("  text:", (await page.evaluate(() => document.body.innerText.slice(0, 400))).replace(/\s+/g, " "));
  await page.close();
}
await browser.close();
server.close();
