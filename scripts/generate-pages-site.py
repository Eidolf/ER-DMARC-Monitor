#!/usr/bin/env python3
"""
Compile arc42 AsciiDoc files, generated SVG diagrams, API endpoint matrices,
and audit reports into a modern, responsive single-page site for GitHub Pages.
"""

import html
import json
import re
from pathlib import Path
from datetime import datetime, timezone

ROOT_DIR = Path(__file__).resolve().parent.parent
DOCS_DIR = ROOT_DIR / "docs"
ARC42_DIR = DOCS_DIR / "arc42"
GENERATED_DIR = DOCS_DIR / "generated"
SITE_DIR = GENERATED_DIR / "site"
DOCS_IMAGES_DIR = DOCS_DIR / "images"
IMAGES_DIR = GENERATED_DIR / "images"
REPORTS_DIR = GENERATED_DIR / "reports"


def parse_adoc_to_html(content: str) -> str:
    """Lightweight converter from AsciiDoc format to semantic HTML."""
    lines = content.splitlines()
    html_lines = []
    in_table = False
    table_headers = []
    table_rows = []
    in_listing = False
    listing_lines = []
    in_callout = False
    callout_lines = []
    skip_plantuml = False

    for raw_line in lines:
        line = raw_line.rstrip()

        # Handle plantuml blocks (skip raw plantuml block markers)
        if line.startswith("[plantuml"):
            skip_plantuml = True
            continue
        if skip_plantuml:
            if line == "----":
                if in_listing:
                    # closing
                    in_listing = False
                    skip_plantuml = False
                else:
                    in_listing = True
                continue
            continue

        # Code listings (----)
        if line.startswith("----") and not skip_plantuml:
            if in_listing:
                in_listing = False
                code_text = html.escape("\n".join(listing_lines))
                html_lines.append(f'<div class="code-block"><pre><code>{code_text}</code></pre></div>')
                listing_lines = []
            else:
                in_listing = True
                listing_lines = []
            continue

        if in_listing:
            listing_lines.append(raw_line)
            continue

        # AsciiDoc comments
        if line.startswith("//"):
            if "TODO:" in line:
                todo_text = html.escape(line.lstrip("/ ").strip())
                html_lines.append(f'<div class="todo-pill"><span class="badge badge-warning">Action Item</span> {todo_text}</div>')
            continue

        # AsciiDoc block attributes (e.g. [options="header",cols="1,2,2"], [source,python], etc.)
        if line.startswith("[") and line.endswith("]"):
            continue

        # AsciiDoc document attributes (e.g. :toc: left)
        if line.startswith(":") and line.count(":") >= 2:
            continue

        # Tables |===
        if line.startswith("|==="):
            if in_table:
                # Close table
                in_table = False
                tbl = ['<div class="table-responsive"><table class="doc-table">']
                if table_headers:
                    tbl.append('<thead><tr>' + ''.join(f'<th>{html.escape(h)}</th>' for h in table_headers) + '</tr></thead>')
                tbl.append('<tbody>')
                for row in table_rows:
                    tbl.append('<tr>' + ''.join(f'<td>{html.escape(c)}</td>' for c in row) + '</tr>')
                tbl.append('</tbody></table></div>')
                html_lines.append("\n".join(tbl))
                table_headers = []
                table_rows = []
            else:
                in_table = True
            continue

        if in_table:
            if line.startswith("|"):
                cells = [c.strip() for c in line.split("|")[1:] if c.strip()]
                if not table_headers and len(cells) > 0:
                    table_headers = cells
                else:
                    table_rows.append(cells)
            continue

        # Headers
        if line.startswith("= "):
            title = html.escape(line[2:].strip())
            html_lines.append(f'<h1 class="chapter-title">{title}</h1>')
            continue
        if line.startswith("== "):
            title = html.escape(line[3:].strip())
            html_lines.append(f'<h2 class="section-title">{title}</h2>')
            continue
        if line.startswith("=== "):
            title = html.escape(line[4:].strip())
            html_lines.append(f'<h3 class="subsection-title">{title}</h3>')
            continue

        # Bullet lists
        if line.startswith("* "):
            item = html.escape(line[2:].strip())
            # Format backticks to <code>
            item = re.sub(r'`([^`]+)`', r'<code class="inline-code">\1</code>', item)
            html_lines.append(f'<li class="doc-li">{item}</li>')
            continue
        if line.startswith("  - ") or line.startswith("    - "):
            item = html.escape(line.strip().lstrip("- ").strip())
            item = re.sub(r'`([^`]+)`', r'<code class="inline-code">\1</code>', item)
            html_lines.append(f'<li class="doc-subli">{item}</li>')
            continue

        # Numbered lists
        num_match = re.match(r'^(\d+)\.\s+(.*)$', line)
        if num_match:
            num = num_match.group(1)
            item = html.escape(num_match.group(2))
            item = re.sub(r'`([^`]+)`', r'<code class="inline-code">\1</code>', item)
            html_lines.append(f'<div class="step-item"><span class="step-num">{num}</span><div class="step-content">{item}</div></div>')
            continue

        # Empty line
        if not line:
            html_lines.append("")
            continue

        # Normal text paragraph
        p_text = html.escape(line)
        p_text = re.sub(r'`([^`]+)`', r'<code class="inline-code">\1</code>', p_text)
        html_lines.append(f'<p class="doc-p">{p_text}</p>')

    return "\n".join(html_lines)


