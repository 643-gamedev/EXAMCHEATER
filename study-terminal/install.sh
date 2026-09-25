#!/usr/bin/env bash
# study-terminal installer
# Sets this project up anywhere: Codespaces, a laptop, a Raspberry Pi, etc.
# Re-running it is safe.

set -e

echo "== study-terminal setup =="

# 1. .env
if [ ! -f .env ]; then
  cp .env.example .env
  echo "-> created .env from .env.example"
else
  echo "-> .env already exists, leaving it alone"
fi

# 2. Node dependencies
if ! command -v node >/dev/null 2>&1; then
  echo "!! node is not installed. Install Node.js 18+ first: https://nodejs.org"
  exit 1
fi
echo "-> installing node dependencies"
npm install

# 3. Ollama (free, open-source, local AI runtime)
if ! command -v ollama >/dev/null 2>&1; then
  echo "-> ollama not found."
  if [ "$(uname)" = "Linux" ] || [ "$(uname)" = "Darwin" ]; then
    read -p "   install it now with the official script? [y/N] " yn
    if [ "$yn" = "y" ] || [ "$yn" = "Y" ]; then
      curl -fsSL https://ollama.com/install.sh | sh
    else
      echo "   skipping. install manually from https://ollama.com before running the app."
    fi
  else
    echo "   on Windows, install Ollama from https://ollama.com then re-run this script."
  fi
else
  echo "-> ollama already installed"
fi

# 4. Pull a small, free, open-source model (works offline after this)
if command -v ollama >/dev/null 2>&1; then
  MODEL=$(grep OLLAMA_MODEL .env | cut -d '=' -f2)
  MODEL=${MODEL:-phi3:mini}
  echo "-> pulling model: $MODEL (one-time download, then works offline)"
  ollama pull "$MODEL" || echo "   could not pull automatically — run: ollama pull $MODEL"
fi

echo ""
echo "== done =="
echo "Start the app with:"
echo "  1) in one terminal: ollama serve"
echo "  2) in another:      npm start"
echo "Then open http://localhost:3000"
