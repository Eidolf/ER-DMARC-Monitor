# Architecture Documentation

This repository contains arc42-compliant software architecture documentation located under `docs/arc42/`.

## Location & Structure

- `docs/arc42/`: Contains the 12 arc42 chapters in AsciiDoc format (`01-introduction-and-goals.adoc` to `12-glossary.adoc`).
- `docs/diagrams/`: Architecture diagrams and visual resources.
- `docs/generated/`: Build output directory for generated reports, cache, and site artifacts.

## Manual GitHub Actions Workflow

The architecture documentation is maintained and built via a manually startable GitHub Actions workflow (`.github/workflows/architecture-docs-manual.yml`).

> **Note:** The workflow does **NOT** trigger automatically on `push`, `pull_request`, `schedule`, `release`, or `workflow_run` events.

### How to Run via GitHub UI

1. Navigate to **Actions** tab in GitHub.
2. Select **Architecture Documentation (Manual)** workflow.
3. Click **Run workflow**.
4. Configure optional inputs:
   - **`since_ref`**: Git ref/tag/commit as diff base (default: previous git tag or fallback).
   - **`target_ref`**: Git ref/tag/commit to document (default: current selected branch).
   - **`use_ai`**: Set `true` to enable AI-assisted documentation updates (default: `false`).
   - **`create_pull_request`**: Set `true` to create a Pull Request with updated docs (default: `true`).
   - **`force_full_scan`**: Set `true` to ignore git diff and scan all doc-relevant files (default: `false`).

### Secrets & AI Configuration

To enable AI-assisted documentation updates when selecting `use_ai=true`, configure one of the following secrets in GitHub Repository Settings (**Settings > Secrets and variables > Actions**):

- `ANTHROPIC_API_KEY`: Anthropic Claude API key.
- `OPENAI_API_KEY`: OpenAI API key (or compatible API).

*If `use_ai=true` is chosen but no AI API key is set in GitHub Secrets, the AI update step emits a warning and gracefully skips without failing the build workflow.*

### Downloading Artifacts

After workflow completion:
1. Open the specific workflow run execution page.
2. Scroll to the **Artifacts** section.
3. Download `architecture-docs-html` (and `architecture-docs-pdf` if available).

### Building Documentation Locally (Without AI)

To execute the documentation build locally without running AI updates:

```bash
# Make build script executable
chmod +x scripts/build-architecture-docs.sh

# Run documentation build
./scripts/build-architecture-docs.sh
```

Generated outputs will be placed in `docs/generated/site/`.

### Reviewing AI-Generated Documentation

All updates performed with `use_ai=true` MUST be reviewed by human maintainers. Any uncertain AI inferences will be flagged with `TODO: REVIEW REQUIRED` in the AsciiDoc files.
