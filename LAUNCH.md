# FLOW Launch Horizon

FLOW уже находится в точке, где бесконечное расширение без запуска начнёт вредить качеству решений.

## Decision

Переход к запуску начинается сейчас.

Дальнейшая работа делится на два класса:

- `launch gate`: обязательные проверки перед первым живым запуском
- `post-launch backlog`: улучшения, которые не должны блокировать старт

## Launch Gate

Проект считается готовым к первому запуску, если одновременно выполняются все условия:

1. `pnpm lint`
2. `pnpm test`
3. `pnpm build`
4. `pnpm smoke`
5. выбран контур запуска:
   - `project` для первого безопасного запуска внутри одного репозитория
   - `system` только после отдельной проверки install/service path

## First Launch Recommendation

Первый реальный запуск должен идти так:

1. `project` contour
2. `supervised` mode по умолчанию
3. `shell.exec` остаётся выключенным
4. bounded tools only
5. maintenance cleanup остаётся либо manual, либо с очень консервативным `interval_seconds`

## First Launch Path

Безопасная репетиция запуска:

```bash
pnpm launch:project
```

Первый живой запуск в явный workspace:

```bash
FLOW_LAUNCH_PROVIDER=codex \
FLOW_LAUNCH_AUTONOMY=supervised \
pnpm launch:project /absolute/workspace/path
```

Правило:

- `mock` можно запускать без явного workspace
- для `codex` явный workspace обязателен

## Post-Launch Backlog

Это полезно, но не должно блокировать запуск:

- cursor pagination вместо offset pagination
- дополнительные maintenance operations кроме `cleanup`
- UI-friendly run graph / dashboard
- расширенные approval views
- более богатая maintenance policy model

## Stop Rule

Если `launch gate` зелёный, мы не продолжаем бесконечное “улучшение ради улучшения”.

После этого следующий шаг — живой запуск и сбор обратной связи по реальному использованию.
