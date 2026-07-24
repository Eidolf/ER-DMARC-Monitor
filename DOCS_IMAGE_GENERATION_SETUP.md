# Documentation Image Generation - Setup Guide

## 🎯 Überblick

Dieses System generiert **dynamisch** Dokumentationsbilder aus Ihrer `project_manifest.json`:

- **Architecture Diagram** (SVG) - Systemarchitektur und Datenfluss
- **Database Schema** (SVG) - ER-Diagramm aus Datenbank-Modellen
- **API Endpoints** (TXT) - Vollständige Endpoint-Dokumentation
- **Metadata Badge** (PNG) - Projekt-Metadaten Visualisierung

## 📋 Setup-Schritte

### Schritt 1: Workflow-Datei in den richtigen Ordner verschieben

Die Workflow-Datei befindet sich aktuell unter `workflows/generate-docs-images.yml` und muss nach `.github/workflows/generate-docs-images.yml` verschoben werden:

```bash
# Im lokalen Repository
mkdir -p .github/workflows
mv workflows/generate-docs-images.yml .github/workflows/generate-docs-images.yml
rm -rf workflows  # Optional: leerer Ordner löschen

# Committen und pushen
git add .github/workflows/generate-docs-images.yml
git commit -m "Move workflow to correct .github/workflows directory"
git push origin feature/add-docs-image-workflow
```

### Schritt 2: Abhängigkeiten installieren (lokal testen)

Zum lokalen Testen des Image-Generators:

```bash
# Python-Abhängigkeiten installieren
pip install graphviz pillow

# Graphviz System-Package installieren (für Diagram-Generierung)
# macOS:
brew install graphviz

# Ubuntu/Debian:
sudo apt-get install graphviz

# Windows (mit Chocolatey):
choco install graphviz
```

### Schritt 3: Script lokal ausführen

```bash
# Macht das Script ausführbar
chmod +x scripts/generate-docs-images.py

# Führt das Script aus
python scripts/generate-docs-images.py
```

Die generierten Bilder werden in `docs/generated/images/` abgelegt.

### Schritt 4: Pull Request erstellen

```bash
# Branch pushen (falls noch nicht geschehen)
git push origin feature/add-docs-image-workflow

# Pull Request auf GitHub erstellen
# https://github.com/Eidolf/ER-DMARC-Monitor/compare/main...feature/add-docs-image-workflow
```

## 🚀 Workflow-Ausführung

Der Workflow wird **automatisch** ausgelöst durch:

### Automatische Trigger:
1. **Push zu `main` oder `develop`** → wenn `project_manifest.json` oder `scripts/generate-docs-images.py` geändert
2. **Pull Request zu `main`** → wenn `project_manifest.json` geändert
3. **Manuell auslösen** → über GitHub UI unter Actions → "Generate Documentation Images" → "Run workflow"

### Manuelle Ausführung (nach dem Merge):

1. Navigieren Sie zu: **Actions** Tab in GitHub
2. Wählen Sie: **Generate Documentation Images**
3. Klicken Sie: **Run workflow**
4. Optional: Setzen Sie `force_regenerate` auf `true` um alle Bilder neu zu generieren

## 📁 Ausgabe-Struktur

```
docs/
└── generated/
    └── images/
        ├── architecture-diagram.svg     # Systemarchitektur
        ├── database-schema.svg          # Datenbank ER-Diagramm
        ├── api-endpoints.txt            # Endpoint-Listing
        └── metadata-badge.png           # Projekt-Badge
```

## 📊 Was wird generiert?

### 1. Architecture Diagram (SVG)
Zeigt die Systemkomponenten und deren Verbindungen:
- SMTP Ingester → Redis Broker → DMARC Parser → PostgreSQL
- FastAPI Backend ↔ PostgreSQL
- React Frontend ↔ FastAPI

**Datei:** `docs/generated/images/architecture-diagram.svg`

