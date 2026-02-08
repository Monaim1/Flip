# Flip (Clean)

This repo is now a single FastAPI backend and a single frontend UI.

**Kept**
- `backend/` — FastAPI (Flip)
- `data/finance.db` — local DuckDB data
- `frontend/` — UI wired to FastAPI

## Run Locally

### 1) Backend
```
cd /Users/mounselam/Desktop/ai-hackaton-paris-2026/backend
export GEMINI_API_KEY="YOUR_REAL_KEY"
export GRADIUM_API_KEY="YOUR_REAL_KEY"
export GRADIUM_REGION="eu"
uv run uvicorn main:app --reload --port 8000
```

### 2) Frontend
```
cd /Users/mounselam/Desktop/ai-hackaton-paris-2026/frontend
npm install
npm run dev
```

Open:
```
http://localhost:3000
```

## Voice (Gradium)
The UI includes a mic button (speech-to-text) and a speaker toggle (text-to-speech).
Voice uses the backend proxy endpoints:
- `WS /api/voice/stt` (STT)
- `POST /api/voice/tts` (TTS)

Required environment variables:
- `GRADIUM_API_KEY`
- `GRADIUM_REGION` (use `eu` in Paris)

## Optional
If you want a different backend URL, create:
```
/Users/mounselam/Desktop/ai-hackaton-paris-2026/frontend/.env
```
with:
```
VITE_FASTAPI_URL=http://localhost:8000
```
