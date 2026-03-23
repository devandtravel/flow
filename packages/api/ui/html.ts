export function getDashboardHtml(): string {
  return `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>FLOW Control Plane</title>
    <link
      rel="icon"
      href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0%25' stop-color='%2362c0ff'/%3E%3Cstop offset='100%25' stop-color='%235fd694'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='64' height='64' rx='16' fill='%23091018'/%3E%3Cpath d='M16 18h32v8H26v10h18v8H26v12h-10V18Z' fill='url(%23g)'/%3E%3C/svg%3E"
    />
    <link rel="stylesheet" href="/ui/app.css" />
  </head>
  <body>
    <div id="app"></div>
    <script src="/ui/app.js" defer></script>
  </body>
</html>`;
}
