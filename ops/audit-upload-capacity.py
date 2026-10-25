#!/usr/bin/env python3
"""Auditoría Linux de solo lectura. Filtra secretos antes de emitir resultados."""
import argparse
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlsplit

SAFE_ENV = {"NODE_ENV", "PORT", "MAX_UPLOAD_SIZE_MB", "UPLOAD_BASE_DIR"}
MEMORY_FLAGS = r"--(?:max[-_]old[-_]space[-_]size|max[-_]semi[-_]space[-_]size)[= ]\d+"

def safe_environment(values):
    result = {key: value for key, value in values.items() if key in SAFE_ENV}
    if "NODE_OPTIONS" in values:
        result["NODE_OPTIONS_memory_flags"] = re.findall(MEMORY_FLAGS, values["NODE_OPTIONS"])
    return result

def capture(args):
    try:
        r = subprocess.run(args, capture_output=True, text=True, timeout=15)
        return r.returncode, r.stdout
    except (OSError, subprocess.TimeoutExpired):
        return -1, ""

def proxy_directives(text):
    allowed = {"listen", "server_name", "client_max_body_size", "client_body_timeout",
               "client_header_timeout", "proxy_read_timeout", "proxy_send_timeout",
               "proxy_connect_timeout", "send_timeout", "proxy_request_buffering",
               "proxy_buffering", "client_body_temp_path", "proxy_pass_request_headers"}
    result = []
    source = ""
    for line_number, line in enumerate(text.splitlines(), 1):
        if line.startswith("# configuration file "):
            source = line.removeprefix("# configuration file ").rstrip(":")
        match = re.match(r"\s*(\w+)\s+([^;]+);", line)
        if not match:
            if re.match(r"\s*location\s+", line):
                result.append({"file": source, "line": line_number, "location": line.strip()})
            continue
        name, value = match.groups()
        if name == "proxy_pass":
            url = urlsplit(value)
            value = f"{url.scheme}://{url.hostname or '[variable]'}" if url.scheme in {"http", "https"} else "[revisar upstream localmente]"
        elif name == "proxy_set_header" and value.lower().startswith("idempotency-key "):
            value = "Idempotency-Key definido (valor omitido; comprobar reenvío)"
        elif name == "add_header" and value.lower().startswith("access-control-allow-headers "):
            value = value
        elif name not in allowed:
            continue
        result.append({"file": source, "line": line_number, "directive": name, "value": value})
    return result

def collect_node_processes():
    processes = []
    for proc in Path("/proc").iterdir():
        if not proc.name.isdigit():
            continue
        try:
            try:
                executable = os.readlink(proc / "exe")
            except OSError:
                if re.match(r"^node(?:js)?(?:\s|$)", proc.joinpath("comm").read_text().strip()):
                    processes.append({"pid": int(proc.name), "status": "Node probable; exe no legible"})
                continue
            if Path(executable.removesuffix(" (deleted)")).name not in {"node", "nodejs"}:
                continue
            env = dict(item.split("=", 1) for item in proc.joinpath("environ").read_bytes().decode(errors="replace").split("\0") if "=" in item)
            cmd = proc.joinpath("cmdline").read_bytes().decode(errors="replace").replace("\0", " ")
            cgroup = proc.joinpath("cgroup").read_text()
            limits = {}
            for row in cgroup.splitlines():
                if row.startswith("0::"):
                    group = Path("/sys/fs/cgroup") / row[3:].lstrip("/")
                    for field in ["memory.max", "memory.high", "memory.current", "memory.swap.max", "cpu.max", "pids.max"]:
                        if group.joinpath(field).is_file():
                            limits[field] = group.joinpath(field).read_text().strip()
            uid = re.search(r"^Uid:\s+(\d+)", proc.joinpath("status").read_text(), re.MULTILINE)
            processes.append({"pid": int(proc.name), "uid": int(uid.group(1)) if uid else None, "cwd": os.readlink(proc / "cwd"), "executable": executable, "memoryFlags": re.findall(MEMORY_FLAGS, cmd), "initialEnvironment": safe_environment(env), "cgroupV2": limits})
        except (OSError, ValueError):
            processes.append({"pid": int(proc.name), "status": "Acceso insuficiente; ejecutar con permisos de lectura apropiados"})
    return processes


