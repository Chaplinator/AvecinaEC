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
