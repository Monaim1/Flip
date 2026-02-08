# Flip Backend (FastAPI)

FastAPI service for the Flip demo. It uses DuckDB for analytics data and a LangGraph + Gemini agent to generate dashboard specs.

## Features
- `POST /api/query` parses a natural-language prompt, runs safe SQL, and returns a dashboard spec.
- `POST /api/query/stream` streams partial assistant output + final JSON via SSE.
- `GET /health` returns a simple status.
- SQL safety guardrails (SELECT-only, allowed tables).
- Schema-aligned agent prompt for the existing DuckDB dataset.
- Voice proxy endpoints for Gradium:
  - `WS /api/voice/stt` (speech-to-text)
  - `POST /api/voice/tts` (text-to-speech)
  - UI supports push-to-talk and optional VAD (auto-stop on silence)

## Recent Changes (Backend Restructure)
- Introduced a proper FastAPI package layout under `app/`.
- Aligned LLM prompt to the actual DuckDB tables (`stock_prices`, `financial_metrics`, `news`).
- Added SQL safety filtering to block non-SELECT statements and unknown tables.
- Implemented safe JSON placeholder hydration without string replacement.
- Normalized LLM blocks to `{ type, props }` to match the frontend renderer.
- Carried forward chaos state when omitted from the LLM response.
- Updated the DB smoke test to match the real schema.
- Added pytest coverage for SQL guardrails, JSON tools, and the query endpoint.
- Switched LLM integration to LangGraph + Gemini.
- Added Gradium voice proxy endpoints (STT + TTS).

## Tech Stack
- FastAPI + Uvicorn
- DuckDB
- LangGraph + Gemini (langchain-google-genai)
- Pydantic v2

## Requirements
- Python 3.12+
- `uv` (recommended)

## Quickstart (uv)
1. Install dependencies:
```
uv sync
```

2. Run the API:
```
uv run uvicorn main:app --reload --port 8000
```

3. Health check:
```
curl http://localhost:8000/health
```

## Configuration
Environment variables:
- `GEMINI_API_KEY` (required for live LLM calls)
- `GEMINI_MODEL` (default: `gemini-2.5-flash`)
- `FINANCE_DB_PATH` (default: `../data/finance.db`)
- `CORS_ALLOW_ORIGINS` (default: `*`)
- `LOG_LEVEL` (default: `INFO`)
- `GRADIUM_API_KEY` (required for voice STT/TTS)
- `GRADIUM_REGION` (default: `eu`)
- `GRADIUM_TTS_VOICE_ID` (default: `b35yykvVppLXyw_l`)
- `GRADIUM_TTS_MODEL` (default: `default`)
- `GRADIUM_TTS_OUTPUT_FORMAT` (default: `wav`)

You can set these in `backend/.env` (loaded automatically).

## API
Contract: see `/Users/mounselam/Desktop/ai-hackaton-paris-2026/CONTRACT.md`.

### `POST /api/query`
Request body:
```
{
  "message": "Show me AAPL vs MSFT performance this quarter",
  "currentChaos": {
    "rotation": 0,
    "fontFamily": "Inter",
    "animation": null,
    "theme": "professional"
  }
}
```

### `POST /api/voice/tts`
Request body:
```
{
  "text": "Hello from Flip"
}
```

### `WS /api/voice/stt`
Open a WebSocket and stream PCM audio frames; the backend forwards to Gradium and
relays transcript events back to the client.

Response body:
```
{
  "dashboardSpec": {
    "blocks": [
      { "type": "executive-summary", "props": { "content": "..." } },
      { "type": "line-chart", "props": { "title": "...", "data": [], "xKey": "date", "yKeys": ["AAPL"] } }
    ],
    "chaos": {
      "rotation": 0,
      "fontFamily": "Inter",
      "animation": null,
      "theme": "professional"
    }
  },
  "assistantMessage": "...",
  "intent": "performance_analysis",
  "queryMetadata": {
    "executionTimeMs": 123,
    "sqlQueriesRequested": 2,
    "sqlQueriesExecuted": 2
  }
}
```

## Data Schema (DuckDB)
Tables expected in `FINANCE_DB_PATH`:
- `stock_prices(ticker, date, open, high, low, close, volume)`
- `financial_metrics(ticker, report_period, market_cap, pe_ratio, pb_ratio, current_ratio, debt_to_equity, revenue_growth, net_income_growth, free_cash_flow_yield)`
- `news(ticker, date, title, author, source, url, sentiment)`

Notes:
- Event timeline data is derived from `news` with SQL aliases to match frontend props.

## Project Structure
- `app/main.py` FastAPI app
- `app/api/routes.py` API endpoints
- `app/services/db.py` DuckDB access
- `app/services/agent.py` LangGraph agent and prompt orchestration
- `app/utils/sql_guard.py` SQL safety checks
- `app/utils/json_tools.py` JSON parsing and placeholder hydration
- `main.py` Uvicorn entrypoint

## Common Tasks
Run the DB smoke test:
```
uv run python test_backend_db.py
```

Run tests:
```
uv run pytest
```

Sync fixture data:
```
uv run python scripts/sync_data.py --tickers AAPL MSFT TSLA --suffix _2024-03-01_2025-03-08
```

## Makefile Shortcuts (repo root)
From the repo root:
```
make backend
```

## Troubleshooting
- `ValueError: mutable default ...` in config: ensure `app/core/config.py` uses `default_factory` for list fields.
- `ModuleNotFoundError: duckdb`: run `uv sync` to install dependencies.
- LLM JSON parsing errors: check `GEMINI_API_KEY` and the prompt in `app/services/prompts.py`.