def audit(args):
    if getattr(args, "process_only", False):
        return {"nodeProcesses": collect_node_processes()}
    report = {"warning": "Declaraciones filtradas: resolver herencia por ubicación y revisar intermediarios/CDN. /proc/environ no prueba valores cargados después por dotenv."}
    for name, command in {
        "memory": ["free", "-b"], "swap": ["swapon", "--show", "--bytes"],
        "cpu": ["lscpu"], "disk": ["df", "-B1", args.backend_root, args.uploads, "/tmp"],
        "uploadFilesystem": ["findmnt", "-T", args.uploads, "-o", "FSTYPE,TARGET,SOURCE"],
        "processes": ["ps", "-eo", "pid,ppid,comm,rss,pcpu,etimes", "--sort=-rss"],
    }.items():
        code, output = capture(command)
        if name == "processes":
            output = "\n".join(line for line in output.splitlines() if re.search(r"node|ogr2ogr|nginx|postgres|PID", line))
        report[name] = {"status": code, "output": output}
    report["nodeProcesses"] = collect_node_processes()
    # Solo lectura de la reserva; omitir token y no inferir que un PID vivo sea
    # su propietario (puede haberse reutilizado o pertenecer a otro namespace).
    lock = Path(args.uploads) / ".runtime" / "layer-upload.lock"
    try:
        owner = json.loads(lock.read_text())
        report["uploadReservation"] = {key: owner.get(key) for key in ["pid", "host", "startedAt"]}
        report["uploadReservation"]["note"] = "No prueba actividad ni autoriza liberar; comprobar todos los hosts/namespaces y GDAL."
    except FileNotFoundError:
        report["uploadReservation"] = "No existe en la ruta indicada; no demuestra ausencia de cargas en otra raíz/versión."
    except (OSError, ValueError):
        report["uploadReservation"] = "No legible o inválida; no liberar automáticamente."
    envfile = Path(args.backend_root) / ".env"
    try:
        values = dict(line.split("=", 1) for line in envfile.read_text().splitlines() if "=" in line and not line.lstrip().startswith("#"))
        report["dotenvFileSelected"] = safe_environment(values)
    except OSError:
        report["dotenvFileSelected"] = "No disponible"
    if args.unit:
        fields = "MainPID,ControlGroup,MemoryMax,MemoryHigh,MemoryCurrent,MemoryPeak,CPUQuotaPerSecUSec,TasksMax,WorkingDirectory,ExecMainStartTimestamp,EnvironmentFiles,TimeoutStopUSec,KillMode,KillSignal,SendSIGKILL"
        report["systemd"] = capture(["systemctl", "show", args.unit, "--property=" + fields])[1]
        raw = capture(["systemctl", "show", args.unit, "--property=Environment", "--value"])[1]
        report["systemdSelectedEnvironment"] = safe_environment(dict(item.split("=", 1) for item in shlex.split(raw) if "=" in item))
    pm2_home = Path(os.environ.get("PM2_HOME", str(Path.home() / ".pm2")))
    try:
        daemon_pid = int((pm2_home / "pm2.pid").read_text().strip())
        pm2_running = b"God Daemon" in Path(f"/proc/{daemon_pid}/cmdline").read_bytes()
    except (OSError, ValueError):
        pm2_running = False
    if args.pm2 and shutil.which("pm2") and pm2_running:
        code, raw = capture(["pm2", "jlist"])
        try:
            report["pm2"] = [{"name": item.get("name"), "pid": item.get("pid"), "execMode": item.get("pm2_env", {}).get("exec_mode"), "instances": item.get("pm2_env", {}).get("instances"), "maxMemoryRestart": item.get("pm2_env", {}).get("max_memory_restart"), "selectedEnvironment": safe_environment({**item.get("pm2_env", {}).get("env", {}), **item.get("pm2_env", {})}), "nodeMemoryFlags": re.findall(MEMORY_FLAGS, " ".join(item.get("pm2_env", {}).get("node_args", [])) if isinstance(item.get("pm2_env", {}).get("node_args"), list) else str(item.get("pm2_env", {}).get("node_args", "")))} for item in json.loads(raw)]
        except (ValueError, TypeError):
            report["pm2"] = {"status": code, "message": "No se pudo leer PM2; salida original omitida"}
    elif args.pm2:
        report["pm2"] = "No se consulta PM2 sin comprobar su daemon existente, para no iniciarlo. Verificar PM2_HOME y usuario del servicio."
    if args.container:
        code, raw = capture(["docker", "inspect", args.container])
        try:
            item = json.loads(raw)[0]
            report["container"] = {"pid": item["State"]["Pid"], "limits": {key: item["HostConfig"].get(key) for key in ["Memory", "MemorySwap", "NanoCpus", "CpuQuota", "CpuPeriod", "PidsLimit"]}, "mounts": [{key: mount.get(key) for key in ["Type", "Source", "Destination"]} for mount in item.get("Mounts", [])]}
        except (ValueError, KeyError, IndexError):
            report["container"] = {"status": code, "message": "No se pudo inspeccionar el contenedor"}
    code, raw = capture(["nginx", "-T"])
    report["nginx"] = {"status": code, "declarations": proxy_directives(raw), "note": "Si status no es cero, falta acceso/configuración; no interpretar como ausencia de límites."}
    report["gitHeadOnDisk"] = capture(["git", "-C", args.backend_root, "rev-parse", "HEAD"])[1].strip()
    return report

