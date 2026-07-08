# ER-DMARC-Monitor - AI Developer Reference Handbook

Welcome! This document outlines coding standards, environment instructions, directory structures, and critical operational constraints designed to guide AI agents working in this repository.

---

## 1. Token Efficiency Rules

To minimize token usage and enhance execution speed:
- **Concise Responses**: Limit explanation prose exclusively to short bullet points. Do not include conversational introductory or concluding filler.
- **Precision File Views**: Restrict file views to specific line ranges (`StartLine` and `EndLine` parameters) rather than reading whole files, unless absolutely necessary.
- **Parallel Tool Invocations**: Group independent tool calls (e.g. read_file, file search) in a single turn for concurrent system execution.
- **No Echoing Code**: Do not print back large blocks of code that have just been written, read, or modified.

---

## 2. Subagent Strategy & Workspaces

- **Isolation Strategy**:
  - Spin up subagents for isolated research, parsing documentation, or running tests.
  - Keep the primary context clean by offloading heavy search/grep workloads.
- **Workspace Configuration**:
  - Keep directories in sync using git branch/checkout patterns or isolated temporary directories inside the workspace (`/home/dev/github/ER-DMARC-Monitor`).
  - Do not use `/tmp` or paths outside the workspace directory structure.

---

## 3. Single Source of Truth

- **File Inspection Order**:
  1. Read [project_manifest.json](file:///home/dev/github/ER-DMARC-Monitor/project_manifest.json) to understand files, models, and endpoints.
  2. Inspect [project_connections.json](file:///home/dev/github/ER-DMARC-Monitor/project_connections.json) to locate components involved in a feature.
  3. Query codebase files directly *only after* consulting the metadata files.

---

## 4. Codebase Architecture

| Directory/Path | Layer / Role | Tech Stack | Entry Point / Details |
| :--- | :--- | :--- | :--- |
| [`api/`](file:///home/dev/github/ER-DMARC-Monitor/api) | Backend API | Python + FastAPI + SQLModel | [`api/main.py`](file:///home/dev/github/ER-DMARC-Monitor/api/main.py) |
| [`frontend/`](file:///home/dev/github/ER-DMARC-Monitor/frontend) | Frontend Dashboard | React + TypeScript + Vite | [`frontend/src/main.tsx`](file:///home/dev/github/ER-DMARC-Monitor/frontend/src/main.tsx) |
| [`smtp-ingester/`](file:///home/dev/github/ER-DMARC-Monitor/smtp-ingester) | Mail Receiver | Python + Redis Broker | [`smtp-ingester/main.py`](file:///home/dev/github/ER-DMARC-Monitor/smtp-ingester/main.py) |
| [`dmarc-parser/`](file:///home/dev/github/ER-DMARC-Monitor/dmarc-parser) | Queue Processing Worker | Python + PostgreSQL | [`dmarc-parser/main.py`](file:///home/dev/github/ER-DMARC-Monitor/dmarc-parser/main.py) |
| [`scripts/`](file:///home/dev/github/ER-DMARC-Monitor/scripts) | Utils & Tests | Python / Bash / PowerShell | Local actions, test SMTP utilities |

---

## 5. CLI Commands Reference

### Development & Execution
* **Launch Entire Ecosystem (Docker Compose)**:
  ```bash
  docker compose up -d --build
  ```
* **Frontend Dev Server**:
  ```bash
  cd frontend && npm run dev
  ```
* **Backend Dev Server**:
  ```bash
  cd api && uvicorn main:app --reload --port 8080
  ```

### Linting & Formatting
* **Frontend ESLint**:
  ```bash
  cd frontend && npm run lint
  ```
* **Backend Linting (Ruff/Flake8 if available)**:
  ```bash
  ruff check api/
  ```

### Type Checking
* **Frontend TypeScript compiler**:
  ```bash
  cd frontend && npx tsc --noEmit
  ```

### Running Tests
* **Run SMTP Ingest Test**:
  ```bash
  python3 scripts/smtp_tests/test_dmarc.py --domain example.com --to report@dmarc.domain.com --host localhost --port 13062
  ```

---

## 6. Project Coding Rules & Quality Hygiene

- **Git Configuration**:
  - Always commit using:
    `git commit --author="Eidolf <andreas@eidolf.de>"` (local scope only).
- **Language**:
  - Use **English** exclusively for code comments, logs, variables, and documentation.
- **Type Annotations**:
  - Python: Enforce Python 3.10+ typing (e.g. `str | None` instead of `Optional[str]`).
  - TypeScript: Strict typing in frontend. Avoid the `any` keyword unless absolutely necessary.
- **Error Handling**:
  - Fail loudly. Always log full exception stack traces to stderr (`traceback.print_exc()`).
  - Prevent silent try-except blocks.
- **Concurrency & Transactions**:
  - FastAPI session management relies on `Depends(get_session)` executing database transaction scope bounds context-wise. Always call `session.commit()` explicitly inside database mutation handlers.
- **Script Constraints**:
  - Put all scripts in `scripts/`.
  - Put temporary outputs or scratch testing scripts in `scratch/`.
  - Do not hardcode credentials or secrets. Always read from `.env` or system environment variables.
