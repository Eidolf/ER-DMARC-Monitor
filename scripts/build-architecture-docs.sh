#!/usr/bin/env bash
set -euo pipefail

SITE_OUTPUT_DIR="docs/generated/site"
CACHE_DIR="docs/generated/cache"
REPORTS_DIR="docs/generated/reports"

mkdir -p "${SITE_OUTPUT_DIR}" "${CACHE_DIR}" "${REPORTS_DIR}"

echo "=== Building arc42 Architecture Documentation ==="

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
    echo "Building HTML with asciidoctor..."
    for adoc_file in docs/arc42/*.adoc; do
      if [[ -f "${adoc_file}" ]]; then
        asciidoctor -D "${SITE_OUTPUT_DIR}" "${adoc_file}"
      fi
    done
  else
    echo "Asciidoctor CLI not found in environment. Generating consolidated standalone HTML output..."
    INDEX_HTML="${SITE_OUTPUT_DIR}/index.html"
    cat <<EOF > "${INDEX_HTML}"
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>ER-DMARC-Monitor Architecture Documentation (arc42)</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; padding: 2rem; max-width: 900px; margin: 0 auto; color: #1a202c; background-color: #f7fafc; }
    h1 { color: #2b6cb0; border-bottom: 2px solid #e2e8f0; padding-bottom: 0.5rem; }
    h2 { color: #2d3748; margin-top: 1.5rem; }
    pre { background: #edf2f7; padding: 1rem; border-radius: 6px; overflow-x: auto; }
    .chapter { background: white; padding: 1.5rem; margin-bottom: 1.5rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .todo { background: #fffaf0; border-left: 4px solid #dd6b20; padding: 0.5rem 1rem; margin: 0.5rem 0; font-weight: bold; color: #9c4221; }
  </style>
</head>
<body>
  <h1>ER-DMARC-Monitor Architecture Documentation (arc42)</h1>
EOF

    for adoc_file in $(ls docs/arc42/*.adoc | sort); do
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
        asciidoctor-pdf -D "${SITE_OUTPUT_DIR}" "${adoc_file}" || true
      fi
    done
  fi
fi

echo "Documentation build complete. Output located at ${SITE_OUTPUT_DIR}"
