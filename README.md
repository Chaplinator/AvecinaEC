# SeFue (nombre provisional)

App colaborativa que muestra en tiempo real qué sectores de una ciudad están sin luz, agua o internet, o con calles inundadas. Empieza en Guayaquil.

La fuente de verdad del producto y las reglas de trabajo están en [CLAUDE.md](CLAUDE.md).

## Desarrollo local

Requisitos: Node 24 y npm.

```bash
npm ci
cp .env.example .env.local   # completar valores; nunca se versiona
npm run dev
```

## Verificaciones

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Flujo de trabajo

Ramas `feat/`, `fix/`, `chore/`, commits con Conventional Commits y PR obligatorio hacia `main` con CI verde.

## Despliegue y observabilidad

- **Vercel:** importar el repositorio y cargar las variables de `.env.example` en el panel (nunca en el repo). Las variables `NEXT_PUBLIC_*` se fijan en el build: si cambian, hay que redesplegar.
- **Sentry:** con `NEXT_PUBLIC_SENTRY_DSN` el navegador reporta solo errores no capturados, sin datos personales y con el SDK cargado en diferido. Con `SENTRY_AUTH_TOKEN` el build sube los source maps a Sentry y los borra del output. Prueba rápida en la consola del navegador: `setTimeout(() => { throw new Error("prueba") })`.
- **Uptime:** monitorear `/api/health` cada minuto.
- **Peso:** el CSP con nonce obliga a renderizar el HTML por petición. El JS inicial se mide en CI cuando exista el presupuesto de bundle (CLAUDE.md §13).

