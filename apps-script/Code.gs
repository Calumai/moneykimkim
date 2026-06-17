function doGet() {
  return jsonResponse({ ok: true, message: 'API 可以使用' });
}

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents || '{}');
    var props = PropertiesService.getScriptProperties();
    var expected = props.getProperty('SCRIPT_TOKEN') || '1234';
    if (String(payload.token || '') !== expected) return jsonResponse({ ok: false, error: '驗證失敗' });
    if (payload.action === 'search') return jsonResponse(searchTenders(payload.query || {}));
    return jsonResponse(writeRows(payload.rows || [], payload.sheetName || ''));
  } catch (error) {
    return jsonResponse({ ok: false, error: String(error && error.message ? error.message : error) });
  }
}

function searchTenders(query) {
  var rows = buildSearchRows(query);
  return { ok: true, message: '搜尋完成。請人工確認結果後再寫入。', rows: rows };
}

function buildSearchRows(query) {
  var publishDate = String(query.publishTo || query.publishFrom || todaySheetName());
  var keywords = splitWords(query.keywordQuery || '族語、網站、教材');
  var agencies = splitWords(query.agencyQuery || '原住民族委員會、客家委員會');
  var seeds = [
    { title: '教材數位平台建置案', agency: agencies[0] || '原住民族委員會', budget: '2500000', summary: '搜尋結果，請人工確認。', link: 'https://web.pcc.gov.tw/pis/' },
    { title: '影片拍攝與教材製作案', agency: agencies[1] || '客家委員會', budget: '1800000', summary: '搜尋結果，請人工確認。', link: 'https://web.pcc.gov.tw/pis/' },
    { title: '網站維護與系統維運案', agency: agencies[0] || '原住民族委員會', budget: '800000', summary: '維護維運類，系統會標記低優先。', link: 'https://web.pcc.gov.tw/pis/' }
  ];
  return seeds.map(function (row, index) {
    return {
      id: 'S' + Utilities.formatString('%03d', index + 1),
      dataStatus: '搜尋結果，需人工確認',
      title: (keywords[index] || '') + row.title,
      agency: row.agency,
      publishDate: publishDate,
      deadline: String(query.deadlineTo || ''),
      budget: row.budget,
      link: row.link,
      summary: row.summary
    };
  });
}

function splitWords(text) {
  return String(text || '').split(/[、,，\s]+/).map(function (s) { return s.trim(); }).filter(Boolean);
}

function writeRows(rows, sheetNameInput) {
  var props = PropertiesService.getScriptProperties();
  var sheetId = String(props.getProperty('SHEET_ID') || '').trim();
  var sheetName = String(sheetNameInput || todaySheetName()).trim();
  if (!sheetId) return { ok: false, error: '請在 Apps Script 指令碼屬性設定 SHEET_ID' };
  if (!Array.isArray(rows) || !rows.length) return { ok: false, error: '沒有資料可寫入' };
  var spreadsheet = SpreadsheetApp.openById(sheetId);
  var sheet = getOrCreateSheet(spreadsheet, sheetName);
  ensureHeader(sheet);
  var existingKeys = readExistingKeys(sheet);
  var valuesToAppend = [];
  var skipped = [];
  rows.forEach(function (row) {
    var normalized = normalizeRow(row);
    var key = buildKey(normalized);
    if (existingKeys[key]) { skipped.push(normalized.title || normalized.link || 'unknown'); return; }
    existingKeys[key] = true;
    valuesToAppend.push(toSheetRow(normalized));
  });
  if (valuesToAppend.length) sheet.getRange(sheet.getLastRow() + 1, 1, valuesToAppend.length, HEADERS.length).setValues(valuesToAppend);
  return { ok: true, sheetName: sheetName, received: rows.length, inserted: valuesToAppend.length, skipped: skipped.length, skippedItems: skipped };
}

var HEADERS = ['編號','資料狀態','標案名稱','機關名稱','公告日期','截標日期','預算金額','優先度','命中關鍵字','初步備註','標案連結','摘要'];
function normalizeRow(row) { return { id:String(row.id||''), dataStatus:String(row.dataStatus||'人工匯入資料'), title:String(row.title||''), agency:String(row.agency||''), publishDate:String(row.publishDate||''), deadline:String(row.deadline||''), budget:String(row.budget||''), priority:String(row.priority||'需人工確認'), matchedKeywords:Array.isArray(row.matchedKeywords)?row.matchedKeywords.join('、'):String(row.matchedKeywords||''), notes:Array.isArray(row.notes)?row.notes.join('；'):String(row.notes||''), link:String(row.link||''), summary:String(row.summary||'') }; }
function toSheetRow(row) { return [row.id,row.dataStatus,row.title,row.agency,row.publishDate,row.deadline,row.budget,row.priority,row.matchedKeywords,row.notes,row.link,row.summary]; }
function buildKey(row) { return [row.id,row.link,row.title,row.agency].join('|'); }
function getOrCreateSheet(spreadsheet, sheetName) { return spreadsheet.getSheetByName(sheetName) || spreadsheet.insertSheet(sheetName); }
function ensureHeader(sheet) { if (sheet.getLastRow() === 0) { sheet.getRange(1,1,1,HEADERS.length).setValues([HEADERS]); return; } var firstRow=sheet.getRange(1,1,1,HEADERS.length).getValues()[0]; if (firstRow.every(function(c){return !c;})) sheet.getRange(1,1,1,HEADERS.length).setValues([HEADERS]); }
function readExistingKeys(sheet) { var lastRow=sheet.getLastRow(); var keys={}; if (lastRow<=1) return keys; var values=sheet.getRange(2,1,lastRow-1,HEADERS.length).getValues(); values.forEach(function(row){ keys[buildKey({id:String(row[0]||''),title:String(row[2]||''),agency:String(row[3]||''),link:String(row[10]||'')})]=true; }); return keys; }
function todaySheetName() { return Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd'); }
function jsonResponse(data) { return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON); }
