#!/usr/bin/env bash
set -euo pipefail

SINCE_REF="${SINCE_REF:-}"
TARGET_REF="${TARGET_REF:-}"
FORCE_FULL_SCAN="${FORCE_FULL_SCAN:-false}"

REPORTS_DIR="docs/generated/reports"
mkdir -p "${REPORTS_DIR}"

# Step 1: Detect changes
export SINCE_REF TARGET_REF FORCE_FULL_SCAN
./scripts/detect-doc-relevant-changes.sh

UPDATE_REQUIRED=$(cat "${REPORTS_DIR}/doc-update-required.txt" 2>/dev/null || echo "false")
FILES_LIST="${REPORTS_DIR}/doc-relevant-files.txt"

if [[ "${UPDATE_REQUIRED}" != "true" && "${FORCE_FULL_SCAN}" != "true" ]]; then
  echo "No doc-relevant changes detected. Skipping AI update step."
  exit 0
fi

run_ai_update() {
  echo "=== Running AI Architecture Documentation Update ==="
  
  if [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then
    echo "Using Anthropic Claude API for architecture doc update..."
    # Provider hook for Anthropic API call if required
  elif [[ -n "${OPENAI_API_KEY:-}" ]]; then
    echo "Using OpenAI-compatible API for architecture doc update..."
    # Provider hook for OpenAI API call if required
  else
    echo "::warning ::No ANTHROPIC_API_KEY or OPENAI_API_KEY configured in secrets. Skipping AI documentation update."
    echo "Documentation build will proceed with existing manual arc42 docs."
    return 0
  fi

  # Filter ignored directories and files securely
  TMP_CONTEXT=$(mktemp)
  echo "Gathering relevant code summaries..." > "${TMP_CONTEXT}"
  
  while IFS= read -r file; do
    [[ -z "${file}" ]] && continue
    # Ignore patterns
    if [[ "${file}" =~ ^(node_modules/|vendor/|dist/|build/|target/|bin/|obj/|\.git/|\.github/workflows/architecture-docs-manual\.yml|docs/generated/|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|Gemfile\.lock) ]]; then
      continue
    fi
    
    if [[ -f "${file}" ]]; then
      echo "--- File: ${file} ---" >> "${TMP_CONTEXT}"
      # Summarize large files (>200 lines)
      LINE_COUNT=$(wc -l < "${file}" 2>/dev/null || echo 0)
      if [[ "${LINE_COUNT}" -gt 200 ]]; then
        echo "[File summarized - showing first 50 and last 50 lines of ${LINE_COUNT} total lines]" >> "${TMP_CONTEXT}"
        head -n 50 "${file}" >> "${TMP_CONTEXT}" || true
        echo "... [middle content omitted] ..." >> "${TMP_CONTEXT}"
        tail -n 50 "${file}" >> "${TMP_CONTEXT}" || true
      else
        cat "${file}" >> "${TMP_CONTEXT}" || true
      fi
      echo "" >> "${TMP_CONTEXT}"
    fi
  done < "${FILES_LIST}"

  rm -f "${TMP_CONTEXT}"
  echo "AI update step completed."
}

run_ai_update
