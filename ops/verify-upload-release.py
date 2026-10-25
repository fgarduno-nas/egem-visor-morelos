#!/usr/bin/env python3
"""Manifiesto de código, sin secretos: crear localmente o verificar sin ejecutar la app."""
import argparse
import hashlib
import json
import subprocess
import tarfile
import urllib.request
from urllib.parse import urljoin, quote
from pathlib import Path

SCOPES = ["backend/src", "backend/package.json", "backend/package-lock.json", "backend/prisma", "shared", "js", "css", "index.html"]
TESTED = ["backend/package.json", "backend/package-lock.json", "backend/src/config/env.js",
          "backend/src/shared/utils/file-utils.js", "backend/src/modules/layers/layer-processing-runner.js",
          "backend/src/modules/layers/layer-processing.worker.js", "backend/src/modules/layers/layer-processing.service.js",
          "backend/src/modules/layers/geospatial-importer.service.js", "backend/src/modules/layers/raster-legend-detector.service.js",
          "shared/upload-limits.js", "shared/archive-limits.js"]


def digest(data):
    # core.autocrlf=true en Windows: comparar código normalizando SOLO CRLF.
    return hashlib.sha256(data.replace(b"\r\n", b"\n")).hexdigest()


def paths(repo):
    output = subprocess.check_output(["git", "-C", str(repo), "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", *SCOPES])
    return sorted(set(part.decode() for part in output.split(b"\0") if part))


def read(root, name):
    path = Path(name)
    if path.is_absolute() or ".." in path.parts or (root / path).is_symlink():
        raise ValueError("Ruta no permitida en manifiesto")
    return (root / path).read_bytes()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--create", action="store_true")
    group.add_argument("--check-repo", action="store_true")
    group.add_argument("--check-sandbox", action="store_true")
    group.add_argument("--check-public", action="store_true")
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--repo", default=".")
    parser.add_argument("--sandbox")
    parser.add_argument("--tested-archive")
    parser.add_argument("--url", default="https://fgarduno-nas.github.io/egem-visor-morelos/")
    parser.add_argument("--cache-key", default="release-verification")
    args = parser.parse_args()
    repo = Path(args.repo).resolve()
    target = Path(args.manifest)
    if args.create:
        if not args.tested_archive:
            parser.error("--create requiere --tested-archive")
        hashes = {name: digest(read(repo, name)) for name in paths(repo)}
        with tarfile.open(args.tested_archive, "r:gz") as archive:
            tested = {name: digest(archive.extractfile(name).read()) for name in TESTED}
        if any(hashes.get(name) != value for name, value in tested.items()):
            raise ValueError("El código de conversión pendiente difiere del paquete ensayado; revisar antes de continuar")
        data = {"algorithm": "sha256-CRLF-to-LF-only", "baseHead": subprocess.check_output(["git", "-C", str(repo), "rev-parse", "HEAD"], text=True).strip(),
                "files": hashes, "testedConversion": tested,
                "testedArchiveRawSha256": hashlib.sha256(Path(args.tested_archive).read_bytes()).hexdigest()}
        with target.open("x", encoding="utf-8") as output:
            json.dump(data, output, indent=2)
        print(json.dumps({"manifest": str(target), "runtimeFiles": len(hashes), "conversionFilesMatchLocalTestedArchive": len(tested)}))
        return
    data = json.loads(target.read_text(encoding="utf-8"))
    if args.check_public:
        if not args.url.startswith("https://"):
            parser.error("La verificación pública requiere HTTPS")
        names = ["index.html", "js/map.js", "js/app/services/layers-api.js", "js/app/services/upload-retry-key.js",
                 "js/app/utils/geospatial-importer.js", "js/app/config/runtime-config.js", "shared/upload-limits.js", "shared/archive-limits.js"]
        failed = []
        for name in names:
            request = urllib.request.Request(urljoin(args.url.rstrip("/") + "/", name) + "?egem_release=" + quote(args.cache_key), headers={"Cache-Control": "no-cache"})
            with urllib.request.urlopen(request, timeout=20) as response:
                if digest(response.read()) != data["files"][name]:
                    failed.append(name)
        if failed:
            raise ValueError("El sitio todavía no sirve el código aprobado: " + ", ".join(failed))
        print(json.dumps({"match": True, "scope": "public-static-files", "files": len(names)}))
        return
    if args.check_sandbox:
        if not args.sandbox:
            parser.error("--check-sandbox requiere --sandbox")
        root, expected = Path(args.sandbox).resolve(), data["testedConversion"]
    else:
        root, expected = repo, data["files"]
        if set(paths(repo)) != set(expected):
            raise ValueError("Inventario de código distinto al aprobado")
    failed = [name for name, value in expected.items() if digest(read(root, name)) != value]
    if failed:
        raise ValueError("Código diferente: " + ", ".join(failed))
    print(json.dumps({"match": True, "scope": "conversion-sandbox" if args.check_sandbox else "runtime-repository", "files": len(expected)}))


if __name__ == "__main__":
    main()
