/**
 * Loop 8.5.0
 * 自動搜尋 + 直接查政府採購網往年類似標案
 *
 * 重點：
 * 1. 不查自己的 Google Sheet 歷史資料。
 * 2. 目前標案先查政府採購網 readTenderBasic。
 * 3. 對每筆標案，再用政府採購網查往年同機關、同月前後區間。
 * 4. 標案名稱清洗後做相似度；80% 以上標記疑似往年標案。
 * 5. 保留同事自訂 GAS URL 的前端支援。
 */

var VERSION = 'Loop 8.5.0';
var UPDATED_AT = '2026-06-17 19:10';
var PCC_BASE = 'https://web.pcc.gov.tw/prkms/tender/common/basic/readTenderBasic';
var PCC_HOST = 'https://web.pcc.gov.tw';

function doGet() {
  return jsonResponse({
    ok: true,
    message: 'API 可以使用',
    backendVersion: VERSION,
    updatedAt: UPDATED_AT,
    note: '自動搜尋 + 直接查政府採購網往年類似標案，不讀公司資料庫'
  });
}

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents || '{}');
    var props = PropertiesService.getScriptProperties();
    var expected = props.getProperty('SCRIPT_TOKEN') || '1234';

    if (String(payload.token || '') !== expected) {
      return jsonResponse({ ok: false, error: '驗證失敗' });
    }

    if (payload.action === 'search') return jsonResponse(searchTenders(payload.query || {}));
    if (payload.action === 'debug') return jsonResponse(debugSearch(payload.query || {}));
    if (payload.action === 'history') return jsonResponse(historySearch(payload.rows || [], payload.query || {}));

    return jsonResponse(writeRows(payload.rows || [], payload.sheetName || ''));
  } catch (error) {
    return jsonResponse({ ok: false, error: String(error && error.message ? error.message : error) });
  }
}

function searchTenders(query) {
  query = query || {};

  var agencies = splitWords(query.agencyQuery || '花蓮');
  var urls = buildCurrentPccUrls(query, agencies);
  var found = [];
  var debugItems = [];

  urls.forEach(function (url, index) {
    if (index >= 12) return;
    var result = fetchTextWithDebug(url);
    debugItems.push(result.debug);
    if (result.ok) parsePccHtml(result.text, url).forEach(function (row) { found.push(row); });
  });

  var unique = uniqueRows(found).map(function (row, index) {
    row.id = row.id || ('P' + Utilities.formatString('%03d', index + 1));
    row.dataStatus = '政府採購網自動搜尋結果，需人工確認';
    return row;
  });

  unique = classifyRows(unique, query.keywordQuery || '');

  if (String(query.enableHistory || 'true') !== 'false') {
    unique = enrichHistory(unique, query);
  }

  return {
    ok: true,
    message: buildSearchMessage(unique, debugItems),
    rows: unique,
    checkedUrls: urls.length,
    debug: debugItems.slice(0, 3)
  };
}

function buildSearchMessage(rows, debugItems) {
  if (rows.length) {
    var historical = rows.filter(function (r) { return Number(r.historyScore || 0) >= 80; }).length;
    return '搜尋完成，共找到 ' + rows.length + ' 筆；其中 ' + historical + ' 筆疑似往年出現過。資料來源：政府採購網。';
  }

  var first = debugItems[0] || {};
  var flags = [];
  flags.push(first.hasTpam ? '有 #tpam' : '沒有 #tpam');
  flags.push(first.hasTable ? '有 table' : '沒有 table');
  flags.push(first.hasTenderText ? '有標案文字' : '沒有標案文字');
  flags.push(first.hasDeadlineText ? '有截標文字' : '沒有截標文字');

  return '查詢已送出，但沒有解析到標案。' +
    ' HTTP=' + (first.httpCode || '未知') + '，' + flags.join('，') +
    '。第一個查詢網址：' + (first.url || '') +
    '。頁面前段：' + (first.preview || '').slice(0, 300);
}

function debugSearch(query) {
  query = query || {};
  var urls = buildCurrentPccUrls(query, splitWords(query.agencyQuery || '花蓮'));
  var result = fetchTextWithDebug(urls[0]);
  return {
    ok: true,
    backendVersion: VERSION,
    debug: result.debug,
    sampleRows: result.ok ? parsePccHtml(result.text, urls[0]).slice(0, 3) : []
  };
}

function historySearch(rows, query) {
  rows = Array.isArray(rows) ? rows : [];
  query = query || {};
  return { ok: true, rows: enrichHistory(rows, query) };
}

