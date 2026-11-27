#!/bin/sh
set -eu
script_root=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
mode=install
if [ "${1-}" = '--uninstall' ]; then
  mode=uninstall
  shift
fi

runtime=''
case "$(uname -s)" in
  Darwin) embedded="${ANTIGRAVITY_USER_DATA_DIR:-$HOME/Library/Application Support/Antigravity}/bin/agy-node" ;;
  *) embedded="${ANTIGRAVITY_USER_DATA_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/Antigravity}/bin/agy-node" ;;
esac

check_node() {
  "$1" -p "const [a,b]=process.versions.node.split('.').map(Number); a>22||(a===22&&b>=13)" 2>/dev/null || true
}

if command -v node >/dev/null 2>&1; then
  if [ "$(check_node "$(command -v node)")" = 'true' ]; then
    runtime=$(command -v node)
  fi
fi

if [ -z "$runtime" ] && [ -x "$embedded" ]; then
  if [ "$(check_node "$embedded")" = 'true' ]; then
    runtime="$embedded"
  fi
fi

if [ -z "$runtime" ]; then
  printf '%s\n' '需要 Node.js 22.13 或更高版本（也可先启动一次 Antigravity 以使用内置 agy-node）。' >&2
  exit 1
fi

exec "$runtime" "$script_root/scripts/$mode.mjs" "$@"
