#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "$(uname -s)" != Darwin ]]; then
  echo 'Для генерации нужны macOS и полный Xcode. WebExtension-ресурсы уже можно собрать: npm run build.' >&2
  exit 1
fi
command -v xcodebuild >/dev/null
xcrun --find swift >/dev/null
apple_tool=safari-web-extension-converter
if ! xcrun --find "$apple_tool" >/dev/null 2>&1; then apple_tool=safari-web-extension-packager; fi
xcrun --find "$apple_tool" >/dev/null
apple_root="${LB_APPLE_DIR:-build/apple}"
bundle_id="${LB_BUNDLE_ID:-local.localblocklist}"
if [[ -e "$apple_root/macos" || -e "$apple_root/ios" ]]; then
  echo 'Проект уже существует. Он не будет перезаписан. Используйте новый LB_APPLE_DIR; перенесите настройки подписи после проверки.' >&2
  exit 1
fi
npm run build
for platform in macos ios; do
  xcrun "$apple_tool" "$PWD/dist/safari" \
    --project-location "$apple_root/$platform" \
    --app-name 'Local Blocklist' --bundle-identifier "$bundle_id" \
    --swift "--$platform-only" --copy-resources --no-open --no-prompt
 done
printf '%s\n' 'Созданы настоящие проекты Apple в' "$apple_root" 'Проверьте предупреждения конвертера и Signing & Capabilities для обоих targets.'
