/**
 * 二者面談 日程調整サイト 共通バックエンド
 * 対象: 2026年8月17日（月）〜8月28日（金）
 */

const SPREADSHEET_ID = "1O5HYojgsD1p-QyqX1wRZLjXvUmVjI2qJJFWeIGKOUuE";
const NOTIFICATION_EMAIL = "yusuke.tigers.0522@gmail.com";
const EVENT_SHEET_NAME = "予定";
const REQUEST_SHEET_NAME = "希望";
const TIMEZONE = "Asia/Tokyo";
const REQUEST_DEADLINE = "2026-08-10";
const EVENTS_CACHE_KEY = "events_v2";
const EVENTS_CACHE_SECONDS = 20;
const VALID_DATES = [
  "2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21",
  "2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28"
];
const START_MINUTES = 9 * 60;
const END_MINUTES = 16 * 60 + 30;

/**
 * 最初に1回だけ、GASエディタから実行します。
 */
function setup() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  ensureEventSheet_(spreadsheet);
  ensureRequestSheet_(spreadsheet);
  setTeacherPassword();
}

/**
 * 初回だけ仮パスワードを作ります。
 * 実行後、プロジェクト設定のスクリプトプロパティから必ず変更してください。
 */
function setTeacherPassword() {
  const properties = PropertiesService.getScriptProperties();
  if (!properties.getProperty("TEACHER_PASSWORD")) {
    properties.setProperty("TEACHER_PASSWORD", "CHANGE_ME_NOW");
  }
}

/**
 * 生徒用・教師用カレンダーから、予定一覧をJSONPで返します。
 */
function doGet(e) {
  const action = String((e && e.parameter && e.parameter.action) || "events");
  const callback = String((e && e.parameter && e.parameter.callback) || "");

  try {
    if (action === "status") {
      const requestId = String((e && e.parameter && e.parameter.requestId) || "");
      if (!/^[0-9A-Za-z_-]{10,120}$/.test(requestId)) {
        throw new Error("送信確認IDが正しくありません。");
      }
      const cached = CacheService.getScriptCache().get("submission_" + requestId);
      return jsonpOutput_({
        ok: true,
        status: cached ? JSON.parse(cached) : { done: false }
      }, callback);
    }

    if (action !== "events") throw new Error("未対応の操作です。");
    const response = {
      ok: true,
      events: getEvents_(),
      serverTime: Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX")
    };
    return jsonpOutput_(response, callback);
  } catch (error) {
    return jsonpOutput_({ ok: false, message: safeMessage_(error) }, callback);
  }
}

/**
 * 予定の保存・削除、希望日時の受付を処理します。
 */
function doPost(e) {
  let requestId = "";
  try {
    if (!e || !e.parameter || !e.parameter.payload) {
      throw new Error("送信内容がありません。");
    }

    const payload = JSON.parse(e.parameter.payload);
    requestId = String(payload.requestId || "");
    let result;

    switch (String(payload.action || "")) {
      case "saveEvent":
        assertTeacherPassword_(payload.password);
        result = saveEvent_(payload.event);
        break;
      case "deleteEvent":
        assertTeacherPassword_(payload.password);
        result = deleteEvent_(payload.eventId);
        break;
      case "submitRequest":
        result = submitRequest_(payload.name, payload.preferredDates);
        break;
      default:
        throw new Error("未対応の操作です。");
    }

    const response = {
      source: "mendan-api",
      requestId: requestId,
      ok: true,
      result: result
    };
    cacheSubmissionStatus_(requestId, { done: true, ok: true, result: result });
    return postMessageOutput_(response);
  } catch (error) {
    const message = safeMessage_(error);
    cacheSubmissionStatus_(requestId, { done: true, ok: false, message: message });
    return postMessageOutput_({
      source: "mendan-api",
      requestId: requestId,
      ok: false,
      message: message
    });
  }
}

function cacheSubmissionStatus_(requestId, status) {
  if (!/^[0-9A-Za-z_-]{10,120}$/.test(String(requestId || ""))) return;
  CacheService.getScriptCache().put(
    "submission_" + requestId,
    JSON.stringify(status),
    120
  );
}

function getEvents_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(EVENTS_CACHE_KEY);
  if (cached) return JSON.parse(cached);

  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ensureEventSheet_(spreadsheet);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const events = sheet.getRange(2, 1, lastRow - 1, 7).getValues()
    .map(function(row) {
      return {
        id: String(row[0] || ""),
        type: String(row[1] || ""),
        date: normalizeDate_(row[2]),
        start: normalizeTime_(row[3]),
        end: normalizeTime_(row[4]),
        title: String(row[5] || "")
      };
    })
    .filter(function(event) {
      return event.id && VALID_DATES.indexOf(event.date) >= 0;
    })
    .sort(function(a, b) {
      return (a.date + " " + a.start).localeCompare(b.date + " " + b.start);
    });

  cache.put(EVENTS_CACHE_KEY, JSON.stringify(events), EVENTS_CACHE_SECONDS);
  return events;
}