function buildCurrentPccUrls(query, agencies) {
  var from = toYmdSlash(query.publishFrom || todaySheetName());
  var to = toYmdSlash(query.publishTo || query.publishFrom || todaySheetName());
  var aList = agencies.length ? agencies : [''];

  return aList.slice(0, 8).map(function (agency) {
    return buildPccUrl({
      orgName: agency,
      tenderName: '',
      startDate: from,
      endDate: to,
      pageSize: '50'
    });
  });
}

function buildPccUrl(opt) {
  opt = opt || {};
  var params = {
    pageSize: opt.pageSize || '50',
    firstSearch: 'true',
    searchType: 'basic',
    isBinding: 'N',
    isLogIn: 'N',
    level_1: 'on',
    orgName: opt.orgName || '',
    orgId: '',
    tenderName: opt.tenderName || '',
    tenderId: '',
    tenderType: 'TENDER_DECLARATION',
    tenderWay: 'TENDER_WAY_ALL_DECLARATION',
    dateType: 'isDate',
    tenderStartDate: opt.startDate || '',
    tenderEndDate: opt.endDate || '',
    radProctrgCate: '',
    policyAdvocacy: ''
  };
  return PCC_BASE + '?' + toQuery(params);
}

function enrichHistory(rows, query) {
  query = query || {};
  var years = Math.max(1, Math.min(Number(query.historyYears || 3), 5));
  var threshold = Math.max(50, Math.min(Number(query.historyThreshold || 80), 99));
  var windowDays = Math.max(15, Math.min(Number(query.historyWindowDays || 60), 180));
  var maxRows = Math.max(1, Math.min(Number(query.historyMaxRows || 40), 80));
  var cache = {};

  rows.slice(0, maxRows).forEach(function (row) {
    var baseDate = parseAnyDate(row.publishDate) || parseAnyDate(query.publishFrom) || new Date();
    var candidates = [];

    for (var y = 1; y <= years; y++) {
      var center = new Date(baseDate.getTime());
      center.setFullYear(center.getFullYear() - y);
      var start = addDays(center, -windowDays);
      var end = addDays(center, windowDays);
      var key = [row.agency || '', formatYmdSlash(start), formatYmdSlash(end)].join('|');

      if (!cache[key]) {
        var url = buildPccUrl({
          orgName: row.agency || '',
          tenderName: '',
          startDate: formatYmdSlash(start),
          endDate: formatYmdSlash(end),
          pageSize: '50'
        });
        var result = fetchTextWithDebug(url);
        cache[key] = result.ok ? parsePccHtml(result.text, url) : [];
      }
      candidates = candidates.concat(cache[key]);
    }

    var best = findBestSimilar(row, candidates);
    if (best && best.score >= threshold) {
      row.historyStatus = best.score >= 90 ? '高度疑似往年標案' : '疑似往年標案';
      row.historyScore = best.score;
      row.historyTitle = best.row.title || '';
      row.historyAgency = best.row.agency || '';
      row.historyPublishDate = best.row.publishDate || '';
      row.historyLink = best.row.link || '';
      row.historyNote = row.historyStatus + ' ' + best.score + '%｜' + (best.row.publishDate || '') + '｜' + (best.row.title || '');
      row.notes = Array.isArray(row.notes) ? row.notes : [];
      row.notes.push(row.historyNote);
    } else {
      row.historyStatus = '';
      row.historyScore = '';
      row.historyTitle = '';
      row.historyAgency = '';
      row.historyPublishDate = '';
      row.historyLink = '';
      row.historyNote = '';
    }
  });

  return rows;
}

function findBestSimilar(current, candidates) {
  var currentNorm = normalizeTenderName(current.title || '');
  var best = null;

  candidates.forEach(function (past) {
    if (!past || !past.title) return;
    if (past.link && current.link && past.link === current.link) return;

    var pastNorm = normalizeTenderName(past.title || '');
    if (!currentNorm || !pastNorm) return;

    var score = Math.round(similarity(currentNorm, pastNorm) * 100);
    if (!best || score > best.score) best = { score: score, row: past };
  });

  return best;
}

function normalizeTenderName(title) {
  var s = String(title || '');
  var parts = s.split(/\n+/).map(function (x) { return x.trim(); }).filter(Boolean);
  if (parts.length > 1 && /^[A-Za-z0-9_\-\.]+$/.test(parts[0])) parts.shift();
  s = parts.join(' ');
  s = s.replace(/\(更正公告\)|（更正公告）|更正公告/g, '');
  s = s.replace(/[0-9０-９]{2,4}\s*年度/g, '');
  s = s.replace(/民國\s*[0-9０-９]{2,3}\s*年/g, '');
  s = s.replace(/[0-9０-９]{4}[\/.-][0-9０-９]{1,2}[\/.-][0-9０-９]{1,2}/g, '');
  s = s.replace(/[0-9０-９]{2,3}[\/.-][0-9０-９]{1,2}[\/.-][0-9０-９]{1,2}/g, '');
  s = s.replace(/第[一二三四五六七八九十0-9０-９]+(次|期|屆)/g, '');
  s = s.replace(/[\s　「」『』【】\[\]（）()《》<>：:，,。．.、;；!！?？\-－_—~～\/\\]/g, '');
  return s.toLowerCase();
}

