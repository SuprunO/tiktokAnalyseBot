#!/bin/bash
set -e

# Запустити Xvfb у бекграунді
echo "✅ Starting Xvfb..."
Xvfb :99 -screen 0 1920x1080x24 &

# Експортувати змінну середовища DISPLAY
export DISPLAY=:99

echo "✅ Starting Node server..."
node index.js
