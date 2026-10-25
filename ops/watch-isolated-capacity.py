#!/usr/bin/env python3
"""Ensayo opt-in: unidad transitoria AISLADA, sin tocar servicios productivos."""
import argparse
import json
import os
import re
import shutil
import subprocess
import time
import urllib.request
import uuid
from pathlib import Path

# Ignorar HTTP_PROXY y redirects: la sonda es exclusivamente loopback.
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

def health():
    start = time.monotonic()
    try:
        with OPENER.open("http://127.0.0.1:4000/health", timeout=2) as response:
            ok = response.status == 200
    except Exception:
        ok = False
    return {"ok": ok, "seconds": round(time.monotonic() - start, 3)}

def available():
    rows = Path("/proc/meminfo").read_text().splitlines()
    return int(next(row for row in rows if row.startswith("MemAvailable:")).split()[1]) * 1024

def unit_snapshot(unit):
    try:
        raw = subprocess.run(["systemctl", "show", unit,
            "--property=MemoryCurrent,MemoryPeak,CPUUsageNSec,ActiveState,ControlGroup,Result,ExecMainCode,ExecMainStatus,MemoryMax,MemoryHigh,CPUQuotaPerSecUSec"],
            capture_output=True, text=True, timeout=5)
    except (OSError, subprocess.TimeoutExpired) as error:
        return {"snapshotError": type(error).__name__}
    values = dict(row.split("=", 1) for row in raw.stdout.splitlines() if "=" in row)
    group = values.get("ControlGroup", "")
    # Solo el grupo de esta unidad generada; nunca pm2-root.service.
    if group and group.endswith("/" + unit + ".service"):
        base = Path("/sys/fs/cgroup") / group.lstrip("/")
        for name in ["memory.peak", "memory.current", "memory.events", "cpu.stat", "memory.max", "cpu.max"]:
            try:
                values[name] = (base / name).read_text().strip()
            except OSError:
                pass
    return values

def joint_peak(values):
    for field in ["memory.peak", "MemoryPeak"]:
        value = values.get(field, "")
        if value.isdigit() and 0 < int(value) < 2**63:
            return {"bytes": int(value), "source": field}
    return None

