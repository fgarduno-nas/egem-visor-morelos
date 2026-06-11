# EGEM - Visor Morelos

Plataforma institucional para el `Estudio Geoespacial del Estado de Morelos` orientada a consulta, carga, revision y publicacion de capas socio-naturales.

## Estructura

```text
.
├── index.html              # Frontend estatico compatible con GitHub Pages
├── css/style.css           # Interfaz institucional y responsive
├── js/map.js               # Visor MapLibre, roles, carga y catalogo
├── js/app/config           # Configuracion runtime del frontend
├── js/app/services         # Cliente HTTP hacia backend
└── backend                 # API Express + Prisma + PostgreSQL/PostGIS
```

## Ramas

- `main`: version estable.
- `desarrollo-visor`: trabajo activo del visualizador y backend.

Antes de modificar codigo, confirma que estas en `desarrollo-visor`:

```bash
git branch --show-current
```

## Frontend local

El frontend no requiere build. Puedes servirlo con cualquier servidor estatico:

```bash
python -m http.server 4173 --bind 127.0.0.1
```

Abre:

```text
http://127.0.0.1:4173/index.html
```

La URL de API se centraliza en `js/app/config/runtime-config.js`. En produccion no debe quedar fija a `localhost`; define `window.__EGEM_CONFIG__` antes de cargar `js/map.js` si necesitas apuntar a otro backend:

```html
<script>
  window.__EGEM_CONFIG__ = {
    apiBaseUrl: "https://api.tu-dominio.gob.mx/api/v1"
  };
</script>
```

## Backend local

```bash
cd backend
npm install
copy .env.example .env
docker compose up -d
npx prisma generate
npx prisma migrate dev
npx prisma db seed
npm run dev
```

API local:

```text
http://localhost:4000/api/v1
```

Salud del backend:

```text
http://localhost:4000/health
```

## Roles

- `PUBLIC_USER`: visitante, consulta solo capas publicadas.
- `DATA_PROVIDER`: alimentador, carga capas para revision.
- `ADMIN`: administra usuarios y aprueba, rechaza, publica o despublica capas.

## Flujo de capas

1. El alimentador sube archivo y metadatos.
2. La capa queda `pending_review`.
3. El administrador aprueba o rechaza.
4. Solo una capa aprobada puede publicarse.
5. El visor publico consume unicamente capas `published`.

## Validaciones utiles

```bash
node --check js/map.js
git diff --check
```

Para backend:

```bash
cd backend
npm run prisma:generate
npm run prisma:migrate
npm run dev
```

## Produccion VPS

- Configura `NODE_ENV=production`.
- Usa PostgreSQL/PostGIS gestionado o contenedor persistente con backups.
- Define `DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGIN`, `PUBLIC_BASE_URL` y `UPLOAD_BASE_DIR`.
- Sirve el frontend estatico con Nginx, Apache, GitHub Pages o almacenamiento estatico.
- Publica el backend detras de HTTPS y proxy inverso.
- No subas `.env`, `node_modules`, uploads reales ni respaldos al repositorio.
