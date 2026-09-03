# News_92 Studio

Сайт студии: дизайн, сайты, программирование и лёгкие 2D-игры.

## Публикация

Продакшен-хостинг — Firebase Hosting. Пуш в `main` запускает GitHub Actions workflow `.github/workflows/firebase-hosting.yml`.

`firebase.json` публикует содержимое корня репозитория. Серверный Google Apps Script в этот репозиторий не входит.

## Интеграции

Заявки и отзывы используют отдельный Google Apps Script backend.

В `index.html` нужно заполнить только публичные настройки:

- `CONFIG.ORDER_ENDPOINT` — URL опубликованного Google Apps Script `/exec`;
- `CONFIG.GOOGLE_CLIENT_ID` — OAuth Client ID для Web application.

Секреты Telegram (`BOT_TOKEN`, `CHAT_ID`) и `SHEET_ID` хранятся только в Script Properties Google Apps Script и никогда не должны попадать в GitHub.

## Google Apps Script

Файл backend-кода хранится отдельно от публичного сайта. При настройке Apps Script используйте `Code.gs` из комплекта проекта и задайте свойства:

- `BOT_TOKEN`
- `CHAT_ID`
- `SHEET_ID`
- `GOOGLE_CLIENT_ID`

Развёртывание должно быть Web app, выполнение от владельца, доступ — для всех.

## Перед запуском

1. Создать Telegram-бота и получить `chat_id`.
2. Создать Google Sheet для `Orders` и `Reviews`.
3. Развернуть Apps Script и получить `/exec` URL.
4. Создать OAuth Client ID и разрешить origin `https://news92-tg.github.io`.
5. Вставить публичные `ORDER_ENDPOINT` и `GOOGLE_CLIENT_ID` в `index.html`.
6. Убедиться, что GitHub Actions secret `FIREBASE_SERVICE_ACCOUNT_NEWS_92` содержит валидный JSON service-account ключ без комментариев, лишних запятых или Markdown-обёртки.
7. После push в `main` проверить успешный Firebase deploy.

## Безопасность

Не коммитьте сюда токены Telegram, service-account JSON, `.env`, приватные ключи или другие секреты.
