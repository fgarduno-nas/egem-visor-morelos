# Despliegue reversible de cargas de 50 MiB — procedimiento preparado, NO ejecutado

**Ejecución autorizada por el usuario el 25 de octubre de 2026.** El agente prepara
commit/push e integración en desarrollo-visor; el usuario ejecuta los bloques
remotos desde PowerShell/Hostinger. **main y Pages quedan retenidos hasta recibir
correspondencia de los 11 archivos y backend/configuración saludables.** No pedir
otra aprobación por estas acciones; sí obtener resultados antes de pasos dependientes.
El ensayo de capacidad está superado: no repetirlo. El HTTP completo sigue pendiente.
Los bloques se ejecutan en orden; no ejecutar todos de una vez sin comprobar salidas.

## Resultado y decisión de timeout

Evidencia del usuario: unidad egem-capacity-bc3011fab940497cb4cde07255e21aa5,
conversionMeasurementValid=true, success=true, conversionExit.code=0,
procesamiento 21,298 ms, hijo completo 21,467 ms, supervisor 22.178 s,
pico memory.peak conjunto 1,267,601,408 bytes, 24,196 elementos,
originalUnchanged=true, Node v22.23.0. Catorce sondas HTTP200 entre 1 y 3 ms;
sin OOM, unidad final inactive. El fallo anterior 226/NAMESPACE queda conservado
como fallo de preparación, no como conversión. No hay razón para repetir capacidad.

Para este KMZ la conversión offline cabe en los 60 s por defecto de Nginx, pero
eso no prueba que recepción+DB+respuesta HTTP quepan, ni que otros archivos de
50 MiB tarden 21 s. Se propone **proxy_read_timeout 240s solo para la ruta de alta**:
180 s de límite GDAL existente + presupuesto operativo de 60 s para análisis,
checksums, registro y respuesta. Es una política de espera, no una garantía ni un
límite global del worker; el análisis no está acotado por el timeout de GDAL.
Cliente 300 s total: al consumir 240 s upstream quedan como máximo unos 60 s para
subida/red/otros costes. No se cambia cliente/Node/heap/JSON. No se garantiza una
subida lenta ni todas las complejidades: mantener reintento con misma clave y
monitorización; no aumentar plazos si el caso real no cabe.

Nginx 60 s sería incoherente con permitir hasta 180 s de GDAL. El cambio mínimo
es una directiva por ruta, con dos locations exactas para /api/v1/layers y su
variante con barra final (Express acepta ambas); no ampliar otras rutas.
**Conservar client_max_body_size 120M, TLS/Certbot, proxy y encabezados existentes.**
Antes de aplicar, confirmar herencia real y ausencia/presupuesto de CDN/WAF en el
panel: DNS o server_name solos no lo demuestran. Si hay un intermediario con plazo
menor, resolver su configuración existente o mantener detenido el despliegue.
Fuentes: [Nginx proxy](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_read_timeout).

## A. Correspondencia del código, ahora sin repetir conversión

Preparados fuera del repositorio, en el directorio de evidencias
`prepublicacion-20261025`: `egem-upload-release-manifest.json` y JSON de resultado
`capacity-vps-success-user.json`. El manifiesto contiene 84 archivos runtime y
11 archivos de conversión/dependencias que coinciden con el paquete original de
ensayo local. Se normaliza SOLO CRLF→LF (core.autocrlf=true), no contenido de código;
se conserva también SHA256 crudo del tar original. El resultado VPS no trae hashes
de sus fuentes: confirmar esta correspondencia en el servidor es un paso separado.

PowerShell, desde el worktree correcto:

```powershell
$Repo = 'C:\Users\Geodinamica\.codex\worktrees\revision-publicada-morelos\egem-visor-morelos'
$Evidence = 'C:\Users\Geodinamica\.codex\visualizations\2026\10\24\01a16fa4-ee11-7740-a537-c4bd9c47745b\prepublicacion-20261025'
Set-Location $Repo
python ops/verify-upload-release.py --check-repo --manifest "$Evidence\egem-upload-release-manifest.json" --repo $Repo
$Destino = Read-Host 'Destino SSH confirmado (root@IP o alias)'
$Puerto = Read-Host 'Puerto SSH confirmado'
scp -P $Puerto "$Repo\ops\verify-upload-release.py" "$Evidence\egem-upload-release-manifest.json" "${Destino}:/tmp/"
```

