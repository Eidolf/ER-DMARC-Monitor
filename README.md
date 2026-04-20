# DMARC Monitoring & Reporting System

A comprehensive, scalable system designed to ingest, process, and analyze DMARC reports (RUA/RUF). This system provides complete visibility into email authentication, unauthorized sender activity, and multi-domain SPF/DKIM compliance policies using an advanced microservices backend and a containerized deployment strategy.

## Architecture

The system follows a microservice-oriented design separated into ingestion, queueing, processing, data storage, and presentation layers.
For full details on the system design, data models, and component specifications, please review the designed architectural plan.

### Components
- **`smtp-ingester`**: The external-facing component to securely receive and validate incoming DMARC emails via MTA connectors or direct drops on port 25.
- **`dmarc-parser`**: Asynchronous worker node to uncompress, validate (anti-XXE), parse XML payloads, and organize insights.
- **`api`**: REST/GraphQL backend providing policy configurations, user management, alerting rules, and data aggregation for dashboards.
- **`frontend`**: Visualization web dashboard for interacting with domain and intelligence reports.
- **`broker`**: Async task and payload queuing via Redis/RabbitMQ.

## Deployment

The system is configured to run fully containerized via Docker for test, staging, and production environments. See `docker-compose.yml` for stack mappings.
