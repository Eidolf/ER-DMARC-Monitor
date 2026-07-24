# DMARC Monitoring & Reporting System

A comprehensive, scalable system designed to ingest, process, and analyze DMARC reports (RUA/RUF). This system provides complete visibility into email authentication, unauthorized sender activity, and multi-domain SPF/DKIM compliance policies using an advanced microservices backend and a containerized deployment strategy.

## Architecture

The system follows a microservice-oriented design separated into ingestion, queueing, processing, data storage, and presentation layers.
- **`smtp-ingester`**: The external-facing component to securely receive and validate incoming DMARC emails.
- **`dmarc-parser`**: Asynchronous worker node to uncompress and parse XML payloads.
- **`api`**: REST/GraphQL backend providing policy configurations and data aggregation.
- **`frontend`**: Visualization web dashboard for interacting with domain and intelligence reports.
- **`broker`**: Async task and payload queuing via Redis.

## Deployment & Configuration

The system is configured to run fully containerized via Docker for test, staging, and production environments.

### Docker Compose Reference
Here is the baseline configuration that orchestrates the system:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      - POSTGRES_USER=dmarc_admin
      - POSTGRES_PASSWORD=secure_dmarc_pass
      - POSTGRES_DB=dmarc_monitor
    volumes:
      - pgdata:/var/lib/postgresql/data
    networks:
      - dmarc-backend

  redis:
    image: redis:alpine
    networks:
      - dmarc-backend

  api:
    build: ./api
    environment:
      - DB_DSN=postgresql+psycopg://dmarc_admin:secure_dmarc_pass@postgres:5432/dmarc_monitor
      - REDIS_URL=redis://redis:6379/0
      - JWT_SECRET=change_me_in_production
    ports:
      - "13061:8080"
    depends_on:
      - postgres
      - redis
    networks:
      - dmarc-backend
      - dmarc-frontend

  frontend:
    build: ./frontend
    ports:
      - "13060:80"
    networks:
      - dmarc-frontend

  smtp-ingester:
    build: ./smtp-ingester
    environment:
      - BROKER_URL=redis://redis:6379/0
      - RECIPIENT_DOMAINS=report.dmarc.domain.com
    ports:
      - "13062:2525"
    volumes:
      - raw-payloads:/data/raw
    networks:
      - dmarc-backend

  dmarc-parser:
    build: ./dmarc-parser
    environment:
      - BROKER_URL=redis://redis:6379/0
      - DB_DSN=postgresql+psycopg://dmarc_admin:secure_dmarc_pass@postgres:5432/dmarc_monitor
    depends_on:
      - postgres
      - redis
    volumes:
      - raw-payloads:/data/raw
    networks:
      - dmarc-backend

networks:
  dmarc-backend:
    driver: bridge
  dmarc-frontend:
    driver: bridge

volumes:
  pgdata:
  raw-payloads:
```

### 🔒 Security Setup (Production Readiness)
Before starting this stack in a live or exposed environment, you **must** update the variables in your configuration:

1. **Database Passwords:**
   Change `POSTGRES_PASSWORD=secure_dmarc_pass` in the `postgres`, `api`, and `dmarc-parser` services to a strong, generated password.
2. **API Authentication JWT:**
   Change `JWT_SECRET=change_me_in_production` under the `api` service. This is used to sign authentication tokens for the dashboard.
3. **Ingestion Restrictions:**
   Change `RECIPIENT_DOMAINS=report.dmarc.domain.com` under `smtp-ingester` to your actual reporting domains to reject fast-spam and relay attempts.
4. **Ports:**
   Ensure ports `13060` (Frontend) and `13061` (API) are behind a secure reverse proxy terminating SSL (like Nginx/Traefik). Port `13062` (Mapped to SMTP) should be forwarded from port `25` on your firewall.

## Startup
To build and launch the ecosystem securely:
```bash
docker compose up -d --build
```

### 🔑 Default Credentials (First Start / Local Development)
After starting the ecosystem, you can log in to the dashboard at `http://localhost:13060` with the following default administrator credentials:
* **Username**: `admin`
* **Password**: `admin123`
* **Email**: `admin@local`

> [!WARNING]
> Change the default administrator password immediately after logging in for the first time via the user profile settings.

## Architecture Documentation

This repository contains arc42-compliant software architecture documentation located under `docs/arc42/`.

### Location & Structure

- `docs/arc42/`: Contains the 12 arc42 chapters in AsciiDoc format (`01-introduction-and-goals.adoc` to `12-glossary.adoc`).
- `docs/diagrams/`: Architecture diagrams and visual resources.
- `docs/generated/`: Build output directory for generated reports, cache, and site artifacts.

### Manual GitHub Actions Workflow

The architecture documentation is maintained and built via a manually startable GitHub Actions workflow (`.github/workflows/architecture-docs-manual.yml`).

> **Note:** The workflow does **NOT** trigger automatically on `push`, `pull_request`, `schedule`, `release`, or `workflow_run` events.

#### How to Run via GitHub UI

1. Navigate to **Actions** tab in GitHub.
2. Select **Architecture Documentation (Manual)** workflow.
3. Click **Run workflow**.
4. Configure optional inputs:
   - **`since_ref`**: Git ref/tag/commit as diff base (default: previous git tag or fallback).
   - **`target_ref`**: Git ref/tag/commit to document (default: current selected branch).
   - **`use_ai`**: Set `true` to enable AI-assisted documentation updates (default: `false`).
   - **`create_pull_request`**: Set `true` to create a Pull Request with updated docs (default: `true`).
   - **`force_full_scan`**: Set `true` to ignore git diff and scan all doc-relevant files (default: `false`).

#### Secrets & AI Configuration

To enable AI-assisted documentation updates when selecting `use_ai=true`, configure one of the following secrets in GitHub Repository Settings (**Settings > Secrets and variables > Actions**):

- `ANTHROPIC_API_KEY`: Anthropic Claude API key.
- `OPENAI_API_KEY`: OpenAI API key (or compatible API).

*If `use_ai=true` is chosen but no AI API key is set in GitHub Secrets, the AI update step emits a warning and gracefully skips without failing the build workflow.*

#### Downloading Artifacts

After workflow completion:
1. Open the specific workflow run execution page.
2. Scroll to the **Artifacts** section.
3. Download `architecture-docs-site` (contains generated HTML documentation and PDF if available).

#### Building Documentation Locally (Without AI)

To execute the documentation build locally without running AI updates:

```bash
# Make build script executable
chmod +x scripts/build-architecture-docs.sh

# Run documentation build
./scripts/build-architecture-docs.sh
```

Generated outputs will be placed in `docs/generated/site/`.

#### Reviewing AI-Generated Documentation

All updates performed with `use_ai=true` MUST be reviewed by human maintainers. Any uncertain AI inferences will be flagged with `TODO: REVIEW REQUIRED` in the AsciiDoc files.