Consola web, solo lectura del sandbox, sin tocar resultado ni lanzar conversión:

```bash
python3 /tmp/verify-upload-release.py --check-sandbox \
  --manifest /tmp/egem-upload-release-manifest.json \
  --sandbox /var/tmp/egem-capacity-waM5Giwu
```

Debe informar match=true, 11 archivos. Si falla, revisar hashes/versiones; no repetir
conversión automáticamente ni declarar probado código diferente. Este chequeo no
incluye recepción HTTP, Multer, Prisma, reintentos o catálogo: sus tests son distintos.

## B. Integración futura, después de aprobación, sin adelantar Pages

HEAD, origin/main y origin/desarrollo-visor siguen en bf17e8b tras fetch. El backend
instalado c93d4cc es antecesor; no hay diferencias backend/shared entre c93 y bf17.
Objetivo: árbol pendiente, todavía sin SHA propio. Dependencias, package-lock,
esquema Prisma y migraciones siguen idénticos: no npm install, generate, migrate,
seed, restauración DB ni cambios de capas. No usar git pull ni reset/clean.

Primero revisar y crear la revisión en codex/carga-capas-50mib e integrar en
**desarrollo-visor**; no integrar main hasta backend/configuración saludables.
Comandos siguientes son futuros, no autorización para ejecutarlos ahora:

```powershell
Set-Location $Repo
git fetch origin
git status --short
git branch --show-current
python ops/verify-upload-release.py --check-repo --manifest "$Evidence\egem-upload-release-manifest.json" --repo $Repo
$Approved = @(
 'backend/.env.example','backend/README.md',
 'backend/src/config/env.js','backend/src/config/upload.js',
 'backend/src/middlewares/error.middleware.js',
 'backend/src/modules/layers/geospatial-importer.service.js',
 'backend/src/modules/layers/layer-processing.service.js',
 'backend/src/modules/layers/layer-processing-runner.js',
 'backend/src/modules/layers/layer-processing.worker.js',
 'backend/src/modules/layers/layers.routes.js','backend/src/modules/layers/layers.service.js',
 'backend/src/modules/layers/upload-control.js','backend/src/modules/layers/upload-retry.js',
 'backend/src/shared/utils/file-utils.js','shared/archive-limits.js','shared/upload-limits.js',
 'index.html','js/map.js','js/app/services/layers-api.js',
 'js/app/services/upload-retry-key.js','js/app/utils/geospatial-importer.js',
 'tests/backend-layer-service-contract.test.mjs','tests/division-http.test.mjs',
 'tests/geospatial-importer.test.mjs','tests/remote-style-utils.test.mjs',
 'tests/archive-limits.test.mjs','tests/upload-reliability.test.mjs','tests/upload-size.test.mjs',
 'ops/active-upload-config.mjs','ops/audit-upload-capacity.py','ops/capacity-convert.mjs',
 'ops/watch-isolated-capacity.py','ops/upload-proxy-limits.conf.example',
 'ops/verify-upload-release.py','ops/restart-upload-backend.py',
 'docs/cargas-50-mib.md','docs/despliegue-cargas-50-mib.md'
)
git add -- @Approved
git diff --cached --check
git diff --cached --stat
git diff --cached
```

Verificar que el índice no contenga otros archivos ya preparados por otra tarea.
Solo después de revisar y estar autorizado:

```powershell
git commit -m "Permitir cargas de 50 MiB y procesar KMZ grandes con control de reintentos"
git push -u origin codex/carga-capas-50mib
```

Usar PR hacia desarrollo-visor y respetar revisiones/checks/protecciones existentes;
no --admin ni force push. Se puede crear el PR desde GitHub web, evitando depender
de gh instalado. Registrar el SHA integrado aprobado; ese será RELEASE_SHA en el
VPS, no asumir que main/bf17/c93 ya contienen los cambios. Si un avance remoto
aparece, revisar su alcance y regenerar/verificar el manifiesto antes de integrar.
No introducir respaldos, capturas, fixture, .env, credenciales o uploads al commit.

## C. Respaldo privado y preflight VPS — futuros

Ejecutar como root en la consola web, manteniendo sesión y variables. Cambia solo
respaldos al principio; bloques posteriores sí cambian configuración/código y
requieren autorización de despliegue. En una nueva sesión recuperar la ruta BACKUP
anotada; no inventar una ni sobrescribir respaldos anteriores.

