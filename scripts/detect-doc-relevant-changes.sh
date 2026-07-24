#!/usr/bin/env bash
set -euo pipefail

SINCE_REF="${SINCE_REF:-}"
TARGET_REF="${TARGET_REF:-}"
FORCE_FULL_SCAN="${FORCE_FULL_SCAN:-false}"

REPORTS_DIR="docs/generated/reports"
mkdir -p "${REPORTS_DIR}"

FILES_REPORT="${REPORTS_DIR}/doc-relevant-files.txt"
DIFF_SUMMARY_REPORT="${REPORTS_DIR}/doc-diff-summary.txt"
UPDATE_REQUIRED_REPORT="${REPORTS_DIR}/doc-update-required.txt"

rm -f "${FILES_REPORT}" "${DIFF_SUMMARY_REPORT}" "${UPDATE_REQUIRED_REPORT}"

# Determine target ref
if [[ -z "${TARGET_REF}" ]]; then
  TARGET_REF="HEAD"
fi

# Determine since ref if not specified
if [[ -z "${SINCE_REF}" ]]; then
  # Try to find previous tag
  PREV_TAG=$(git describe --tags --abbrev=0 "${TARGET_REF}^" 2>/dev/null || true)
  if [[ -n "${PREV_TAG}" ]]; then
    SINCE_REF="${PREV_TAG}"
  else
    # Fallback to HEAD~1 or first commit
    if git rev-parse --verify "${TARGET_REF}~1" >/dev/null 2>&1; then
      SINCE_REF="${TARGET_REF}~1"
    else
      SINCE_REF=$(git rev-list --max-parents=0 "${TARGET_REF}" 2>/dev/null || echo "${TARGET_REF}")
    fi
  fi
fi

echo "Diff Base (since_ref): ${SINCE_REF}"
echo "Diff Target (target_ref): ${TARGET_REF}"

RELEVANT_PATTERNS=(
  "src/"
  "app/"
  "lib/"
  "services/"
  "api/"
  "server/"
  "backend/"
  "frontend/"
  "infrastructure/"
  "infra/"
  "deploy/"
  "helm/"
  "k8s/"
  "docker/"
  "Dockerfile"
  "docker-compose.yml"
  "compose.yml"
  "package.json"
  "pom.xml"
  "build.gradle"
  "settings.gradle"
  "requirements.txt"
  "pyproject.toml"
  "go.mod"
  "Cargo.toml"
  "*.csproj"
  "*.sln"
  "openapi.*"
  "swagger.*"
  "proto/"
)

MATCHED_FILES=()

if [[ "${FORCE_FULL_SCAN}" == "true" ]]; then
  echo "Force full scan enabled. Scanning repository for matching paths..." > "${DIFF_SUMMARY_REPORT}"
  ALL_FILES=$(git ls-files "${TARGET_REF}" 2>/dev/null || find . -type f)
  for file in ${ALL_FILES}; do
    for pattern in "${RELEVANT_PATTERNS[@]}"; do
      if [[ "${pattern}" == */ ]]; then
        if [[ "${file}" == ${pattern}* ]]; then
          MATCHED_FILES+=("${file}")
          break
        fi
      elif [[ "${pattern}" == *\** ]]; then
        # Glob pattern check
        filename=$(basename "${file}")
        if [[ "${filename}" == ${pattern} ]]; then
          MATCHED_FILES+=("${file}")
          break
        fi
      else
        if [[ "${file}" == "${pattern}" ]]; then
          MATCHED_FILES+=("${file}")
          break
        fi
      fi
    done
  done
else
  # Perform git diff check
  if git rev-parse --verify "${SINCE_REF}" >/dev/null 2>&1 && git rev-parse --verify "${TARGET_REF}" >/dev/null 2>&1; then
    CHANGED_FILES=$(git diff --name-only "${SINCE_REF}" "${TARGET_REF}")
    git diff --stat "${SINCE_REF}" "${TARGET_REF}" > "${DIFF_SUMMARY_REPORT}" || true
    
    for file in ${CHANGED_FILES}; do
      for pattern in "${RELEVANT_PATTERNS[@]}"; do
        if [[ "${pattern}" == */ ]]; then
          if [[ "${file}" == ${pattern}* ]]; then
            MATCHED_FILES+=("${file}")
            break
          fi
        elif [[ "${pattern}" == *\** ]]; then
          filename=$(basename "${file}")
          if [[ "${filename}" == ${pattern} ]]; then
            MATCHED_FILES+=("${file}")
            break
          fi
        else
          if [[ "${file}" == "${pattern}" ]]; then
            MATCHED_FILES+=("${file}")
            break
          fi
        fi
      done
    done
  else
    echo "Warning: Invalid git refs for diff. Falling back to empty diff summary." > "${DIFF_SUMMARY_REPORT}"
  fi
fi

# De-duplicate files
if [[ ${#MATCHED_FILES[@]} -gt 0 ]]; then
  printf "%s\n" "${MATCHED_FILES[@]}" | sort -u > "${FILES_REPORT}"
  echo "true" > "${UPDATE_REQUIRED_REPORT}"
else
  touch "${FILES_REPORT}"
  echo "false" > "${UPDATE_REQUIRED_REPORT}"
fi

echo "Relevant files count: $(wc -l < "${FILES_REPORT}")"
echo "Update required: $(cat "${UPDATE_REQUIRED_REPORT}")"
