# ReleaseReady

**AI-powered release communication and readiness workbench** built with React, TypeScript, FastAPI, SQLite, and Google Gemini.

ReleaseReady helps developers turn structured release information into clear, evidence-linked release communication. It combines deterministic completeness checks with AI-assisted analysis, while keeping review decisions under human control.

## Features

- **Structured release packages** for completed features, bug fixes, changed behaviour, QA summary and evidence, known limitations, migration/configuration notes, and affected user groups.
- **Deterministic readiness checks** that identify missing required sections without relying on an AI model.
- **AI-assisted analysis** to classify user impact, surface missing information, ask clarification questions, identify risks and limitations, and flag potentially unsupported QA claims.
- **Two release briefs**: a technical brief for internal engineering audiences and a plain-language stakeholder brief.
- **Traceable source references** that link generated statements to supplied release items or QA evidence.
- **Human review workflow** to edit, approve, or reject proposed statements.
- **Release version history and comparison** to preserve snapshots and inspect field-level changes.
- **Review audit history** and final reviewed-brief generation from approved statements.

AI output is a proposal, not an approval. ReleaseReady does not deploy software or autonomously approve a release.

## Technology stack

| Layer                  | Technology                           |
| ---------------------- | ------------------------------------ |
| Frontend               | React, TypeScript, Vite              |
| Backend API            | Python, FastAPI, Uvicorn             |
| Local data store       | SQLite                               |
| AI provider            | Google Gemini API (`google-genai`) |
| Validation and schemas | Pydantic                             |

## Project layout

```text
app/
├── backend/
│   ├── app/
│   │   ├── ai_analysis.py
│   │   ├── database.py
│   │   ├── main.py
│   │   ├── schemas.py
│   │   └── validation.py
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── App.css
│   │   ├── index.css
│   │   └── main.tsx
│   ├── package.json
│   └── vite.config.ts
├── .gitignore
└── README.md
```

## Run locally (Windows PowerShell)

### 1. Prerequisites

- Python 3.11+ (the project has been developed with Python 3.13)
- Node.js and npm
- A Google Gemini API key for AI analysis

### 2. Start the backend

From the repository root:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Create `backend/.env` using `.env.example` as a template:

```dotenv
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=your_enabled_gemini_model
```

Use a model available to your Google AI Studio project and compatible with the structured-output API used by the app. Keep the real `.env` file private; it must never be committed to Git.

Start the API:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload
```

The local API runs at [http://127.0.0.1:8000](http://127.0.0.1:8000). Interactive API documentation is available at [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs).

### 3. Start the frontend

Open a second terminal at the repository root:

```powershell
cd frontend
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

For local development, the frontend uses `http://127.0.0.1:8000` as its default API URL. To override it, create `frontend/.env.local`:

```dotenv
VITE_API_URL=http://127.0.0.1:8000
```

Vite environment variables prefixed with `VITE_` are bundled into client code. **Never put the Gemini key in a `VITE_` variable or any frontend file.**

## Quality checks

Run these commands before opening a pull request or deploying:

```powershell
cd frontend
npm run lint
npm run build
```

For Python syntax/import checks, from the repository root run:

```powershell
cd backend
.\.venv\Scripts\python.exe -m compileall app
```

These checks are useful but are not a substitute for automated tests of API, AI, versioning, and review workflows.

## Deployment overview

The frontend and backend are separate services, so a frontend hosting provider alone does not deploy the FastAPI API.

### Frontend: Vercel

1. Import the GitHub repository into Vercel.
2. Set **Root Directory** to `frontend`.
3. Use the Vite framework preset, build command `npm run build`, and output directory `dist` (usually detected automatically).
4. Add the environment variable `VITE_API_URL` with the public HTTPS base URL of the deployed backend, for example `https://your-api.example.com`.
5. Redeploy after changing build-time environment variables.

### Backend: Render or another Python host

For a Render Web Service, set **Root Directory** to `backend`, **Build Command** to `pip install -r requirements.txt`, and **Start Command** to:

```bash
uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

Configure `GEMINI_API_KEY` and `GEMINI_MODEL` in the backend host's environment settings. Do not commit or expose these values.

Update backend CORS configuration to allow the exact deployed Vercel origin as well as local development origins. Do not use a wildcard origin when credentials or private data are involved.

### Important data-persistence note

The current local implementation stores data in SQLite. A local SQLite file is suitable for development, but a hosted service may have an ephemeral filesystem. Before relying on the public deployment for durable releases, versions, analyses, or review history, migrate the backend to a managed PostgreSQL database or configure a host with supported persistent storage and point SQLite at that persistent mount. Verify persistence after a restart/redeploy.

## Security and current limitations

- The Gemini key belongs only in backend environment variables.
- The current app does not include user authentication or per-user access control. Use sample/demo release data only on a public deployment; do not enter confidential release information.
- Citation ID checks ensure that references exist in the supplied source catalogue; they do not prove the semantic truth of a model-generated claim. Human review remains necessary.
- Stale-statement detection when supporting release items change, comprehensive automated tests, and production authentication/database hardening should be completed before treating the app as production-ready.
- Hosting free tiers have usage and persistence limitations; confirm the provider's current plan details before deployment.

## License

No license has been added yet. Add a license file if you intend to grant others explicit reuse rights.
