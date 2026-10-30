#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == --help ]]; then
  echo 'Usage: bash scripts/start-firefox.sh [HTTP/HTTPS URL ...]'
  echo 'Starts Firefox with the add-on in a separate persistent DEVELOPMENT profile.'
  echo 'web-ext changes security/update settings. Do not use this profile for daily browsing.'
  echo 'Optional: FIREFOX_BIN=/path/to/firefox'
  exit 0
fi

cd "$(dirname "$0")/.."
for url in "$@"; do
  case "$url" in
    http://*|https://*) ;;
    *) echo 'Arguments must be HTTP/HTTPS URLs.' >&2; exit 1 ;;
  esac
done
for tool in node npm flock; do
  command -v "$tool" >/dev/null || { echo "Required command: $tool" >&2; exit 1; }
done
[[ -d node_modules/web-ext && -d node_modules/esbuild ]] || {
  echo 'Install dependencies first: npm ci' >&2
  exit 1
}

umask 077
mkdir -p build
# Hold the lock until web-ext exits; never open the same profile twice.
exec 9>build/firefox-launch.lock
flock -n 9 || { echo 'This launcher is already running. Close its Firefox first.' >&2; exit 1; }

npm run build
profile="$PWD/build/firefox-profile"
args=(run --source-dir dist/firefox --no-config-discovery --no-input --no-reload
  --firefox-profile "$profile" --profile-create-if-missing --keep-profile-changes
  --pref extensions.webextensions.keepStorageOnUninstall=true
  --pref extensions.webextensions.keepUuidOnUninstall=true)
if [[ -n "${FIREFOX_BIN:-}" ]]; then
  args+=(--firefox "$FIREFOX_BIN")
fi
for url in "$@"; do
  args+=(--start-url "$url")
done
echo "Development profile: $profile"
echo 'web-ext enables debugging and changes security/update settings in this profile.' >&2
exec node scripts/web-ext.mjs "${args[@]}"
