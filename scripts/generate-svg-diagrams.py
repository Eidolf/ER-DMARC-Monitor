#!/usr/bin/env python3
"""
Generate SVG diagrams and visual assets without requiring system graphviz binary.
Uses pure Python SVG generation for architecture and DB schema, plus metadata badge.
"""

import json
import os
import sys
from pathlib import Path
from datetime import datetime

ROOT_DIR = Path(__file__).resolve().parent.parent
DOCS_DIR = ROOT_DIR / "docs"
IMAGES_DIR = DOCS_DIR / "generated" / "images"


def load_manifest():
    manifest_path = ROOT_DIR / "project_manifest.json"
    if manifest_path.exists():
        with open(manifest_path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def generate_architecture_svg(output_path: Path):
    svg = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 700" width="100%" height="100%" style="background:#0f172a; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <defs>
    <linearGradient id="primaryGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#3b82f6" />
      <stop offset="100%" stop-color="#1d4ed8" />
    </linearGradient>
    <linearGradient id="accentGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#10b981" />
      <stop offset="100%" stop-color="#047857" />
    </linearGradient>
    <linearGradient id="amberGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#f59e0b" />
      <stop offset="100%" stop-color="#b45309" />
    </linearGradient>
    <linearGradient id="purpleGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#8b5cf6" />
      <stop offset="100%" stop-color="#6d28d9" />
    </linearGradient>
    <linearGradient id="roseGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ec4899" />
      <stop offset="100%" stop-color="#be185d" />
    </linearGradient>
    <filter id="cardGlow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#000000" flood-opacity="0.4"/>
    </filter>
    <marker id="arrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 1 L 10 5 L 0 9 z" fill="#64748b" />
    </marker>
    <marker id="arrow-blue" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 1 L 10 5 L 0 9 z" fill="#38bdf8" />
    </marker>
  </defs>

  <!-- Title & Legend -->
  <text x="40" y="48" font-size="22" font-weight="700" fill="#f8fafc">ER-DMARC-Monitor · System Architecture &amp; Data Pipeline</text>
  <text x="40" y="74" font-size="13" fill="#94a3b8">Interactive Service Topology, Asynchronous Queue Workers &amp; Analytics Pipeline</text>

  <!-- External MTAs -->
  <g transform="translate(50, 120)">
    <rect width="180" height="90" rx="10" fill="#1e293b" stroke="#f43f5e" stroke-width="1.5" filter="url(#cardGlow)"/>
    <rect width="180" height="26" rx="10" fill="#f43f5e" fill-opacity="0.2"/>
    <text x="14" y="20" font-size="12" font-weight="600" fill="#fda4af">EXTERNAL INGEST</text>
    <text x="14" y="52" font-size="15" font-weight="700" fill="#ffffff">External Mail Servers</text>
    <text x="14" y="72" font-size="12" fill="#94a3b8">MTAs (Google, MS, etc.)</text>
  </g>

  <!-- Arrow 1: MTA -> SMTP Ingester -->
  <path d="M 230 165 L 300 165" stroke="#38bdf8" stroke-width="2" stroke-dasharray="4,4" marker-end="url(#arrow-blue)"/>
  <text x="238" y="155" font-size="11" fill="#38bdf8">Port 2525</text>

  <!-- Service: SMTP Ingester -->
  <g transform="translate(310, 120)">
    <rect width="200" height="100" rx="10" fill="#1e293b" stroke="#3b82f6" stroke-width="1.5" filter="url(#cardGlow)"/>
    <rect width="200" height="26" rx="10" fill="#3b82f6" fill-opacity="0.2"/>
    <text x="14" y="20" font-size="12" font-weight="600" fill="#93c5fd">INGEST SERVICE</text>
    <text x="14" y="54" font-size="15" font-weight="700" fill="#ffffff">smtp-ingester</text>
    <text x="14" y="74" font-size="12" fill="#94a3b8">aiosmtpd / Python 3.10+</text>
    <text x="14" y="90" font-size="11" fill="#64748b">Validates &amp; extracts .zip/.gz</text>
  </g>

  <!-- Arrow 2: SMTP Ingester -> Redis -->
  <path d="M 510 165 L 590 165" stroke="#38bdf8" stroke-width="2" marker-end="url(#arrow-blue)"/>
  <text x="525" y="155" font-size="11" fill="#38bdf8">LPUSH job</text>

  <!-- Broker: Redis Queue -->
  <g transform="translate(600, 120)">
    <rect width="180" height="100" rx="10" fill="#1e293b" stroke="#e11d48" stroke-width="1.5" filter="url(#cardGlow)"/>
    <rect width="180" height="26" rx="10" fill="#e11d48" fill-opacity="0.2"/>
    <text x="14" y="20" font-size="12" font-weight="600" fill="#fda4af">MESSAGE BROKER</text>
    <text x="14" y="54" font-size="15" font-weight="700" fill="#ffffff">Redis Queue</text>
    <text x="14" y="74" font-size="12" fill="#94a3b8">Task Spooling (dmarc_jobs)</text>
    <text x="14" y="90" font-size="11" fill="#64748b">Port 6379</text>
  </g>

  <!-- Arrow 3: Redis -> DMARC Parser -->
  <path d="M 690 220 L 690 310" stroke="#38bdf8" stroke-width="2" marker-end="url(#arrow-blue)"/>
  <text x="700" y="270" font-size="11" fill="#38bdf8">BRPOP</text>

  <!-- Worker: DMARC Parser -->
  <g transform="translate(590, 320)">
    <rect width="200" height="110" rx="10" fill="#1e293b" stroke="#10b981" stroke-width="1.5" filter="url(#cardGlow)"/>
    <rect width="200" height="26" rx="10" fill="#10b981" fill-opacity="0.2"/>
    <text x="14" y="20" font-size="12" font-weight="600" fill="#6ee7b7">WORKER DAEMON</text>
    <text x="14" y="54" font-size="15" font-weight="700" fill="#ffffff">dmarc-parser</text>
    <text x="14" y="74" font-size="12" fill="#94a3b8">XML Unpack &amp; Normalizer</text>
    <text x="14" y="94" font-size="11" fill="#64748b">DKIM / SPF / IP Alignment</text>
  </g>

  <!-- Arrow 4: DMARC Parser -> Database -->
  <path d="M 590 380 L 480 380" stroke="#38bdf8" stroke-width="2" marker-end="url(#arrow-blue)"/>
  <text x="500" y="370" font-size="11" fill="#38bdf8">INSERT</text>

  <!-- Storage: PostgreSQL -->
  <g transform="translate(280, 320)">
    <rect width="190" height="120" rx="10" fill="#1e293b" stroke="#0ea5e9" stroke-width="1.5" filter="url(#cardGlow)"/>
    <rect width="190" height="26" rx="10" fill="#0ea5e9" fill-opacity="0.2"/>
    <text x="14" y="20" font-size="12" font-weight="600" fill="#7dd3fc">RELATIONAL STORE</text>
    <text x="14" y="54" font-size="15" font-weight="700" fill="#ffffff">PostgreSQL 15+</text>
    <text x="14" y="74" font-size="12" fill="#94a3b8">DMARC Records, Reports</text>
    <text x="14" y="90" font-size="12" fill="#94a3b8">Domains, Users, Audit Logs</text>
    <text x="14" y="108" font-size="11" fill="#64748b">Port 5432 · SQLModel ORM</text>
  </g>

  <!-- Arrow 5: Database <-> API -->
  <path d="M 375 440 L 375 520" stroke="#38bdf8" stroke-width="2" marker-end="url(#arrow-blue)"/>
  <text x="385" y="485" font-size="11" fill="#38bdf8">SQL Queries</text>

  <!-- API: FastAPI Backend -->
  <g transform="translate(270, 530)">
    <rect width="210" height="110" rx="10" fill="#1e293b" stroke="#8b5cf6" stroke-width="1.5" filter="url(#cardGlow)"/>
    <rect width="210" height="26" rx="10" fill="#8b5cf6" fill-opacity="0.2"/>
    <text x="14" y="20" font-size="12" font-weight="600" fill="#c4b5fd">BACKEND API</text>
    <text x="14" y="54" font-size="15" font-weight="700" fill="#ffffff">FastAPI Backend</text>
    <text x="14" y="74" font-size="12" fill="#94a3b8">REST Endpoints / JWT / SSO</text>
    <text x="14" y="94" font-size="11" fill="#64748b">DNS Check, Stats &amp; Admin</text>
  </g>

  <!-- Arrow 6: Frontend <-> API -->
  <path d="M 570 585 L 490 585" stroke="#38bdf8" stroke-width="2" marker-end="url(#arrow-blue)"/>
  <text x="500" y="575" font-size="11" fill="#38bdf8">JSON / REST</text>

  <!-- Frontend: React Dashboard -->
  <g transform="translate(580, 530)">
    <rect width="210" height="110" rx="10" fill="#1e293b" stroke="#f59e0b" stroke-width="1.5" filter="url(#cardGlow)"/>
    <rect width="210" height="26" rx="10" fill="#f59e0b" fill-opacity="0.2"/>
    <text x="14" y="20" font-size="12" font-weight="600" fill="#fde68a">WEB DASHBOARD</text>
    <text x="14" y="54" font-size="15" font-weight="700" fill="#ffffff">React + Vite SPA</text>
    <text x="14" y="74" font-size="12" fill="#94a3b8">TypeScript, Tailwind / Lucide</text>
    <text x="14" y="94" font-size="11" fill="#64748b">Charts, Filters, Alignment Table</text>
  </g>

  <!-- Arrow 7: Users <-> Frontend -->
  <path d="M 870 585 L 800 585" stroke="#38bdf8" stroke-width="2" marker-end="url(#arrow-blue)"/>

  <!-- Users -->
  <g transform="translate(880, 540)">
    <circle cx="45" cy="35" r="25" fill="#334155" stroke="#94a3b8" stroke-width="1.5"/>
    <circle cx="45" cy="26" r="9" fill="#94a3b8"/>
    <path d="M 30 45 A 15 15 0 0 1 60 45 Z" fill="#94a3b8"/>
    <text x="45" y="76" font-size="12" font-weight="600" fill="#f8fafc" text-anchor="middle">Security Analysts</text>
    <text x="45" y="92" font-size="11" fill="#64748b" text-anchor="middle">&amp; Admins</text>
  </g>
</svg>'''
    output_path.write_text(svg, encoding="utf-8")
    print(f"✓ Generated architecture SVG: {output_path}")


def generate_database_schema_svg(manifest, output_path: Path):
    db_models = manifest.get("db_models", {})
    
    # Render interactive cards in SVG
    num_models = len(db_models)
    width = 1200
    card_width = 270
    card_margin = 25
    cols = 4
    rows = (num_models + cols - 1) // cols
    height = max(500, rows * 280 + 100)

    svg_parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="100%" height="100%" style="background:#0f172a; font-family:-apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, monospace;">',
        '  <defs>',
        '    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">',
        '      <feDropShadow dx="0" dy="4" stdDeviation="5" flood-color="#000000" flood-opacity="0.5"/>',
        '    </filter>',
        '  </defs>',
        '  <text x="30" y="45" font-size="20" font-weight="700" fill="#f8fafc" font-family="-apple-system, BlinkMacSystemFont, sans-serif">Database Schema · Relational Entities &amp; Data Models</text>',
        '  <text x="30" y="70" font-size="12" fill="#94a3b8" font-family="-apple-system, BlinkMacSystemFont, sans-serif">SQLModel schema definitions extracted from api/models.py</text>'
    ]

    for idx, (model_name, info) in enumerate(db_models.items()):
        col = idx % cols
        row = idx // cols
        x = 30 + col * (card_width + card_margin)
        y = 100 + row * 270
        fields = info.get("fields", {})

        svg_parts.append(f'  <g transform="translate({x}, {y})">')
        svg_parts.append(f'    <rect width="{card_width}" height="240" rx="8" fill="#1e293b" stroke="#334155" stroke-width="1.5" filter="url(#shadow)"/>')
        svg_parts.append(f'    <rect width="{card_width}" height="32" rx="8" fill="#2563eb" fill-opacity="0.3"/>')
        svg_parts.append(f'    <text x="14" y="21" font-size="13" font-weight="700" fill="#60a5fa" font-family="-apple-system, BlinkMacSystemFont, sans-serif">{model_name}</text>')

        field_y = 52
        for f_name, f_type in list(fields.items())[:8]:
            short_type = str(f_type).replace(" | None", "?")
            svg_parts.append(f'    <text x="14" y="{field_y}" font-size="11" fill="#e2e8f0">{f_name}</text>')
            svg_parts.append(f'    <text x="{card_width - 14}" y="{field_y}" font-size="10" fill="#94a3b8" text-anchor="end">{short_type}</text>')
            field_y += 20

        remaining = len(fields) - 8
        if remaining > 0:
            svg_parts.append(f'    <text x="14" y="{field_y + 4}" font-size="10" fill="#64748b" font-style="italic">+{remaining} additional attributes...</text>')

        svg_parts.append('  </g>')

    svg_parts.append('</svg>')
    output_path.write_text("\n".join(svg_parts), encoding="utf-8")
    print(f"✓ Generated database schema SVG: {output_path}")


def generate_metadata_badge_svg(output_path: Path):
    svg = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 450 100" width="450" height="100">
  <defs>
    <linearGradient id="badgeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#1e293b"/>
      <stop offset="100%" stop-color="#0f172a"/>
    </linearGradient>
  </defs>
  <rect width="450" height="100" rx="10" fill="url(#badgeGrad)" stroke="#38bdf8" stroke-width="1.5"/>
  <circle cx="35" cy="50" r="16" fill="#0284c7"/>
  <path d="M 28 50 L 33 55 L 43 43" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round"/>
  <text x="65" y="38" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="16" font-weight="700" fill="#ffffff">ER-DMARC-Monitor</text>
  <text x="65" y="58" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="12" fill="#94a3b8">Automated arc42 Architecture Documentation</text>
  <text x="65" y="78" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="10" fill="#38bdf8">GitHub Pages · Continuous Docs-as-Code</text>
</svg>'''
    output_path.write_text(svg, encoding="utf-8")
    print(f"✓ Generated metadata badge SVG: {output_path}")


def main():
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    manifest = load_manifest()
    generate_architecture_svg(IMAGES_DIR / "architecture-diagram.svg")
    generate_database_schema_svg(manifest, IMAGES_DIR / "database-schema.svg")
    generate_metadata_badge_svg(IMAGES_DIR / "metadata-badge.svg")


if __name__ == "__main__":
    main()
