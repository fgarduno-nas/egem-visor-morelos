# Cargas de hasta 50 MiB por archivo

Estado vigente: **capacidad de conversión superada para el KMZ original**; no repetir ensayo. El procedimiento exacto y reversible está en [despliegue-cargas-50-mib.md](despliegue-cargas-50-mib.md). El flujo HTTP completo y la publicación siguen pendientes; no se ejecutó despliegue.

El contrato compartido está en `shared/upload-limits.js`: 52,428,800 bytes
inclusive, presentados como **50 MB**. El navegador valida antes de preparar la
vista previa y antes de construir/enviar multipart. El backend aplica el límite
en Multer, independientemente del navegador. Busboy señala truncamiento al alcanzar
su límite; por ello su umbral interno es 52,428,801 bytes. No admite ese byte extra.
`LIMIT_FILE_SIZE` responde HTTP 413 con el mensaje institucional. El cliente
normaliza también 413 HTML de un proxy. Multer elimina los temporales del multipart
rechazado, incluidos archivos previos del mismo envío.

## Inventario y diagnóstico

- Antes: no había validación general de tamaño en selección/envío; Multer usaba
  `MAX_UPLOAD_SIZE_MB`, con valor por defecto, ejemplo y entorno local de 100 MiB.
- Ahora: `MAX_UPLOAD_SIZE_MB=50`; valores distintos impiden iniciar el backend con
  una política diferente de la interfaz. La variable sigue existiendo y tiene un
  diagnóstico explícito de configuración.
- `express.json` y `urlencoded` conservan 5 MiB; no limitan el archivo multipart.
- El envío conserva cinco minutos. El receptor y el servicio frontend admiten **un archivo por solicitud**, de acuerdo con el formulario de publicación. La selección múltiple del importador local es un flujo distinto.
- KMZ usa el contrato compartido `shared/archive-limits.js`: 50 MiB comprimidos,
  450 MiB descomprimidos en total, 128 MiB por entrada y 250 entradas. Se valida
  además una relación máxima de compresión de 100:1 por entrada. Antes eran
  120 MiB por entrada en ambos importadores y 120 MiB comprimidos en el importador
  (con el receptor externo de 100 MiB). El navegador no comprobaba el total ni
  había una comprobación explícita de la relación de compresión. Permanecen las
  comprobaciones de rutas, tipos de entrada, imágenes y geometrías existentes.
  No se amplían límites de memoria, complejidad ni JSON. El cliente conserva
  cinco minutos; GDAL tiene ahora un plazo acotado de 180 s (antes ilimitado).
- El repositorio no contiene la configuración instalada del proxy del VPS. El usuario
  comprobó Nginx 120M y su ubicación; conservar ese límite. Falta el entorno activo del backend.
  Los 100 MiB locales no explican por sí solos un rechazo HTTP de unos 15 MB.
  El rechazo de `doc.kml` sí quedó identificado: superaba los 120 MiB internos,
  independientemente de la recepción HTTP. Para descartar otros rechazos de
  transporte hace falta revisar la configuración/logs del VPS;
  no se ha enviado ningún archivo al catálogo de producción para diagnosticarlo.

## Despliegue pendiente (no realizado)

1. Respaldar la configuración actual y revisar el diff. Desplegar juntos el módulo
   `shared/upload-limits.js`, `shared/archive-limits.js` y los archivos del backend; el import compartido vive
   fuera de `backend`, igual que los contratos institucionales existentes.
2. En el entorno del proceso backend establecer **`MAX_UPLOAD_SIZE_MB=50`** antes
   de arrancar la nueva versión. No son necesarias migraciones, cambios de
   PostgreSQL, catálogo, autenticación o CORS. Usar el gestor de servicios existente
   para reiniciar únicamente tras la aprobación del despliegue. Comprobar `/health`.
3. Inspeccionar en el VPS, en modo lectura, `nginx -T` (o configuración equivalente)
   y el entorno efectivo del servicio, sin divulgar secretos. En la ubicación
   existente que recibe `POST /api/v1/layers`, permitir margen multipart. Usar
   **conservar `client_max_body_size 120M;`**, confirmado en el VPS; no aplicar la propuesta anterior de 52m.
   Un límite de 50m al cuerpo completo rechazaría incluso un único archivo de
   exactamente 50 MiB. No confundir el límite agregado del proxy con el límite
   individual de Multer. Reutilizar las directivas de proxy/TLS existentes;
   comprobar asimismo cualquier CDN o proxy anterior. Validar `nginx -t` y recargar
   con el procedimiento operativo existente solamente al desplegar.
4. Publicar el frontend por el flujo existente de GitHub Pages, que ya incluye
   `shared/`. Pages **no actualiza el VPS**. Publicar solo la interfaz no basta.
5. Verificar con un usuario autorizado y un catálogo de pruebas: recepción,
   procesamiento, registro y visualización por separado. Revisar un 413 de proxy
   y uno del backend; no registrar cargas de prueba en el catálogo público real.

## Pruebas

`node --test tests/upload-size.test.mjs` comprueba -1, máximo y +1 byte por archivo
con recepción HTTP multipart real, limpieza de temporales y respuestas de tamaño.
Los GeoJSON con espacio final de esa prueba son datos sintéticos de transporte;
no acreditan procesamiento cartográfico. La validación con KMZ reales se documenta
por separado en las evidencias locales, fuera del repositorio.

## Diagnóstico del KMZ Inundaciones Pluviales (25 de octubre de 2026)

El original se inspeccionó en modo lectura. SHA-256:
`1a64382e22fb721a5041272ee48aaf857cd9e169f52748798eaf2723cc85b73f`.
El ZIP contiene dos entradas: `doc.kml` (129,486,449 bytes descomprimidos y
15,923,784 comprimidos) y un XSL (5,485 bytes descomprimidos). Archivo completo:
15,925,342 bytes (15,552.1 KiB); total descomprimido: 129,491,934 bytes;
relación global: 8.13:1. El KML supera los antiguos 120 MiB y cabe en 128 MiB.
La lectura XML por streaming verificó 24,196 Placemark, 93,105 Polygon,
95,267 LinearRing y 1,390,282 tuplas de coordenadas; no se simplificó el original.

El análisis aislado tardó aproximadamente 10 segundos y alcanzó 552 MiB RSS.
La prueba de construcción completa de XML/DOM en el navegador dejó la pestaña
sin responder durante más de dos minutos; hubo además fallos posteriores del
control automatizado del navegador, por lo que no se atribuye todo el bloqueo
exclusivamente a la complejidad cartográfica. Para no confundir aceptación con
capacidad de vista previa, los KML que suman más de 32 MiB se validan en el ZIP
sin inflarlos en el navegador. Se conserva la selección, clasificación y envío;
se muestra una explicación de que la visualización se hará desde el catálogo
después del procesamiento en servidor. **32 MiB es un presupuesto de vista
previa, no un límite de carga ni de procesamiento del backend.** Los archivos
pequeños conservan su vista previa automática. También aplica a KML directo.

Con el original, el backend local respondió HTTP 201 y `processed` tras 139 s,
con 24,196 elementos y pico observado de aproximadamente 1 GiB RSS. Se utilizó
exclusivamente la base aislada `egem_carga_50mib_20261024`. Antes del despliegue,
verificar memoria disponible y concurrencia en el VPS; esta medición local
no garantiza el rendimiento en el servidor o en todos los dispositivos.

El GeoJSON servido por el backend devuelve HTTP 200 y conserva los conteos del
original: 24,196 elementos MultiPolygon, 93,105 partes poligonales, 95,267 anillos
y 1,390,282 coordenadas. No se usó `-simplify` ni se editaron las geometrías.
Se comprobó la selección diferida en la interfaz, el aviso, la clasificación y
el botón de envío habilitado. **El usuario confirmó manualmente que se visualiza
«PRUEBA LOCAL — Inundaciones Pluviales (KMZ original)»** en su revisión posterior.
Es una validación manual del usuario sobre la capa local anterior, distinta de
las pruebas automatizadas y de la inspección de capacidad del VPS. La alternativa
para dispositivos que no puedan manejar el GeoJSON completo son teselas
vectoriales generadas en servidor a partir del original, como trabajo separado.

Los mensajes distinguen límite comprimido (50 MB), entrada interna (128 MiB),
total descomprimido (450 MiB), relación de compresión (100:1), cantidad de entradas
(250), rutas inseguras y tamaños inválidos. El backend limita la salida real de
inflate a 128 MiB y comprueba que coincida con la cabecera declarada. Las pruebas
`tests/archive-limits.test.mjs` verifican los mismos límites en ambos importadores,
fronteras inclusivas y la ruta diferida sin lectura del KML en el navegador.

## Diagnóstico inicial (25 de octubre de 2026; actualizado con datos del VPS al final)

La rama de trabajo es `codex/carga-capas-50mib`, en el worktree
`revision-publicada-morelos/egem-visor-morelos`. HEAD, `origin/main` y
`origin/desarrollo-visor` siguen en `bf17e8bc00928e330189a4f4bbcca5c48763c197`
tras fetch. Los cambios están sin confirmar y tienen respaldo recuperable fuera
del repositorio. No se modificó producción ni se reinició ningún servicio existente.

En la computadora del agente no hay acceso SSH configurado: solo existen `known_hosts` y su copia, no hay
claves/configuración SSH, el agente no está disponible y no hay sesiones PuTTY.
La API pública responde HTTP 200 y anuncia Nginx 1.24.0/Ubuntu. Eso **no demuestra**
recursos, límites, versión del backend ni ausencia de otros proxies/CDN. Los recursos, gestor y SHA aportados después por el usuario se incorporan en la actualización al final y sustituyen los desconocidos de este diagnóstico inicial.
El JavaScript público todavía contiene los límites anteriores de importación.

