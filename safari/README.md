# Оболочка Apple

Оболочка не имитируется файлами `.pbxproj`. `npm run safari:generate` на Mac вызывает официальный `xcrun safari-web-extension-converter` (либо его новое имя `safari-web-extension-packager`) и создаёт два минимальных настоящих Swift host app + Safari Web Extension проекта из `dist/safari`.

В репозитории находятся WebExtension-ресурсы и скрипты генерации/сборки. Получение, компиляция, подпись и запуск Apple targets в Linux не выполняются. Подробности в [README](../README.md) и [чек-листе](../docs/SAFARI-CHECKLIST.md).
