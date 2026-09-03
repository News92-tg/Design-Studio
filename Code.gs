/**
 * News_92 Studio — бэкенд на Google Apps Script (версия 2).
 *
 * Что делает:
 *  1) Принимает заявки с сайта и пересылает их в Telegram-бота, попутно записывая в таблицу.
 *  2) Проверяет вход через Google НА СЕРВЕРЕ (а не на слово браузеру) — так «один отзыв на аккаунт»
 *     нельзя обойти подделкой запроса.
 *  3) Принимает отзывы и отдаёт их сайту.
 *  4) Отдаёт клиенту его собственные заказы со статусом — раздел «Мои заказы» на сайте.
 *
 * === НАСТРОЙКА (делается один раз) ===
 * 1. https://script.google.com → «Новый проект» → вставить сюда весь этот код.
 * 2. Шестерёнка «Настройки проекта» → «Свойства скрипта» → добавить:
 *      BOT_TOKEN        — токен бота от @BotFather   (секрет, на сайт не попадает)
 *      CHAT_ID          — ваш chat_id от @userinfobot
 *      SHEET_ID         — ID таблицы Google Sheets (из адреса между /d/ и /edit)
 *      GOOGLE_CLIENT_ID — тот же Client ID, что стоит в CONFIG на сайте
 * 3. «Развернуть» → «Новое развёртывание» → «Веб-приложение»:
 *      Выполнять от имени: Я
 *      У кого есть доступ: Все
 * 4. Скопировать URL (заканчивается на /exec) и вставить в CONFIG.ORDER_ENDPOINT в index.html.
 *
 * === КАК ВЕСТИ ЗАКАЗЫ ===
 * В таблице появится лист «Orders». Колонка «Статус» — то, что видит клиент у себя в «Моих заказах».
 * Пишите в неё: Новая / В работе / На проверке / Готово / Отменена. Клиент увидит изменение сразу.
 */

function getProp(name) {
  return PropertiesService.getScriptProperties().getProperty(name);
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ================== Telegram ================== */
function sendTelegram(text) {
  const token = getProp('BOT_TOKEN');
  const chatId = getProp('CHAT_ID');
  if (!token || !chatId) return { ok: false, error: 'BOT_TOKEN или CHAT_ID не заданы' };
  const res = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'HTML' }),
    muteHttpExceptions: true
  });
  let body;
  try { body = JSON.parse(res.getContentText()); } catch (e) { body = { ok: false, description: res.getContentText() }; }
  return { ok: !!body.ok, error: body.ok ? null : JSON.stringify(body) };
}

/* ================== проверка входа через Google ================== */
/**
 * Проверяет ID-токен у самого Google. Возвращает данные пользователя или null.
 * Это и есть «полноценный вход»: браузеру на слово не верим.
 */
function verifyGoogleToken(idToken) {
  if (!idToken) return null;
  try {
    const res = UrlFetchApp.fetch(
      'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
      { muteHttpExceptions: true }
    );
    if (res.getResponseCode() !== 200) return null;
    const info = JSON.parse(res.getContentText());
    const clientId = getProp('GOOGLE_CLIENT_ID');
    if (clientId && info.aud !== clientId) return null;                 // токен выдан не нашему сайту
    if (!info.sub) return null;
    if (Number(info.exp) * 1000 < Date.now()) return null;              // просрочен
    return { sub: String(info.sub), email: info.email || '', name: info.name || 'Гость', picture: info.picture || '' };
  } catch (e) {
    return null;
  }
}

/* ================== таблицы ================== */
function getSheet(name) {
  const id = getProp('SHEET_ID');
  if (!id) return null;
  const ss = SpreadsheetApp.openById(id);
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (name === 'Orders') {
      sheet.appendRow(['Номер', 'Дата', 'Имя', 'Контакт', 'Услуга', 'Цена', 'Промокод', 'Комментарий', 'GoogleID', 'Статус']);
      sheet.setFrozenRows(1);
    } else if (name === 'Reviews') {
      sheet.appendRow(['Дата', 'GoogleID', 'Имя', 'Фото', 'Оценка', 'Текст']);
      sheet.setFrozenRows(1);
    }
  }
  return sheet;
}

