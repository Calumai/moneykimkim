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
  var agencies = splitWords(query.agencyQuery || '原住民、客家');
  var keywords = splitWords(query.keywordQuery || '族語、網站、教材');
  var urls = buildPccUrls(query, agencies, keywords);
  var found = [];
  var errors = [];

  urls.forEach(function (url) {
    try {
      var html = fetchText(url);
      var parsed = parsePccHtml(html, url);
      parsed.forEach(function (row) { found.push(row); });
    } catch (err) {
      errors.push(String(err && err.message ? err.message : err));
    }
  });

  var unique = uniqueRows(found).map(function (row, index) {
    row.id = row.id || ('P' + Utilities.formatString('%03d', index + 1));
    row.dataStatus = '政府採購網搜尋結果，需人工確認';
    return row;
  });

  return {
    ok: true,
    message: unique.length ? ('搜尋完成，共找到 ' + unique.length + ' 筆。截標日期以政府採購網頁面文字為準。') : ('沒有解析到標案。可改日期/關鍵字再查，或切換人工貼上備援。' + (errors.length ? ' 錯誤：' + errors.slice(0, 2).join('；') : '')),
    rows: unique,
    checkedUrls: urls.length
  };
}

function buildPccUrls(query, agencies, keywords) {
  var from = toRocDate(query.publishFrom || todaySheetName());
  var to = toRocDate(query.publishTo || query.publishFrom || todaySheetName());
  var pairs = [];
  var aList = agencies.length ? agencies : [''];
  var kList = keywords.length ? keywords : [''];
  aList.slice(0, 4).forEach(function (agency) {
    kList.slice(0, 12).forEach(function (keyword) {
      pairs.push({ agency: agency, keyword: keyword });
    });
  });

  return pairs.map(function (p) {
    var base = 'https://web.pcc.gov.tw/tps/pss/tender.do';
    var params = {
      searchMode: 'common',
      searchType: 'basic',
      method: 'search',
      tenderWay: '1',
      tenderDateRadio: 'on',
      dateType: 'isDate',
      tenderStartDate: from,
      tenderEndDate: to,
      orgName: p.agency,
      tenderName: p.keyword,
      tenderStatus: '5',
      pageIndex: '1'
    };
    return base + '?' + toQuery(params);
  });
}

function fetchText(url) {
  var res = UrlFetchApp.fetch(url, {
    method: 'get',
    muteHttpExceptions: true,
    followRedirects: true,
    headers: { 'User-Agent': 'Mozilla/5.0 AppsScript tender helper' }
  });
  var code = res.getResponseCode();
  var text = res.getContentText('UTF-8');
  if (code < 200 || code >= 400) throw new Error('政府採購網回應 HTTP ' + code);
  return text;
}

function parsePccHtml(html, sourceUrl) {
  var rows = [];
  var trMatches = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];
  trMatches.forEach(function (tr) {
    var cells = extractCells(tr);
    var link = extractTenderLink(tr);
    var text = cells.join(' ');
    if (!link && text.indexOf('標案') < 0) return;
    if (cells.length < 4) return;
    var title = guessTitle(cells);
    var agency = guessAgency(cells);
    if (!title || title.indexOf('標案名稱') >= 0) return;
    var dates = guessDates(cells);
    rows.push({
      title: title,
      agency: agency,
      publishDate: dates.publishDate,
      deadline: dates.deadline,
      budget: guessBudget(cells),
      link: link || sourceUrl,
      summary: text.slice(0, 260)
    });
  });
  return rows;
}

function extractCells(tr) {
  var matches = tr.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || [];
  return matches.map(function (cell) { return cleanHtml(cell); }).filter(Boolean);
}

function extractTenderLink(tr) {
  var m = tr.match(/href=["']([^"']*(?:tender|prkms|pkPmsMain)[^"']*)["']/i);
  if (!m) return '';
  var href = m[1].replace(/&amp;/g, '&');
  if (href.indexOf('http') === 0) return href;
  if (href.charAt(0) === '/') return 'https://web.pcc.gov.tw' + href;
  return 'https://web.pcc.gov.tw/tps/pss/' + href;
}

function cleanHtml(s) {
  return String(s || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function guessTitle(cells) {
  var best = '';
  cells.forEach(function (c) {
    if (c.length > best.length && !looksLikeDate(c) && !looksLikeMoney(c) && c.indexOf('機關') < 0) best = c;
  });
  return best;
}

function guessAgency(cells) {
  for (var i = 0; i < cells.length; i++) {
    if (/(委員會|基金會|公所|學校|局|處|署|部|中心|政府)/.test(cells[i]) && cells[i].length < 60) return cells[i];
  }
  return cells[1] || '';
}

function guessDates(cells) {
  var dates = [];
  cells.forEach(function (c) {
    var found = c.match(/(?:\d{2,3}|\d{4})[\/.-]\d{1,2}[\/.-]\d{1,2}(?:\s+\d{1,2}:\d{2})?/g);
    if (found) found.forEach(function (d) { dates.push(d); });
  });
  return { publishDate: dates[0] || '', deadline: dates[1] || '' };
}

function guessBudget(cells) {
  for (var i = 0; i < cells.length; i++) {
    if (/\d{1,3}(,\d{3})+|\d{6,}/.test(cells[i]) && !looksLikeDate(cells[i])) return cells[i].match(/\d[\d,]*/)[0];
  }
  return '';
}

function looksLikeDate(s) { return /(?:\d{2,3}|\d{4})[\/.-]\d{1,2}[\/.-]\d{1,2}/.test(String(s)); }
function looksLikeMoney(s) { return /\d{1,3}(,\d{3})+|\d{6,}/.test(String(s)); }

function uniqueRows(rows) {
  var seen = {};
  var out = [];
  rows.forEach(function (r) {
    var key = [r.link, r.title, r.agency].join('|');
    if (!seen[key]) { seen[key] = true; out.push(r); }
  });
  return out;
}

function splitWords(text) { return String(text || '').split(/[、,，\s]+/).map(function (s) { return s.trim(); }).filter(Boolean); }
function toQuery(obj) { return Object.keys(obj).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(obj[k] || ''); }).join('&'); }
function toRocDate(iso) { var p = String(iso || '').split('-'); if (p.length < 3) return iso; return String(Number(p[0]) - 1911) + '/' + p[1] + '/' + p[2]; }

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