function clearEventsCache_() {
  CacheService.getScriptCache().remove(EVENTS_CACHE_KEY);
}

function saveEvent_(rawEvent) {
  const event = validateEvent_(rawEvent);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);

  try {
    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ensureEventSheet_(spreadsheet);
    const lastRow = sheet.getLastRow();
    const values = lastRow >= 2 ? sheet.getRange(2, 1, lastRow - 1, 7).getValues() : [];

    values.forEach(function(row) {
      const existingId = String(row[0] || "");
      if (event.id && existingId === event.id) return;

      const existingDate = normalizeDate_(row[2]);
      const existingStart = timeToMinutes_(normalizeTime_(row[3]));
      const existingEnd = timeToMinutes_(normalizeTime_(row[4]));
      if (
        existingDate === event.date &&
        existingStart < timeToMinutes_(event.end) &&
        existingEnd > timeToMinutes_(event.start)
      ) {
        throw new Error(
          normalizeTime_(row[3]) + "〜" + normalizeTime_(row[4]) + "の予定と重なっています。"
        );
      }
    });

    const updatedAt = new Date();
    if (event.id) {
      const index = values.findIndex(function(row) {
        return String(row[0] || "") === event.id;
      });
      if (index < 0) throw new Error("編集する予定が見つかりません。ページを更新してください。");
      sheet.getRange(index + 2, 1, 1, 7).setValues([[
        event.id, event.type, event.date, event.start, event.end, event.title, updatedAt
      ]]);
    } else {
      event.id = Utilities.getUuid();
      sheet.appendRow([
        event.id, event.type, event.date, event.start, event.end, event.title, updatedAt
      ]);
    }

    sortEvents_(sheet);
    clearEventsCache_();
    return { id: event.id };
  } finally {
    lock.releaseLock();
  }
}

function deleteEvent_(eventId) {
  const id = String(eventId || "").trim();
  if (!id) throw new Error("削除する予定が指定されていません。");

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);

  try {
    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ensureEventSheet_(spreadsheet);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) throw new Error("削除する予定が見つかりません。");

    const ids = sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
    const index = ids.findIndex(function(row) {
      return String(row[0]) === id;
    });
    if (index < 0) throw new Error("削除する予定が見つかりません。ページを更新してください。");

    sheet.deleteRow(index + 2);
    clearEventsCache_();
    return { id: id };
  } finally {
    lock.releaseLock();
  }
}

