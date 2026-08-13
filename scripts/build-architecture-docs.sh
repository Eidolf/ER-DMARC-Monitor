#!/usr/bin/env bash
set -euo pipefail

SITE_OUTPUT_DIR="docs/generated/site"
CACHE_DIR="docs/generated/cache"
REPORTS_DIR="docs/generated/reports"
IMAGES_OUTPUT_DIR="docs/generated/images"

mkdir -p "${SITE_OUTPUT_DIR}" "${CACHE_DIR}" "${REPORTS_DIR}" "${IMAGES_OUTPUT_DIR}"

echo "=== Building arc42 Architecture Documentation ==="

if command -v python3 >/dev/null 2>&1 && [[ -f "scripts/generate-docs-images.py" ]]; then
  echo "Generating architecture & schema images via generate-docs-images.py..."
  python3 scripts/generate-docs-images.py || echo "Warning: Image generation skipped or dependencies missing."
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
      echo "No local diagram gem found. Enabling Kroki extension attributes..."
      DIAGRAM_ARGS+=("-r" "asciidoctor-kroki" "-a" "kroki-server-url=https://kroki.io")
    fi

    # Compile master index.adoc if present, or all individual adoc files
    if [[ -f "docs/arc42/index.adoc" ]]; then
      echo "Compiling master architecture document (docs/arc42/index.adoc)..."
      asciidoctor "${DIAGRAM_ARGS[@]}" -D "${SITE_OUTPUT_DIR}" "docs/arc42/index.adoc"
    fi
    for adoc_file in docs/arc42/*.adoc; do
      if [[ -f "${adoc_file}" ]]; then
        asciidoctor "${DIAGRAM_ARGS[@]}" -D "${SITE_OUTPUT_DIR}" "${adoc_file}"
      fi
    done
  else
    echo "Asciidoctor CLI not found in environment. Generating consolidated standalone HTML output with embedded images..."
    INDEX_HTML="${SITE_OUTPUT_DIR}/index.html"
    cat <<EOF > "${INDEX_HTML}"
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>ER-DMARC-Monitor Architecture Documentation (arc42)</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; padding: 2rem; max-width: 950px; margin: 0 auto; color: #1a202c; background-color: #f7fafc; }
    h1 { color: #2b6cb0; border-bottom: 2px solid #e2e8f0; padding-bottom: 0.5rem; }
    h2 { color: #2d3748; margin-top: 1.5rem; }
    .chapter { background: white; padding: 1.5rem; margin-bottom: 1.5rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .diagram-box { text-align: center; margin: 1.5rem 0; padding: 1rem; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; }
    .diagram-box img { max-width: 100%; height: auto; }
    pre { background: #edf2f7; padding: 1rem; border-radius: 6px; overflow-x: auto; }
    .todo { background: #fffaf0; border-left: 4px solid #dd6b20; padding: 0.5rem 1rem; margin: 0.5rem 0; font-weight: bold; color: #9c4221; }
  </style>
</head>
<body>
  <h1>ER-DMARC-Monitor Architecture Documentation (arc42)</h1>

  <div class="chapter">
    <h2>System Architecture Overview</h2>
    <div class="diagram-box">
      <img src="../images/architecture-diagram.svg" alt="Architecture Diagram" onerror="this.src='../images/metadata-badge.png'; this.onerror=null;" />
    </div>
  </div>
EOF

    for adoc_file in $(ls docs/arc42/*.adoc | grep -v 'index.adoc' | sort); do
      chapter_title=$(basename "${adoc_file}")
      echo "  <div class=\"chapter\">" >> "${INDEX_HTML}"
      echo "    <h2>${chapter_title}</h2>" >> "${INDEX_HTML}"
      echo "    <pre>" >> "${INDEX_HTML}"
      sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g' "${adoc_file}" >> "${INDEX_HTML}"
      echo "    </pre>" >> "${INDEX_HTML}"
      echo "  </div>" >> "${INDEX_HTML}"
    done

    cat <<EOF >> "${INDEX_HTML}"
</body>
</html>
EOF
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
