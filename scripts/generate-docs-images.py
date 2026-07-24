#!/usr/bin/env python3
"""
Dynamic documentation image generator for ER-DMARC-Monitor.
Generates architecture diagrams, API endpoint visualizations, and database schema images.
"""

import json
import os
import sys
from pathlib import Path
from datetime import datetime

try:
    import graphviz
    HAS_GRAPHVIZ = True
except ImportError:
    HAS_GRAPHVIZ = False
    print("⚠ Warning: graphviz module not available. Install with: pip install graphviz")

try:
    from PIL import Image, ImageDraw, ImageFont
    HAS_PIL = True
except ImportError:
    HAS_PIL = False
    print("⚠ Warning: PIL not available. Install with: pip install Pillow")


def load_manifest():
    """Load project manifest."""
    manifest_path = Path(__file__).parent.parent / "project_manifest.json"
    if not manifest_path.exists():
        raise FileNotFoundError(f"project_manifest.json not found at {manifest_path}")
    
    with open(manifest_path, 'r') as f:
        return json.load(f)


def create_output_dir():
    """Create output directory for generated images."""
    output_dir = Path(__file__).parent.parent / "docs" / "generated" / "images"
    output_dir.mkdir(parents=True, exist_ok=True)
    return output_dir


def generate_architecture_diagram(manifest, output_dir):
    """Generate architecture overview diagram."""
    if not HAS_GRAPHVIZ:
        print("✗ Skipping architecture diagram (graphviz not available)")
        return
    
    g = graphviz.Digraph(
        name='architecture',
        comment='ER-DMARC-Monitor Architecture',
        graph_attr={
            'rankdir': 'TB',
            'bgcolor': 'white',
            'nodesep': '0.8',
            'ranksep': '1.0',
            'fontname': 'Arial'
        }
    )
    
    # Styling
    g.attr('node', shape='box', style='rounded,filled', fillcolor='lightblue', fontname='Arial')
    g.attr('edge', fontname='Arial', fontsize='10')
    
    # External layer
    g.node('SMTP_Sources', 'DMARC\nEmail Sources', fillcolor='#ffcccc')
    
    # Ingestion layer
    g.node('SMTP_Ingester', 'SMTP Ingester\n(Port 2525)', fillcolor='#ffe6cc')
    
    # Broker layer
    g.node('Redis', 'Redis Broker\n(Task Queue)', fillcolor='#fff4cc')
    
    # Processing layer
    g.node('DMARC_Parser', 'DMARC Parser\n(Worker)', fillcolor='#e6f3ff')
    
    # Storage layer
    g.node('PostgreSQL', 'PostgreSQL\nDatabase', fillcolor='#ccf2ff')
    
    # API layer
    g.node('FastAPI', 'FastAPI Backend\n(Port 8080)', fillcolor='#e6ccff')
    
    # Frontend layer
    g.node('Frontend', 'React Dashboard\n(Port 80)', fillcolor='#ccf2cc')
    
    # User layer
    g.node('Users', 'Users/Analysts', fillcolor='#ffcccc')
    
    # Connections
    g.edge('SMTP_Sources', 'SMTP_Ingester', label='Email (SMTP)')
    g.edge('SMTP_Ingester', 'Redis', label='Queue')
    g.edge('Redis', 'DMARC_Parser', label='Task')
    g.edge('DMARC_Parser', 'PostgreSQL', label='Parsed Data')
    g.edge('FastAPI', 'PostgreSQL', label='Query/Update')
    g.edge('Frontend', 'FastAPI', label='REST API')
    g.edge('Users', 'Frontend', label='Browse')
    
    output_path = output_dir / 'architecture-diagram'
    g.render(output_path, format='svg', cleanup=True)
    print(f"✓ Generated architecture diagram: {output_path}.svg")