function submitRequest_(rawName, rawPreferredDates) {
  const name = String(rawName || "").trim();
  const preferredDates = String(rawPreferredDates || "").trim();
  const today = Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd");

  if (today > REQUEST_DEADLINE) throw new Error("希望入力の受付は8月10日（月）で終了しました。");
  if (!name) throw new Error("氏名を入力してください。");
  if (!preferredDates) throw new Error("希望日時を入力してください。");
  if (name.length > 50) throw new Error("氏名は50文字以内で入力してください。");
  if (preferredDates.length > 800) throw new Error("希望日時は800文字以内で入力してください。");

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);

  let sheet;
  let appendedRow = 0;
  try {
    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    sheet = ensureRequestSheet_(spreadsheet);
    const receivedAt = new Date();
    sheet.appendRow([receivedAt, name, preferredDates]);
    appendedRow = sheet.getLastRow();

    const subject = "【二者面談】希望日時が送信されました（" + name + "）";
    const body = [
      "二者面談の希望日時が送信されました。",
      "",
      "氏名：",
      name,
      "",
      "希望日時：",
      preferredDates,
      "",
      "受付日時：" + Utilities.formatDate(receivedAt, TIMEZONE, "yyyy年M月d日 HH:mm"),
      "",
      "スプレッドシート：",
      "https://docs.google.com/spreadsheets/d/" + SPREADSHEET_ID + "/edit"
    ].join("\n");

    MailApp.sendEmail({
      to: NOTIFICATION_EMAIL,
      subject: subject,
      body: body,
      name: "二者面談 日程調整"
    });

    return { received: true };
  } catch (error) {
    if (sheet && appendedRow >= 2 && sheet.getLastRow() >= appendedRow) {
      try {
        sheet.deleteRow(appendedRow);
      } catch (rollbackError) {
        console.error(rollbackError);
      }
    }
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function validateEvent_(rawEvent) {
  const event = rawEvent || {};
  const cleaned = {
    id: String(event.id || "").trim(),
    type: String(event.type || "").trim(),
    date: String(event.date || "").trim(),
    start: String(event.start || "").trim(),
    end: String(event.end || "").trim(),
    title: String(event.title || "").trim()
  };

  if (["interview", "teacher"].indexOf(cleaned.type) < 0) {
    throw new Error("予定の種類が正しくありません。");
  }
  if (VALID_DATES.indexOf(cleaned.date) < 0) {
    throw new Error("対象期間内の日付を選んでください。");
  }
  if (!/^\d{2}:\d{2}$/.test(cleaned.start) || !/^\d{2}:\d{2}$/.test(cleaned.end)) {
    throw new Error("時刻の形式が正しくありません。");
  }

  const start = timeToMinutes_(cleaned.start);
  const end = timeToMinutes_(cleaned.end);
  if (start < START_MINUTES || end > END_MINUTES || end <= start) {
    throw new Error("9:00〜16:30の範囲で、終了を開始より後にしてください。");
  }
  if (start % 5 !== 0 || end % 5 !== 0) {
    throw new Error("時刻は5分単位で指定してください。");
  }
  if (!cleaned.title) {
    throw new Error(cleaned.type === "interview" ? "生徒名を入力してください。" : "予定名を入力してください。");
  }
  if (cleaned.title.length > 60) {
    throw new Error("表示名は60文字以内で入力してください。");
  }
  return cleaned;
}

function assertTeacherPassword_(rawPassword) {
  const expected = PropertiesService.getScriptProperties().getProperty("TEACHER_PASSWORD");
  const received = String(rawPassword || "");

  if (!expected || expected === "CHANGE_ME_NOW") {
    throw new Error("管理パスワードが未設定です。GASのスクリプトプロパティを確認してください。");
  }
  if (received !== expected) {
    throw new Error("管理パスワードが違います。");
  }
}

function ensureEventSheet_(spreadsheet) {
  let sheet = spreadsheet.getSheetByName(EVENT_SHEET_NAME);
  if (!sheet) sheet = spreadsheet.insertSheet(EVENT_SHEET_NAME);

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, 7).setValues([[
      "ID", "種別", "日付", "開始", "終了", "表示名", "更新日時"
    ]]);
    sheet.setFrozenRows(1);
    sheet.getRange("A:A").setNumberFormat("@");
    sheet.getRange("C:F").setNumberFormat("@");
    sheet.getRange("G:G").setNumberFormat("yyyy/mm/dd hh:mm:ss");
    sheet.getRange(1, 1, 1, 7)
      .setFontWeight("bold")
      .setBackground("#17365d")
      .setFontColor("#ffffff");
    sheet.autoResizeColumns(1, 7);
  }
  return sheet;
}

function ensureRequestSheet_(spreadsheet) {
  let sheet = spreadsheet.getSheetByName(REQUEST_SHEET_NAME);
  if (!sheet) sheet = spreadsheet.insertSheet(REQUEST_SHEET_NAME);

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, 3).setValues([[
      "受付日時", "氏名", "希望日時"
    ]]);
    sheet.setFrozenRows(1);
    sheet.getRange("A:A").setNumberFormat("yyyy/mm/dd hh:mm:ss");
    sheet.getRange("B:C").setNumberFormat("@");
    sheet.getRange(1, 1, 1, 3)
      .setFontWeight("bold")
      .setBackground("#17365d")
      .setFontColor("#ffffff");
    sheet.setColumnWidth(1, 160);
    sheet.setColumnWidth(2, 180);
    sheet.setColumnWidth(3, 420);
    sheet.getRange("C:C").setWrap(true);
  }
  return sheet;
}

function sortEvents_(sheet) {
  if (sheet.getLastRow() < 3) return;
  sheet.getRange(2, 1, sheet.getLastRow() - 1, 7)
    .sort([{ column: 3, ascending: true }, { column: 4, ascending: true }]);
}

function normalizeDate_(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, TIMEZONE, "yyyy-MM-dd");
  }
  return String(value || "").trim();
}

function normalizeTime_(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, TIMEZONE, "HH:mm");
  }
  const text = String(value || "").trim();
  const match = text.match(/^(\d{1,2}):(\d{2})/);
  return match ? String(match[1]).padStart(2, "0") + ":" + match[2] : text;
}

function timeToMinutes_(time) {
  const parts = String(time).split(":").map(Number);
  return parts[0] * 60 + parts[1];
}

function jsonpOutput_(data, callback) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  if (/^[A-Za-z_$][0-9A-Za-z_$\.]*$/.test(callback)) {
    return ContentService
      .createTextOutput(callback + "(" + json + ");")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

function postMessageOutput_(data) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  const html = [
    "<!doctype html><meta charset=\"utf-8\">",
    "<title>送信結果</title>",
    "<script>",
    "window.parent.postMessage(" + json + ", '*');",
    "<\/script>"
  ].join("");

  return HtmlService
    .createHtmlOutput(html)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function safeMessage_(error) {
  const message = error && error.message ? String(error.message) : "処理中にエラーが発生しました。";
  return message.replace(/^Exception:\s*/, "");
}
