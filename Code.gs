/**
 * News_92 Studio — уведомления в Telegram (версия 3).
 *
 * ВАЖНО, что изменилось: аккаунты, отзывы и история заявок теперь живут в Supabase.
 * Этот скрипт делает ровно одну вещь — присылает вам в Telegram сообщение о новой
 * заявке или новом отзыве, чтобы вы не сидели в админке. Ничего критичного он не хранит,
 * и если он вдруг перестанет работать, сайт продолжит работать без него.
 *
 * === НАСТРОЙКА (5 минут, делается один раз) ===
 * 1. https://script.google.com → «Новый проект» → вставить сюда весь этот код.
 * 2. Шестерёнка «Настройки проекта» → «Свойства скрипта» → добавить:
 *      BOT_TOKEN — токен бота от @BotFather
 *      CHAT_ID   — ваш chat_id от @userinfobot
 *      SHEET_ID  — (необязательно) ID таблицы Google Sheets для дубля заявок
 * 3. «Развернуть» → «Новое развёртывание» → «Веб-приложение»:
 *      Выполнять от имени: Я
 *      У кого есть доступ: Все
 * 4. Скопировать URL (заканчивается на /exec) → вставить в CONFIG.ORDER_ENDPOINT в index.html.
 *
 * ❗ Токен бота живёт ТОЛЬКО здесь, в свойствах скрипта. В код сайта он не попадает никогда:
 *    иначе любой посетитель смог бы писать от имени вашего бота.
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

/** Необязательный дубль заявок в таблицу — удобно, если Telegram потеряется. */
function logToSheet(data) {
  const id = getProp('SHEET_ID');
  if (!id) return;
  const ss = SpreadsheetApp.openById(id);
  let sheet = ss.getSheetByName('Orders');
  if (!sheet) {
    sheet = ss.insertSheet('Orders');
    sheet.appendRow(['Дата', 'Имя', 'Контакт', 'Услуга', 'Цена', 'Промокод', 'Аккаунт', 'Комментарий']);
    sheet.setFrozenRows(1);
  }
  sheet.appendRow([new Date(), data.name, data.contact, data.service, data.price,
                   data.promo || '', data.account || '', data.message]);
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    /* --- новая заявка --- */
    if (data.type === 'site_order') {
      const text =
        '🆕 <b>Новая заявка</b>\n\n' +
        '👤 Имя: ' + escapeHtml(data.name) + '\n' +
        '📞 Контакт: ' + escapeHtml(data.contact) + '\n' +
        '🛠 Услуга: ' + escapeHtml(data.service) + (data.price ? ' — ' + escapeHtml(data.price) + ' ₽' : '') + '\n' +
        (data.promo ? '🏷 Промокод: ' + escapeHtml(data.promo) + '\n' : '') +
        (data.account ? '✅ Аккаунт: ' + escapeHtml(data.account) + '\n' : '👤 Гость (без аккаунта)\n') +
        '💬 Комментарий: ' + escapeHtml(data.message) + '\n' +
        '🕐 ' + Utilities.formatDate(new Date(), 'Europe/Moscow', 'dd.MM.yyyy HH:mm');
      const tg = sendTelegram(text);
      try { logToSheet(data); } catch (err) { /* таблица не обязательна */ }
      return jsonOut({ ok: tg.ok, error: tg.error || null });
    }

    /* --- пришёл новый отзыв, его нужно одобрить в Supabase --- */
    if (data.type === 'review_notify') {
      sendTelegram(
        '⭐ <b>Новый отзыв — ждёт модерации</b>\n' +
        escapeHtml(data.name) + ' — ' + escapeHtml(data.rating) + '/5' +
        (data.service ? ' · ' + escapeHtml(data.service) : '') + '\n' +
        escapeHtml(data.text) + '\n\n' +
        'Одобрить: Supabase → Table editor → reviews → approved = true'
      );
      return jsonOut({ ok: true });
    }

    return jsonOut({ ok: false, error: 'unknown_type' });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

function doGet() {
  return jsonOut({ ok: true, status: 'News_92 Studio: уведомления в Telegram работают' });
}
