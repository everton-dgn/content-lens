#!/bin/sh
# Runs the local graph consolidator with the Python from the global graphifyy
# installation. Never downloads or upgrades: a missing installation is an error
# the caller has to resolve, so Git hooks cannot pull packages on their own.
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

if ! command -v uv > /dev/null 2>&1; then
  echo "uv not found; install uv and then: uv tool install graphifyy" >&2
  exit 1
fi

tool_dir=$(uv tool dir)
python="$tool_dir/graphifyy/bin/python"

if [ ! -x "$python" ]; then
  echo "graphifyy is not installed globally; run: uv tool install graphifyy" >&2
  exit 1
fi

exec "$python" -B "$script_dir/graphify-update.py" "$@"
