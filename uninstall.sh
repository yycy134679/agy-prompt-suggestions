#!/bin/sh
set -eu
script_root=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
exec sh "$script_root/install.sh" --uninstall "$@"