```bash
set -euo pipefail
VPS_REPO=/opt/egem-visor-morelos
BACKEND="$VPS_REPO/backend"
ENV_REAL=$(readlink -f "$BACKEND/.env")
NGINX_REAL=$(readlink -f /etc/nginx/sites-enabled/egem-backend)
SNIPPET=/etc/nginx/snippets/egem-upload-50mib.conf
PM2_HOME=/root/.pm2
export PM2_HOME
cd "$VPS_REPO"
test -z "$(git status --porcelain)"
PREVIOUS_SHA=$(git rev-parse HEAD)
test "$PREVIOUS_SHA" = c93d4ccaea0b305e43b3366789ddaa30a2b8e55a
read -r -p 'SHA completo integrado y aprobado de desarrollo-visor: ' RELEASE_SHA
[[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]]
git fetch origin
git cat-file -e "$RELEASE_SHA^{commit}"
git merge-base --is-ancestor "$PREVIOUS_SHA" "$RELEASE_SHA"
git diff --exit-code "$PREVIOUS_SHA" "$RELEASE_SHA" -- backend/package.json backend/package-lock.json backend/prisma
(cd "$BACKEND" && npm ls --depth=0 --omit=dev)
test -f "$ENV_REAL" && test -f "$NGINX_REAL"
test ! -e "$SNIPPET"
test -r "$PM2_HOME/pm2.pid"
kill -0 "$(cat "$PM2_HOME/pm2.pid")"
umask 077
BACKUP=$(mktemp -d /var/backups/egem-upload-XXXXXXXX)
printf 'RESPALDO: %s\n' "$BACKUP"
printf '%s\n' "$PREVIOUS_SHA" > "$BACKUP/previous.sha"
printf '%s\n' "$RELEASE_SHA" > "$BACKUP/target.sha"
printf '%s\n' "$ENV_REAL" > "$BACKUP/env.path"
printf '%s\n' "$NGINX_REAL" > "$BACKUP/nginx.path"
git bundle create "$BACKUP/code-before.bundle" HEAD
cp --preserve=all "$ENV_REAL" "$BACKUP/backend.env"
cp --preserve=all "$NGINX_REAL" "$BACKUP/nginx.conf"
if [ -f "$PM2_HOME/dump.pm2" ]; then cp -p "$PM2_HOME/dump.pm2" "$BACKUP/dump.pm2.before"; else touch "$BACKUP/dump.was-absent"; fi
if [ -f "$PM2_HOME/dump.pm2.bak" ]; then cp -p "$PM2_HOME/dump.pm2.bak" "$BACKUP/dump.pm2.bak.before"; else touch "$BACKUP/dump-bak.was-absent"; fi
pm2 jlist > "$BACKUP/pm2-active.private.json"
cp /tmp/egem-upload-release-manifest.json "$BACKUP/manifest.json"
git show "$RELEASE_SHA:ops/restart-upload-backend.py" > "$BACKUP/restart-upload-backend.py"
git show "$RELEASE_SHA:ops/upload-proxy-limits.conf.example" > "$BACKUP/upload-maintenance.conf"
```

No compartir el contenido de los respaldos privados. Capturar entorno inicial sin
imprimirlo; comprobar que PM2 y /proc concuerdan sobre overrides del límite. El
reinicio futuro conserva el entorno previo: si no hay override, cambiar solo .env;
si ya lo hay, actualizar únicamente MAX_UPLOAD_SIZE_MB y restaurarlo al revertir.
No mezclar todas las variables de la consola con la app mediante --update-env.

