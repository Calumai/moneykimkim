/**
 * 政府採購每日查標整理 MVP - Google Apps Script 寫入端
 *
 * 第一次設定：
 * 專案設定 > 指令碼屬性
 * SCRIPT_TOKEN = 1234
 * SHEET_ID = 你的 Google Sheet ID
 */

function doGet() {
  return jsonResponse({ ok: true, message: 'API 可以使用' });
}

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents || '{}');
    const props = PropertiesService.getScriptProperties();
    const expectedToken = props.getProperty('SCRIPT_TOKEN') || '1234';

    if (String(payload.token || '') !== expectedToken) {
      return jsonResponse({ ok: false, error: 'Token 不正確' });
    }

    const sheetId = String(payload.sheetId || props.getProperty('SHEET_ID') || '').trim();
    const sheetName = String(payload.sheetName || todaySheetName()).trim();
    const rows = Array.isArray(payload.rows) ? payload.rows : [];

    if (!sheetId) return jsonResponse({ ok: false, error: '請在 Apps Script 指令碼屬性設定 SHEET_ID' });
    if (!rows.length) return jsonResponse({ ok: false, error: '沒有資料可寫入' });

    const spreadsheet = SpreadsheetApp.openById(sheetId);
    const sheet = getOrCreateSheet(spreadsheet, sheetName);
    ensureHeader(sheet);

    const existingKeys = readExistingKeys(sheet);
    const valuesToAppend = [];
    const skipped = [];

    rows.forEach(function (row) {
      const normalized = normalizeRow(row);
      const key = buildKey(normalized);
      if (existingKeys[key]) {
        skipped.push(normalized.title || normalized.link || 'unknown');
        return;
      }
      existingKeys[key] = true;
      valuesToAppend.push(toSheetRow(normalized));
    });

    if (valuesToAppend.length) {
      sheet.getRange(sheet.getLastRow() + 1, 1, valuesToAppend.length, HEADERS.length).setValues(valuesToAppend);
    }

    return jsonResponse({ ok: true, sheetName: sheetName, received: rows.length, inserted: valuesToAppend.length, skipped: skipped.length, skippedItems: skipped });
  } catch (error) {
    return jsonResponse({ ok: false, error: String(error && error.message ? error.message : error) });
  }
}

const HEADERS = ['編號','資料狀態','標案名稱','機關名稱','公告日期','截標日期','預算金額','優先度','命中關鍵字','初步備註','標案連結','摘要'];

function normalizeRow(row) {
  return {
    id: String(row.id || ''),
    dataStatus: String(row.dataStatus || '人工匯入資料'),
    title: String(row.title || ''),
    agency: String(row.agency || ''),
    publishDate: String(row.publishDate || ''),
    deadline: String(row.deadline || ''),
    budget: String(row.budget || ''),
    priority: String(row.priority || '需人工確認'),
    matchedKeywords: Array.isArray(row.matchedKeywords) ? row.matchedKeywords.join('、') : String(row.matchedKeywords || ''),
    notes: Array.isArray(row.notes) ? row.notes.join('；') : String(row.notes || ''),
    link: String(row.link || ''),
    summary: String(row.summary || '')
  };
}

function toSheetRow(row) {
  return [row.id,row.dataStatus,row.title,row.agency,row.publishDate,row.deadline,row.budget,row.priority,row.matchedKeywords,row.notes,row.link,row.summary];
}

function buildKey(row) {
  return [row.id, row.link, row.title, row.agency].join('|');
}

function getOrCreateSheet(spreadsheet, sheetName) {
  return spreadsheet.getSheetByName(sheetName) || spreadsheet.insertSheet(sheetName);
}

function ensureHeader(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    return;
  }
  const firstRow = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  const isEmpty = firstRow.every(function (cell) { return !cell; });
  if (isEmpty) sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
}

function readExistingKeys(sheet) {
  const lastRow = sheet.getLastRow();
  const keys = {};
  if (lastRow <= 1) return keys;
  const values = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
  values.forEach(function (row) {
    const normalized = { id: String(row[0] || ''), title: String(row[2] || ''), agency: String(row[3] || ''), link: String(row[10] || '') };
    keys[buildKey(normalized)] = true;
  });
  return keys;
}

function todaySheetName() {
  return Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
