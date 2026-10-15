#!/usr/bin/env bash
set -euo pipefail
# All caller-supplied values arrive via environment, never shell interpolation.
python3 "$(dirname "$0")/preflight.py" "${1:-.}"