```bash
python3 - "$BACKUP" "$VPS_REPO" "$ENV_REAL" "$NGINX_REAL" "$RELEASE_SHA" <<'PY'
import json,os,shutil,sys
from pathlib import Path
b,repo,envfile,nginx,release=sys.argv[1:]
b=Path(b); apps=json.loads((b/'pm2-active.private.json').read_text())
selected=[a for a in apps if a.get('name')=='egem-backend']
assert len(selected)==1, 'Instancia backend inesperada'
a=selected[0]; e=a['pm2_env']; pid=a['pid']
assert e.get('exec_mode')=='fork_mode', 'Revisar modo PM2'
assert Path(e['pm_exec_path']).resolve()==Path(repo+'/backend/src/server.js').resolve(), 'PM2 no ejecuta la entrada esperada'
assert Path(os.readlink(f'/proc/{pid}/cwd')).resolve()==Path(repo+'/backend').resolve()
raw=Path(f'/proc/{pid}/environ').read_bytes().decode().split('\0')
initial=dict(item.split('=',1) for item in raw if '=' in item)
values=[str(v) for v in [e.get('MAX_UPLOAD_SIZE_MB'),e.get('env',{}).get('MAX_UPLOAD_SIZE_MB'),initial.get('MAX_UPLOAD_SIZE_MB')] if v is not None]
assert len(set(values))<=1, 'Discrepancia de overrides: revisar antes de cambiar'
assert bool(values)==('MAX_UPLOAD_SIZE_MB' in initial), 'Gestor e inicio discrepan'
if values: assert values[0] in {'50','100'}, 'Límite previo inesperado'
state={'repo':repo,'envPath':envfile,'nginxPath':nginx,'targetSha':release,
       'pm2Home':'/root/.pm2','pm2Binary':shutil.which('pm2'),
       'initialLimitPresent':bool(values),'initialLimitValue':values[0] if values else None}
assert state['pm2Binary']
(b/'process-environment.private.json').write_text(json.dumps(initial))
(b/'deployment-state.json').write_text(json.dumps(state,indent=2))
PY
```

El backup Git no incluye DB/uploads ni .env. No se modifica esquema, datos ni
almacenamiento de capas. Mantener los backups institucionales existentes; rollback
es de código/configuración y no restaura DB sobre datos nuevos.

## D. Ventana backend/configuración y salud — futuros

Primero pausar altas para evitar mezcla frontend viejo/backend nuevo. La plantilla
contiene 503 solo para POST de ambas variantes de la ruta de alta, timeout 240s y
los encabezados existentes. No sobrescribir un snippet anterior no reconocido.

```bash
install -m 644 "$BACKUP/upload-maintenance.conf" "$SNIPPET"
"${EDITOR:-vi}" "$NGINX_REAL"
```

En el editor agregar **una línea dentro del server HTTPS de api-egem.geodinamica.mx**,
conservando el resto, incluidos location /, 120M y Certbot:

```nginx
include /etc/nginx/snippets/egem-upload-50mib.conf;
```

Revisar que las locations actuales no tengan reglas auth/CORS adicionales que deban
copiarse a las nuevas; no reemplazar todo el servidor. Si Nginx rechaza el snippet,
no recargar y corregir/revertir el diff preparado.

```bash
nginx -t
systemctl reload nginx
for URL in https://api-egem.geodinamica.mx/api/v1/layers https://api-egem.geodinamica.mx/api/v1/layers/; do
  test "$(curl --noproxy '*' --max-time 10 -s -o /dev/null -w '%{http_code}' -X POST "$URL")" = 503
done
curl --noproxy '*' --fail --max-time 5 http://127.0.0.1:4000/health
```

Esperar fin de solicitudes anteriores y confirmar por operadores/logs que no quedan
conversiones; el backend viejo no tiene reserva y ausencia de lock no prueba drenaje.
No forzar parada si hay GDAL activo. La comprobación ps siguiente no imprime args:

```bash
PID=$(pm2 pid egem-backend)
ps --ppid "$PID" -o pid,ppid,comm
read -r -p 'Altas pausadas y sin conversiones activas; escribir DRENADO: ' DRAIN_STATE
test "$DRAIN_STATE" = DRENADO
pm2 stop egem-backend
git switch --detach "$RELEASE_SHA"
python3 /tmp/verify-upload-release.py --check-repo --repo "$VPS_REPO" --manifest "$BACKUP/manifest.json"
```

Cambiar únicamente la variable prevista, preservando permisos, propietario y demás
contenido del archivo real (no reemplazar .env por un ejemplo):

```bash
python3 - "$ENV_REAL" <<'PY'
import os,re,stat,sys
from pathlib import Path
p=Path(sys.argv[1]); info=p.stat(); raw=p.read_bytes()
new,n=re.subn(rb'(?m)^([ \t]*(?:export[ \t]+)?MAX_UPLOAD_SIZE_MB[ \t]*=)[^\r\n]*',rb'\g<1>50',raw)
assert n==1, 'Variable ausente/duplicada: revisar, no continuar'
tmp=p.with_name(p.name+'.egem-upload-new')
with tmp.open('xb') as f:f.write(new)
os.chmod(tmp,stat.S_IMODE(info.st_mode));os.chown(tmp,info.st_uid,info.st_gid)
os.replace(tmp,p)
PY
python3 "$BACKUP/restart-upload-backend.py" --backup "$BACKUP" --mode apply --confirm-service-restart
curl --noproxy '*' --fail --max-time 5 http://127.0.0.1:4000/health
curl --noproxy '*' --fail --max-time 10 https://api-egem.geodinamica.mx/health
PID=$(pm2 pid egem-backend)
env -u NODE_OPTIONS node "$VPS_REPO/ops/active-upload-config.mjs" "$BACKEND" --pid "$PID"
```