def generate_database_schema(manifest, output_dir):
    """Generate database schema diagram from manifest models."""
    if not HAS_GRAPHVIZ:
        print("✗ Skipping database schema (graphviz not available)")
        return
    
    g = graphviz.Digraph(
        name='database_schema',
        comment='ER-DMARC-Monitor Database Schema',
        graph_attr={
            'rankdir': 'LR',
            'bgcolor': 'white',
            'fontname': 'Arial',
            'concentrate': 'true'
        }
    )
    
    g.attr('node', shape='plaintext', fontname='Arial')
    
    db_models = manifest.get('db_models', {})
    
    for model_name, model_info in db_models.items():
        fields = model_info.get('fields', {})
        field_html = '<TR><TD PORT="name" BGCOLOR="#e0e0e0"><B>' + model_name + '</B></TD></TR>'
        
        for field_name, field_type in list(fields.items())[:10]:  # Limit to 10 fields
            field_html += f'<TR><TD>{field_name}: {field_type}</TD></TR>'
        
        if len(fields) > 10:
            field_html += f'<TR><TD><I>... +{len(fields)-10} more</I></TD></TR>'
        
        html = f'<TABLE BORDER="1" CELLBORDER="1" CELLSPACING="0">{field_html}</TABLE>'
        g.node(model_name, html)
    
    # Add relationships
    for model_name, model_info in db_models.items():
        relationships = model_info.get('relationships', [])
        for related in relationships:
            g.edge(model_name, related)
    
    output_path = output_dir / 'database-schema'
    g.render(output_path, format='svg', cleanup=True)
    print(f"✓ Generated database schema: {output_path}.svg")


def generate_endpoints_visualization(manifest, output_dir):
    """Generate API endpoints summary as text table."""
    endpoints = manifest.get('endpoints', [])
    
    output_file = output_dir / 'api-endpoints.txt'
    
    with open(output_file, 'w') as f:
        f.write("=" * 100 + "\n")
        f.write("ER-DMARC-Monitor API Endpoints\n")
        f.write(f"Generated: {datetime.now().isoformat()}\n")
        f.write("=" * 100 + "\n\n")
        
        # Group by method
        methods = {}
        for ep in endpoints:
            method = ep.get('method', 'UNKNOWN')
            if method not in methods:
                methods[method] = []
            methods[method].append(ep)
        
        for method in sorted(methods.keys()):
            eps = methods[method]
            f.write(f"\n{method.upper()} Endpoints ({len(eps)}):\n")
            f.write("-" * 100 + "\n")
            
            for ep in eps:
                path = ep.get('path', 'N/A')
                summary = ep.get('summary', 'N/A')
                req_model = ep.get('request_model', 'N/A')
                resp_model = ep.get('response_model', 'N/A')
                
                f.write(f"  {path:<40} | Summary: {summary:<30}\n")
                f.write(f"    Request: {str(req_model):<20} | Response: {str(resp_model)}\n\n")
        
        f.write("\n" + "=" * 100 + "\n")
        f.write(f"Total Endpoints: {len(endpoints)}\n")
    
    print(f"✓ Generated endpoints visualization: {output_file}")


def generate_metadata_badge(output_dir):
    """Generate metadata badge image."""
    if not HAS_PIL:
        print("✗ Skipping metadata badge (PIL not available)")
        return
    
    manifest = load_manifest()
    
    # Create image
    img = Image.new('RGB', (400, 100), color='#f0f0f0')
    draw = ImageDraw.Draw(img)
    
    # Try to use a nice font, fallback to default
    try:
        font_title = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 20)
        font_text = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 14)
    except:
        font_title = ImageFont.load_default()
        font_text = ImageFont.load_default()
    
    title = manifest['metadata'].get('name', 'ER-DMARC-Monitor')
    desc = manifest['metadata'].get('description', '')[:50]
    
    draw.text((10, 10), title, fill='#333333', font=font_title)
    draw.text((10, 40), desc, fill='#666666', font=font_text)
    draw.text((10, 65), f"Generated: {datetime.now().strftime('%Y-%m-%d')}", 
              fill='#999999', font=font_text)
    
    output_file = output_dir / 'metadata-badge.png'
    img.save(output_file)
    print(f"✓ Generated metadata badge: {output_file}")


def main():
    """Main entry point."""
    print("🔄 Generating dynamic documentation images...")
    
    try:
        manifest = load_manifest()
        output_dir = create_output_dir()
        
        print(f"📁 Output directory: {output_dir}")
        print()
        
        # Generate diagrams
        generate_architecture_diagram(manifest, output_dir)
        generate_database_schema(manifest, output_dir)
        generate_endpoints_visualization(manifest, output_dir)
        generate_metadata_badge(output_dir)
        
        print()
        print("✅ Documentation image generation complete!")
        return 0
        
    except Exception as e:
        print(f"❌ Error: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        return 1


if __name__ == '__main__':
    sys.exit(main())
