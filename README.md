# StockShock (Flip)

Voice-enabled market analysis app with:
- A FastAPI backend (`backend/`) using DuckDB + LLM agents
- A React/TanStack frontend (`frontend/`) for chat + dashboard rendering
- EPIC-style streaming (`voice agent + UI agent`) so UI updates do not block voice/text responses

## What This Project Does

You ask market questions (text or voice), and the system:
1. Runs agent inference to produce a friendly assistant answer.
2. Generates a structured `dashboardSpec` (cards/charts/timeline).
3. Streams incremental text to the UI.
4. Renders dashboard blocks from the contract.
5. Supports UI control/chaos commands (flip, comic sans, wobble, matrix, reset, etc.).

## Repository Layout

- `backend/`: FastAPI API, agent orchestration, DB access, streaming endpoints, voice proxy
- `frontend/`: React app (TanStack Router), chat UI, dashboard renderer, voice controls
- `backend/finance.db`: local DuckDB database used by backend by default

## Architecture (High Level)

- `POST /api/query`: non-streaming query endpoint
- `POST /api/query/stream`: SSE stream for single-agent flow
- `POST /api/query/epic-stream`: SSE stream for EPIC flow (voice + UI loops in parallel)
- `WS /api/voice/stt`: speech-to-text proxy
- `POST /api/voice/tts`: text-to-speech proxy
- `GET/POST /api/chaos`: persisted per-user UI chaos state

Backend normalizes/sanitizes dashboard output before returning it so frontend rendering stays stable.

## Prerequisites

- Python `3.12+`
- Node.js `18+` (or newer)
- `uv` installed for Python dependency management
- API keys:
  - `GEMINI_API_KEY` (LLM)
  - `GRADIUM_API_KEY` (voice STT/TTS, optional if you only use text chat)

## Quick Start

### 1) Start Backend

```bash
cd /Users/mounselam/Developer/Flip/backend
uv sync
```

Set required environment variables in `backend/.env` (or export in shell):

```env
GEMINI_API_KEY=your_key
GRADIUM_API_KEY=your_key
GRADIUM_REGION=eu
```

Run:

```bash
uv run uvicorn main:app --reload --port 8000
```

Health check:

```bash
curl http://localhost:8000/health
```

### 2) Start Frontend

```bash
cd /Users/mounselam/Developer/Flip/frontend
npm install
npm run dev
```

Open:

```text
http://localhost:3000
```

If backend is not on `http://localhost:8000`, create `frontend/.env`:

```env
VITE_FASTAPI_URL=http://localhost:8000
```

## Environment Variables

### Backend (`backend/.env`)

- `GEMINI_API_KEY`: Gemini API key
- `GEMINI_MODEL`: defaults to `gemini-3-flash-preview`
- `OPENAI_API_KEY`: optional, used only if you switch providers
- `OPENAI_MODEL`: defaults to `gpt-5`
- `FINANCE_DB_PATH`: optional override for DuckDB path
  - If omitted, backend resolves in this order:
    - `/Users/mounselam/Developer/Flip/data/finance.db`
    - `/Users/mounselam/Developer/Flip/backend/finance.db`
    - `/Users/mounselam/Developer/Flip/backend/data/finance.db`
- `CORS_ALLOW_ORIGINS`: comma-separated, default `*`
- `LOG_LEVEL`: default `INFO`
- `GRADIUM_API_KEY`: required for voice
- `GRADIUM_REGION`: default `eu`
- `GRADIUM_STT_MODEL`, `GRADIUM_TTS_MODEL`, `GRADIUM_TTS_VOICE_ID`, `GRADIUM_TTS_OUTPUT_FORMAT`

### Frontend (`frontend/.env`)

- `VITE_FASTAPI_URL`: backend base URL (default in code: `http://localhost:8000`)

## Streaming and Rendering Behavior

- Frontend connects to `/api/query/epic-stream`, then falls back to `/api/query/stream` if needed.
- Assistant text is streamed and shown immediately.
- Final dashboard payload is rendered separately (with a small delay in UI to improve perceived responsiveness).
- UI side-channel events (`ui_command`, `ui_intent`, `ui_state`) can update interface state without blocking assistant response flow.

## Testing and Quality

### Backend

```bash
cd /Users/mounselam/Developer/Flip/backend
uv run pytest -q
```

### Frontend Typecheck

```bash
cd /Users/mounselam/Developer/Flip/frontend
npx tsc --noEmit
```

## Troubleshooting

### `Cannot open file ... finance.db`

Cause: DB path points to missing file/directory.

Fix:
1. Ensure one of the default DB files exists (recommended: `backend/finance.db`).
2. Or explicitly set `FINANCE_DB_PATH` in `backend/.env` to an existing absolute path.

### `Table stock_prices does not exist`

Cause: Wrong DB file or uninitialized DB schema.

Fix:
1. Point `FINANCE_DB_PATH` to the expected finance DB.
2. Verify table exists:
   ```sql
   SELECT * FROM stock_prices LIMIT 5;
   ```

### SSE starts but UI updates late

This project now separates text streaming from dashboard rendering, so text should appear first.  
If it still feels delayed, check browser network tab for stalled SSE or reverse proxy buffering.

### UI block validation errors (e.g. KPI `change`)

Frontend now handles missing KPI change fields more defensively, but malformed payloads can still produce warnings.  
Check backend contract sanitation and block props in returned `dashboardSpec`.

## Useful Docs

- Backend details: `/Users/mounselam/Developer/Flip/backend/README.md`
- API + schema contracts in code:
  - `/Users/mounselam/Developer/Flip/backend/app/schemas/api.py`
  - `/Users/mounselam/Developer/Flip/backend/app/api/routes.py`
  - `/Users/mounselam/Developer/Flip/frontend/src/types/genui.ts`
