#!/bin/bash
set -e

# ER-DMARC-Monitor - Local GitHub Actions Emulation Script
# This script uses 'act' (https://github.com/nektos/act) to run GitHub Actions locally.

# Prerequisites check
if ! command -v act &> /dev/null; then
    echo "❌ Error: 'act' is not installed."
    echo "Please install it first: https://nektosact.com/installation/index.html"
    echo "Example (macOS): brew install act"
    echo "Example (Linux): curl -s https://raw.githubusercontent.com/nektos/act/master/install.sh | sudo bash -s -- -b /usr/local/bin"
    exit 1
fi

if ! command -v docker &> /dev/null; then
    echo "❌ Error: 'docker' is not running or not installed."
    exit 1
fi

echo "🚀 Starting local emulation of GitHub Actions..."
echo "This will build the Docker images locally without pushing them."
echo ""

# Change to project root directory to ensure act finds the .github folder
cd "$(dirname "$0")/.." || exit 1

# Run act for the workflow_dispatch event to trigger our build pipeline
# We use -P ubuntu-latest=catthehacker/ubuntu:act-latest to provide a standard runner environment
act workflow_dispatch -W .github/workflows/docker-build.yml --secret GITHUB_TOKEN=""


echo ""
echo "✅ Local build completed successfully!"
echo "The images were built locally. You can view them by running: docker images"