function nextOrderNumber(sheet) {
  const n = Math.max(0, sheet.getLastRow() - 1) + 1;
  return 'N-' + String(n).padStart(4, '0');
}

/* ================== приём данных ================== */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const user = verifyGoogleToken(data.credential);   // может быть null — это нормально

    /* --- заявка --- */
    if (data.type === 'site_order') {
      const sheet = getSheet('Orders');
      const number = sheet ? nextOrderNumber(sheet) : '';
      const text =
        '🆕 <b>Новая заявка ' + escapeHtml(number) + '</b>\n\n' +
        '👤 Имя: ' + escapeHtml(data.name) + '\n' +
        '📞 Контакт: ' + escapeHtml(data.contact) + '\n' +
        '🛠 Услуга: ' + escapeHtml(data.service) + (data.price ? ' — ' + escapeHtml(data.price) + ' ₽' : '') + '\n' +
        (data.promo ? '🏷 Промокод: ' + escapeHtml(data.promo) + '\n' : '') +
        (user ? '✅ Вход через Google: ' + escapeHtml(user.email) + '\n' : '👤 Без входа в аккаунт\n') +
        '💬 Комментарий: ' + escapeHtml(data.message) + '\n' +
        '🕐 ' + Utilities.formatDate(new Date(), 'Europe/Moscow', 'dd.MM.yyyy HH:mm');
      const tg = sendTelegram(text);
      if (sheet) {
        sheet.appendRow([number, new Date(), data.name, data.contact, data.service, data.price,
                         data.promo || '', data.message, user ? user.sub : '', 'Новая']);
      }
      return jsonOut({ ok: tg.ok, number: number, error: tg.error || null });
    }

    /* --- отзыв (только для проверенного аккаунта) --- */
    if (data.type === 'review') {
      if (!user) return jsonOut({ ok: false, error: 'auth_required' });
      const sheet = getSheet('Reviews');
      if (sheet) {
        const values = sheet.getDataRange().getValues();
        for (let i = 1; i < values.length; i++) {
          if (String(values[i][1]) === user.sub) return jsonOut({ ok: false, error: 'already_submitted' });
        }
        const rating = Math.max(1, Math.min(5, Number(data.rating) || 5));
        sheet.appendRow([new Date(), user.sub, user.name, user.picture, rating, String(data.text || '').slice(0, 1000)]);
      }
      sendTelegram('⭐ <b>Новый отзыв</b>\n' + escapeHtml(user.name) + ' — ' + escapeHtml(data.rating) + '/5\n' + escapeHtml(data.text));
      return jsonOut({ ok: true });
    }

    return jsonOut({ ok: false, error: 'unknown_type' });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

/* ================== отдача данных ================== */
function doGet(e) {
  const p = (e && e.parameter) || {};

  /* список отзывов для всех */
  if (p.type === 'reviews') {
    const sheet = getSheet('Reviews');
    if (!sheet) return jsonOut({ ok: true, reviews: [] });
    const values = sheet.getDataRange().getValues();
    const reviews = [];
    for (let i = 1; i < values.length; i++) {
      const r = values[i];
      reviews.push({
        createdAt: r[0] instanceof Date ? r[0].toISOString() : String(r[0]),
        name: r[2], picture: r[3], rating: r[4], text: r[5]
      });
    }
    return jsonOut({ ok: true, reviews: reviews.slice(-100) });
  }

  /* свои заказы — только по проверенному токену */
  if (p.type === 'my_orders') {
    const user = verifyGoogleToken(p.credential);
    if (!user) return jsonOut({ ok: false, error: 'auth_required' });
    const sheet = getSheet('Orders');
    if (!sheet) return jsonOut({ ok: true, orders: [] });
    const values = sheet.getDataRange().getValues();
    const orders = [];
    for (let i = 1; i < values.length; i++) {
      const r = values[i];
      if (String(r[8]) !== user.sub) continue;
      orders.push({
        number: r[0],
        createdAt: r[1] instanceof Date ? r[1].toISOString() : String(r[1]),
        service: r[4], price: r[5], status: r[9] || 'Новая'
      });
    }
    return jsonOut({ ok: true, orders: orders.reverse().slice(0, 50) });
  }

  return jsonOut({ ok: true, status: 'News_92 Studio backend работает' });
}