| Parámetro | Código/local verificado | Producción actual comprobada |
|---|---|---|
| Archivo recibido | 52,428,800 bytes inclusive; interfaz «50 MB» | Backend instalado c93d4cc: default 100 MiB; entorno activo pendiente. Nginx confirmado 120M, se conserva |
| Entrada descomprimida | 134,217,728 bytes, 128 MiB | Frontend publicado: 120 MiB; código backend c93d4cc: 120 MiB; configuración activa pendiente |
| Total descomprimido | 471,859,200 bytes, 450 MiB, ambos importadores | Frontend publicado sin esta comprobación; backend c93d4cc: 450 MiB en código |
| Entradas | 250, ambos importadores | Frontend publicado y código backend c93d4cc: 250 |
| Relación por entrada | 100:1, ambos importadores | Frontend publicado sin comprobación explícita; backend c93d4cc sin comprobación explícita |
| KML >32 MiB | Difiere vista previa; conserva archivo y permite procesamiento del servidor | Frontend publicado sin esta ruta |
| Variable de entorno | `MAX_UPLOAD_SIZE_MB=50`; otro valor impide arrancar explícitamente | Valor efectivo remoto desconocido |
| Concurrencia | Una solicitud de carga por raíz compartida de uploads | PM2 egem-backend: una instancia fork/root confirmada; ruta efectiva y exclusión objetivo pendientes |

El archivo de ejemplo y el entorno local usan 50. La validación de arranque
rechaza 100, probado en un proceso aislado. Los límites de archivo se comparten
por módulo; no dependen de un texto de ayuda o de que el navegador sea honesto.

### Recursos: qué se midió y qué falta

El pico anterior cercano a 1 GiB se leyó de `PeakWorkingSet64` del proceso Node
local después de procesar el KMZ: era el máximo residente de ese proceso durante
su vida, no el heap JavaScript ni una medida total del sistema. No incluía el
proceso hijo GDAL, PostgreSQL, navegador, proxy ni sistema operativo.

El nuevo ensayo aislado usó otra API en loopback, puerto 4002, sin reiniciar
la revisión anterior en 4000/4174. Una sola conversión del original alcanzó el
estado `processed`; se observó finalizada tras aproximadamente 135 s, incluyendo
sondeo y recuperación. Se abortó deliberadamente el cliente después del registro.
El servidor continuó; otra carga recibió 503; el reintento devolvió el mismo ID
`cmvnvtbhr0003wczsuob7jir1`, con un único registro y 24,196 elementos.

En ese proceso, el pico residente de Node fue **1,037 MiB**; incluye el hilo
principal y los workers, pero no GDAL. El hijo GDAL tuvo **337 MiB observados**.
El muestreo fue cada dos segundos: no recoge necesariamente sus picos exactos
ni permite sumar máximos como si fueran simultáneos. RSS no equivale a heap,
memoria privada comprometida ni consumo completo de un cgroup. El diagnóstico
local de V8 mostró 2,240 MiB de límite de heap; no se modificaron flags de memoria.
El RSS puede conservar páginas del asignador incluso después de salir un worker.

Durante el ensayo se hicieron 67 lecturas de `/health`, todas correctas, con
latencia máxima observada de 54 ms. Es una comprobación de atención de solicitudes
durante una conversión local, **no una prueba de estrés ni un benchmark del VPS**.
Se verificó el hash del original; no hubo simplificación de geometrías.

RAM/swap/CPU/disco, margen instantáneo, gestor root/PM2 y ausencia de cuotas del
servicio pm2-root ya fueron comprobados por el usuario (tabla actualizada al final).
Faltan cuotas/cgroups antecesores, consumo de otros procesos y margen durante la
conversión, límites ACTIVOS de Node/PM2, ruta efectiva de uploads, uso temporal del
proxy, versiones Node/GDAL e intermediarios HTTP. 450 MiB de contenido permitido no implica
450 MiB de RAM: XML, objetos y GeoJSON pueden multiplicar ese consumo. No aprobar
producción basándose únicamente en el pico del ejemplo o en memoria libre del host
si el contenedor tiene una cuota menor.

### Tiempos de espera y cuerpo multipart

| Componente | Verificado localmente | Producción |
|---|---|---|
| Cliente POST de capa | 300,000 ms, incluye envío y respuesta, sin reintentos automáticos | También 300,000 ms en JS público |
| Otras peticiones del cliente | 12,000 ms de configuración habitual; contrato previo es otra petición | No confundir con plazo de carga |
| Node `requestTimeout` | 300,000 ms: recepción del request, no plazo de conversión | Versión/valor real desconocidos |
| Node `headersTimeout` | 60,000 ms | Desconocido |
| Node `timeout` | 0, sin timeout de inactividad del socket configurado | Desconocido |
| Node `keepAliveTimeout` | 5,000 ms tras respuesta; no limita la conversión activa | Desconocido |
| GDAL | Nuevo máximo de 180 s para el proceso externo, con terminación y fallo registrado | No desplegado; antes no había timeout en código |
| Proxy/intermediarios | Se conserva cuerpo 120M; plazo por ruta pendiente de medición | Nginx confirmado 120M; sin timeout explícito en salida aportada, defaults condicionados a herencia completa |

La propuesta anterior de **52 MiB** queda sustituida por conservar **120M**, ya
configurado en el VPS. El presupuesto mínimo del flujo es un archivo de 50 MiB más
metadatos y delimitadores; 120M ya lo cubre sin cambiar producción.
Multer conserva su límite existente de 1 MiB por campo; no se amplía. Este margen
no autoriza metadatos ilimitados: una solicitud con metadatos extraordinariamente
grandes puede alcanzar el límite agregado del proxy. No se prometen todas las
combinaciones de campos de 1 MiB. El formulario envía diez campos escalares como
máximo, dos leyendas opcionales y etiquetas; los valores normales quedan muy por
debajo del margen. Los nombres/cabeceras también consumen parte de esos 2 MiB.

**240 s no se consideran suficientes ni aprobados por la duración local.** La
plantilla ya no configura ese timeout. Para decidirlo se necesita medir en un
entorno aislado con los mismos recursos, cuotas, GDAL y almacenamiento del VPS:
recepción, descompresión, conversión, registro/respuesta y latencias concurrentes
ligeras. Repetir con tamaños/complejidades representativos, sin estrés ni catálogo
de producción. Registrar duración máxima observada, consumo y variabilidad;
justificar margen por esa variación y la carga habitual. Verificar plazos de
cliente (300 s totales), recepción Node (300 s), GDAL (180 s solo conversión),
proxy y CDN/WAF: `proxy_read_timeout` limita inactividad entre lecturas del upstream,
no tiempo total de solicitud; sin respuesta intermedia debe cubrir todo el trabajo
previo a responder. El plazo del cliente además incluye subida y red. Revisar
recursos y plazos con evidencias antes de fijar un valor en la configuración.
No se cambian globalmente buffers, JSON (5 MiB), cabeceras ni memoria.
Si la medición del VPS no cabe en este presupuesto, no seguir elevándolo: se
requiere aceptación 202 y trabajo duradero consultable, como cambio separado.
La propuesta Nginx aún necesita validar herencia, ubicación y `nginx -t` en el VPS.

### Protección preparada del flujo

- `guardedUpload` se ejecuta después de autenticación, rol y contrato institucional,
  antes de Multer. Una reserva exclusiva `uploads/.runtime/layer-upload.lock`
  impide dos cargas incluso en procesos distintos que comparten esa raíz.
  No crea una cola en memoria. Devuelve 503/`UPLOAD_BUSY` y `Retry-After: 15`.
- Todas las instancias deben usar la misma raíz persistente y permisos compatibles.
  Instancias con otro volumen o código anterior no respetan la reserva: bloquear
  el despliegue hasta verificarlas. Una reserva tras caída falla cerrada y requiere
  inspección administrativa; no caduca ni se borra automáticamente mientras otro
  proceso podría seguir trabajando.
- La descompresión, análisis, conversión y resumen de altas GeoJSON pasan a workers.
  Se espera su salida antes de liberar la reserva; los archivos KML internos se
  evalúan secuencialmente conservando la misma elección de documento principal,
  sin retener todos sus textos a la vez. No se eleva el heap ni se cambian datos.
- Hay lecturas síncronas históricas en consultas, por ejemplo el fallback de
  leyendas cuando no están persistidas. El ensayo del KMZ no certifica todas las
  consultas o formatos, ni el rendimiento bajo tráfico real del VPS.
- `Idempotency-Key` UUID v4 es obligatorio. La interfaz lo conserva tras un fallo
  de conexión o recarga, y el backend busca por usuario y clave y compara metadatos
  y checksums. Un reintento reutiliza la capa; un conflicto responde 409. Tras
  confirmar una respuesta, la interfaz libera la clave para una nueva carga
  intencionada. Clientes antiguos reciben 409 con instrucción de recargar antes
  de recibir archivos; los clientes externos deben conservar la clave al reintentar.
- Si se cancela la recepción, se cierra y retira el parcial. Errores de validación,
  rechazo y copias redundantes de reintentos retiran los archivos no registrados.
  Los nombres almacenados incluyen UUID y no pisan otra carga.
- Tras registrar una capa, se completa el trabajo aunque se desconecte el cliente.
  La reserva no se libera por `res.close`. Se conservan originales vinculados al
  catálogo para descarga/auditoría, también si falla la conversión; se retiran
  salidas procesadas incompletas. No confundir originales persistidos con temporales.
- No hay cola duradera ni recuperación automática tras reinicio/OOM del proceso.
  Una caída puede dejar un registro pendiente y una reserva; no reintentar creando
  otra capa ni retirar la reserva hasta inspeccionar procesos y archivos. El
  despliegue necesita pausa y drenaje de cargas. No se añadieron migraciones,
  dependencias ni cambios de autenticación, permisos, clasificación o CORS.

### Auditoría de lectura preparada

`ops/audit-upload-capacity.py` filtra secretos: no imprime `.env`, argumentos
completos, cabeceras de autorización ni el JSON íntegro de PM2/Docker/Nginx.
No inicia PM2 si no comprueba un daemon existente del usuario/PM2_HOME. Examina
RAM/swap/CPU/disco, procesos, cgroups v2, entorno seleccionado, flags de memoria,
systemd/PM2/contenedor opcionales y declaraciones filtradas de Nginx. Los valores
de `/proc/environ` son iniciales: hay que correlacionar dotenv y configuración
del gestor. El SHA del disco no demuestra por sí solo el código cargado en RAM.

Ejemplo exacto parametrizado desde una terminal con Python y acceso SSH existente:

```bash
python3 ops/audit-upload-capacity.py --self-test
python3 ops/audit-upload-capacity.py --ssh "$SSH_TARGET" --ssh-port "$SSH_PORT" \
  --ssh-key "$SSH_KEY" --backend-root "$VPS_BACKEND" --uploads "$VPS_UPLOADS" \
  --unit "$SYSTEMD_UNIT" > auditoria-vps-filtrada.json
```