def load_api_endpoints():
    endpoints_file = IMAGES_DIR / "api-endpoints.txt"
    if endpoints_file.exists():
        return endpoints_file.read_text(encoding="utf-8")
    return ""


def load_doc_diff_summary():
    diff_file = REPORTS_DIR / "doc-diff-summary.txt"
    if diff_file.exists():
        return diff_file.read_text(encoding="utf-8")
    return ""


def generate_site():
    SITE_DIR.mkdir(parents=True, exist_ok=True)
    (SITE_DIR / "images").mkdir(parents=True, exist_ok=True)
    DOCS_IMAGES_DIR.mkdir(parents=True, exist_ok=True)

    # Ensure images are copied to site/images and docs/images
    if IMAGES_DIR.exists():
        for img in IMAGES_DIR.glob("*"):
            if img.is_file():
                (SITE_DIR / "images" / img.name).write_bytes(img.read_bytes())
                (DOCS_IMAGES_DIR / img.name).write_bytes(img.read_bytes())

    # Order of arc42 chapters
    chapter_files = [
        ("01-introduction-and-goals.adoc", "1. Introduction & Goals", "introduction"),
        ("02-architecture-constraints.adoc", "2. Constraints", "constraints"),
        ("03-system-scope-and-context.adoc", "3. System Scope & Context", "scope"),
        ("04-solution-strategy.adoc", "4. Solution Strategy", "strategy"),
        ("05-building-block-view.adoc", "5. Building Block View", "building-blocks"),
        ("06-runtime-view.adoc", "6. Runtime View", "runtime"),
        ("07-deployment-view.adoc", "7. Deployment View", "deployment"),
        ("08-crosscutting-concepts.adoc", "8. Crosscutting Concepts", "crosscutting"),
        ("09-architecture-decisions.adoc", "9. Architecture Decisions", "decisions"),
        ("10-quality-requirements.adoc", "10. Quality Requirements", "quality"),
        ("11-risks-and-technical-debt.adoc", "11. Risks & Tech Debt", "risks"),
        ("12-glossary.adoc", "12. Glossary", "glossary")
    ]

    nav_items = []
    sections_html = []

    # Chapter mapping with diagram injections
    for file_name, display_title, anchor_id in chapter_files:
        f_path = ARC42_DIR / file_name
        nav_items.append(f'<a href="#{anchor_id}" class="nav-link" data-target="{anchor_id}">{display_title}</a>')

        content_html = ""
        if f_path.exists():
            content_html = parse_adoc_to_html(f_path.read_text(encoding="utf-8"))

        extra_diagram = ""
        if anchor_id == "building-blocks":
            extra_diagram = '''
            <div class="interactive-diagram-container">
                <div class="diagram-toolbar">
                    <span class="diagram-tag">Visual Model</span>
                    <span class="diagram-title">System Architecture & Pipeline</span>
                    <a href="images/architecture-diagram.svg" target="_blank" class="diagram-btn">Open Fullscreen ↗</a>
                </div>
                <div class="svg-viewer">
                    <img src="images/architecture-diagram.svg" alt="System Architecture Diagram" loading="lazy" />
                </div>
            </div>
            '''
        elif anchor_id == "constraints" or anchor_id == "decisions":
            extra_diagram = ""
        elif anchor_id == "runtime":
            extra_diagram = '''
            <div class="callout callout-info">
                <h4>Pipeline Data Flow</h4>
                <p>MTA Inbound &rarr; SMTP Receiver (Port 2525) &rarr; Redis Task Spool &rarr; Asynchronous XML Parser &rarr; PostgreSQL 15 &rarr; FastAPI REST &rarr; React SPA.</p>
            </div>
            '''

        sections_html.append(f'''
        <section id="{anchor_id}" class="chapter-card">
            {content_html}
            {extra_diagram}
        </section>
        ''')

    # Add extra sections for Database Schema & Live API Endpoints
    nav_items.append('<a href="#database-schema" class="nav-link" data-target="database-schema">Data Models & Schema</a>')
    nav_items.append('<a href="#api-endpoints" class="nav-link" data-target="api-endpoints">API Endpoints</a>')
    nav_items.append('<a href="#build-reports" class="nav-link" data-target="build-reports">Reports & Diff</a>')

    api_endpoints_txt = html.escape(load_api_endpoints())
    diff_summary_txt = html.escape(load_doc_diff_summary())
    current_time_iso = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    full_html = f'''<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="ER-DMARC-Monitor Architecture & Engineering Documentation (arc42)">
  <title>ER-DMARC-Monitor · Architecture Documentation (arc42)</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {{
      --bg-canvas: #090d16;
      --bg-sidebar: #0e1526;
      --bg-card: #131b2e;
      --bg-card-header: #1a243d;
      --border-subtle: #1e293b;
      --border-highlight: #334155;
      --text-primary: #f1f5f9;
      --text-secondary: #94a3b8;
      --text-muted: #64748b;
      --accent-primary: #38bdf8;
      --accent-glow: rgba(56, 189, 248, 0.25);
      --accent-success: #10b981;
      --accent-amber: #f59e0b;
      --accent-rose: #f43f5e;
      --sidebar-width: 280px;
    }}

    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      background-color: var(--bg-canvas);
      color: var(--text-primary);
      line-height: 1.6;
      display: flex;
      min-height: 100vh;
      overflow-x: hidden;
    }}

    /* Sidebar Navigation */
    .sidebar {{
      width: var(--sidebar-width);
      background-color: var(--bg-sidebar);
      border-right: 1px solid var(--border-subtle);
      position: fixed;
      top: 0;
      bottom: 0;
      left: 0;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      z-index: 100;
    }}

    .sidebar-header {{
      padding: 1.5rem;
      border-bottom: 1px solid var(--border-subtle);
    }}

    .logo-container {{
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 0.75rem;
    }}

    .logo-badge {{
      width: 38px;
      height: 38px;
      background: linear-gradient(135deg, #0284c7, #2563eb);
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      font-size: 1.1rem;
      color: white;
      box-shadow: 0 4px 12px var(--accent-glow);
    }}

    .project-name {{
      font-weight: 800;
      font-size: 1.05rem;
      color: #ffffff;
      letter-spacing: -0.02em;
    }}

    .project-sub {{
      font-size: 0.75rem;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-weight: 600;
    }}

    .nav-search {{
      padding: 0.5rem 0.75rem;
      margin: 1rem 1.25rem 0.5rem;
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      display: flex;
      align-items: center;
    }}

    .nav-search input {{
      width: 100%;
      background: transparent;
      border: none;
      color: var(--text-primary);
      font-size: 0.85rem;
      outline: none;
    }}

    .nav-group {{
      padding: 0.5rem 0.75rem 2rem;
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
    }}

    .nav-link {{
      display: block;
      padding: 0.55rem 0.85rem;
      border-radius: 6px;
      color: var(--text-secondary);
      font-size: 0.85rem;
      font-weight: 500;
      text-decoration: none;
      transition: all 0.15s ease;
    }}

    .nav-link:hover {{
      color: var(--accent-primary);
      background-color: rgba(56, 189, 248, 0.08);
    }}

    .nav-link.active {{
      color: #ffffff;
      background: linear-gradient(90deg, rgba(56, 189, 248, 0.15), rgba(37, 99, 235, 0.05));
      border-left: 3px solid var(--accent-primary);
      font-weight: 600;
    }}

    .sidebar-footer {{
      margin-top: auto;
      padding: 1.25rem;
      border-top: 1px solid var(--border-subtle);
      font-size: 0.75rem;
      color: var(--text-muted);
    }}

    /* Main Content Area */
    .main-wrapper {{
      margin-left: var(--sidebar-width);
      flex: 1;
      padding: 2.5rem 3.5rem 5rem;
      max-width: 1200px;
    }}

    .top-hero {{
      background: linear-gradient(135deg, rgba(30, 41, 59, 0.7), rgba(15, 23, 42, 0.9));
      border: 1px solid var(--border-subtle);
      border-radius: 16px;
      padding: 2rem 2.5rem;
      margin-bottom: 2.5rem;
      backdrop-filter: blur(12px);
      box-shadow: 0 8px 30px rgba(0,0,0,0.4);
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 1.5rem;
    }}

    .hero-title {{
      font-size: 2.2rem;
      font-weight: 800;
      letter-spacing: -0.03em;
      background: linear-gradient(to right, #ffffff, #93c5fd);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 0.4rem;
    }}

    .hero-desc {{
      color: var(--text-secondary);
      font-size: 1rem;
      max-width: 650px;
    }}

    .meta-pills {{
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-top: 1rem;
    }}

    .pill {{
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.1);
      padding: 0.25rem 0.75rem;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 500;
      color: var(--text-secondary);
    }}

    .pill-green {{ border-color: rgba(16, 185, 129, 0.3); color: #6ee7b7; background: rgba(16, 185, 129, 0.1); }}
    .pill-blue {{ border-color: rgba(56, 189, 248, 0.3); color: #7dd3fc; background: rgba(56, 189, 248, 0.1); }}

    /* Chapter Cards */
    .chapter-card {{
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: 14px;
      padding: 2.25rem;
      margin-bottom: 2rem;
      box-shadow: 0 4px 20px rgba(0,0,0,0.25);
      scroll-margin-top: 2rem;
    }}

    .chapter-title {{
      font-size: 1.6rem;
      font-weight: 700;
      color: #ffffff;
      border-bottom: 1px solid var(--border-subtle);
      padding-bottom: 0.75rem;
      margin-bottom: 1.25rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }}

    .section-title {{
      font-size: 1.25rem;
      font-weight: 600;
      color: #38bdf8;
      margin-top: 1.5rem;
      margin-bottom: 0.75rem;
    }}

    .subsection-title {{
      font-size: 1.05rem;
      font-weight: 600;
      color: #cbd5e1;
      margin-top: 1.25rem;
      margin-bottom: 0.5rem;
    }}

    .doc-p {{
      color: #cbd5e1;
      font-size: 0.95rem;
      margin-bottom: 0.9rem;
    }}

    .doc-li {{
      color: #e2e8f0;
      margin-left: 1.5rem;
      margin-bottom: 0.4rem;
      font-size: 0.92rem;
    }}

    .doc-subli {{
      color: #94a3b8;
      margin-left: 3rem;
      margin-bottom: 0.3rem;
      font-size: 0.88rem;
    }}

    .inline-code {{
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.85em;
      background: rgba(255,255,255,0.08);
      border: 1px solid rgba(255,255,255,0.12);
      padding: 0.15rem 0.4rem;
      border-radius: 4px;
      color: #38bdf8;
    }}

    .code-block {{
      background: #090d16;
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      padding: 1rem 1.25rem;
      margin: 1rem 0;
      overflow-x: auto;
    }}

    .code-block pre {{
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.85rem;
      color: #e2e8f0;
    }}

    .step-item {{
      display: flex;
      align-items: flex-start;
      gap: 0.75rem;
      margin-bottom: 0.75rem;
    }}

    .step-num {{
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      background: rgba(56, 189, 248, 0.15);
      color: #38bdf8;
      border: 1px solid rgba(56, 189, 248, 0.3);
      border-radius: 50%;
      font-size: 0.75rem;
      font-weight: 700;
      flex-shrink: 0;
      margin-top: 0.15rem;
    }}

    .step-content {{
      color: #cbd5e1;
      font-size: 0.92rem;
    }}

    /* Diagrams & SVGs */
    .interactive-diagram-container {{
      background: #0f172a;
      border: 1px solid var(--border-subtle);
      border-radius: 12px;
      overflow: hidden;
      margin: 1.5rem 0;
    }}

    .diagram-toolbar {{
      background: #1e293b;
      padding: 0.75rem 1.25rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid var(--border-subtle);
    }}

    .diagram-tag {{
      background: rgba(56, 189, 248, 0.15);
      color: #38bdf8;
      font-size: 0.7rem;
      font-weight: 700;
      text-transform: uppercase;
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
    }}

    .diagram-title {{
      font-size: 0.85rem;
      font-weight: 600;
      color: #e2e8f0;
      margin-left: 0.5rem;
      flex: 1;
    }}

    .diagram-btn {{
      font-size: 0.75rem;
      color: #38bdf8;
      text-decoration: none;
      font-weight: 600;
      padding: 0.3rem 0.6rem;
      border-radius: 4px;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.1);
      transition: all 0.2s;
    }}

    .diagram-btn:hover {{
      background: rgba(56, 189, 248, 0.2);
      border-color: #38bdf8;
    }}

    .svg-viewer {{
      padding: 1.5rem;
      display: flex;
      justify-content: center;
      align-items: center;
      background: #0b1120;
    }}

    .svg-viewer img {{
      max-width: 100%;
      height: auto;
      border-radius: 8px;
    }}

    /* Table Styles */
    .table-responsive {{
      overflow-x: auto;
      margin: 1.25rem 0;
    }}

    .doc-table {{
      width: 100%;
      border-collapse: collapse;
      font-size: 0.88rem;
      text-align: left;
    }}

    .doc-table th {{
      background: var(--bg-card-header);
      color: #f8fafc;
      padding: 0.75rem 1rem;
      font-weight: 600;
      border-bottom: 2px solid var(--border-subtle);
    }}

    .doc-table td {{
      padding: 0.75rem 1rem;
      border-bottom: 1px solid var(--border-subtle);
      color: #cbd5e1;
    }}

    .doc-table tr:hover td {{
      background: rgba(255,255,255,0.02);
    }}

    /* Alerts and Callouts */
    .callout {{
      padding: 1rem 1.25rem;
      border-radius: 8px;
      margin: 1.25rem 0;
      font-size: 0.9rem;
    }}

    .callout-info {{
      background: rgba(56, 189, 248, 0.08);
      border-left: 4px solid #38bdf8;
      color: #bae6fd;
    }}

    .callout h4 {{
      font-size: 0.95rem;
      font-weight: 700;
      margin-bottom: 0.35rem;
      color: #ffffff;
    }}

    .todo-pill {{
      background: rgba(245, 158, 11, 0.08);
      border: 1px dashed rgba(245, 158, 11, 0.35);
      border-radius: 6px;
      padding: 0.6rem 0.9rem;
      margin: 0.75rem 0;
      font-size: 0.82rem;
      color: #fde68a;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }}

    .badge-warning {{
      background: #f59e0b;
      color: #000000;
      font-weight: 700;
      font-size: 0.68rem;
      padding: 0.15rem 0.4rem;
      border-radius: 4px;
      text-transform: uppercase;
    }}

    /* Responsive */
    @media (max-width: 900px) {{
      body {{ flex-direction: column; }}
      .sidebar {{ position: static; width: 100%; border-right: none; border-bottom: 1px solid var(--border-subtle); }}
      .main-wrapper {{ margin-left: 0; padding: 1.5rem; }}
    }}
  </style>
</head>
<body>
  <!-- Sidebar -->
  <aside class="sidebar">
    <div class="sidebar-header">
      <div class="logo-container">
        <div class="logo-badge">ER</div>
        <div>
          <div class="project-name">DMARC Monitor</div>
          <div class="project-sub">Architecture arc42</div>
        </div>
      </div>
    </div>

    <div class="nav-search">
      <input type="text" id="chapterFilter" placeholder="Filter sections..." autocomplete="off">
    </div>

    <nav class="nav-group" id="navGroup">
      {''.join(nav_items)}
    </nav>

    <div class="sidebar-footer">
      <div>Generated: {current_time_iso}</div>
      <div>Maintained by: <strong>Eidolf</strong></div>
    </div>
  </aside>

  <!-- Main Content -->
  <main class="main-wrapper">
    <header class="top-hero">
      <div>
        <h1 class="hero-title">ER-DMARC-Monitor</h1>
        <p class="hero-desc">
          Automated system architecture documentation following the international <strong>arc42</strong> engineering template. Synchronized continuously via Docs-as-Code pipeline.
        </p>
        <div class="meta-pills">
          <span class="pill pill-green">● GitHub Pages Ready</span>
          <span class="pill pill-blue">arc42 Standard v8</span>
          <span class="pill">FastAPI · React · Redis · PostgreSQL</span>
          <span class="pill">Docs-as-Code</span>
        </div>
      </div>
      <div>
        <img src="images/metadata-badge.svg" alt="Project Badge" style="max-height: 80px;" />
      </div>
    </header>

    <!-- Sections -->
    {''.join(sections_html)}

    <!-- Database Schema Section -->
    <section id="database-schema" class="chapter-card">
      <h1 class="chapter-title">Database Models &amp; Relational Schema</h1>
      <p class="doc-p">Overview of data models defined with SQLModel and PostgreSQL schemas for reports, domains, alignment rules, and authentication.</p>
      
      <div class="interactive-diagram-container">
        <div class="diagram-toolbar">
          <span class="diagram-tag">Schema Vector</span>
          <span class="diagram-title">PostgreSQL Database Schema &amp; Entities</span>
          <a href="images/database-schema.svg" target="_blank" class="diagram-btn">Open Fullscreen ↗</a>
        </div>
        <div class="svg-viewer">
          <img src="images/database-schema.svg" alt="Database Schema Diagram" loading="lazy" />
        </div>
      </div>
    </section>

    <!-- API Endpoints Section -->
    <section id="api-endpoints" class="chapter-card">
      <h1 class="chapter-title">API Endpoint Catalog</h1>
      <p class="doc-p">Extracted REST API endpoints from FastAPI service inspection, grouped by HTTP verb.</p>
      <div class="code-block">
        <pre><code>{api_endpoints_txt}</code></pre>
      </div>
    </section>

    <!-- Build & Diff Reports Section -->
    <section id="build-reports" class="chapter-card">
      <h1 class="chapter-title">Build Verification &amp; Git Diff Report</h1>
      <p class="doc-p">Latest changes detected between current commit and documentation base tag.</p>
      <div class="code-block">
        <pre><code>{diff_summary_txt if diff_summary_txt else 'No pending uncommitted documentation differences.'}</code></pre>
      </div>
    </section>
  </main>

  <script>
    // Chapter filtering in sidebar
    const filterInput = document.getElementById('chapterFilter');
    const navLinks = document.querySelectorAll('.nav-link');

    filterInput.addEventListener('input', (e) => {{
      const q = e.target.value.toLowerCase();
      navLinks.forEach(link => {{
        const text = link.textContent.toLowerCase();
        link.style.display = text.includes(q) ? 'block' : 'none';
      }});
    }});

    // Scroll spy for navigation links
    const sections = document.querySelectorAll('section.chapter-card');
    window.addEventListener('scroll', () => {{
      let current = '';
      sections.forEach(section => {{
        const top = section.offsetTop - 120;
        if (window.scrollY >= top) {{
          current = section.getAttribute('id');
        }}
      }});

      navLinks.forEach(link => {{
        link.classList.remove('active');
        if (link.getAttribute('data-target') === current) {{
          link.classList.add('active');
        }}
      }});
    }});
  </script>
</body>
</html>
'''
    index_file = SITE_DIR / "index.html"
    index_file.write_text(full_html, encoding="utf-8")
    
    docs_root_index = DOCS_DIR / "index.html"
    docs_root_index.write_text(full_html, encoding="utf-8")
    print(f"✓ Generated GitHub Pages site index: {docs_root_index} & {index_file} ({len(full_html)} bytes)")


if __name__ == "__main__":
    generate_site()