function similarity(a, b) {
  a = String(a || '');
  b = String(b || '');
  if (!a || !b) return 0;
  if (a === b) return 1;

  var gramsA = ngrams(a, 2);
  var gramsB = ngrams(b, 2);
  if (!gramsA.length || !gramsB.length) return 0;

  var map = {};
  gramsA.forEach(function (g) { map[g] = (map[g] || 0) + 1; });

  var hit = 0;
  gramsB.forEach(function (g) {
    if (map[g]) {
      hit++;
      map[g]--;
    }
  });

  return (2 * hit) / (gramsA.length + gramsB.length);
}

function ngrams(s, n) {
  var out = [];
  if (s.length <= n) return [s];
  for (var i = 0; i <= s.length - n; i++) out.push(s.slice(i, i + n));
  return out;
}

function classifyRows(rows, keywordText) {
  var words = splitWords(keywordText || '');
  rows.forEach(function (row) {
    var text = [row.title, row.agency, row.summary].join(' ');
    var matched = words.filter(function (w) { return w && text.indexOf(w) >= 0; });
    var notes = [];
    var priority = matched.length ? '可觀察' : '需人工確認';
    var amount = Number(String(row.budget || '').replace(/[^0-9]/g, ''));

    if (/維運|維護/.test(text)) {
      notes.push('維運／維護類，可能已有原廠商');
      priority = '低優先';
    }
    if (/系統|資訊|網站|平台|平臺/.test(text) && amount && amount < 1000000) {
      notes.push('資訊系統類且低於 100 萬，先低優先');
      priority = '低優先';
    }
    if (!notes.length && matched.length) notes.push('命中關鍵字，建議人工檢視');

    row.matchedKeywords = matched;
    row.notes = notes;
    row.priority = row.priority || priority;
  });
  return rows;
}

function fetchTextWithDebug(url) {
  var debug = { url: url, httpCode: '', hasTpam: false, hasTable: false, hasTenderText: false, hasDeadlineText: false, preview: '', error: '' };
  try {
    var res = UrlFetchApp.fetch(url, {
      method: 'get',
      muteHttpExceptions: true,
      followRedirects: true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8'
      }
    });
    var code = res.getResponseCode();
    var text = res.getContentText('UTF-8');
    debug.httpCode = code;
    debug.hasTpam = /id=["']tpam["']|id=tpam/i.test(text);
    debug.hasTable = /<table/i.test(text);
    debug.hasTenderText = /標案|招標|決標|採購/.test(text);
    debug.hasDeadlineText = /截標|截止投標|投標截止/.test(text);
    debug.preview = cleanHtml(text).slice(0, 600);
    if (code < 200 || code >= 400) {
      debug.error = 'HTTP ' + code;
      return { ok: false, text: text, debug: debug };
    }
    return { ok: true, text: text, debug: debug };
  } catch (err) {
    debug.error = String(err && err.message ? err.message : err);
    return { ok: false, text: '', debug: debug };
  }
}

function parsePccHtml(html, sourceUrl) {
  var rows = [];
  var table = extractTpamTable(html) || html;
  var trMatches = table.match(/<tr[\s\S]*?<\/tr>/gi) || [];

  trMatches.forEach(function (tr) {
    var cells = extractCells(tr);
    if (cells.length < 9) return;
    if (cells[0] && /序號|項次/.test(cells[0])) return;

    var row = {
      title: cells[2] || '',
      agency: cells[1] || '',
      publishDate: cells[6] || '',
      deadline: cells[7] || '',
      budget: cells[8] || '',
      link: extractTenderLink(tr, sourceUrl) || sourceUrl,
      summary: [cells[4] || '', cells[5] || ''].filter(Boolean).join('｜')
    };

    if (row.title && row.agency) rows.push(row);
  });

  return rows;
}

