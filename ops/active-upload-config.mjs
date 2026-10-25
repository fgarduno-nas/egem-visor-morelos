// Solo lectura. No importa env.js/app.js, no conecta a DB y no ejecuta PM2.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const backend = fs.realpathSync(process.argv[2] || "/opt/egem-visor-morelos/backend");
const require = createRequire(path.join(backend, "package.json"));
const dotenv = require("dotenv");
const envfile = path.join(backend, ".env");
const disk = fs.existsSync(envfile) ? dotenv.parse(fs.readFileSync(envfile)) : {};
const bootSeconds = Number(fs.readFileSync("/proc/stat", "utf8").match(/^btime (\d+)/m)?.[1]);
const explicit = process.argv.indexOf("--pid");
const requestedPid = explicit >= 0 ? process.argv[explicit + 1] : null;
if (explicit >= 0 && !/^[1-9]\d*$/.test(requestedPid || "")) throw new Error("--pid requiere un PID numérico");
const ticks = Number(execFileSync("getconf", ["CLK_TCK"], { encoding: "utf8" }).trim());
const rows = [], diagnostics = [];

for (const pid of requestedPid ? [requestedPid] : fs.readdirSync("/proc").filter(value => /^\d+$/.test(value))) {
  if (Number(pid) === process.pid) { diagnostics.push({ pid: Number(pid), reason: "helper propio excluido" }); continue; }
  try {
    const proc = `/proc/${pid}`;
    const comm = fs.readFileSync(`${proc}/comm`, "utf8").trim();
    const executable = fs.realpathSync(`${proc}/exe`);
    if (!/^node(?:js)?$/.test(path.basename(executable).replace(/ \(deleted\)$/, ""))) {
      if (requestedPid) diagnostics.push({ pid: Number(pid), reason: "ejecutable no identificado como Node" });
      continue;
    }
    const cwd = fs.realpathSync(`${proc}/cwd`);
    if (cwd !== backend) { if (requestedPid) diagnostics.push({ pid: Number(pid), reason: "cwd distinto del backend esperado", cwd }); continue; }
    const initial = Object.fromEntries(fs.readFileSync(`${proc}/environ`, "utf8").split("\0")
      .filter(value => value.includes("=")).map(value => { const n = value.indexOf("="); return [value.slice(0, n), value.slice(n + 1)]; }));
    const merged = { ...disk, ...initial }; // dotenv instalado usa override=false.
    const upload = merged.UPLOAD_BASE_DIR ?? "uploads";
    const resolved = path.resolve(cwd, upload);
    const cmd = fs.readFileSync(`${proc}/cmdline`, "utf8").replaceAll("\0", " ");
    const memoryFlags = value => [...value.matchAll(/--(?:max[-_]old[-_]space[-_]size|max[-_]semi[-_]space[-_]size)(?:=|\s+)\d+/g)].map(item => item[0]);
    const stat = fs.readFileSync(`${proc}/stat`, "utf8");
    rows.push({ pid: Number(pid), isHelper: false, oldCommFilterWouldMatch: /^node(js)?$/.test(comm), cwd, executable,
      uploadCandidate: resolved, uploadRealpath: fs.existsSync(resolved) ? fs.realpathSync(resolved) : null,
      uploadSource: initial.UPLOAD_BASE_DIR !== undefined ? "entorno inicial" : disk.UPLOAD_BASE_DIR !== undefined ? ".env actual" : "default código: uploads",
      maxUploadMiBCandidate: merged.MAX_UPLOAD_SIZE_MB ?? "default código instalado: 100",
      apiPrefixCandidate: merged.API_PREFIX ?? "/api/v1",
      dotenvMtime: fs.existsSync(envfile) ? fs.statSync(envfile).mtime.toISOString() : null,
      processStartTicks: stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19], bootSeconds,
      processStartedAt: new Date((bootSeconds + Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19]) / ticks) * 1000).toISOString(),
      commandMemoryFlags: memoryFlags(cmd), nodeOptionsMemoryFlags: memoryFlags(initial.NODE_OPTIONS || ""),
      nodeOptionsPresent: Boolean(initial.NODE_OPTIONS),
      note: "Candidato por precedencia de código instalado; /proc no refleja necesariamente dotenv. Si .env/código cambió tras el arranque, no demuestra el valor en memoria. No reiniciar para averiguarlo." });
  } catch (error) { if (requestedPid) diagnostics.push({ pid: Number(pid), reason: "No legible o terminó", code: error.code || "READ_ERROR" }); }
}
console.log(JSON.stringify({ backend, helperPid: process.pid, requestedPid, diagnostics, processes: rows, processCountMatchingCwd: rows.length }, null, 2));