Comprobar modo production, límite candidato 50 por fuente consistente y uploads
canónico sin cambio. No reabrir altas si falla salud o el código no coincide. No
hacer npm install, prisma generate/migrate/seed, cambios PostgreSQL ni CORS.

## E. Frontend Pages, apertura controlada y validación HTTP — futuros

Solo después de D saludable, integrar desarrollo-visor hacia main mediante el flujo
permitido del repositorio (PR si hay protecciones). No forzar ni eludir checks.
El workflow existente .github/workflows/deploy-pages.yml se activa al push de main;
no crear otro despliegue. El SHA main puede ser un merge distinto del SHA backend:
comparar contenido con el mismo manifiesto en el worktree aprobado.

PowerShell:

```powershell
Set-Location $Repo
git fetch origin
git log -3 --oneline origin/main origin/desarrollo-visor
```

Esperar el run correspondiente en
https://github.com/fgarduno-nas/egem-visor-morelos/actions/workflows/deploy-pages.yml.
Si gh ya está instalado y autenticado, consultar/esperar sin instalarlo:

```powershell
gh run list --workflow deploy-pages.yml --branch main --limit 5 --json databaseId,headSha,status,conclusion,url
$RunId = Read-Host 'ID del run cuyo headSha coincide con el main aprobado'
gh run watch $RunId --exit-status
$MainSha = Read-Host 'SHA completo main desplegado por ese run'
python ops/verify-upload-release.py --check-public --manifest "$Evidence\egem-upload-release-manifest.json" --cache-key $MainSha
```

La verificación HTTP lee ocho archivos públicos y compara hashes de contenido;
no prueba ejecución de la app. Recargar navegador con caché desactivada para revisar
50 MB y recursos actuales, bienvenida, GOES compacto, los cuatro cambios previos,
navegación, selección de capas y móvil. Sin URLs localhost/configuración de revisión.

Para la prueba privada, coordinar con operadores y retirar solo las dos líneas de
mantenimiento del snippet, no el timeout ni el servidor TLS:

```bash
python3 - "$SNIPPET" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]); lines=p.read_text().splitlines(keepends=True)
assert sum(line.rstrip().endswith('# EGEM_UPLOAD_MAINTENANCE') for line in lines)==2
p.write_text(''.join(line for line in lines if not line.rstrip().endswith('# EGEM_UPLOAD_MAINTENANCE')))
PY
nginx -t
systemctl reload nginx
```

**Una sola alta HTTP privada** del KMZ original, sin repetir el ensayo offline:

1. Iniciar sesión en el visor público con un usuario autorizado, preferentemente
   DATA_PROVIDER/Director existente. No poner contraseña/token en consola o informe.
2. Título: **PRUEBA HTTP 50 MiB — Inundaciones Pluviales — fecha/hora**. Descripción:
   «Validación privada de carga. No publicar». Usar clasificación real del archivo
   con los selectores actuales; no inventar metadatos. Seleccionar original KMZ.
3. Network debe mostrar POST /api/v1/layers, multipart con un archivo,
   Idempotency-Key y clasificación, respuesta 201 con ID. Conservar duración y
   respuesta filtrada, sin Authorization/Cookie. Comprobar `processingStatus=processed`,
   featureCount=24196, original y metadatos correctos; no confundir HTTP201 con
   procesamiento exitoso si la respuesta informa failed/pending.
4. Verificar ese mismo ID en Mis capas/catálogo privado y visualizar desde sesión
   autorizada; revisar geometrías y atributos. Director debe quedar PENDING_REVIEW;
   ADMIN puede quedar APPROVED, **ninguno debe quedar PUBLISHED automáticamente**.
5. No pulsar Aprobar/Publicar ni llamar publish-state. Consultar lista pública y
   confirmar ausencia del ID privado. Si hay timeout, revisar el registro y reutilizar
   la misma clave de reintento, no volver a seleccionar una carga nueva tras éxito.
