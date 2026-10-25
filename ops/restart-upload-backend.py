#!/usr/bin/env python3
"""Reinicio futuro explícito de egem-backend; restaura el entorno capturado sin imprimirlo."""
import argparse
import json
import os
import subprocess
import time
from pathlib import Path


def restart(backup, mode):
    state = json.loads((backup / "deployment-state.json").read_text())
    original = json.loads((backup / "process-environment.private.json").read_text())
    command = [state["pm2Binary"], "restart", "egem-backend"]
    if state["initialLimitPresent"]:
        environment = dict(original)
        environment["MAX_UPLOAD_SIZE_MB"] = "50" if mode == "apply" else state["initialLimitValue"]
        command.append("--update-env")
        home = Path(environment.get("PM2_HOME", str(Path(environment.get("HOME", "/root")) / ".pm2"))).resolve()
        if home != Path(state["pm2Home"]).resolve():
            raise ValueError("El entorno no corresponde al gestor PM2 respaldado")
    else:
        # Sin override inicial, dotenv actualizado/restaurado gobierna el límite.
        # No introducir una clave persistente ni mezclar el shell en el entorno app.
        environment = {**os.environ, "PM2_HOME": state["pm2Home"]}
    result = subprocess.run(command, env=environment, capture_output=True, text=True)
    log = backup / ("restart-" + mode + "-" + str(time.time_ns()) + ".private.log")
    with log.open("x") as output:
        output.write(result.stdout + result.stderr)
    print(json.dumps({"service": "egem-backend", "mode": mode, "success": result.returncode == 0, "log": str(log)}))
    return result.returncode


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backup", required=True)
    parser.add_argument("--mode", required=True, choices=["apply", "rollback"])
    parser.add_argument("--confirm-service-restart", action="store_true")
    args = parser.parse_args()
    backup = Path(args.backup).resolve()
    if not args.confirm_service_restart or not hasattr(os, "geteuid") or os.geteuid() != 0:
        parser.error("Requiere root y autorización explícita --confirm-service-restart")
    if not str(backup).startswith("/var/backups/egem-upload-") or backup.stat().st_mode & 0o077:
        parser.error("Respaldo privado no válido")
    raise SystemExit(restart(backup, args.mode))
