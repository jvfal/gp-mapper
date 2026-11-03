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
- Add individual maps through the board toolbar's `+` button, then connect them
  by dragging between handles. The old top connection form is preserved but
  disabled by `SHOW_CONNECTION_FORM = false` in `src/config.js`; set it to `true`
  to restore it. Existing connections are edited with the anchored duration card.
- Cards show icons and quantities below their names. Small features have a blue
  background; large features have an amber background and a `G` badge.
  Icons share balanced rows with up to five per row: six split 3–3, seven split
  4–3, and eight split 4–4.
- The toolbar `+` opens the catalog to add maps without creating connections.
- Drag handles on any of the four sides to connect maps. A small non-modal card
  beside the destination handle asks for the duration. It flips/clamps inside the
  canvas and follows zoom or resize. Cancel, Escape or an outside click dismisses
  the draft without creating a connection; the rest of the editor stays usable.
  The optional legacy top form keeps its own duration fields when enabled.
- Click a map for its image and catalog details. Double-click a connection line
  to edit its time; clicking its timer remains an accessible shortcut.
- Reverse duplicate connections and self-connections are rejected.
- Select and delete nodes/connections, arrange the graph, zoom, and pan.
- Download the complete map as PNG or copy that PNG to the image clipboard.
  Both include offscreen nodes, edges, resource icons and timers, without changing
  the current viewport. Toolbars and editing cards are excluded. Large maps use
  lower pixel density to keep the whole graph within browser canvas limits.
- The fullscreen button in the board toolbar shows just the map and its controls.
  The catalog, duration cards, selection, deletion and export remain available.
  Clicking an existing timer opens its edit card while fullscreen. Exit with
  the same button or Escape. Browsers that deny native fullscreen use a viewport
  focus mode instead.
- Sign in through `/admin`, then open `/` to list, create, open, or rename boards.
  Boards can be personal or shared with this installation's guild. The editor
  URL includes `?board=<uuid>` and can be bookmarked.
- Nodes, connections and absolute expiration times are saved to PostgreSQL.
  Refreshing does not restart timers. Expired connections remain until removed.
- Each board connects to `/ws/boards/<uuid>/` using the Django session.
  Editors and viewers receive changes without refreshing, including node moves,
  connection timers, deletion, renaming and permission changes. Camera position,
  zoom, selection and editing panels remain local to each browser.

The API uses session authentication and CSRF protection. `/api/boards/` lists or
creates accessible boards; `/api/boards/<uuid>/` reads, replaces board
state (`PUT`), or renames (`PATCH`). Inaccessible boards return 404, including for
staff users. Data is relational (`Board`, `BoardNode`, `BoardConnection`), with no
JSONField. The editor sends atomic operation batches over WebSocket, throttled
to 120 ms during dragging. The server locks the board, applies operations to the
latest document and broadcasts committed changes through Redis Channels. Edits
to different nodes/connections merge. The last committed edit wins when editing
the same entity; stale movement or timer updates cannot recreate deleted items.
Concurrent duplicate connections are resolved to one connection.

Clients preserve pending local operations when receiving remote changes and
rebase them onto the server document. Reconnection refreshes the current state
before retrying unacknowledged batches. `BoardMutation` receipts make retries
idempotent. Acknowledgements are sent after PostgreSQL commits; Redis carries
notifications, not the persistent map. A 15-second heartbeat repairs missed
notifications and checks session validity. Access is checked on every read and
write, and permission updates notify connected clients immediately.

The UI shows live/reconnecting status. Unacknowledged edits remain in memory
during a connection loss. Leaving through the in-app back button waits for
acknowledgements; browser unload warns while edits are pending. The legacy
whole-document HTTP PUT still requires a matching revision and returns 409 for
stale clients; the live editor does not use it.

Each deployment represents one guild. Active Django accounts are its current
members; no self-service guild creation or membership management is introduced.
The owner configures `/api/boards/<uuid>/access/` through the "Map access" panel:
view and edit access may each be granted to everyone or selected users.
Individual grants add to the guild-wide defaults. Edit requires view. Only the
owner can rename or manage access. Private boards ignore all guild grants.
Viewer mode allows inspecting, zooming, panning and exporting, with no database
writes. Existing boards remain private after migration; new boards default to
guild sharing in the UI, with everyone able to view and only the owner editing.
Discord sign-in is available without guild or role restrictions; configure it
with the [Discord login guide](../docs/discord-login.md). Membership management
is later work.

Deployment must forward WebSocket upgrades for `/ws/` to Uvicorn, alongside
ordinary HTTP. All web instances must share the PostgreSQL database and Redis
channel layer. Connections use Channels' `AllowedHostsOriginValidator` and
session authentication ([Channels security](https://channels.readthedocs.io/en/stable/topics/security.html)).

## Languages

The mapper supports `pt-BR`, `en-US`, and `es` with i18next/react-i18next.
Translations live in `src/locales/<language>/common.json` and `mapper.json`.
Use stable keys with `t("key")`; interpolate values with `{{name}}` and
use `_one`/`_other` keys for counts. The build checks that all languages have
matching keys and interpolation variables.

The header selector updates the UI immediately and saves the preference in
localStorage and a mapper-specific cookie. Without a saved preference, the
browser language is used (`es-AR`, for example, selects `es`). Unsupported
languages fall back to US English. Django uses the same JSON for the initial
page metadata and JavaScript-disabled message; `/admin` keeps its configuration.
Map names and draft data remain unchanged when switching languages.

## Verification

```powershell
npm test
npm run test:e2e
```

Backend board checks (permissions, CSRF, state validation and revision conflicts):

```powershell
docker compose --env-file .env.docker -f compose.yaml -f compose.corporate.yaml exec web python manage.py test mapper.test_boards --noinput
```

Focused live synchronization checks (concurrent operations, retries, view-only
access, live revocation and origin/session validation):

```powershell
docker compose --env-file .env.docker -f compose.yaml -f compose.corporate.yaml exec web python manage.py test mapper.test_realtime --noinput
```

Browser tests use the installed Microsoft Edge and the app at
`http://127.0.0.1:8000`. Override `MAPPER_URL` or `PLAYWRIGHT_CHANNEL` if needed.
The older editor browser tests predate session-backed boards and need authenticated
fixtures before running the full suite. They run in isolated browser contexts.