### 2. Database Schema (SVG)
ER-Diagramm mit allen Modellen aus `project_manifest.json`:
- User, SystemSettings, LoginAudit, Domain
- ReportMetadata, ReportRecord
- SMTPListeningDomain, SMTPRecipient

**Datei:** `docs/generated/images/database-schema.svg`

### 3. API Endpoints (TXT)
Sortierte Liste aller API-Endpunkte nach HTTP-Methode:
- GET, POST, PATCH, DELETE Endpoints
- Mit Request/Response Models
- Mit Pfaden und Zusammenfassungen

**Datei:** `docs/generated/images/api-endpoints.txt`

### 4. Metadata Badge (PNG)
Visuelle Badge mit Projekt-Informationen:
- Projektname
- Beschreibung
- Generierungsdatum

**Datei:** `docs/generated/images/metadata-badge.png`

## ⚙️ Workflow-Details

### Trigger Pfade (Path Filters):
```yaml
paths:
  - 'project_manifest.json'         # Wenn Manifest ändert
  - 'scripts/generate-docs-images.py'  # Wenn Script ändert
  - '.github/workflows/generate-docs-images.yml'  # Wenn Workflow ändert
```

### Workflow-Schritte:
1. ✅ Repository auschecken
2. ✅ Python 3.11 installieren
3. ✅ Abhängigkeiten (graphviz, pillow) installieren
4. ✅ Systempaket graphviz installieren
5. ✅ `generate-docs-images.py` ausführen
6. ✅ Auf Änderungen prüfen
7. ✅ Änderungen committen (nur auf `main` bei `push`)
8. ✅ Artefakte hochladen (30 Tage Aufbewahrung)
9. ✅ GitHub Step Summary generieren

## 🔍 Monitoring & Debugging

### In GitHub Actions:
1. Gehen Sie zu: **Actions** Tab
2. Wählen Sie: **Generate Documentation Images**
3. Klicken Sie auf den Workflow-Run
4. Sehen Sie: Logs für jeden Schritt

### Häufige Fehler:

**Fehler:** `graphviz not found`
- **Lösung:** System-Paket graphviz ist nicht installiert
- Der Workflow installiert es automatisch mit `apt-get`

**Fehler:** `ModuleNotFoundError: No module named 'graphviz'`
- **Lösung:** Python-Paket fehlt
- Workflow installiert es mit `pip install graphviz`

**Fehler:** `Permission denied`
- **Lösung:** Script-Berechtigungen
- Führen Sie lokal aus: `chmod +x scripts/generate-docs-images.py`

## 📝 Verwendung der generierten Bilder

### In der README.md:

```markdown
## Architecture

![Architecture Diagram](docs/generated/images/architecture-diagram.svg)

## Database Schema

![Database Schema](docs/generated/images/database-schema.svg)

## API Endpoints

Siehe: [API Endpoints Documentation](docs/generated/images/api-endpoints.txt)
```

### Als Projekt-Badge:

```markdown
![ER-DMARC-Monitor](docs/generated/images/metadata-badge.png)
```

## 🔄 Automatische Aktualisierungen

Der Workflow committet automatisch auf dem `main` Branch:
- Commit-Nachricht: `🔄 Update auto-generated documentation images [skip ci]`
- Mit `[skip ci]` um endlose Workflow-Loops zu vermeiden

## 📦 Artefakte

Nach jedem Workflow-Run:
1. Klicken Sie auf den Workflow-Run
2. Scrolle zu **Artifacts**
3. Downloaden Sie `documentation-images.zip`
4. Enthält alle generierten SVG, TXT, und PNG Dateien

---

## ✅ Checkliste zum Starten

- [ ] Workflow-Datei von `workflows/` nach `.github/workflows/` verschieben
- [ ] Lokal testen: `python scripts/generate-docs-images.py`
- [ ] Lokale Ausgaben in `docs/generated/images/` prüfen
- [ ] Alle Dateien committen
- [ ] Pull Request erstellen
- [ ] Nach dem Merge: Workflow unter Actions → "Run workflow" testen
- [ ] Generierte Bilder in der Dokumentation einbinden
