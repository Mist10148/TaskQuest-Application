# @taskquest/ai

The optional private AI service for TaskQuest: a summarizer, a prioritizer and a chat assistant, built with FastAPI, LangChain and LangGraph on Google Gemini. The design is in [docs/AI_INTEGRATION.md](../../docs/AI_INTEGRATION.md).

The browser never calls this service. Express authenticates the user and forwards requests with a shared secret (`X-AI-Token`) and the trusted Discord ID (`X-Discord-Id`).

## Run it

```bash
python -m venv .venv
.venv/Scripts/activate            # Linux/macOS: source .venv/bin/activate
pip install -e ".[dev]"
uvicorn app.main:app --reload --port 8000
```

It reads the repository-root `.env` (see the AI section of [`.env.example`](../../.env.example)). Minimum: `AI_INTERNAL_TOKEN` (32+ characters, same value as the web service), `GEMINI_API_KEY`, and the database variables. The schema comes from the Node migrations (`npm run db:migrate`, migration `003_ai`); this service never runs DDL.

One-off jobs:

```bash
python -m app.rag.index_docs      # embed docs/GAMEPLAY.md and docs/COMMANDS.md (idempotent)
python -m app.rag.backfill        # embed every quest; add --user <discord id> for one user
```

## Test and lint

```bash
ruff check .
pytest tests/unit tests/graphs
```

Tests are offline: fake chat models and embeddings, in-memory SQLite, and a mocked Express. Nothing calls Gemini. The Python code targets 3.12 (CI) and has also been run on 3.13.

## Layout

```
app/
├── main.py               FastAPI app, health, request logging, reconcile loop
├── config.py             Settings (env vars)
├── deps.py               X-AI-Token and X-Discord-Id checks
├── db/                   async SQLAlchemy engine; repo.py = scoped queries (every function takes discord_id)
├── rag/                  chunking, embeddings, vector store, hybrid retriever, indexer, CLIs
├── chains/summarize.py   summarizer (3 modes, cache, id validation, map-reduce)
├── graphs/
│   ├── prioritize.py     LangGraph: features -> LLM rank -> validate -> merge / fallback
│   ├── chat.py           LangGraph agent: router, retrieval, tools, confirmation, memory
│   └── checkpointer.py   MySQL checkpoint saver
├── tools/                chat tools (specs.py) and the Express /internal client (web_client.py)
├── chat_service.py       runs a turn and turns graph output into SSE events
├── threads.py            chat thread rows
├── usage.py              daily quota and token accounting
├── prompts/*.md          versioned prompts (the version is logged)
└── routers/              /v1/* (summary, prioritize, chat, threads) and /internal/* (index, forget)
```

## Safety rules the code enforces

- Every repository function and thread function takes `discord_id` and filters by it (a unit test checks the repo).
- `discord_id` is never a tool argument. Tool argument models reject extra fields.
- Write tools (`create_list`, `add_item`, `complete_item`, `update_list`) run only after the user approves a confirmation, and only through Express `/internal/*`, so XP and achievements are awarded in one place.
- Task text reaches the model only inside delimited `<task>`/`<doc>` blocks, and the prompt says it is data, not instructions.
- Logs never contain task text. Users who opted out are never embedded.