El script viaja por stdin; no instala archivos remotos. Omitir `--ssh-key` si se
usa un agente ya configurado, y `--unit` si no existe. Para PM2 usar `--pm2` con
su usuario/PM2_HOME; para contenedor `--container NOMBRE_VERIFICADO`. Sin SSH,
ejecutar el mismo script dentro de una sesión administrativa existente, sin esas
opciones de transporte. No habilitar SSH, Docker, inspector Node ni otro servicio
para esta auditoría. Faltan precisamente destino/usuario/puerto/autenticación y
rutas/gestor reales; **estos comandos no se ejecutaron contra producción**.

### Aplicación futura y reversión: orden obligatorio

No ejecutar hasta resolver BLOQUEADO y recibir autorización de publicación.
Los nombres/rutas siguientes son parámetros que deben salir de la auditoría;
no se inventan valores del VPS. Se asume árbol completo del repositorio, incluidos
`shared/` y los workers. Los esquemas Prisma de esta tarea no cambian.

1. **Proxy y operación:** respaldar configuración y entorno con permisos protegidos;
   pausar solo POST de capas mediante el mecanismo de mantenimiento existente y
   drenar conversiones actuales. Antes del primer despliegue, la ausencia del
   archivo de reserva nuevo no demuestra que el backend anterior esté inactivo.
2. **Backend:** desplegar el release aprobado y configurar 50 en la fuente efectiva
   del entorno. No elevar memoria, instancias ni cuotas sin presupuesto medido.
   Todas las instancias deben respetar la reserva compartida. Verificar salud,
   versión, entorno, espacio y errores de arranque antes de permitir cargas.
3. **Proxy:** incorporar las dos directivas propuestas solo en la ubicación que
   realmente recibe la carga. Mantener upstream/TLS/headers y origen CORS; comprobar
   que `Idempotency-Key` llega al backend y que OPTIONS lo permite. Validar y
   recargar únicamente cuando se apruebe. Verificar también CDN/WAF/intermediarios.
4. **Frontend:** integrar y publicar por el workflow existente de Pages
   `.github/workflows/deploy-pages.yml`, que ya copia `js/` y `shared/`. Pages no
   despliega el VPS. Verificar el cache-buster `upload-reliability` y el helper nuevo.
   La interfaz anterior debe pedir recarga, no hacer altas sin clave.
5. Retirar la pausa solo con todas las verificaciones satisfactorias. No probar
   archivos falsos en el catálogo público; usar staging equivalente al VPS para
   la prueba representativa, cancelación, reintento y atención de consultas.

Receta parametrizada para **systemd**, únicamente si ese gestor se confirma;
no sustituye su flujo existente. Preparar antes `VPS_REPO`, `ENV_FILE`,
`SYSTEMD_UNIT`, `NGINX_CONF`, `RELEASE_SHA` y `UPLOADS_PAUSED=yes`:

```bash
set -euo pipefail
: "${VPS_REPO:?}" "${ENV_FILE:?}" "${SYSTEMD_UNIT:?}" "${NGINX_CONF:?}" "${RELEASE_SHA:?}"
test "${UPLOADS_PAUSED:?}" = yes
test -z "$(git -C "$VPS_REPO" status --porcelain --untracked-files=no)"
PREVIOUS_SHA=$(git -C "$VPS_REPO" rev-parse HEAD)
BACKUP_DIR="/var/backups/egem-upload-$(date -u +%Y%m%dT%H%M%SZ)"
sudo install -d -m 700 "$BACKUP_DIR"
sudo cp --preserve=all "$ENV_FILE" "$BACKUP_DIR/backend.env"
sudo cp --preserve=all "$NGINX_CONF" "$BACKUP_DIR/nginx.conf"
printf '%s\n' "$PREVIOUS_SHA" | sudo tee "$BACKUP_DIR/backend.sha" >/dev/null
# Confirmar drenaje y el release completo previamente revisado.
git -C "$VPS_REPO" fetch origin
sudo systemctl stop "$SYSTEMD_UNIT"
git -C "$VPS_REPO" switch --detach "$RELEASE_SHA"
sudo python3 - "$ENV_FILE" <<'PY'
import re,sys
from pathlib import Path
p=Path(sys.argv[1]);s=p.read_text()
pattern=r'(?m)^MAX_UPLOAD_SIZE_MB=.*$'
s=re.sub(pattern,'MAX_UPLOAD_SIZE_MB=50',s) if re.search(pattern,s) else s+'\nMAX_UPLOAD_SIZE_MB=50\n'
p.write_text(s)
PY
sudo systemctl start "$SYSTEMD_UNIT"
sudo systemctl is-active "$SYSTEMD_UNIT"
```

El bloque asume que `ENV_FILE` es la fuente efectiva y no existe otro override.
Si PM2/systemd/contenedor la sobrescribe, editar **esa fuente verificada** y
conservar su copia. Para PM2 usar el flujo existente y `--update-env` con 50;
para Docker faltan imagen/volúmenes/compose reales, por lo que no se proporcionan
comandos ficticios de recreación. No hay Dockerfile del backend en este repositorio.

En el proxy, con uploads aún pausados, añadir el contenido de
`ops/upload-proxy-limits.conf.example` en la ubicación existente mediante
`sudoedit "$NGINX_CONF"`; no reemplazar el servidor completo. Después:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

Para revertir: mantener/recuperar la pausa, drenar, restaurar backend y entorno,
restaurar el archivo proxy respaldado y validar antes de recargar. No borrar
uploads, catálogo, respaldos ni reservas como parte del rollback. No usar reset,
clean o force push. Ejemplo, solo si no hubo otros cambios posteriores en entorno
o proxy (si los hubo, revertir únicamente las líneas de esta tarea):

```bash
: "${BACKUP_DIR:?}" "${VPS_REPO:?}" "${ENV_FILE:?}" "${NGINX_CONF:?}" "${SYSTEMD_UNIT:?}"
test "${UPLOADS_PAUSED:?}" = yes
sudo systemctl stop "$SYSTEMD_UNIT"
PREVIOUS_SHA=$(sudo cat "$BACKUP_DIR/backend.sha")
git -C "$VPS_REPO" switch --detach "$PREVIOUS_SHA"
sudo cp --preserve=all "$BACKUP_DIR/backend.env" "$ENV_FILE"
sudo cp --preserve=all "$BACKUP_DIR/nginx.conf" "$NGINX_CONF"
sudo nginx -t
sudo systemctl start "$SYSTEMD_UNIT"
sudo systemctl reload nginx
```

Para frontend, revertir los commits de carga aprobados mediante una rama/PR y el
mismo workflow Pages, sin reescribir ramas compartidas. No revertir `bf17e8b`,
que contiene los cuatro ajustes anteriores. Retirar la pausa después de comprobar
la combinación de versiones: frontend antiguo + backend que exige clave bloquea
las altas de forma segura con 409. Si hay reserva tras caída, con cargas pausadas,
inspeccionar PID/host/fecha y procesos GDAL, corregir el registro pendiente y mover
la reserva a una copia de diagnóstico **solo cuando se confirme que ya no existe
trabajo activo**; nunca eliminarla automáticamente para forzar un reintento.

**Criterio de salida actualizado:** hay recursos/gestor confirmados por consultas del usuario; sigue BLOQUEADO hasta completar las comprobaciones activas y la prueba aislada del VPS,
comprobar margen de proceso/cgroup/sistema y disco, comprobar una raíz compartida
entre todas las instancias, confirmar plazos efectivos de extremo a extremo y
validar la propuesta Nginx. Las pruebas locales y la confirmación visual del usuario
son evidencia favorable, no sustituyen esas comprobaciones.

### Comprobaciones finales de esta revisión

- Suite completa: **503 pruebas aprobadas, 0 fallidas**; evidencia `tests-resultado-final.tap`.
- Tras el último ajuste de confirmación de reintentos: **11 pruebas de fiabilidad aprobadas**.
- Sintaxis de todos los JavaScript/MJS modificados y nuevos comprobada; auditor Python compilado sin generar artefactos y filtros de secretos aprobados mediante `--self-test`.
- `git diff --check` sin errores. No se hicieron commit, push, merge, despliegue ni cambios/reinicios de producción.
- La visualización del KMZ original fue confirmada manualmente por el usuario; se distingue del ensayo automatizado aislado y no acredita capacidad del VPS.


## Revisión del flujo de un archivo y operación segura

| Formato del formulario | Archivos externos por carga | Observación |
|---|---:|---|
| KML | 1 | Referencias externas no se convierten en archivos multipart adicionales |
| KMZ | 1 | KML, imágenes y otros recursos van dentro del ZIP; siguen sus protecciones |
| GeoJSON | 1 | Un documento |
| TIFF/GeoTIFF | 1 | Se conserva el flujo actual; no se añade soporte a ficheros auxiliares |
| Shapefile ZIP | 1 | El procesador exige dentro `.shp`, `.shx`, `.dbf`; admite auxiliares existentes |
| SHP/DBF/PRJ/CPG sueltos | 1 seleccionable | Extensiones heredadas siguen aceptadas; no constituyen un conjunto procesable en este formulario. Usar ZIP. No ampliar selección múltiple para remediarlo en esta tarea |

No se habilitaron diez archivos. Se redujo el receptor heredado a uno y se valida
el número antes de enviar. El importador local múltiple mantiene sus funciones.
La propuesta anterior de 52 MiB queda retirada: **conservar 120M** en el contexto actual del VPS. Multer sigue limitando a un archivo de 50 MiB inclusive.

### Auditoría desde la consola del VPS

Transferir únicamente `ops/audit-upload-capacity.py` revisado a una ruta auxiliar
(por ejemplo `/tmp/audit-upload-capacity.py`); no necesita instalarse ni ejecutar
el backend nuevo. Requiere Python **3.9 o posterior** y herramientas ya existentes.
La ausencia de una herramienta se informa, no se instala. Desde la consola:

```bash
read -r -p 'Ruta absoluta al backend vigente: ' BACKEND_ROOT
read -r -p 'Ruta absoluta efectiva de uploads: ' UPLOAD_ROOT
python3 /tmp/audit-upload-capacity.py --self-test
python3 /tmp/audit-upload-capacity.py --backend-root "$BACKEND_ROOT" --uploads "$UPLOAD_ROOT"
```