def build_isolated_command(unit, root, node):
    # PrivateTmp oculta /var/tmp del host: importar SOLO este sandbox en la
    # misma ruta. ReadWritePaths permite escritura, no sustituye el bind.
    command = ["systemd-run", "--unit=" + unit, "--wait", "--pipe",
        "--property=MemoryMax=2G", "--property=MemoryHigh=1536M",
        "--property=MemorySwapMax=0", "--property=CPUQuota=100%",
        "--property=MemoryAccounting=yes", "--property=CPUAccounting=yes",
        "--property=TasksMax=64", "--property=RuntimeMaxSec=240",
        "--property=TimeoutStopSec=10", "--property=KillMode=control-group",
        "--property=Nice=10", "--property=IOWeight=25",
        "--property=ProtectSystem=strict",
        "--property=BindPaths=" + str(root) + ":" + str(root),
        "--property=ReadWritePaths=" + str(root),
        "--property=ProtectHome=read-only", "--property=PrivateTmp=yes",
        "--property=NoNewPrivileges=yes", "--property=RestrictAddressFamilies=AF_UNIX",
        "--working-directory=" + str(root), "/usr/bin/env", "-i",
        "PATH=/usr/local/bin:/usr/bin:/bin", "HOME=/nonexistent",
        node, str(root / "ops/capacity-convert.mjs")]
    return command


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sandbox", required=True)
    parser.add_argument("--node", required=True, help="Binario absoluto verificado del proceso vigente")
    parser.add_argument("--run-isolated", action="store_true")
    args = parser.parse_args()
    root = Path(args.sandbox).resolve()
    if not args.run_isolated or not hasattr(os, "geteuid") or os.geteuid() != 0 or not str(root).startswith("/var/tmp/egem-capacity-"):
        parser.error("Requiere root, sandbox /var/tmp/egem-capacity-* y --run-isolated explícito")
    if not Path(args.node).is_absolute() or not Path(args.node).is_file():
        parser.error("Binario Node no válido")
    if (root / "backend/.env").exists() or not (root / "fixture.kmz").is_file():
        parser.error("Sandbox incompleto o contiene .env")
    if any((root / name).exists() for name in ["capacity-run.json", "conversion-private.log", "conversion-exit.json", "capacity-filtered.json"]):
        parser.error("Ya existe evidencia de ensayo; conservarla, no ejecutar otra conversión aquí")
    if not Path("/sys/fs/cgroup/cgroup.controllers").is_file():
        parser.error("Se requiere cgroup v2; no ejecutar sin aislamiento")
    for script in [root / "ops/capacity-convert.mjs", root / "ops/watch-isolated-capacity.py"]:
        if script.is_symlink() or not script.is_file() or script.stat().st_mode & 0o022:
            parser.error("Los scripts del ensayo deben ser archivos regulares sin escritura de grupo/otros; aplicar chmod 600 solo a estos archivos del sandbox")
    baseline = [health() for _ in range(3)]
    if not all(row["ok"] and row["seconds"] < 1 for row in baseline):
        parser.error("Servicio no saludable o lento antes de comenzar")
    if available() < 4 * 1024**3 or shutil.disk_usage(root).free < 8 * 1024**3:
        parser.error("Requiere 4 GiB disponibles y 8 GiB libres antes del ensayo")
    unit = "egem-capacity-" + uuid.uuid4().hex
    command = build_isolated_command(unit, root, args.node)
    with (root / "capacity-run.json").open("x") as out:
        json.dump({"unit": unit, "sandbox": str(root)}, out)
    print("Unidad aislada: " + unit, flush=True)
    print("Parada manual: systemctl stop " + unit, flush=True)
    report = {"unit": unit, "baseline": baseline, "samples": [], "stopReason": None}
    start = time.monotonic()
    with (root / "conversion-private.log").open("x") as log:
        proc = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT)
        bad = 0
        try:
            while proc.poll() is None:
                time.sleep(2)
                sample = {"elapsedSeconds": round(time.monotonic() - start, 1), "health": health(),
                          "availableBytes": available(), "freeBytes": shutil.disk_usage(root).free,
                          "unit": unit_snapshot(unit)}
                report["samples"].append(sample)
                limits = sample["unit"]
                if limits.get("ControlGroup"):
                    cpu = limits.get("cpu.max", "").split()
                    valid_cpu = len(cpu) == 2 and all(value.isdigit() for value in cpu) and 0 < int(cpu[0]) <= int(cpu[1])
                    memory = limits.get("memory.max", "")
                    if not (memory.isdigit() and 0 < int(memory) <= 2 * 1024**3 and valid_cpu):
                        report["stopReason"] = "No se pudieron confirmar límites efectivos 2 GiB/un núcleo del ensayo"
                        break

                bad = bad + 1 if not sample["health"]["ok"] or sample["health"]["seconds"] > 1 else 0
                if sample["availableBytes"] < 2 * 1024**3 or sample["freeBytes"] < 5 * 1024**3 or bad >= 2 or sample["elapsedSeconds"] >= 240:
                    report["stopReason"] = "Margen/latencia/duración de seguridad alcanzado"
                    break
                if (root / "conversion-exit.json").is_file():
                    report["conversionExit"] = json.loads((root / "conversion-exit.json").read_text())
                    # Padre sigue vivo; leer el pico conjunto ANTES de detener unidad.
                    report["finalBeforeStop"] = unit_snapshot(unit)
                    report["jointPeak"] = joint_peak(report["finalBeforeStop"])
                    break
        except KeyboardInterrupt:
            report["stopReason"] = "Cancelación manual del supervisor"
        except Exception as error:
            report["stopReason"] = "Fallo del supervisor: " + type(error).__name__
        finally:
            report.setdefault("finalBeforeStop", unit_snapshot(unit))
            report.setdefault("jointPeak", joint_peak(report["finalBeforeStop"]))
            if proc.poll() is None:
                try:
                    stopped = subprocess.run(["systemctl", "stop", unit], capture_output=True, timeout=20)
                    if stopped.returncode:
                        report["stopReason"] = "Parada del ensayo no confirmada; comprobar solo esta unidad"
                except (OSError, subprocess.TimeoutExpired):
                    report["stopReason"] = "Parada del ensayo no confirmada; comprobar solo esta unidad"
            try:
                proc.wait(timeout=25)
            except subprocess.TimeoutExpired:
                report["stopReason"] = "La unidad del ensayo no confirmó terminación; usar parada manual por nombre"
        # No confundir este código con el hijo: el padre se detiene deliberadamente.
        report["systemdRunExitCode"] = proc.returncode
    report["elapsedSupervisorSeconds"] = round(time.monotonic() - start, 3)
    report["afterStop"] = unit_snapshot(unit)
    for line in (root / "conversion-private.log").read_text(errors="replace").splitlines():
        if line.startswith("CAPACITY_RESULT="):
            try:
                report["conversion"] = json.loads(line.split("=", 1)[1])
            except ValueError:
                report["stopReason"] = "Resultado de conversión no legible"
    states = [report.get("finalBeforeStop", {}), report.get("afterStop", {})]
    namespace_failed = not report.get("conversionExit") and (
        any(state.get("ExecMainStatus") == "226" for state in states)
        or report.get("systemdRunExitCode") == 226)
    report["phase"] = "preparation_failed" if namespace_failed else "conversion_or_execution"
    if namespace_failed:
        report["preparationPeak"] = report.get("jointPeak")
        report["jointPeak"] = None
        report["stopReason"] = "226/NAMESPACE: fallo de preparación; no hay medición válida de conversión"
    report["conversionMeasurementValid"] = bool(report.get("conversionExit") and report.get("jointPeak") and report.get("conversion"))
    report["success"] = (report.get("conversionExit", {}).get("code") == 0
        and report.get("conversion", {}).get("status") == "processed"
        and report.get("conversion", {}).get("originalUnchanged") is True
        and report.get("jointPeak") is not None and not report["stopReason"])
    report["note"] = "Pico del cgroup NUEVO del ensayo: padre+Node+workers+GDAL, no PM2. Si falta pico o falla, no declarar éxito. No prueba multipart/DB/catálogo. Logs crudos quedan privados."
    (root / "capacity-filtered.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
    return 0 if report["success"] else 1

if __name__ == "__main__":
    raise SystemExit(main())
