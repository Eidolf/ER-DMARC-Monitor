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
