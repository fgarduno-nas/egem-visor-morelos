// Ensayo sin servidor HTTP, Prisma ni catálogo. Solo escribe dentro del sandbox.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (!root.startsWith("/var/tmp/egem-capacity-") || fs.existsSync(path.join(root, "backend/.env"))) {
  throw new Error("Se requiere sandbox independiente sin .env.");
}
// Padre pequeño que permanece vivo al terminar el hijo: permite leer el pico
// DEL CGROUP completo antes de que systemd destruya el grupo. Incluye GDAL.
if (!process.argv.includes("--child")) {
  const start = performance.now();
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--child"], { stdio: "inherit", env: process.env });
  const termination = await new Promise(resolve => {
    child.once("error", () => resolve({ code: null, signal: null, spawnError: true }));
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  fs.writeFileSync(path.join(root, "conversion-exit.pending"), JSON.stringify({
    ...termination, elapsedMs: Math.round(performance.now() - start)
  }), { flag: "wx", mode: 0o600 });
  fs.renameSync(path.join(root, "conversion-exit.pending"), path.join(root, "conversion-exit.json"));
  // El supervisor recoge memory.peak y termina SOLO esta unidad transitoria.
  await new Promise(() => setInterval(() => {}, 60000));
}
const input = path.join(root, "fixture.kmz");
const checksum = () => crypto.createHash("sha256").update(fs.readFileSync(input)).digest("hex");
const expected = "1a64382e22fb721a5041272ee48aaf857cd9e169f52748798eaf2723cc85b73f";
if (checksum() !== expected) throw new Error("El KMZ no coincide con el original autorizado.");
Object.assign(process.env, {
  NODE_ENV: "test", UPLOAD_BASE_DIR: path.join(root, "output"),
  MAX_UPLOAD_SIZE_MB: "50", PUBLIC_BASE_URL: "http://127.0.0.1:1",
  DATABASE_URL: "postgresql://isolated:unused@127.0.0.1:1/never_connect",
  JWT_SECRET: "isolated-test-only-no-real-credentials",
  DEFAULT_ADMIN_EMAIL: "isolated@example.invalid", DEFAULT_ADMIN_PASSWORD: "isolated-only",
  DEFAULT_ADMIN_NAME: "Isolated capacity test",
});
process.chdir(root);
const { processLayerOffThread } = await import("../backend/src/modules/layers/layer-processing-runner.js");
const start = performance.now();
const result = await processLayerOffThread({ id: "capacity-only", title: "Ensayo aislado", sourceType: "kmz", metadata: null }, [
  { originalname: "fixture.kmz", path: input, size: fs.statSync(input).size },
]);
const report = {
  status: result.processingStatus, durationMs: Math.round(performance.now() - start),
  featureCount: result.featureCount, originalUnchanged: checksum() === expected,
  node: process.version, nodeMaxRssKiB: process.resourceUsage().maxRSS,
  // RSS de Node incluye worker threads; GDAL se mide aparte a través del cgroup.
};
console.log("CAPACITY_RESULT=" + JSON.stringify(report));
if (report.status !== "processed" || !report.originalUnchanged) process.exitCode = 1;
