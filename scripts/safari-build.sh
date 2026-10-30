#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
[[ "$(uname -s)" == Darwin ]] || { echo 'Нужны macOS и Xcode.' >&2; exit 1; }
platform="${1:-macos}"
[[ "$platform" == macos || "$platform" == ios ]] || { echo 'Укажите macos или ios.' >&2; exit 1; }
apple_root="${LB_APPLE_DIR:-build/apple}"
project="${LB_PROJECT:-$(find "$apple_root/$platform" -type d -name '*.xcodeproj' -prune -print)}"
[[ -n "$project" ]] || { echo 'Сначала npm run safari:generate.' >&2; exit 1; }
# Discover real generated scheme names instead of inventing a project layout.
if [[ -z "${LB_SCHEME:-}" ]]; then
  xcodebuild -list -project "$project"
  echo 'Повторите с LB_SCHEME="имя схемы из списка". Для подписанной device-сборки задайте также LB_TEAM.' >&2
  exit 1
fi
args=(-project "$project" -scheme "$LB_SCHEME" -configuration "${LB_CONFIGURATION:-Debug}" -derivedDataPath "$apple_root/DerivedData-$platform")
if [[ "$platform" == ios ]]; then
  args+=(-destination "${LB_DESTINATION:-generic/platform=iOS Simulator}" IPHONEOS_DEPLOYMENT_TARGET=18.0)
else
  args+=(-destination 'generic/platform=macOS' MACOSX_DEPLOYMENT_TARGET=13.0)
fi
if [[ -n "${LB_TEAM:-}" ]]; then
  args+=(DEVELOPMENT_TEAM="$LB_TEAM" CODE_SIGN_STYLE=Automatic)
  # Provisioning may contact Apple only when explicitly selected for signed builds.
  [[ "${LB_ALLOW_PROVISIONING:-0}" != 1 ]] || args+=(-allowProvisioningUpdates)
else
  args+=(CODE_SIGNING_ALLOWED=NO)
fi
xcodebuild "${args[@]}" build
