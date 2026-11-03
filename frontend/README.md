# Mapper frontend

React + React Flow, embedded in a Django template at `/`. Django serves the
read-only catalog at `/api/catalog/maps/` with four database queries, including
resources, chests, dungeons, and static image URLs.

## Build

The Dockerfile builds the frontend in a Node stage and copies the compiled assets
into the Python image. No Node server runs in production.

From the repository root, in this corporate environment:

```powershell
docker compose --env-file .env.docker -f compose.yaml -f compose.corporate.yaml up -d --build web
```

The corporate override mounts `.npm/npmrc` and the Windows CA bundle during the
build. The local npm configuration contains:

```ini
registry=https://artifactory.marex.com/artifactory/api/npm/marex-npm-virtual/
```

For Django running directly on your machine, with its database configured in
`.env`, run these commands from `frontend/`:

```powershell
$env:NODE_EXTRA_CA_CERTS = (Resolve-Path ../.certs/windows-ca.pem).Path
npm ci --userconfig=../.npm/npmrc
npm run watch
```

Refresh the Django page after changes. Vite writes `static/mapper/mapper.js` and
`mapper.css`; Django staticfiles provides hashed URLs when collecting static
files. Generated files and `node_modules` are ignored by Git.

## Current behavior

- Search by full name or ordered prefixes (`ca ai` finds `Casos-Aiagsum`), or filter
  the catalog by tier. All matching results remain available for selection.
- Add individual maps, or create both endpoints through the connection form.
- Cards show icons and quantities below their names. Small features have a blue
  background; large features have an amber background and a `G` badge.
- The toolbar `+` opens the catalog to add maps without creating connections.
- Drag handles on any of the four sides to connect maps. A dialog asks for the
  duration after dropping on another map; canceling leaves the graph unchanged.
  This duration is independent of the top form, which remains available.
- Click a map for its image and catalog details; click a timer to edit a connection.
- Reverse duplicate connections and self-connections are rejected.
- Select and delete nodes/connections, arrange the graph, zoom, and pan.
- Export or copy the board as JSON.
- The fullscreen button in the board toolbar shows just the map and its controls.
  The catalog, duration dialogs, selection, deletion and export remain available.
  Clicking an existing timer opens its edit dialog while fullscreen. Exit with
  the same button or Escape. Browsers that deny native fullscreen use a viewport
  focus mode instead.
- Nodes, connections, absolute expiration times, and viewport persist in this
  browser's localStorage. Refreshing does not restart timers. Expired connections
  remain visible until removed.

This is a local draft. Shared server persistence, guild permissions, and WebSocket
synchronization are subsequent work. No connection data is written to PostgreSQL.

## Verification

```powershell
npm test
npm run test:e2e
```

Browser tests use the installed Microsoft Edge and the app at
`http://127.0.0.1:8000`. Override `MAPPER_URL` or `PLAYWRIGHT_CHANNEL` if needed.
They run in isolated browser contexts and do not change your browser's draft.
