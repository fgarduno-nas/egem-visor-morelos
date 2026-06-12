# EGEM Backend

Backend institucional para `EGEM - Estudio Geoespacial del Estado de Morelos`.

## Evaluación técnica

El proyecto original del visor es útil como frontend estático, pero **no es suficiente para una liberación gubernamental abierta** si se espera:

- autenticación real y segura
- creación y gestión formal de usuarios
- aprobación institucional de capas
- auditoría de acciones
- control de estados de publicación
- carga concurrente de archivos y trazabilidad

Con el backend de esta carpeta, el sistema queda **apto para una salida institucional inicial**. Para una escala masiva de mediano/largo plazo aún recomiendo:

- mover archivos a almacenamiento tipo S3/MinIO
- procesar capas pesadas en colas asíncronas
- usar balanceador y despliegue horizontal
- agregar caché para lecturas públicas
- agregar antivirus y validación geoespacial profunda
- separar conversión/normalización de capas en workers

## Stack elegido

- Node.js + Express
- PostgreSQL + PostGIS
- Prisma ORM
- JWT
- bcryptjs
- Multer
- Zod
- Helmet
- CORS configurable
- Rate limiting

## Estructura

```text
backend/
├─ docker-compose.yml
├─ package.json
├─ prisma/
│  ├─ schema.prisma
│  ├─ seed.js
│  └─ migrations/
├─ src/
│  ├─ app.js
│  ├─ server.js
│  ├─ routes.js
│  ├─ config/
│  ├─ middlewares/
│  ├─ modules/
│  │  ├─ auth/
│  │  ├─ users/
│  │  └─ layers/
│  └─ shared/
├─ docs/
│  └─ openapi.yaml
└─ uploads/
```

## Variables de entorno

1. Copia `.env.example` como `.env`
2. Ajusta los valores según tu ambiente

Ejemplo:

```env
NODE_ENV=development
PORT=4000
API_PREFIX=/api/v1
APP_NAME=EGEM Backend
DATABASE_URL=postgresql://postgres:postgres@localhost:55432/egem_backend?schema=public
JWT_SECRET=change_this_super_secret_key
JWT_EXPIRES_IN=8h
BCRYPT_SALT_ROUNDS=12
CORS_ORIGIN=http://localhost:4173,http://127.0.0.1:4173,http://localhost:5500,http://127.0.0.1:5500
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=150
MAX_UPLOAD_SIZE_MB=100
UPLOAD_BASE_DIR=uploads
PUBLIC_BASE_URL=http://localhost:4000
DEFAULT_ADMIN_EMAIL=admin@egem.morelos
DEFAULT_ADMIN_PASSWORD=Admin123!
DEFAULT_ADMIN_NAME=Administrador EGEM
```

## Instalación

```bash
cd backend
npm install
```

## Base de datos local con PostGIS

Si tienes Docker:

```bash
docker compose up -d
```

## Comandos de arranque

Generar cliente Prisma:

```bash
npx prisma generate
```

Aplicar migraciones:

```bash
npx prisma migrate dev
```

Seed inicial:

```bash
npx prisma db seed
```

Arranque en desarrollo:

```bash
npm run dev
```

## Usuario administrador inicial

Lo crea el seed con estas variables:

- `DEFAULT_ADMIN_EMAIL`
- `DEFAULT_ADMIN_PASSWORD`
- `DEFAULT_ADMIN_NAME`

## Roles iniciales

- `PUBLIC_USER`
- `DATA_PROVIDER`
- `ADMIN`

## Estados de capa

- `draft`
- `pending_review`
- `approved`
- `rejected`
- `published`
- `unpublished`

## Flujo sugerido de capas

- `DATA_PROVIDER` sube capa -> `pending_review`
- `ADMIN` aprueba -> `approved`
- `ADMIN` publica -> `published`
- `ADMIN` despublica -> `unpublished`
- `ADMIN` rechaza -> `rejected`

Una capa no debe exponerse al visor publico hasta quedar en estado `published`. El backend solo devuelve capas publicas desde `GET /api/v1/layers/public` cuando su estado es `published`.