Añadir `--unit NOMBRE.service` si usa systemd, `--pm2` si usa PM2, o
`--container NOMBRE` si usa Docker, usando nombres reales sin credenciales.
Primero ejecutar como usuario del servicio. Si faltan lecturas de `/proc`, `.env`,
configuración Nginx/certificados o cgroups, repetir con `sudo python3 ...` y los
mismos argumentos. Ese privilegio permite **leer** esos recursos y ejecutar
`nginx -T`, no recargarlo. Docker puede requerir permiso al socket; no agregar
usuarios/grupos ni cambiar permisos para esta auditoría. PM2 debe consultarse con
el usuario y `PM2_HOME` existentes: sudo sin ese contexto puede omitirlo. El script
comprueba el daemon antes de `jlist` para no iniciarlo. Si faltan permisos, compartir
el estado incompleto y pedir la lectura al administrador, sin modificar servicios.

Compartir **solo el JSON filtrado** que imprime y los errores de permisos o
herramientas ausentes. Revisar antes de enviarlo: contiene rutas, nombres de host,
IP/dominios y procesos, que pueden anonimizarse conservando correspondencias.
No compartir `.env`, `pm2 jlist` crudo, `docker inspect` crudo, `nginx -T` crudo,
claves, tokens ni volcados de variables. El script filtra un conjunto permitido
de variables/directivas, omite Authorization y credenciales/URL privada del
upstream; su autoprueba comprueba esos filtros. No imprime las salidas crudas de
los inspectores ni mensajes stderr que podrían contener secretos.

El script solo ejecuta consultas y lee archivos: no instala, no escribe estado
remoto, no importa módulos del proyecto, no elimina reservas ni reinicia servicios.
Redirigir su JSON a un archivo es opcional y crea únicamente ese informe.
La auditoría no mide una conversión ni su pico, no resuelve automáticamente herencia
Nginx, cuotas de cgroups antecesores/v1, configuración de CDN/WAF ni valores de
dotenv cargados posteriormente en memoria. Estas comprobaciones siguen pendientes
si el informe no las demuestra. Un SHA en disco no prueba qué código está cargado.

### Reserva tras caída: diagnóstico y recuperación, no ejecutados

1. Una respuesta 503/`UPLOAD_BUSY` indica reserva, no demuestra caída. Leer el
   JSON de `.runtime/layer-upload.lock` **localmente**, sin divulgar su token;
   cotejar host, PID y fecha con procesos, inicio del proceso y namespace. No
   declarar huérfana por antigüedad, PID ausente en otro host o timeout del cliente.
2. Si el proceso propietario o una conversión/descendiente GDAL siguen trabajando,
   **no mover ni eliminar la reserva**. Esperar e inspeccionar estado/logs. El worker
   se espera hasta `exit`; la reserva no depende de `res.close`. Las pruebas cubren
   cancelación con trabajo activo y rechazo de una segunda carga.
3. Si hubo caída, pausar las altas mediante el mecanismo existente. Antes de
   recuperar, comprobar todos los procesos/hosts/contenedores que compartan la
   raíz, que ninguno recibe cargas ni sigue convirtiendo, incluidos GDAL huérfanos.
   El PID puede reutilizarse. No inferir seguridad a partir de una única instancia.
   Parar/drenar procesos solo en una intervención futura autorizada, no durante
   esta auditoría. Si no se puede demostrar ausencia de trabajo, mantener bloqueo.
4. Revisar el registro del usuario con `uploadRequestId`, fingerprint, archivos
   originales y estado de procesamiento. Si ya está procesado, recuperar el mismo
   ID; no volver a crear la capa. Si quedó pendiente/fallido, no borrar el registro
   ni inventar otra clave: el reintento devuelve ese registro, **no reanuda** un
   trabajo perdido. La reanudación exige intervención de recuperación autorizada
   sobre ese mismo registro; no existe recuperación automática persistente.
5. Solo con altas pausadas y ausencia de todos los trabajadores confirmada, mover
   la reserva a una copia diagnóstica con nombre único, conservando sus permisos.
   Ejemplo futuro: `mv -n -- "$UPLOAD_ROOT/.runtime/layer-upload.lock" "$UPLOAD_ROOT/.runtime/layer-upload.lock.recovery-$(date -u +%Y%m%dT%H%M%SZ)"`.
   No ejecutar si queda cualquier duda de actividad, ni sobrescribir una copia.
   No borrar originales, catálogo ni salidas parciales sin revisar su pertenencia.
   Reabrir únicamente tras resolver el registro pendiente y comprobar salud.

La exclusión está probada entre procesos locales con la misma raíz. VPS: una instancia PM2 fork confirmada. **Pendiente**: comprobar procesos adicionales, rutas canónicas y montajes,
UID/permisos comunes y semántica de creación exclusiva del filesystem. Raíces
separadas, versiones viejas o namespaces sin volumen compartido invalidan la
exclusión global; no publicar hasta resolverlos. El informe facilita rutas/procesos,
pero no puede certificar por sí solo esa topología ni la recuperación tras caída.

Validación de la revisión de solicitud única: **504 pruebas aprobadas, 0 fallidas**
(`tests-un-archivo-validado.tap`). Incluye rechazo de dos archivos en el servicio
frontend y en recepción multipart real, límites -1/exacto/+1, exclusión y cancelación.
Se actualizó una aserción heredada que esperaba diez archivos; autenticación y
permisos permanecen. Sintaxis JavaScript/Python, autoprueba de filtros y
`git diff --check` correctos. La auditoría Linux sigue pendiente de ejecución real.

## Actualización con evidencias reales del VPS y preparación reversible

**Fuente:** consultas de solo lectura realizadas por el usuario y comunicadas en
esta conversación. Son evidencia aportada, no mediciones ejecutadas por el agente.
Estas cifras sustituyen los «desconocidos» del diagnóstico inicial para recursos y
gestor. No equivalen todavía a una prueba de conversión del VPS.

| Comprobación | Confirmado | Pendiente |
|---|---|---|
| RAM | 7.8 GiB total, 7.0 GiB disponible al consultar, sin swap | Margen y picos durante conversión; cgroups antecesores |
| CPU/disco | 2 CPU, 90 GB libres | Cuota efectiva del proceso y rendimiento bajo límite de ensayo |
| Node | Unos 274 MiB en reposo | Ejecutable/versión, flags y NODE_OPTIONS activos |
| PM2 | egem-backend, una instancia fork, root | jlist filtrado activo; max_memory_restart null y node_args [] solo se comprobaron en configuración guardada |
| systemd | pm2-root.service sin MemoryMax/MemoryHigh/CPUQuota restrictivos | Controles de padres y proceso activo |
| Código | /opt/egem-visor-morelos, HEAD c93d4ccaea0b305e43b3366789ddaa30a2b8e55a, árbol limpio | Confirmar que el proceso arrancó con ese código, no solo SHA en disco |
| cwd | /opt/egem-visor-morelos/backend | UPLOAD_BASE_DIR efectivo y ruta canónica; directorio backend/uploads existe |
| Nginx | /etc/nginx/sites-enabled/egem-backend, HTTPS api-egem.geodinamica.mx, proxy localhost:4000, client_max_body_size 120M, TLS Certbot | Herencia completa y posibles intermediarios externos |

**Decisión de tamaño:** conservar **120M**. Ya supera 50 MiB más metadatos y no
hay motivo para cambiarlo. El receptor nuevo impone 50 MiB inclusive y un archivo;
no se habilitan diez archivos ni se aumenta el máximo del proxy. Las propuestas
anteriores de 510m y 52m quedan retiradas. No confundir límite de solicitud y archivo.

### Diferencia instalada → objetivo (comparación local de Git)

`git fetch origin` mantiene HEAD/origin/main/origin/desarrollo-visor en
bf17e8bc00928e330189a4f4bbcca5c48763c197. c93d4cc es antecesor; entre ambos hay
cuatro commits: f1543ef (cartografía), f76ca93 (móvil), 036ca9e (bienvenida/popups)
y bf17e8b (cuatro ajustes aprobados). **Ninguno cambia backend/ ni shared/.**

Se compararon c93d4cc, HEAD y árbol objetivo pendiente. `backend/package.json`,
`backend/package-lock.json`, `backend/prisma/schema.prisma` y todas las migraciones
son idénticos en los tres estados. No se requieren nuevas dependencias, migración,
seed ni generación Prisma por estos cambios. El estado aplicado real de migraciones
y versiones instaladas no se deduce del árbol: antes de publicar, comprobar los
paquetes instalados sin reinstalar; no ejecutar migraciones exploratorias.

El objetivo aún no tiene SHA propio: es el diff sin confirmar de esta rama. Cambia
recepción/errores/env, importación y procesamiento en worker, exclusión/reintentos,
y añade contratos compartidos; además frontend, pruebas y documentación. No hacer
`git pull && pm2 restart`: desplegar posteriormente una revisión explícita aprobada,
incluyendo shared/ y los nuevos workers, tras comprobar nuevamente estado limpio.
Compatibilidad: env MAX_UPLOAD_SIZE_MB debe ser 50 en la fuente efectiva (otro valor
impide arrancar); frontend nuevo debe enviar Idempotency-Key. Frontend viejo contra
backend nuevo recibe 409 en altas: coordinar la ventana de actualización y cachés.
Los cuatro ajustes y cartografía vigentes permanecen; la base de datos y uploads
no se cambian. Reutilizar dependencias instaladas solo si coinciden con lockfile.
Node con worker_threads/ESM y GDAL deben estar disponibles: consultar sus versiones,
no instalar ni actualizar automáticamente durante la auditoría.

### 1. Transferencia simple, sin suponer acceso a GitHub

La consola web Hostinger es una terminal, no implica transferencia de archivos.
No pegar 16 MB de base64 ni publicar un servidor temporal para entregarlos.
Preparado fuera del repo: `egem-capacity-vps-20261025.tar.gz` (~15.9 MB) y su
archivo `.sha256`, en el directorio de evidencias `prepublicacion-20261025`.
Contiene 19 archivos de código permitidos, manifest con SHA256 y el KMZ original
como fixture.kmz. No contiene .env, DB, credenciales, node_modules ni configuración
Nginx. **Es paquete de ensayo, no de despliegue.** El código es la instantánea
pendiente local; no se supone que esté en GitHub.