function extractTpamTable(html) {
  var m = String(html || '').match(/<table[^>]*id=["']?tpam["']?[^>]*>[\s\S]*?<\/table>/i);
  return m ? m[0] : '';
}

function extractCells(tr) {
  var matches = tr.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || [];
  return matches.map(function (cell) { return cleanHtml(cell); }).filter(function (v) { return v !== ''; });
}

function extractTenderLink(tr, sourceUrl) {
  var m = tr.match(/href=["']([^"']+)["']/i);
  if (!m) return '';
  var href = m[1].replace(/&amp;/g, '&');
  if (href.indexOf('http') === 0) return href;
  if (href.charAt(0) === '/') return PCC_HOST + href;
  return PCC_HOST + '/prkms/tender/common/basic/' + href;
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
    .replace(/&#x([0-9a-f]+);/gi, function (_, h) { return String.fromCharCode(parseInt(h, 16)); })
    .replace(/&#(\d+);/g, function (_, d) { return String.fromCharCode(parseInt(d, 10)); })
    .replace(/\s+/g, ' ')
    .trim();
}

function uniqueRows(rows) {
  var seen = {};
  var out = [];
  rows.forEach(function (r) {
    var key = [r.link, r.title, r.agency].join('|');
    if (!seen[key]) { seen[key] = true; out.push(r); }
  });
  return out;
}

function splitWords(text) {
  return String(text || '').split(/[、,，\s]+/).map(function (s) { return s.trim(); }).filter(Boolean);
}

function toQuery(obj) {
  return Object.keys(obj).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(obj[k] || ''); }).join('&');
}

function toYmdSlash(iso) {
  var p = String(iso || '').split('-');
  if (p.length < 3) return iso;
  return p[0] + '/' + p[1] + '/' + p[2];
}

function parseAnyDate(s) {
  s = String(s || '').trim();
  var m = s.match(/^(\d{2,4})[\/.-](\d{1,2})[\/.-](\d{1,2})/);
  if (!m) return null;
  var y = Number(m[1]);
  if (y < 1911) y += 1911;
  return new Date(y, Number(m[2]) - 1, Number(m[3]));
}

function addDays(date, days) {
  var d = new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

function formatYmdSlash(date) {
  return date.getFullYear() + '/' + pad2(date.getMonth() + 1) + '/' + pad2(date.getDate());
}

function pad2(n) {
  return String(n).length < 2 ? '0' + n : String(n);
}

function authorizeUrlFetch() {
  UrlFetchApp.fetch(PCC_BASE + '?firstSearch=true&searchType=basic&isBinding=N&isLogIn=N&level_1=on&orgName=%E8%8A%B1%E8%93%AE&tenderType=TENDER_DECLARATION&tenderWay=TENDER_WAY_ALL_DECLARATION&dateType=isDate&tenderStartDate=2026%2F06%2F11&tenderEndDate=2026%2F06%2F17');
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

  if (valuesToAppend.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, valuesToAppend.length, HEADERS.length).setValues(valuesToAppend);
  }

  return { ok: true, sheetName: sheetName, received: rows.length, inserted: valuesToAppend.length, skipped: skipped.length, skippedItems: skipped };
}

var HEADERS = ['編號','資料狀態','標案名稱','機關名稱','公告日期','截標日期','預算金額','優先度','命中關鍵字','初步備註','標案連結','摘要','歷史相似度','歷史相似標案','歷史相似公告日','歷史相似連結'];

function normalizeRow(row) {
  return {
    id: String(row.id || ''),
    dataStatus: String(row.dataStatus || '政府採購網自動搜尋結果'),
    title: String(row.title || ''),
    agency: String(row.agency || ''),
    publishDate: String(row.publishDate || ''),
    deadline: String(row.deadline || ''),
    budget: String(row.budget || ''),
    priority: String(row.priority || '需人工確認'),
    matchedKeywords: Array.isArray(row.matchedKeywords) ? row.matchedKeywords.join('、') : String(row.matchedKeywords || ''),
    notes: Array.isArray(row.notes) ? row.notes.join('；') : String(row.notes || ''),
    link: String(row.link || ''),
    summary: String(row.summary || ''),
    historyScore: String(row.historyScore || ''),
    historyTitle: String(row.historyTitle || ''),
    historyPublishDate: String(row.historyPublishDate || ''),
    historyLink: String(row.historyLink || '')
  };
}

function toSheetRow(row) {
  return [row.id,row.dataStatus,row.title,row.agency,row.publishDate,row.deadline,row.budget,row.priority,row.matchedKeywords,row.notes,row.link,row.summary,row.historyScore,row.historyTitle,row.historyPublishDate,row.historyLink];
}

function buildKey(row) { return [row.link,row.title,row.agency].join('|'); }
function getOrCreateSheet(spreadsheet, sheetName) { return spreadsheet.getSheetByName(sheetName) || spreadsheet.insertSheet(sheetName); }
function ensureHeader(sheet) { sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]); }
function readExistingKeys(sheet) {
  var last = sheet.getLastRow();
  var existing = {};
  if (last < 2) return existing;
  var values = sheet.getRange(2, 1, last - 1, Math.max(HEADERS.length, sheet.getLastColumn())).getValues();
  values.forEach(function (r) { existing[[r[10], r[2], r[3]].join('|')] = true; });
  return existing;
}
function todaySheetName() {
  var tz = Session.getScriptTimeZone() || 'Asia/Taipei';
  return Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
}
function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
