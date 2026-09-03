#!/usr/bin/env bash
set -euo pipefail

SITE_OUTPUT_DIR="docs/generated/site"
CACHE_DIR="docs/generated/cache"
REPORTS_DIR="docs/generated/reports"
IMAGES_OUTPUT_DIR="docs/generated/images"

mkdir -p "${SITE_OUTPUT_DIR}" "${CACHE_DIR}" "${REPORTS_DIR}" "${IMAGES_OUTPUT_DIR}"

echo "=== Building arc42 Architecture Documentation ==="

if command -v python3 >/dev/null 2>&1; then
  if [[ -f "scripts/generate-docs-images.py" ]]; then
    echo "Generating architecture & schema images via generate-docs-images.py..."
    python3 scripts/generate-docs-images.py || echo "Warning: Image generation skipped or dependencies missing."
  fi
  if [[ -f "scripts/generate-svg-diagrams.py" ]]; then
    echo "Generating high-fidelity SVG diagrams..."
    python3 scripts/generate-svg-diagrams.py || true
  fi
fi

# Check for docToolchain availability
DOCTOOLCHAIN_CMD=""
if [[ -f "./dtcw" ]]; then
  DOCTOOLCHAIN_CMD="./dtcw"
elif command -v doctoolchain >/dev/null 2>&1; then
  DOCTOOLCHAIN_CMD="doctoolchain"
fi

if [[ -n "${DOCTOOLCHAIN_CMD}" ]]; then
  echo "Using docToolchain wrapper: ${DOCTOOLCHAIN_CMD}"
  ${DOCTOOLCHAIN_CMD} generateHTML
  ${DOCTOOLCHAIN_CMD} generatePDF || echo "PDF generation skipped or optional."
else
  echo "docToolchain binary/wrapper (dtcw) not found locally."
  echo "Falling back to Asciidoctor build engine..."

  if command -v asciidoctor >/dev/null 2>&1; then
    echo "Building consolidated HTML with asciidoctor..."
    
    # Check for asciidoctor-diagram plugin or Kroki integration with valid input probe
    DIAGRAM_ARGS=()
    if printf "= Test\n\n[plantuml]\n----\n@startuml\n@enduml\n----\n" | asciidoctor -r asciidoctor-diagram -o /dev/null - 2>/dev/null; then
      echo "Using asciidoctor-diagram extension for PlantUML/Mermaid diagrams..."
      DIAGRAM_ARGS+=("-r" "asciidoctor-diagram")
    elif printf "= Test\n\n[plantuml]\n----\n@startuml\n@enduml\n----\n" | asciidoctor -r asciidoctor-kroki -o /dev/null - 2>/dev/null; then
      echo "Using asciidoctor-kroki extension..."
      DIAGRAM_ARGS+=("-r" "asciidoctor-kroki" "-a" "kroki-server-url=https://kroki.io")
    else
      echo "No local diagram gem found. Compiling standard Asciidoc without diagram extension..."
    fi

    # Copy images to site output directory so images resolve inside site artifact
    mkdir -p "${SITE_OUTPUT_DIR}/images"
    if [[ -d "${IMAGES_OUTPUT_DIR}" ]]; then
      cp -r "${IMAGES_OUTPUT_DIR}/"* "${SITE_OUTPUT_DIR}/images/" 2>/dev/null || true
    fi

    # Compile master index.adoc if present, or all individual adoc files
    if [[ -f "docs/arc42/index.adoc" ]]; then
      echo "Compiling master architecture document (docs/arc42/index.adoc)..."
      asciidoctor "${DIAGRAM_ARGS[@]}" -D "${SITE_OUTPUT_DIR}" "docs/arc42/index.adoc"
    fi
    for adoc_file in docs/arc42/*.adoc; do
      if [[ -f "${adoc_file}" && "$(basename "${adoc_file}")" != "index.adoc" ]]; then
        asciidoctor "${DIAGRAM_ARGS[@]}" -D "${SITE_OUTPUT_DIR}" "${adoc_file}"
      fi
    done
  else
    echo "Asciidoctor CLI not found in environment. Generating modern GitHub Pages site using Python compiler..."
    
    # Copy images to site output directory
    mkdir -p "${SITE_OUTPUT_DIR}/images"
    if [[ -d "${IMAGES_OUTPUT_DIR}" ]]; then
      cp -r "${IMAGES_OUTPUT_DIR}/"* "${SITE_OUTPUT_DIR}/images/" 2>/dev/null || true
    fi

    if [[ -f "scripts/generate-pages-site.py" ]]; then
      python3 scripts/generate-pages-site.py
    fi
  fi

  if command -v asciidoctor-pdf >/dev/null 2>&1; then
    echo "Building PDF with asciidoctor-pdf..."
    for adoc_file in docs/arc42/*.adoc; do
      if [[ -f "${adoc_file}" ]]; then
        asciidoctor-pdf "${DIAGRAM_ARGS[@]}" -D "${SITE_OUTPUT_DIR}" "${adoc_file}" || true
      fi
    done
  fi
fi

echo "Documentation build complete. Output located at ${SITE_OUTPUT_DIR}"