Desde PowerShell, usar IP y puerto SSH del panel Hostinger (son los únicos datos
de conexión que faltan; el dominio API no demuestra destino o puerto SSH). Usa
el acceso existente; ninguna contraseña se incluye en comandos o informes:

```powershell
$VpsHost = Read-Host 'IP o host SSH del VPS según Hostinger'
$VpsPort = Read-Host 'Puerto SSH según Hostinger'
$Evidence = 'C:\Users\Geodinamica\.codex\visualizations\2026\10\24\01a16fa4-ee11-7740-a537-c4bd9c47745b\prepublicacion-20261025'
scp -P $VpsPort "$Evidence\egem-capacity-vps-20261025.tar.gz" "$Evidence\egem-capacity-vps-20261025.sha256" "root@${VpsHost}:/tmp/"
```

Si solo se dispone de consola web y no hay acceso SSH/SFTP habilitado, detenerse:
solicitar al administrador transferencia de esos dos archivos a /tmp por su canal
existente. No habilitar SSH, abrir puertos ni cambiar autenticación en esta tarea.

En la consola Hostinger, los siguientes pasos **escriben únicamente archivos del
ensayo**. No se han ejecutado; ejecutar tras revisar el procedimiento:

```bash
cd /tmp
sha256sum -c egem-capacity-vps-20261025.sha256 || exit 1
umask 077
CASE=$(mktemp -d /var/tmp/egem-capacity-XXXXXXXX)
chmod 700 "$CASE"
tar -xzf /tmp/egem-capacity-vps-20261025.tar.gz -C "$CASE"
printf 'Sandbox: %s\n' "$CASE"
```

No extraer en /opt ni sobre uploads. Conservar CASE y la sesión, o anotar la ruta
impresa. Si cambia cualquier script, regenerar paquete/hash antes de transferir.

### 2. Solo las consultas activas que faltan

Primero, sin arrancar app/Prisma/PM2, el helper lee /proc y usa únicamente
`dotenv.parse` instalado para interpretar la configuración sin imprimir secretos:

```bash
cd /opt/egem-visor-morelos/backend
env -u NODE_OPTIONS node "$CASE/ops/active-upload-config.mjs" /opt/egem-visor-morelos/backend
```

Compartir su JSON: executable, cwd, processCountMatchingCwd, uploadCandidate,
uploadRealpath, uploadSource, API prefix y flags de memoria permitidos. Debe mostrar
un proceso coincidente; no seleccionar automáticamente uno si aparecen varios.
La precedencia del código es entorno inicial → .env → uploads relativo a cwd.
Si no hay override, la ruta es /opt/egem-visor-morelos/backend/uploads. El helper
no declara efectivo un valor de .env si pudo cambiar tras arrancar. Indica fecha
del archivo y ticks de inicio; completar con `getconf CLK_TCK` si hace falta
comparar. No reiniciar ni adjuntar depurador para resolver una incertidumbre.

Con la ruta canónica verificada, sustituirla al responder al prompt:

```bash
read -r -p 'Ruta canónica de uploads comprobada: ' UPLOAD_ROOT
python3 "$CASE/ops/audit-upload-capacity.py" --self-test
python3 "$CASE/ops/audit-upload-capacity.py" \
  --backend-root /opt/egem-visor-morelos/backend --uploads "$UPLOAD_ROOT" \
  --pm2 --unit pm2-root.service > "$CASE/audit-filtered.json"
cat "$CASE/audit-filtered.json"
node --version
ogr2ogr --version
npm ls --depth=0 --omit=dev
```

El auditor se ejecuta como root existente: necesita leer /proc, .env y Nginx; no
instala, no recarga y filtra PM2 activo antes de imprimir. No compartir salidas
crudas de pm2 env/jlist, .env, docker inspect ni nginx -T. npm ls no instala ni
corre hooks; informa paquetes ausentes/inválidos sin repararlos. La versión Node
del shell puede diferir del ejecutable mostrado por /proc: contrastar ambas.

Intermediarios: `getent ahosts api-egem.geodinamica.mx` y, en el panel DNS/Hostinger,
confirmar si hay CDN/proxy/WAF/Load Balancer y sus plazos máximos. DNS directo no
prueba ausencia de otros saltos. Compartir solo confirmación del panel y límites,
no credenciales. El auditor Nginx muestra declaraciones y contextos; revisar la
herencia http/server/location sin publicar la configuración completa. Una instancia
fork está confirmada; falta descartar otros backends/hosts con la misma ruta y
corroborar filesystem/volumen. No asumir exclusión global en raíces separadas.

### 3. Ensayo de una conversión, aislado y limitado (aún no ejecutado)

Requisitos existentes a comprobar: Python >=3.9, Node del proceso productivo,
GDAL, systemd-run y cgroup v2. **No se instala nada**. Si falta alguno, informar y
no improvisar un ensayo sin límites. Se crea un enlace en el sandbox a dependencias
instaladas, de solo lectura desde el servicio de ensayo; no se modifica /opt:

```bash
test -d /opt/egem-visor-morelos/backend/node_modules || exit 1
ln -s /opt/egem-visor-morelos/backend/node_modules "$CASE/backend/node_modules"
read -r -p 'Ejecutable Node absoluto mostrado por el helper: ' NODE_BIN
python3 "$CASE/ops/watch-isolated-capacity.py" \
  --sandbox "$CASE" --node "$NODE_BIN" --run-isolated
```

Este último comando es **una prueba con escrituras aisladas**, no una consulta
read-only: crea una unidad transitoria egem-capacity-<UUID> (no PM2), logs e informe
y salidas en CASE/output. No requiere reiniciar servicios existentes, tocar Nginx,
crear DB/usuario, usar catálogo ni uploads reales. No escucha HTTP. El runner no
importa Prisma/app; usa valores ficticios y DB localhost:1 que nunca se consulta.
Se comprueba SHA256 del KMZ antes/después; no se simplifican geometrías.

Aislamiento: CPUQuota=100% (un núcleo de los dos), MemoryHigh=1536M,
MemoryMax=2G, sin swap, TasksMax=64, Nice=10, IOWeight=25, plazo global 240 s,
KillMode=control-group y 10 s para terminar. Filesystem protegido con escritura
solo en CASE y /tmp privado; solo sockets Unix (no red del proceso de conversión).
Si systemd rechaza propiedades, **no repetir quitando protecciones**. La presión
controlada sobre el VPS no garantiza impacto cero; planificar una ventana tranquila.

Antes de empezar exige MemAvailable >=4 GiB, disco libre >=8 GiB y tres /health
locales <1 s/HTTP200. Cada cinco segundos mide memoria disponible, disco, memoria
y CPU del cgroup completo (Node+worker+GDAL) y /health productivo sin leer cuerpos.
**Parar solo la unidad del ensayo** si disponibles <2 GiB, disco <5 GiB, dos
consultas seguidas fallan o tardan >1 s, o duración >=240 s. Timeout HTTP de sonda
2 s. RuntimeMaxSec y MemoryMax son límites adicionales independientes del monitor.
No reintentar automáticamente tras fallo/umbral ni confundir OOM del sandbox con
capacidad ilimitada del host. El cupo de CPU puede hacer la prueba más lenta que
producción; anotarlo al interpretar resultados.

Compartir `capacity-filtered.json` (también se imprime), no conversion-private.log.
Registra resultado, duración, métricas cgroup y salud. MemoryPeak si está disponible
es pico conjunto; muestras cada 5 s pueden omitir picos. No sumar máximos de procesos
ocurridos en momentos distintos. Conservar sandbox/evidencias; no borrar esta tarea.
No prueba recepción multipart, alta en catálogo, autenticación ni navegador en el
VPS: esas etapas ya tienen evidencia local y se validarán después sin cargar datos
de prueba al catálogo productivo. Una única conversión favorable no es percentil
ni prueba para todos los archivos posibles de 50 MiB.

### 4. Tiempos efectivos y ajuste mínimo futuro