def self_test():
    sample = "proxy_pass https://user:SECRET@example.org/private?token=SECRET;\nproxy_set_header Authorization SECRET;\nclient_max_body_size 50m;"
    assert "SECRET" not in json.dumps(proxy_directives(sample))
    assert safe_environment({"JWT_SECRET": "SECRET", "MAX_UPLOAD_SIZE_MB": "50", "NODE_OPTIONS": "--require private-hook --max-old-space-size=512"}) == {"MAX_UPLOAD_SIZE_MB": "50", "NODE_OPTIONS_memory_flags": ["--max-old-space-size=512"]}
    print("Filtros de secretos: correctos")

if __name__ == "__main__":
    if "--self-test" in sys.argv:
        self_test()
    else:
        parser = argparse.ArgumentParser(description=__doc__)
        parser.add_argument("--backend-root", required=True)
        parser.add_argument("--uploads", required=True)
        parser.add_argument("--unit")
        parser.add_argument("--pm2", action="store_true")
        parser.add_argument("--process-only", action="store_true", help="Solo /proc de Node; no repite recursos ni consultas de gestores")
        parser.add_argument("--container")
        parser.add_argument("--ssh", help="Destino SSH existente; envía el script por stdin sin crear archivos remotos")
        parser.add_argument("--ssh-port", type=int, default=22)
        parser.add_argument("--ssh-key", help="Ruta a una clave existente; nunca se lee ni se imprime su contenido")
        options = parser.parse_args()
        if options.ssh:
            if options.ssh.startswith("-") or not re.fullmatch(r"[\w.@:\[\]-]+", options.ssh):
                parser.error("Destino SSH no válido")
            remote = ["python3", "-", "--backend-root", options.backend_root, "--uploads", options.uploads]
            if options.unit:
                remote += ["--unit", options.unit]
            if options.process_only:
                remote += ["--process-only"]
            if options.pm2:
                remote += ["--pm2"]
            if options.container:
                remote += ["--container", options.container]
            command = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-p", str(options.ssh_port)]
            if options.ssh_key:
                command += ["-i", options.ssh_key]
            command += [options.ssh, shlex.join(remote)]
            result = subprocess.run(command, input=Path(__file__).read_text(), text=True)
            sys.exit(result.returncode)
        if not sys.platform.startswith("linux"):
            parser.error("La inspección de /proc y cgroups requiere ejecutarse en el VPS Linux")
        print(json.dumps(audit(options), indent=2, ensure_ascii=False))
