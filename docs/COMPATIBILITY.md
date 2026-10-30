# Проверенная по документации совместимость API

Сверено 26 октября 2026. Это проверка контрактов API и исходных compatibility-данных, **не запуск Safari**. Базовая цель Safari — 18.0 / iOS 18.0; более новые возможности в реализации не используются.

| Использование | Firefox | Safari / iOS Safari | Решение проекта |
| --- | --- | --- | --- |
| MV3 `background.scripts`, `persistent:false` | поддерживается | поддерживается | event page, без постоянно живого процесса |
| `optional_host_permissions` MV3 | 128+ | 15.5+ | только потенциальный диапазон HTTP/HTTPS; фактический запрос по одному hostname |
| `permissions.request/contains/getAll/remove`, added/removed | поддерживается | поддерживается, с дополнительным UI контроля сайтов | перепроверка доступа; ручная инструкция для Safari |
| `scripting.register/get/update/unregisterContentScripts` | 102+ | 16.4+ | динамические регистрации, без manifest content_scripts |
| RegisteredContentScript `world: MAIN/ISOLATED` | 128+ | 16.4+ | отдельный MAIN файл без API/политики |
| `persistAcrossSessions` | 105+ для true | 16.4+ | true; дополнительно восстановление из storage при запуске/обновлении |
| `runAt:document_start`, `allFrames` | поддерживается | поддерживается | запуск на всём разрешённом домене |
| `executeScript` | не используется | не используется | настройки не зависят от внедрения в уже открытые вкладки; после добавления сайта требуется его перезагрузка |
| `declarativeNetRequestWithHostAccess` | поддерживается | поддерживается | доступ требуется и для сетевого слоя |
| DNR `getDynamicRules/updateDynamicRules` | 113+ | 15.4+ | динамические, переживают сессии; get без нового аргумента filter |
| DNR `regexFilter`, `isUrlFilterCaseSensitive`, `resourceTypes` | 113+ | 15+ | явный case-sensitive; только main_frame/sub_frame |
| `isRegexSupported` | 113+ | 15+ | проверяется каждое выражение перед применением |
| DNR `MAX_NUMBER_OF_DYNAMIC_RULES` | 128+ | отсутствует | feature detection; fallback на старую объединённую константу при наличии |
| DNR `MAX_NUMBER_OF_DYNAMIC_AND_SESSION_RULES` | 113+ (старое имя) | 16.4+ | session rules в проекте не используются |
| `storage.local`, `tabs.query/get/update`, `runtime.openOptionsPage` | поддерживается | поддерживается | URL вкладок доступны только с соответствующим host grant; permission tabs не нужен |
| `webNavigation.onHistoryStateUpdated` | поддерживается | не поддерживается | webNavigation вообще не запрашивается |

Источники Mozilla:

- [Manifest background](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background).
- [RegisteredContentScript](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/scripting/RegisteredContentScript), [executeScript и результаты ошибок](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/scripting/executeScript).
- [DNR RuleCondition](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/declarativeNetRequest/RuleCondition), [DNR API и лимиты](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/declarativeNetRequest).
- Compatibility data проекта MDN: [scripting.json](https://github.com/mdn/browser-compat-data/blob/main/webextensions/api/scripting.json), [declarativeNetRequest.json](https://github.com/mdn/browser-compat-data/blob/main/webextensions/api/declarativeNetRequest.json), [optional_host_permissions.json](https://github.com/mdn/browser-compat-data/blob/main/webextensions/manifest/optional_host_permissions.json). Записи Safari iOS наследуют Safari (`mirror`) для перечисленных функций.

Источники Apple/WebKit:

- [Совместимость Safari Web Extension](https://developer.apple.com/documentation/safariservices/assessing-your-safari-web-extension-s-browser-compatibility).
- [Декларативная блокировка](https://developer.apple.com/documentation/safariservices/blocking-content-with-your-safari-web-extension).
- [Управление разрешениями](https://developer.apple.com/documentation/safariservices/managing-safari-web-extension-permissions).
- [Safari 18.0 / iOS 18](https://developer.apple.com/documentation/safari-release-notes/safari-18-release-notes).
- [Safari 18.4](https://webkit.org/blog/16574/webkit-features-in-safari-18-4/) — часть API моложе базовой цели и намеренно исключена.

Не используются DNR `requestDomains`, `initiatorDomains`, `requestMethods`, redirects, `getDynamicRules(filter)`, `documentId`, `matchOriginAsFallback`, `storage.session`, `storage.getKeys` или navigation API. Например, `getDynamicRules.filter` появляется в Safari 18.5, `matchOriginAsFallback` — в 18.4; это не допустимые зависимости для базового iOS 18.0.

Regex генерируются приложением, не вводятся пользователем. Только ASCII, якоря начала/конца, группы, классы символов, `*`, `+`, `?` и экранированные литералы. Альтернация `|` не используется: [парсер URL-фильтров WebKit](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/contentextensions/URLFilterParser.cpp) её отклоняет. Граница пути выражается необязательным суффиксом с завершающим якорем: `([/?#].*)?$` для раздела, `([?#].*)?$` для точной страницы. Нет lookbehind/lookahead, backreferences и нестабильных расширений синтаксиса. Длина пути и число правил ограничены. Даже корректный по этим ограничениям regex должен пройти реальный `isRegexSupported` выбранного браузера; при отказе DNR не объявляется активным.

С версии 1.0.3 JavaScript собирается с `charset: ascii`: Unicode-строки записываются escape-последовательностями, чтобы декодирование JS фоновой страницы не портило русский текст. HTML остаётся UTF-8 с явным meta charset. Аудит пакетов проверяет отсутствие не-ASCII байтов во всех JS-файлах.

С версии 1.0.6 одноразовое внедрение `executeScript` полностью удалено из применения правил. Safari мог оставлять этот вызов незавершённым, блокируя очередь настроек на этапе `scripts:refresh`. Регистрация `document_start` по-прежнему содержит `allFrames: true` и разрешённые host patterns; после установки/добавления сайта нужно перезагрузить уже открытые документы. Работающие guards обновляются сигналом `protectionEpoch`. Статус скриптов обозначает подтверждённую регистрацию, а не проверку всех открытых документов. Аудит пакета запрещает возврат live injection в runtime-код.

С версии 1.0.5 настройки и guard используют `runtime.connect`/`runtime.Port`: одна операция на соединение, явный ответ через `postMessage`, закрытие после результата и таймаут 10 секунд. Сохранение не повторяется автоматически при разрыве/таймауте, поскольку оно могло уже завершиться. Проверка отправителя берётся из browser-supplied `port.sender` и сохраняет поддержку `sender.tab.url`; явно чужой ID или адрес не допускается. Старый `runtime.onMessage` оставлен для скриптов уже открытых документов. Порты не гарантируют бессрочную жизнь event page: разрывы обрабатываются как ошибка, следующий явный запрос создаёт новое соединение. Диагностика выполняется вне очереди операций и сообщает текущий этап без URL, правил и исходных ошибок браузера.

Сравнение DNR/software в Node проверяет эквивалентность относительно сериализации WHATWG URL и JavaScript RegExp. Оно не подменяет сетевой движок браузера. В частности, нормализация нестандартных URL и поведение host permissions на необычных поддоменах требуют повторения native-сценариев.

Safari может выдавать site access шире заданного origin на уровне собственного UI/профилей и запрашивать подтверждение через toolbar/меню страницы. В коде учитывается результат `permissions.contains`; UI предупреждает о необходимости ручного действия. Проверка private-mode API сама по себе не доказывает включение расширения в каждом профиле/приватном контексте.