Fuentes primarias consultadas: [proxy Nginx](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_read_timeout)
y [core Nginx](https://nginx.org/en/docs/http/ngx_http_core_module.html#client_body_timeout).
Sin overrides en la jerarquía aplicable, los defaults son proxy_read_timeout=60s,
proxy_connect_timeout=60s, proxy_send_timeout=60s, client_body_timeout=60s y
client_header_timeout=60s. Lectura/escritura/cuerpo limitan intervalos de inactividad,
no el total; conexión y cabeceras tienen su semántica propia. El filtro aportado no
encontró timeouts explícitos: 60s es el valor aplicable **condicionado a verificar
que no faltan includes/contextos o intermediarios**, no una medición de solicitud.
Un procesamiento sin respuesta intermedia que exceda 60s podría terminar en 504.

La ruta de alta del código es POST /api/v1/layers (confirmar API_PREFIX activo).
El ajuste mínimo es una location exacta para esa ruta en el mismo servidor HTTPS,
con el mismo proxy_pass SIN añadir URI y los cinco encabezados/directivas existentes,
y únicamente proxy_read_timeout=<valor validado>. Conservar location /, 120M,
TLS/Certbot y cualquier autenticación/CORS/herencia existente. La plantilla contiene
comentarios, **no un valor listo para copiar ni una configuración completa aplicable**.

No fijar 240s por el ensayo local de 135s. Después del ensayo del VPS, sumar tiempo
sin respuesta observado + costes no medidos (checksums, recepción upstream, registro
DB, respuesta) y margen justificado por variación/carga. Contrastar con cliente
300s total, GDAL 180s solo conversión y límites de todos los intermediarios. Node
instalado usa app.listen sin overrides HTTP en código; confirmar versión/flags antes
de extrapolar defaults locales (requestTimeout 300s de recepción, headers 60s,
socket timeout 0, keepalive 5s). El ensayo offline no mide un tiempo extremo a extremo:
si no hay evidencia suficiente, mantener el valor pendiente. Si GDAL/sandbox vence
plazo o el presupuesto síncrono no cabe, seguir bloqueado y preparar trabajo durable
202 aparte, no aumentar indiscriminadamente memoria/tiempos.

### 5. Actualización reversible: preparar, no ejecutar

1. Obtener los dos JSON de auditoría activa y el informe aislado; resolver ruta,
   flags activos, intermediarios y timeout por ruta. Mantener estado BLOQUEADO hasta
   esos resultados. Los recursos conocidos dan margen inicial favorable, no garantía.
2. Tras aprobación posterior, generar revisión explícita y artefacto de despliegue
   separado con manifest (el paquete de capacidad no sirve), respaldar SHA c93d4cc,
   configuración PM2 ACTIVA filtrada para revisar y copia privada restaurable,
   backend/.env privado y archivo Nginx real resuelto con readlink -f (puede ser symlink).
   Conservar uploads/DB; no copiarlos encima de código ni usar clean/reset.
3. Pausar solo altas y drenar. Guardar el estado de archivos modificados fuera de
   código y rutas reales; verificar árbol limpio y dependencias. Actualizar backend
   + shared a revisión aprobada, MAX_UPLOAD_SIZE_MB=50 en fuente efectiva PM2/env,
   sin migración/seed/reinstalación automática. Mantener misma UPLOAD_BASE_DIR.
4. Aplicar únicamente timeout validado a ruta exacta (si se necesita), revisar diff,
   nginx -t antes de recargar. No cambiar 120M. El reinicio PM2 y recarga requieren
   la autorización posterior de despliegue; no se ejecutaron en esta preparación.
5. Publicar frontend mediante Pages existente, actualizar cachés y comprobar
   Idempotency-Key; reabrir altas solo con combinación compatible. Backend VPS y
   Pages son entregas distintas.
6. Reversión preparada: pausar/drenar, volver a código c93d4cc y a entorno/PM2 previos,
   retirar solo nueva location/timeout si llegó a añadirse, validar Nginx; revertir
   únicamente frontend de cargas si corresponde. No tocar DB, uploads o catálogos,
   ni revertir los cuatro ajustes previos del visor. Guardar copias/evidencias.
   Si una capa quedó registrada, recuperar su ID sin crear otra ni liberar reserva
   mientras trabaje GDAL. Resolver recuperaciones pendientes antes de reabrir altas.

Estado actual: **BLOQUEADO**, con recursos, gestor y base instalada ya confirmados;
pendientes únicamente configuración activa/ruta, topología HTTP y ensayo aislado.
No se hicieron commit, push, merge, migraciones, despliegue, cambios Nginx o reinicios.

Validación de esta preparación: 504 pruebas aprobadas, 0 fallidas
(`tests-preparacion-vps.tap`), sintaxis JS/Python y filtros del auditor correctos,
`git diff --check` limpio. Se probó que el runner rechaza ejecutarse fuera del
sandbox antes de procesar archivos. El tar se verificó sin extraer: solo archivos
regulares relativos, sin .env/node_modules, hashes del código y KMZ coincidentes.
SHA256 final del paquete:
`1e6ccc74e00d0ee8de33c6432f9853107f7fa6e6e9ca805e76b800d678360a5c`.
Los nuevos scripts operativos no se han probado contra systemd/Linux real; sintaxis
y guardas locales no sustituyen esa prueba. No se ejecutó ningún comando del VPS.

## Auditoría JSON recibida: identificación corregida y ensayo en sandbox existente

Esta sección sustituye las instrucciones de scripts anteriores. Fuente: adjunto
`Texto pegado.txt` de la auditoría ejecutada por el usuario. Se guardó una copia JSON
filtrada en evidencias fuera del repo; no se ejecutaron órdenes en el VPS desde aquí.
Sandbox real: **/var/tmp/egem-capacity-waM5Giwu**. No crear otro ni volver a enviar
el KMZ. El paquete ya extraído contiene los scripts anteriores: actualizar solo
los cuatro archivos indicados antes del ensayo, preservando una copia del helper.

### Evidencias incorporadas

| Dato del JSON | Resultado y alcance |
|---|---|
| RAM total/disponible | 8,326,623,232 / 7,567,314,944 bytes (7.755 / 7.048 GiB), swap 0 |
| CPU | 2 vCPU x86_64, AMD EPYC virtualizado KVM |
| Disco libre | 95,879,356,416 bytes (~89.295 GiB); backend, uploads y /tmp en /dev/sda1 |
| Filesystem uploads | ext4 en /dev/sda1, montado en /; almacenamiento local, no NFS |
| Proceso | ps y PM2 activo: 1041, padre 941, RSS 280,884 KiB (~274.30 MiB) |
| PM2 activo | egem-backend, fork_mode, maxMemoryRestart null, nodeMemoryFlags []; una entrada backend. instances null no demuestra ausencia del proceso |
| PM2 entorno filtrado | {}: no prueba valores de dotenv ni ausencia de opciones en el proceso; se corrigió también la lectura de env anidado |
| Servicio padre | pm2-root.service, MainPID 941, sin límite MemoryHigh/MemoryMax/CPUQuota; TasksMax 9483 |
| Memoria grupo PM2 | MemoryCurrent 1,169,874,944 bytes; MemoryPeak 2,029,805,568 bytes (~1935.77 MiB), HISTÓRICO de todo el servicio |
| .env seleccionado | NODE_ENV production, PORT 4000, MAX_UPLOAD_SIZE_MB 100, UPLOAD_BASE_DIR uploads |
| Código en disco | c93d4ccaea0b305e43b3366789ddaa30a2b8e55a |
| Nginx | 120M, servidor api-egem.geodinamica.mx y 2.25.67.210; HTTPS 443 ssl, configuración egem-backend; no timeouts explícitos en el filtro |

**MemoryPeak de pm2-root no mide una conversión**: incluye todo su cgroup e historia,
no permite atribuirse al backend, al KMZ, ni sumar/reutilizarlo como pico del ensayo.
El ensayo medirá exclusivamente un cgroup NUEVO con nombre único. No cambiar cuotas
ni reiniciar PM2 para obtenerlo. El límite por archivo sigue siendo 50 MiB en el
objetivo; los 100 del archivo remoto seleccionado se cambiarán a 50 solo durante
un despliegue posterior autorizado, en la fuente efectiva. Conservar Nginx 120M.

### Discrepancia de PID: hechos, defecto y prueba mínima

Ambas versiones anteriores filtraban `/proc/PID/comm` por igualdad exacta con node
(o nodejs). El auditor usa `ps -eo ...comm...`, y para 1041 el adjunto muestra
`node /opt/egem-`: ese título no coincide con la igualdad exigida, explicando la
omisión. El helper además no excluía process.pid; ejecutado desde cwd del backend,
su propio proceso Node puede superar ambos filtros. El adjunto no contiene el JSON
original de 8256 ni su `/proc`, por lo que no se certifica retrospectivamente su
identidad solo por ese número. La reproducción siguiente imprime su PID propio y
permite demostrar el mecanismo sin inferirlo por antigüedad o numeración.

Antes de sobrescribir el helper, desde la consola VPS:

```bash
CASE=/var/tmp/egem-capacity-waM5Giwu
cp -pn "$CASE/ops/active-upload-config.mjs" "$CASE/ops/active-upload-config.before-pid-fix.mjs"
cd /opt/egem-visor-morelos/backend
env -u NODE_OPTIONS node --input-type=module -e 'console.log(JSON.stringify({diagnosticHelperPid:process.pid})); await import(process.argv[1]);' \
  "$CASE/ops/active-upload-config.before-pid-fix.mjs" /opt/egem-visor-morelos/backend
```

Comparar diagnosticHelperPid con los PID de processes: si coincide, se ha
identificado a sí mismo. Esa reproducción es diagnóstica, no una conversión.
Las versiones nuevas reconocen el ejecutable `/proc/PID/exe`, admiten títulos
modificados y excluyen el propio helper. Añaden PID explícito y oldCommFilterWouldMatch
para comprobar exactamente por qué el proceso real quedaba fuera.

### Transferir únicamente scripts corregidos

Desde PowerShell con el acceso SSH/SFTP existente; no suponer que la IP de server_name
sea necesariamente el destino SSH. No publicar los archivos en Internet:

```powershell
$Destino = Read-Host 'Destino SSH confirmado (root@IP o alias existente)'
$Puerto = Read-Host 'Puerto SSH confirmado'
$Repo = 'C:\Users\Geodinamica\.codex\worktrees\revision-publicada-morelos\egem-visor-morelos'
scp -P $Puerto "$Repo\ops\active-upload-config.mjs" "$Repo\ops\audit-upload-capacity.py" "$Repo\ops\watch-isolated-capacity.py" "$Repo\ops\capacity-convert.mjs" "${Destino}:/var/tmp/egem-capacity-waM5Giwu/ops/"
```

Solo se sobrescriben esos archivos auxiliares dentro del sandbox. El tar original,
manifest y KMZ quedan conservados; sus hashes del código operativo anterior ya no
representan estos cuatro scripts. No repetir la extracción del paquete ni copiarlo
a /opt. La consola web no transfiere archivos por sí misma; si no existe canal SSH,
usarlo a través del administrador sin habilitar servicios en esta tarea.

### Consultas mínimas tras la transferencia

```bash
CASE=/var/tmp/egem-capacity-waM5Giwu
cd /opt/egem-visor-morelos/backend
env -u NODE_OPTIONS node "$CASE/ops/active-upload-config.mjs" \
  /opt/egem-visor-morelos/backend --pid 1041
python3 "$CASE/ops/audit-upload-capacity.py" \
  --backend-root /opt/egem-visor-morelos/backend \
  --uploads /opt/egem-visor-morelos/backend/uploads --process-only
```

Compartir solo esos JSON: el helper debe devolver 1041, isHelper=false,
oldCommFilterWouldMatch=false si la omisión se debió al título, cwd/executable,
flags permitidos y ruta de uploads por precedencia entorno inicial → .env → default.
El auditor corregido ahora incluye 1041 aunque comm haya cambiado; puede incluir
941 como daemon PM2, que no constituye otra instancia del backend. Si 1041 ya no
existe, verificar el PID activo antes de continuar, no escoger uno arbitrario.

Para denominar efectiva la ruta, correlacionar uploadSource, uploadRealpath,
processStartedAt y dotenvMtime: una .env cambiada después de arrancar no prueba el
valor en memoria. No se importa env.js/app ni se adjunta un depurador. Si hay override
inicial o archivo anterior al arranque y código consistente, resolver uploads relativo
a cwd. El ext4 local, misma raíz y una instancia fork son compatibles con la exclusión;
no confundir el daemon PM2 con un segundo backend ni asumir que otra raíz participe.

### Ensayo exacto después de confirmar los JSON

No instalar dependencias. Reutilizar las ya instaladas mediante enlace de lectura;
si el enlace existe pero apunta a otro destino, detenerse sin sobrescribirlo.
El servicio aislado protege /opt contra escritura y solo permite sockets Unix:
no tiene conexión TCP a DB ni escucha puertos. El runner no importa Prisma/app,
usa configuración ficticia y output dentro del sandbox; no usa uploads productivos.

```bash
CASE=/var/tmp/egem-capacity-waM5Giwu
NODE_BIN=$(readlink -f /proc/1041/exe)
test -x "$NODE_BIN" || exit 1
if [ ! -e "$CASE/backend/node_modules" ] && [ ! -L "$CASE/backend/node_modules" ]; then
  ln -s /opt/egem-visor-morelos/backend/node_modules "$CASE/backend/node_modules"
fi
test "$(readlink -f "$CASE/backend/node_modules")" = "$(readlink -f /opt/egem-visor-morelos/backend/node_modules)" || exit 1
python3 "$CASE/ops/watch-isolated-capacity.py" --sandbox "$CASE" --node "$NODE_BIN" --run-isolated
RESULT=$?
printf 'Código del supervisor: %s\n' "$RESULT"
cat "$CASE/capacity-filtered.json"
```

Ejecutar una sola vez. El supervisor impide reutilizar un sandbox con evidencia de
ensayo anterior, no sobreescribe logs ni informes. No retirar archivos para forzar
un reintento. No se ha ejecutado este comando desde el agente.

El límite conjunto se aplica al cgroup de **padre monitor Node + hijo Node + workers
+ GDAL y otros descendientes**: MemoryMax 2 GiB, MemoryHigh 1536 MiB, sin swap,
CPUQuota 100% (un núcleo), TasksMax 64 y RuntimeMaxSec 240. Verifica memory.max y
cpu.max efectivos y detiene el ensayo si no puede confirmarlos. Se mantienen
NoNewPrivileges, filesystem protegido y /tmp privado. Si una propiedad falla, no
repetir quitando protecciones. El cgroup pm2-root nunca se detiene ni se modifica.

Requiere antes de empezar: 4 GiB MemAvailable, 8 GiB libres y tres sondas HTTP200
<1 s a **http://127.0.0.1:4000/health**, sin proxy de entorno ni redirects. Cada
2 s mide el mismo endpoint, memoria, disco y cgroup. Para si disponibles <2 GiB,
disco <5 GiB, dos sondas consecutivas fallan/tardan >1 s, o alcanza 240 s. GDAL
mantiene su timeout de conversión 180 s. Ctrl+C ejecuta limpieza de la unidad propia.

Antes de detenerla al completar, el padre pequeño permanece vivo para poder leer
**memory.peak del cgroup nuevo completo**; así no desaparece la métrica junto con
el proceso principal. MemoryPeak de esa unidad nueva es fallback si el kernel no
expone memory.peak; se identifica la fuente. Si falta pico válido, no declara éxito.
En OOM/fallo puede faltar la métrica final: se conserva esa limitación, no se
sustituye por el pico de PM2 ni solo por muestras de RSS.

Se guarda conversion-private.log completo en el sandbox, conversion-exit.json con
código/señal del hijo, capacidad de origen original sin cambios, duración del hijo
y durationMs del procesamiento, y capacity-filtered.json con jointPeak (bytes/fuente),
CPU, límites, salud, resultado y parada. systemdRunExitCode corresponde al padre
retenido que se para deliberadamente: puede ser distinto del código real de la
conversión. success exige conversión procesada, código 0, hash intacto, pico válido
y ninguna condición de parada. No confundir el tiempo del supervisor con el tiempo
de conversión. Compartir el JSON filtrado y el código impreso; no logs crudos.

Parada manual desde otra consola, **solo la unidad creada por este sandbox**:

```bash
CASE=/var/tmp/egem-capacity-waM5Giwu
UNIT=$(python3 -c 'import json,re,sys; u=json.load(open(sys.argv[1]))["unit"]; assert re.fullmatch(r"egem-capacity-[0-9a-f]{32}",u); print(u)' "$CASE/capacity-run.json") && systemctl stop "$UNIT"
```

El nombre se imprime al arrancar y se persiste antes de iniciar; no usar comodines,
no detener pm2-root/egem-backend ni procesos por nombre. No elimina evidencias.

### CDN/intermediarios y timeout pendiente del resultado

El JSON no contiene resolución DNS ni evidencia del panel Hostinger/CDN/WAF. Un
server_name y TLS Certbot no prueban ausencia de intermediarios. Comprobación concreta:

```bash
getent ahostsv4 api-egem.geodinamica.mx
curl --noproxy '*' --max-time 5 -sS -o /dev/null \
  -w 'HTTP=%{http_code} IP=%{remote_ip} tiempo=%{time_total}\n' \
  https://api-egem.geodinamica.mx/health
```

Correlacionar la IP con la IP pública real del VPS en Hostinger y confirmar en DNS/CDN
si hay proxy/WAF activo y su timeout. Compartir únicamente IP/estado y confirmación
del panel, sin cookies ni tokens. DNS directo por sí solo no demuestra toda la cadena.

Tras el ensayo: revisar success, duración del hijo, peak del grupo, CPU y salud;
no fijar proxy_read_timeout hasta disponer del resultado. El default Nginx 60 s
aplica si no hay overrides de herencia; el filtro recibido no muestra ninguno.
El ajuste mínimo sigue siendo location exacta **/api/v1/layers** (confirmar prefix)
con proxy_pass/encabezados idénticos a la ruta actual y solo el plazo de lectura
justificado por duración y margen. Conservar TLS/Certbot y client_max_body_size 120M.
Coordinar con cliente 300 s total, Node de recepción y GDAL 180 s; este ensayo no
mide multipart/DB. Si el trabajo falla o no cabe con margen, mantener BLOQUEADO,
no elevar límites a ciegas ni publicar solo frontend.


Validación de las correcciones operativas: 7 comprobaciones locales aprobadas (incluye detección de Node con título modificado, filtrado de secretos, picos inválidos, sonda loopback sin redirects y fallo de consulta systemd). Son pruebas con datos simulados, no una conversión ni ejecución systemd real. Sintaxis JS/Python, self-test del auditor y git diff --check correctos. La suite de aplicación de 504 pruebas ya estaba aprobada y no se modificó código de aplicación en esta revisión. No se ejecutaron órdenes remotas, reinicios, migraciones ni despliegue.

## Corrección 226/NAMESPACE: mantener PrivateTmp y hacer visible el sandbox

**Ensayo anterior:** fallo de preparación del mount namespace, status=226/NAMESPACE.
No se inició la conversión: **sin duración ni pico válidos de conversión**. Sus
métricas, si existen, describen preparación y no deben usarse para elegir timeout.
No confundirlo con fallo de GDAL ni insuficiencia de RAM. Evidencia comunicada por
el usuario: sandbox real drwx------ root:root y capacity-convert.mjs regular existente,
3178 bytes, modo 0666; ENOENT aparece solo al construir el namespace.

Causa: la orden anterior combina PrivateTmp=yes, ProtectSystem=strict,
ReadWritePaths=/var/tmp/egem-capacity-waM5Giwu y WorkingDirectory en esa misma ruta,
**sin BindPaths**. PrivateTmp proporciona /tmp y /var/tmp privados, ocultando el
sandbox del host. ReadWritePaths permite escritura pero no importa su contenido
al namespace; al preparar esa excepción no encuentra la ruta. WorkingDirectory
no restaura su visibilidad y se utiliza después del montaje. No es un problema de
permisos DAC ni de ausencia del directorio en el host.

Referencia primaria: [systemd.exec: BindPaths, PrivateTmp y ReadWritePaths](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html#BindPaths=).
La corrección mínima añade **BindPaths=HOST_SANDBOX:MISMA_RUTA**. Se conserva:

```ini
PrivateTmp=yes
ProtectSystem=strict
BindPaths=/var/tmp/egem-capacity-waM5Giwu:/var/tmp/egem-capacity-waM5Giwu
ReadWritePaths=/var/tmp/egem-capacity-waM5Giwu
WorkingDirectory=/var/tmp/egem-capacity-waM5Giwu
```

El bind de origen del host hace visible únicamente ese sandbox dentro de /var/tmp
privado. No se comparte todo /var/tmp, no se usa un prefijo opcional '-' para ocultar
errores, no se mueve el sandbox y no cambia ninguna referencia absoluta ni el
symlink de node_modules. Los temporales privados siguen aislados; /opt permanece
protegido contra escritura. No se cambian límites CPU/memoria, red, vigilancia,
parada de hijos ni captura del pico del cgroup nuevo antes de detenerlo.

Cambió solo **ops/watch-isolated-capacity.py**, además de esta documentación. Ahora
rechaza scripts enlazados o escribibles por grupo/otros, y clasifica 226/NAMESPACE
como preparation_failed con conversionMeasurementValid=false, sin atribuir el
pico de preparación a conversión. No se requiere transferir los otros scripts.

### 1. Conservar el fallo antes de repetir (consola VPS)

La siguiente comprobación se limita a la unidad de ensayo registrada. No detener
servicios productivos. Si la unidad aún está activa/activando/desactivando, detenerse
y usar la parada específica documentada antes de mover sus archivos:

```bash
CASE=/var/tmp/egem-capacity-waM5Giwu
test "$(readlink -f "$CASE")" = /var/tmp/egem-capacity-waM5Giwu || exit 1
OLD_UNIT=$(python3 -c 'import json,re,sys; u=json.load(open(sys.argv[1]))["unit"]; assert re.fullmatch(r"egem-capacity-[0-9a-f]{32}",u); print(u)' "$CASE/capacity-run.json") || exit 1
STATE=$(systemctl show "$OLD_UNIT" --property=ActiveState --value) || exit 1
case "$STATE" in inactive|failed) ;; *) printf 'Ensayo anterior no detenido: %s\n' "$STATE"; exit 1;; esac
umask 077
ARCHIVE=$(mktemp -d "$CASE/namespace-failed-226-XXXXXXXX")
systemctl show "$OLD_UNIT" --property=ActiveState,SubState,Result,ExecMainCode,ExecMainStatus > "$ARCHIVE/unit-state.txt"
cp -p -- "$CASE/ops/watch-isolated-capacity.py" "$CASE/ops/capacity-convert.mjs" "$ARCHIVE/"
for NAME in capacity-run.json conversion-private.log conversion-exit.json conversion-exit.pending capacity-filtered.json output; do
  if [ -e "$CASE/$NAME" ] || [ -L "$CASE/$NAME" ]; then
    mv -n -- "$CASE/$NAME" "$ARCHIVE/"
  fi
done
printf '%s\n' 'Fallo de preparación 226/NAMESPACE; conversión no iniciada; sin medición válida de conversión.' > "$ARCHIVE/classification.txt"
printf 'Evidencia conservada: %s\n' "$ARCHIVE"
```

El archivo capacity-filtered.json anterior se conserva intacto dentro de ARCHIVE,
no se reescribe para cambiar su clasificación; se añade una nota separada. cp -p y
mv conservan permisos/contenido. No se eliminan evidencias ni se usa otro directorio
productivo. El estado failed de la unidad anterior puede permanecer: no hace falta
reset-failed ni cambiar PM2. El siguiente ensayo obtiene otro nombre UUID.

### 2. Transferir solo el supervisor corregido (PowerShell)

```powershell
$Destino = Read-Host 'Destino SSH confirmado (root@IP o alias)'
$Puerto = Read-Host 'Puerto SSH confirmado'
$Repo = 'C:\Users\Geodinamica\.codex\worktrees\revision-publicada-morelos\egem-visor-morelos'
scp -P $Puerto "$Repo\ops\watch-isolated-capacity.py" "${Destino}:/var/tmp/egem-capacity-waM5Giwu/ops/"
```

### 3. Permisos puntuales y una repetición (consola VPS)

```bash
CASE=/var/tmp/egem-capacity-waM5Giwu
test -f "$CASE/ops/capacity-convert.mjs" && test ! -L "$CASE/ops/capacity-convert.mjs" || exit 1
test -f "$CASE/ops/watch-isolated-capacity.py" && test ! -L "$CASE/ops/watch-isolated-capacity.py" || exit 1
chmod 600 -- "$CASE/ops/capacity-convert.mjs" "$CASE/ops/watch-isolated-capacity.py"
stat -c '%a %U:%G %n' "$CASE/ops/capacity-convert.mjs" "$CASE/ops/watch-isolated-capacity.py"
NODE_BIN=$(readlink -f /proc/1041/exe)
test -x "$NODE_BIN" || exit 1
test "$(readlink -f "$CASE/backend/node_modules")" = "$(readlink -f /opt/egem-visor-morelos/backend/node_modules)" || exit 1
python3 "$CASE/ops/watch-isolated-capacity.py" --sandbox "$CASE" --node "$NODE_BIN" --run-isolated
RESULT=$?
printf 'Código supervisor: %s\n' "$RESULT"
cat "$CASE/capacity-filtered.json"
```

Si PID 1041 ya no corresponde al backend verificado, no escoger otro automáticamente.
No se instalan dependencias, no se lanza conversión fuera de systemd y no se modifica
ningún archivo productivo. chmod se aplica solo a los dos archivos regulares del
sandbox, no de forma global/recursiva ni siguiendo enlaces de dependencias.

Repetir una vez: 2 GiB y un núcleo para todos los descendientes, health loopback
cada 2 s, guardas de memoria/disco/latencia, máximo 240 s, GDAL 180 s, sin TCP,
Prisma/catalogación ni escritura en uploads productivos. No relajar aislamiento
si vuelve a fallar la preparación; conservar el nuevo informe para diagnosticarlo.

Parada manual desde otra consola:

```bash
CASE=/var/tmp/egem-capacity-waM5Giwu
UNIT=$(python3 -c 'import json,re,sys; u=json.load(open(sys.argv[1]))["unit"]; assert re.fullmatch(r"egem-capacity-[0-9a-f]{32}",u); print(u)' "$CASE/capacity-run.json") && systemctl stop "$UNIT"
```

Compartir el JSON nuevo y código supervisor. Se conservan conversionExit (hijo),
systemdRunExitCode (padre retenido/parada), salida privada y pico conjunto leído
antes de destruir el grupo; no usar el MemoryPeak de pm2-root. Seguir BLOQUEADO
hasta obtener conversión válida y revisar presupuesto HTTP. Nginx 120M/TLS intactos.

Validación local: sintaxis Python y 6 pruebas de propiedades generadas aprobadas:
bind exacto, PrivateTmp/ProtectSystem/RW/cwd conservados, límites de recursos,
restricciones de red/privilegios, excepción de escritura no ampliada y lectura de
pico. git diff --check correcto. No hay systemd Linux local para ejecutar el mount
namespace: la confirmación de funcionamiento real queda pendiente de este ensayo.
No se ejecutaron órdenes del VPS, reinicios, despliegues ni cambios productivos.

## Capacidad de conversión superada: ensayo real del VPS y preparación final

Fuente: adjunto del usuario tras corregir el namespace. El JSON fue analizado y
conservado como `capacity-vps-success-user.json` en evidencias fuera del repo.
No se repitió el ensayo y no se repetirá sin una razón nueva.

| Evidencia | Resultado |
|---|---|
| Unidad | egem-capacity-bc3011fab940497cb4cde07255e21aa5 |
| conversionMeasurementValid / success | true / true |
| conversionExit.code / signal | 0 / null |
| Procesamiento | 21,298 ms |
| Hijo completo / supervisor | 21,467 ms / 22.178 s |
| Pico conjunto | 1,267,601,408 bytes, fuente memory.peak del cgroup nuevo |
| Elementos / original | 24,196 / originalUnchanged=true |
| Salud productiva | 14 sondas correctas, 1–3 ms |
| Límites efectivos del ensayo | memory.max 2,147,483,648; cpu.max 100000/100000 |
| Presión | Sin eventos high/max/oom/oom_kill; no swap; unidad final inactive |
| Node | v22.23.0 |

El pico incluye memoria cargada al cgroup del ensayo (padre, Node, workers, GDAL y
caché cargada al grupo), no solo heap/RSS ni el historial de pm2-root. La capacidad
queda **superada para este KMZ**, sin simplificar cartografía. No se extrapola a
todos los archivos de 50 MiB. El primer fallo 226 queda archivado como preparación.

Se compararon 11 archivos de conversión/dependencias del tar original con el árbol
objetivo: coinciden normalizando SOLO CRLF→LF por core.autocrlf=true. Se generó un
manifiesto de 84 archivos runtime. El resultado VPS no incorpora hashes de fuentes;
el procedimiento incluye verificarlos allí, sin conversión, y después en el repo
instalado. El objetivo todavía no tiene SHA de commit; no inventarlo ni suponer
que bf17 ya contiene las cargas. Tras fetch las dos ramas remotas siguen en bf17.

El procedimiento concreto está en **[despliegue-cargas-50-mib.md](despliegue-cargas-50-mib.md)**:
comandos PowerShell/consola, respaldo privado de código/config/env/PM2, control de
overrides de MAX_UPLOAD_SIZE_MB, reversión, integración desarrollo antes de main,
workflow Pages existente y comprobación privada HTTP/catálogo/visualización.

Decisión preparada: conservar **client_max_body_size 120M**; cambiar la fuente
efectiva MAX_UPLOAD_SIZE_MB de 100 a **50**; timeout Nginx **240 s solo en las dos
variantes de ruta de alta**, conservando TLS y proxy. Presupuesto operativo: GDAL
hasta 180 s + 60 s para otros costes; cliente mantiene 300 s total. Para el archivo
medido 21.298 s offline no se demostró necesidad de superar 60 s, pero 60 s no
cubriría el límite de GDAL permitido. La propuesta 240 s no garantiza cualquier
complejidad ni subida lenta, ni constituye un plazo global del análisis; verificar
intermediarios y el HTTP real antes de declarar servicio completo validado.

La plantilla de Nginx ahora contiene ambas locations exactas, plazo propuesto y
una pausa POST marcada, para coordinar backend/frontend. Solo se instala en la
ventana futura aprobada, con nginx -t previo a recarga; no se modificó Nginx real.
No cambia CORS, DB, capas, autenticación, permisos ni memoria global.

**Estado:** capacidad de conversión superada; procedimiento de despliegue preparado.
Pendientes: correspondencia hash en VPS, confirmación de intermediarios, autorización
para integrar/publicar, y comprobación HTTP de recepción/procesamiento/registro/
visualización privada tras el despliegue. No se ha demostrado ese flujo completo.
La capa de prueba deberá permanecer PENDING_REVIEW o APPROVED, nunca PUBLISHED por
automatismo; verificar ausencia del ID en catálogo público. No se publica cartografía
ni se eliminan DB/uploads como parte de la prueba o reversión.

Validación de esta preparación: suite completa 504/504 aprobada; 6 comprobaciones
simuladas adicionales del verificador y reinicio/reversión con entorno preservado,
sin ejecutar PM2; sintaxis JS/Python, inventario/hashes local y git diff --check
correctos. Nginx -t y comandos de reinicio/reversión son pendientes de ejecución
futura autorizada; no hay systemd/Nginx Linux local para probarlos aquí. No se
hicieron commit, push, merge, despliegue, migraciones ni reinicios.


## Publicación autorizada: coordinación iniciada

El usuario autorizó commit/push e integración en desarrollo-visor y main, actualización
backend/configuración y publicación Pages, con ejecución remota por el usuario.
Fetch de esta fase: origin/main y origin/desarrollo-visor siguen en bf17e8b, sin
avances adicionales. API GitHub: protected=false y reglas activas vacías en ambas;
se permite avance rápido normal, sin force. Suite repetida: 504/504 aprobada.
API pública health HTTP200, DNS IPv4 2.25.67.210, Server nginx/1.24.0 (Ubuntu),
sin Via/CF-Ray/X-Cache en esa respuesta; no demuestra ausencia de CDN/WAF.
Pendiente confirmación del panel y huellas del sandbox en VPS. No adelantar main
ni Pages hasta recibir backend/configuración preparados y saludables. Los comandos
remotos los ejecuta el usuario: el agente no dispone de sesión SSH asumida.
