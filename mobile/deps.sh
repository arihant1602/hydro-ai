#!/usr/bin/env bash
# Restores the phone app's node_modules (exact versions in package-lock.json).
set -euo pipefail
cd "$(dirname "$0")"
npm ci
