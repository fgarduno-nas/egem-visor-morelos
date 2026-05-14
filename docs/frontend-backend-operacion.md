# Operacion conjunta EGEM

## Objetivo

Este documento resume como correr el frontend institucional EGEM junto con el backend real para autenticacion, gestion de usuarios y consumo de capas.

## 1. Levantar backend

Ubicacion:

`C:\Users\franc\Desktop\DOCUMENTACIÓN ATLAS MORELOS\AtlasMorelosVisor\backend`

Pasos:

```bash
cd backend
npm install
docker compose up -d
npx prisma generate
npx prisma migrate dev
npx prisma db seed
npm run dev
```

Backend esperado:

- API: `http://localhost:4000/api/v1`
- Health: `http://localhost:4000/health`

## 2. Levantar frontend

Ubicacion:

`C:\Users\franc\Desktop\DOCUMENTACIÓN ATLAS MORELOS\AtlasMorelosVisor`

Abrir con Live Server o cualquier servidor estatico local.

La configuracion actual del frontend usa automaticamente:

- `http://localhost:4000/api/v1` cuando se abre en `localhost` o `127.0.0.1`

## 3. Flujo actual

- visitante: consulta publica sin login
- administrador: login contra backend, crea usuarios y gestiona capas
- director: login contra backend, sube capas y revisa sus propias capas

## 4. Endurecimiento agregado en frontend

- cliente API centralizado con timeout
- reintentos controlados en lecturas GET
- cache temporal para capas publicas
- modo degradado si la API no responde
- persistencia ligera solo de sesion y visibilidad de capas
- eliminacion de almacenamiento masivo de capas en `localStorage`

## 5. Segunda capa de endurecimiento recomendada para produccion

Para salida masiva institucional, este frontend ya esta mejor preparado, pero la siguiente capa recomendada es:

- backend y frontend detras de proxy reverso
- almacenamiento S3 o MinIO para archivos
- CDN para recursos estaticos
- workers para normalizacion y validacion de capas pesadas
- cache HTTP en lecturas publicas
- monitoreo y alertamiento
- escaneo de archivos y validacion geoespacial avanzada

## 6. Nota de despliegue

Si el frontend se publica fuera de `localhost`, actualiza el bloque `window.__EGEM_CONFIG__` en:

`C:\Users\franc\Desktop\DOCUMENTACIÓN ATLAS MORELOS\AtlasMorelosVisor\index.html`

Define ahi la URL real del backend institucional, por ejemplo:

```html
<script>
  window.__EGEM_CONFIG__ = {
    apiBaseUrl: "https://api.tu-dominio.gob.mx/api/v1"
  };
</script>
```