## Catalogo de metadatos

La carga de capas acepta metadatos institucionales y los guarda en `LayerMetadata.properties`:

- `source`
- `responsibleAgency`
- `updatedAt`
- `scaleOrResolution`
- `crs`
- `coverage`
- `tags`

Para GeoJSON, el backend intenta extraer conteo de entidades y tipo de geometria. Para Shapefile ZIP, KML/KMZ y GeoTIFF se conserva la estructura de carga y metadatos para procesamiento posterior o vista previa del visor cuando aplique.

Nota GeoTIFF: el frontend no reproyecta raster. Para visualizacion directa, carga GeoTIFF en EPSG:4326/WGS84 o Web Mercator compatible. Si se requiere reproyeccion automatica, debe implementarse como procesamiento backend con GDAL/rasterio o un worker geoespacial.

## Tipos de archivo aceptados

- `KML`
- `KMZ`
- `GeoJSON`
- `ZIP` para shapefile
- `GeoTIFF` (`.tif`, `.tiff`)
- partes de shapefile (`.shp`, `.dbf`, `.prj`, `.cpg`)

## Endpoints principales

### Auth

- `POST /api/v1/auth/login`

Ejemplo request:

```json
{
  "email": "admin@egem.morelos",
  "password": "Admin123!"
}
```

Ejemplo response:

```json
{
  "success": true,
  "message": "Login exitoso.",
  "data": {
    "accessToken": "jwt-token",
    "user": {
      "id": "clx...",
      "email": "admin@egem.morelos",
      "name": "Administrador EGEM",
      "municipality": "Estado de Morelos",
      "role": "ADMIN"
    }
  }
}
```

### Usuarios

- `POST /api/v1/users`
- `GET /api/v1/users`
- `PATCH /api/v1/users/:id`
- `PATCH /api/v1/users/:id/status`
- `PATCH /api/v1/users/:id/role`

### Capas

- `POST /api/v1/layers`
- `GET /api/v1/layers/public`
- `GET /api/v1/layers/mine`
- `GET /api/v1/layers/admin/pending`
- `GET /api/v1/layers/:id`
- `PATCH /api/v1/layers/:id/approve`
- `PATCH /api/v1/layers/:id/reject`
- `PATCH /api/v1/layers/:id/publish-state`
- `DELETE /api/v1/layers/:id`

## Seguridad incorporada

- Helmet
- CORS configurable
- Rate limit
- Sanitización básica
- Validación con Zod
- Manejo centralizado de errores
- Contraseñas hasheadas con bcrypt
- JWT para autenticación

## Auditoría

Se registran acciones como:

- login
- creación de usuario
- cambio de rol
- activación/desactivación de usuario
- creación de capa
- aprobación
- rechazo
- publicación
- despublicación
- eliminación lógica

## Integración con MapLibre

El frontend puede consumir:

- `GET /api/v1/layers/public`
- `GET /api/v1/layers/:id`

Cada capa responde con:

- metadatos
- estado
- archivos asociados
- `publicUrl` del archivo

## Recomendaciones de producción

Para liberar a población general:

1. mover archivos a `S3/MinIO` en lugar de disco local
2. poner Nginx o API Gateway al frente
3. separar conversión de capas en workers
4. agregar Redis para rate limit distribuido y caché
5. agregar monitoreo y trazas
6. endurecer CORS y secretos
7. usar HTTPS y rotación de JWT secret
8. agregar backups y política de retención

## Estado de validación en este entorno

Se generó el backend completo y funcional a nivel de archivos. En este entorno local de trabajo:

- sí pude validar la presencia del runtime Node
- no hay `npm` ni `psql` disponibles en PATH
- no hay Docker disponible

Por eso **no pude ejecutar aquí**:

- `npm install`
- `npm run dev`
- `npx prisma migrate dev`
- `npx prisma db seed`

La estructura quedó preparada para esos comandos, pero la validación final de ejecución depende de que el entorno tenga `npm` y una instancia PostgreSQL/PostGIS accesible.