6. Registrar etapas separadas: recepción HTTP, procesamiento, registro, visualización
   privada y ausencia pública. No borrar DB/uploads para limpiar la prueba; conservar
   el ID y decidir su retirada mediante el flujo normal después de la revisión.

PowerShell, comprobación pública sin credenciales:

```powershell
$TestId = Read-Host 'ID de la capa privada de prueba'
$Public = Invoke-RestMethod 'https://api-egem.geodinamica.mx/api/v1/layers/public'
if (@($Public.data | Where-Object { $_.id -eq $TestId }).Count -ne 0) { throw 'La capa de prueba aparece públicamente: detener verificación' }
```

Los límites -1/exacto/+1 ya están probados en transporte local; no enviar binarios
arbitrarios de 50 MiB como evidencia cartográfica ni hacer estrés en producción.
Después de todas las comprobaciones correctas, persistir PM2 para reinicio del VPS:

```bash
pm2 save
```

No declarar flujo completo validado hasta completar estos pasos y guardar evidencias.
Si falla, volver a instalar el snippet de mantenimiento, nginx -t/recarga y ejecutar
rollback con las mismas rutas de backup; no insistir con nuevas capas duplicadas.

## F. Reversión concreta — futura, si resulta necesaria

Pausar altas, drenar y no interrumpir una conversión activa. Conservar registro de
prueba, DB, archivos y evidencias. No usar reset --hard, clean ni force push.
Recuperar BACKUP desde la ruta impresa, no elegir automáticamente «el último».
Si alguien cambió configuración/PM2 después del backup, comparar y revertir solo
estas líneas; no sobrescribir avances ajenos con la copia entera.

```bash
read -r -p 'Ruta exacta del respaldo de esta ventana: ' BACKUP
test -f "$BACKUP/deployment-state.json"
VPS_REPO=/opt/egem-visor-morelos
ENV_REAL=$(cat "$BACKUP/env.path")
NGINX_REAL=$(cat "$BACKUP/nginx.path")
SNIPPET=/etc/nginx/snippets/egem-upload-50mib.conf
install -m 644 "$BACKUP/upload-maintenance.conf" "$SNIPPET"
nginx -t
systemctl reload nginx
read -r -p 'Sin conversiones activas; escribir DRENADO: ' DRAIN_STATE
test "$DRAIN_STATE" = DRENADO
pm2 stop egem-backend
PREVIOUS_SHA=$(cat "$BACKUP/previous.sha")
git -C "$VPS_REPO" switch --detach "$PREVIOUS_SHA"
cp --preserve=all "$BACKUP/backend.env" "$ENV_REAL"
python3 "$BACKUP/restart-upload-backend.py" --backup "$BACKUP" --mode rollback --confirm-service-restart
curl --noproxy '*' --fail --max-time 5 http://127.0.0.1:4000/health
```

Si Pages ya se publicó, mantener pausa mientras se revierte **solo el commit de
cargas** mediante rama/PR y workflow Pages existente. No volver el sitio público a
c93: su versión estable previa es bf17e8b y conserva los cuatro ajustes aprobados.
No reescribir ramas compartidas. Comprobar contenido/health de versión estable.

Restaurar Nginx original (incluye 120M/TLS), retirar únicamente el snippet nuevo
creado por esta tarea, y restaurar dump PM2 si se llegó a guardar:

```bash
cp --preserve=all "$BACKUP/nginx.conf" "$NGINX_REAL"
nginx -t
systemctl reload nginx
rm -- "$SNIPPET"
if [ -f "$BACKUP/dump.pm2.before" ]; then
  cp -p "$BACKUP/dump.pm2.before" /root/.pm2/dump.pm2
elif [ -f "$BACKUP/dump.was-absent" ]; then
  rm -f -- /root/.pm2/dump.pm2
fi
if [ -f "$BACKUP/dump.pm2.bak.before" ]; then
  cp -p "$BACKUP/dump.pm2.bak.before" /root/.pm2/dump.pm2.bak
elif [ -f "$BACKUP/dump-bak.was-absent" ]; then
  rm -f -- /root/.pm2/dump.pm2.bak
fi
curl --noproxy '*' --fail --max-time 10 https://api-egem.geodinamica.mx/health
```

No eliminar worktrees, directorio original desactualizado, respaldos o sandbox. La
reversión de código es compatible con los metadatos JSON nuevos; no borrar registros
ni restaurar DB sobre altas recientes. Registrar cualquier recuperación de reserva
según docs/cargas-50-mib.md antes de reabrir.
