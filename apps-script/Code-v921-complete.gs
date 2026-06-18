/**
 * MoneyKimKim - Code-v921-complete.gs
 * Loop 9.2.1 Complete
 *
 * 一個完整 Apps Script 檔案，請整份貼到 Code.gs。
 * 不需要再貼 Code-v900 / v904 / v905 / v906 / v910 addon。
 *
 * 核心修正：
 * 1. 機關欄位空白 = 不限機關，不會預設花蓮。
 * 2. 機關欄位有填 = 用 orgName 做機關名稱關鍵字搜尋。
 * 3. 搜尋策略改為：機關單查 → 標案關鍵字單查 → 機關×標案關鍵字交叉查。
 * 4. 標案名稱優先從檢視按鈕 title 抓，再從搜尋列 a/span 抓，最後才進 detail 頁。
 * 5. 補 safeToRocDate，避免 toRocDate is not defined。
 */

var VERSION = 'Loop 9.2.1 Complete';
var UPDATED_AT = '2026-06-18 01:05';
var PCC_BASE = 'https://web.pcc.gov.tw/prkms/tender/common/basic/readTenderBasic';
var PCC_HOST = 'https://web.pcc.gov.tw';
var DEFAULT_TOKEN = '1234';

function doGet() {
  return jsonResponse({
    ok: true,
    message: 'API 可以使用',
    backendVersion: VERSION,
    updatedAt: UPDATED_AT,
    note: '完整單檔：機關空白不限機關；機關關鍵字模糊搜尋；先單查再交叉查，避免只查前 80 組找不到'
  });
}

function doPost(e) {
  try {
    var payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var props = PropertiesService.getScriptProperties();
    var expected = props.getProperty('SCRIPT_TOKEN') || DEFAULT_TOKEN;
    if (String(payload.token || '') !== expected) {
      return jsonResponse({ ok: false, error: '驗證失敗' });
    }
    if (payload.action === 'search') return jsonResponse(searchTenders(payload.query || {}));
    if (payload.action === 'debug') return jsonResponse(debugSearch(payload.query || {}));
    if (payload.action === 'history') return jsonResponse({ ok: true, rows: enrichHistory(payload.rows || [], payload.query || {}) });
    if (payload.action === 'chatTest') return jsonResponse(testGoogleChatNotify());
    if (payload.action === 'dailyRun') return jsonResponse(dailyAutoRunWithChat());
    return jsonResponse(writeRows(payload.rows || [], payload.sheetName || ''));
  } catch (error) {
    return jsonResponse({ ok: false, error: String(error && error.message ? error.message : error) });
  }
}

function searchTenders(query) {
  query = query || {};
  var urls = buildCurrentPccUrls(query);
  var maxUrls = Number(query.maxSearchUrls || 260);
  urls = urls.slice(0, Math.max(1, maxUrls));

  var all = [];
  var errors = [];

  urls.forEach(function (item) {
    try {
      var html = UrlFetchApp.fetch(item.url, {
        muteHttpExceptions: true,
        followRedirects: true,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
          'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8'
        }
      }).getContentText('UTF-8');

      var parsed = parsePccHtml(html, item.url);
      parsed.forEach(function (row) {
        row.searchMode = item.mode || '';
        row.sourceAgencyKeyword = item.agency || '';
        row.sourceKeyword = item.keyword || '';
      });
      all = all.concat(parsed);
    } catch (err) {
      errors.push((item.mode || '') + '｜' + (item.agency || '不限機關') + '｜' + (item.keyword || '空白') + '：' + err.message);
    }
  });

  var unique = uniqueRows(all);
  var classified = classifyRows(unique, query);
  var enriched = enrichHistory(classified, query);

  return {
    ok: true,
    rows: enriched,
    searchedUrls: urls.length,
    errors: errors.slice(0, 8),
    message: '完成：查詢 ' + urls.length + ' 組，找到 ' + enriched.length + ' 筆勞務類標案'
  };
}

function debugSearch(query) {
  query = query || {};
  var urls = buildCurrentPccUrls(query).slice(0, Number(query.maxSearchUrls || 260));
  return {
    ok: true,
    backendVersion: VERSION,
    query: query,
    urls: urls,
    message: '搜尋策略：先機關單查，再標案關鍵字單查，再機關×標案關鍵字交叉查。機關空白＝不限機關。'
  };
}

function buildCurrentPccUrls(query) {
  query = query || {};
  var from = safeToRocDate(query.publishFrom || safeTodayIso());
  var to = safeToRocDate(query.publishTo || query.publishFrom || safeTodayIso());
  var agencies = splitWords(query.agencyQuery || '');
  var keywords = splitWords(query.keywordQuery || query.tenderKeywordQuery || query.tenderNameQuery || '');
  var out = [];
  var seen = {};

  function add(mode, agency, keyword) {
    agency = agency || '';
    keyword = keyword || '';
    var key = mode + '|' + agency + '|' + keyword;
    if (seen[key]) return;
    seen[key] = true;
    out.push({
      mode: mode,
      agency: agency,
      keyword: keyword,
      url: buildPccUrl({
        orgName: agency,
        tenderName: keyword,
        startDate: from,
        endDate: to,
        pageSize: '50'
      })
    });
  }

  if (agencies.length) {
    agencies.slice(0, 20).forEach(function (agency) { add('機關單查', agency, ''); });
  }
  if (keywords.length) {
    keywords.slice(0, 80).forEach(function (keyword) { add('標案名稱單查', '', keyword); });
  }
  if (agencies.length && keywords.length) {
    agencies.slice(0, 20).forEach(function (agency) {
      keywords.slice(0, 40).forEach(function (keyword) { add('機關×標案', agency, keyword); });
    });
  }
  if (!agencies.length && !keywords.length) {
    add('不限機關不限標案', '', '');
  }
  return out;
}

function buildPccUrl(opts) {
  opts = opts || {};
  var params = {
    searchType: 'basic',
    orgName: opts.orgName || '',
    tenderName: opts.tenderName || '',
    tenderType: 'TENDER_DECLARATION',
    tenderWay: 'TENDER_WAY_ALL_DECLARATION',
    dateType: 'isDate',
    tenderStartDate: opts.startDate || '',
    tenderEndDate: opts.endDate || '',
    isSpdt: 'N',
    pageSize: opts.pageSize || '50',
    firstSearch: 'true'
  };
  return PCC_BASE + '?' + Object.keys(params).map(function (k) {
    return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
  }).join('&');
}

function parsePccHtml(html, sourceUrl) {
  var rows = [];
  var table = extractTpamTable(html) || html;
  var trMatches = table.match(/<tr[\s\S]*?<\/tr>/gi) || [];

  trMatches.forEach(function (tr) {
    var rawCells = tr.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || [];
    var cells = rawCells.map(function (cell) { return cleanHtml(cell); });
    if (cells.length < 6) return;
    if (cells[0] && /序號|項次/.test(cells[0])) return;

    var category = findCategory(cells);
    if (category.indexOf('勞務') < 0) return;

    var titleCellIndex = findTitleCellIndex(rawCells);
    if (titleCellIndex < 0) titleCellIndex = 2;
    var titleTd = rawCells[titleCellIndex] || rawCells[2] || '';

    var link = extractTenderLink(tr, sourceUrl) || sourceUrl;
    var tenderNo = extractTenderNoFromSearchTitleCell(titleTd, cells[titleCellIndex] || cells[2] || '');
    var title = extractTitleFromViewButton(tr);
    if (!title) title = extractTenderTitleFromSearchTitleCell(titleTd);

    if (isBadTenderTitle(title, tenderNo)) {
      var detailTitle = fetchTenderDetailTitle(link);
      if (detailTitle) title = detailTitle;
    }
    if (!title) title = cells[titleCellIndex] || cells[2] || '';

    var agency = cells[1] || '';
    var publishDate = cells[6] || '';
    var deadline = cells[7] || '';
    var budget = cells[8] || '';

    var fullTitle = tenderNo && title && title !== tenderNo ? tenderNo + '｜' + title : (title || cells[titleCellIndex] || '');
    rows.push({
      tenderNo: tenderNo,
      title: title,
      fullTitle: fullTitle,
      agency: agency,
      publishDate: publishDate,
      deadline: deadline,
      budget: budget,
      link: link,
      summary: [cells[4] || '', category].filter(Boolean).join('｜'),
      category: category
    });
  });

  return rows.filter(function (r) { return r.agency && r.title; });
}

function findCategory(cells) {
  for (var i = 0; i < cells.length; i++) {
    if (/勞務|財物|工程/.test(cells[i])) return cells[i];
  }
  return cells[5] || '';
}

function findTitleCellIndex(rawCells) {
  for (var i = 0; i < rawCells.length; i++) {
    if (/\/prkms\/urlSelector\/common\/tpam/.test(rawCells[i])) return i;
  }
  return -1;
}

function extractTpamTable(html) {
  html = String(html || '');
  var m = html.match(/<table[^>]*id=["']?tpam["']?[^>]*>[\s\S]*?<\/table>/i);
  return m ? m[0] : '';
}

function extractTenderLink(tr, sourceUrl) {
  var m = String(tr || '').match(/href=["']([^"']*\/prkms\/urlSelector\/common\/tpam[^"']*)["']/i);
  if (!m) return '';
  var href = decodeHtml(m[1]);
  if (/^https?:\/\//i.test(href)) return href;
  if (href.charAt(0) === '/') return PCC_HOST + href;
  return PCC_HOST + '/' + href;
}

function extractTitleFromViewButton(tr) {
  tr = String(tr || '');
  var patterns = [
    /title=["']\s*檢視\s*標案名稱\s*[:：]\s*([\s\S]*?)["']/i,
    /title=["']\s*標案名稱\s*[:：]\s*([\s\S]*?)["']/i,
    /aria-label=["']\s*檢視\s*標案名稱\s*[:：]\s*([\s\S]*?)["']/i,
    /data-original-title=["']\s*檢視\s*標案名稱\s*[:：]\s*([\s\S]*?)["']/i
  ];
  for (var i = 0; i < patterns.length; i++) {
    var m = tr.match(patterns[i]);
    if (m && m[1]) {
      var title = cleanTenderTitle(decodeHtml(m[1]));
      if (looksLikeTenderTitle(title)) return title;
    }
  }
  return '';
}

function extractTenderNoFromSearchTitleCell(tdHtml, fallback) {
  tdHtml = String(tdHtml || '');
  var beforeBr = tdHtml.split(/<br\s*\/?\s*>/i)[0] || tdHtml.split(/<a\s/i)[0] || '';
  var text = cleanHtml(beforeBr).replace(/\(更正公告\)|（更正公告）|更正公告/g, ' ').trim();
  var m = text.match(/[A-Za-z0-9][A-Za-z0-9_.\-]{3,}/);
  if (m) return m[0];
  m = String(fallback || '').match(/[A-Za-z0-9][A-Za-z0-9_.\-]{3,}/);
  return m ? m[0] : '';
}

function extractTenderTitleFromSearchTitleCell(tdHtml) {
  tdHtml = String(tdHtml || '');
  var candidates = [];
  var m;
  var linkSpanRe = /<a[^>]*href=["'][^"']*\/prkms\/urlSelector\/common\/tpam[^"']*["'][^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>[\s\S]*?<\/a>/gi;
  while ((m = linkSpanRe.exec(tdHtml)) !== null) candidates.push(cleanHtml(m[1]));
  var spanRe = /<span[^>]*>([\s\S]*?)<\/span>/gi;
  while ((m = spanRe.exec(tdHtml)) !== null) {
    var spanText = cleanHtml(m[1]);
    if (!/更正公告/.test(spanText)) candidates.push(spanText);
  }
  var aRe = /<a[^>]*>([\s\S]*?)<\/a>/gi;
  while ((m = aRe.exec(tdHtml)) !== null) candidates.push(cleanHtml(m[1]));
  candidates = candidates.map(cleanTenderTitle).filter(looksLikeTenderTitle);
  candidates.sort(function (a, b) { return b.length - a.length; });
  return candidates[0] || '';
}

function fetchTenderDetailTitle(url) {
  if (!url) return '';
  try {
    var res = UrlFetchApp.fetch(url, { method: 'get', muteHttpExceptions: true, followRedirects: true, headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'zh-TW,zh;q=0.9' } });
    var html = res.getContentText('UTF-8');
    var m = html.match(/<td[^>]*id=["']tenderNameText["'][^>]*>([\s\S]*?)<\/td>/i);
    if (m && m[1]) return cleanTenderTitle(m[1]);
    m = html.match(/<td[^>]*headers=["']tb_02["'][^>]*>([\s\S]*?)<\/td>/i);
    if (m && m[1]) return cleanTenderTitle(m[1]);
    return '';
  } catch (err) { return ''; }
}

function cleanTenderTitle(s) {
  return cleanHtml(decodeHtml(s))
    .replace(/^標案名稱\s*[:：]?\s*/, '')
    .replace(/^檢視\s*標案名稱\s*[:：]?\s*/, '')
    .replace(/政府電子採購網|標案瀏覽|招標公告|決標公告|更正公告/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeTenderTitle(s) {
  s = String(s || '').trim();
  if (!s) return false;
  if (/政府電子採購網|標案瀏覽|查詢結果|檢視|連結|更正公告/.test(s)) return false;
  if (/^[A-Za-z0-9_.\-\s|｜()（）]+$/.test(s)) return false;
  return s.length >= 4;
}

function isBadTenderTitle(title, tenderNo) {
  title = String(title || '').replace(/\s+/g, '').trim();
  tenderNo = String(tenderNo || '').replace(/\s+/g, '').trim();
  if (!title) return true;
  if (tenderNo && title === tenderNo) return true;
  if (/^[A-Za-z0-9_.\-]+$/.test(title)) return true;
  if (/政府電子採購網|標案瀏覽|查詢結果/.test(title)) return true;
  return false;
}

function cleanHtml(html) {
  return decodeHtml(String(html || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function decodeHtml(s) {
  return String(s || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x([0-9a-f]+);/gi, function (_, h) { return String.fromCharCode(parseInt(h, 16)); })
    .replace(/&#(\d+);/g, function (_, d) { return String.fromCharCode(parseInt(d, 10)); });
}

function classifyRows(rows, query) {
  var keywords = splitWords(query.keywordQuery || query.tenderKeywordQuery || query.tenderNameQuery || '');
  return (rows || []).map(function (r) {
    var titleText = [r.title, r.fullTitle].join(' ');
    var allText = [r.tenderNo, r.title, r.fullTitle, r.agency, r.summary, r.sourceKeyword, r.sourceAgencyKeyword].join(' ');
    var hits = keywords.filter(function (k) { return titleText.indexOf(k) >= 0; });
    var broadHits = keywords.filter(function (k) { return allText.indexOf(k) >= 0; });
    r.matchedKeywords = hits.length ? hits : broadHits;
    r.dataStatus = '政';
    if (hits.length >= 2) r.priority = '建議關注';
    else if (hits.length === 1) r.priority = '建議關注';
    else if (broadHits.length) r.priority = '需人工確認';
    else r.priority = '低優先';
    var notes = [];
    notes.push('政府採購網自動搜尋結果，需人工確認');
    if (r.sourceAgencyKeyword) notes.push('機關關鍵字：' + r.sourceAgencyKeyword);
    if (r.sourceKeyword) notes.push('標案關鍵字：' + r.sourceKeyword);
    if (!hits.length && broadHits.length) notes.push('非標題命中，請人工判斷');
    r.notes = notes;
    return r;
  });
}

function enrichHistory(rows, query) {
  if (String(query.enableHistory || 'false') !== 'true') return rows || [];
  var years = Number(query.historyYears || 3);
  var threshold = Number(query.historyThreshold || 80);
  var windowDays = Number(query.historyWindowDays || 60);
  return (rows || []).map(function (r) {
    try {
      var best = findBestHistoryMatch(r, years, windowDays);
      if (best && best.score >= threshold) {
        r.historyScore = best.score;
        r.historyTitle = best.title;
        r.historyPublishDate = best.publishDate;
        r.historyLink = best.link;
      }
    } catch (err) {}
    return r;
  });
}

function findBestHistoryMatch(row, years, windowDays) {
  var pub = parseRocOrAdDate(row.publishDate || '');
  if (!pub) return null;
  var best = null;
  for (var y = 1; y <= years; y++) {
    var d1 = new Date(pub.getTime());
    d1.setFullYear(d1.getFullYear() - y);
    var start = new Date(d1.getTime());
    start.setDate(start.getDate() - windowDays);
    var end = new Date(d1.getTime());
    end.setDate(end.getDate() + windowDays);
    var urls = [buildPccUrl({ orgName: row.sourceAgencyKeyword || '', tenderName: row.sourceKeyword || row.title || '', startDate: dateToRoc(start), endDate: dateToRoc(end), pageSize: '50' })];
    urls.forEach(function (u) {
      try {
        var html = UrlFetchApp.fetch(u, { muteHttpExceptions: true, followRedirects: true }).getContentText('UTF-8');
        var rows = parsePccHtml(html, u);
        rows.forEach(function (h) {
          var score = similarity(row.title || row.fullTitle || '', h.title || h.fullTitle || '');
          if (!best || score > best.score) best = { score: score, title: h.title || h.fullTitle, publishDate: h.publishDate, link: h.link };
        });
      } catch (err) {}
    });
  }
  return best;
}

function similarity(a, b) {
  a = normalizeText(a); b = normalizeText(b);
  if (!a || !b) return 0;
  var gramsA = grams(a), gramsB = grams(b);
  var setA = {}, setB = {}, inter = 0, union = 0;
  gramsA.forEach(function (g) { setA[g] = true; });
  gramsB.forEach(function (g) { setB[g] = true; });
  Object.keys(setA).forEach(function (g) { if (setB[g]) inter++; union++; });
  Object.keys(setB).forEach(function (g) { if (!setA[g]) union++; });
  return Math.round((inter / Math.max(1, union)) * 100);
}

function grams(s) {
  var out = [];
  for (var i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out.length ? out : [s];
}

function normalizeText(s) {
  return String(s || '').replace(/[\s\dA-Za-z_.\-()（）【】\[\]「」『』、，,。．.]/g, '').trim();
}

function uniqueRows(rows) {
  var seen = {}, out = [];
  (rows || []).forEach(function (r) {
    var key = r.tenderNo || r.link || (r.title + '|' + r.agency);
    if (seen[key]) return;
    seen[key] = true;
    out.push(r);
  });
  return out;
}

function writeRows(rows, sheetName) {
  var ss = SpreadsheetApp.openById(getRequiredProperty('SHEET_ID'));
  var sh = ss.getSheetByName(sheetName || '每日查標') || ss.insertSheet(sheetName || '每日查標');
  var headers = ['編號', '資料狀態', '案號', '標案名稱', '完整標案名稱', '機關名稱', '公告日期', '截標日期', '預算金額', '優先度', '搜尋關鍵字', '命中關鍵字', '初步備註', '標案連結', '摘要', '歷史相似度', '歷史相似標案', '歷史相似公告日', '歷史相似連結'];
  ensureHeaders(sh, headers);
  var existing = buildExistingMap(sh);
  var inserted = 0, skipped = 0;
  (rows || []).forEach(function (r, i) {
    var key = r.tenderNo || r.link || r.fullTitle;
    if (existing[key]) { skipped++; return; }
    sh.appendRow([
      new Date(), r.dataStatus || '政', r.tenderNo || '', r.title || '', r.fullTitle || '', r.agency || '', r.publishDate || '', r.deadline || '', r.budget || '', r.priority || '',
      r.sourceKeyword || '', (r.matchedKeywords || []).join('、'), Array.isArray(r.notes) ? r.notes.join('；') : (r.notes || ''), r.link || '', r.summary || '',
      r.historyScore || '', r.historyTitle || '', r.historyPublishDate || '', r.historyLink || ''
    ]);
    existing[key] = true;
    inserted++;
  });
  return { ok: true, inserted: inserted, skipped: skipped };
}

function ensureHeaders(sh, headers) {
  if (sh.getLastRow() === 0) sh.appendRow(headers);
  else {
    var current = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), headers.length)).getValues()[0];
    var changed = false;
    headers.forEach(function (h, i) { if (current[i] !== h) changed = true; });
    if (changed) sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
}

function buildExistingMap(sh) {
  var map = {};
  var last = sh.getLastRow();
  if (last < 2) return map;
  var vals = sh.getRange(2, 3, last - 1, 3).getValues();
  vals.forEach(function (r) { if (r[0]) map[r[0]] = true; if (r[2]) map[r[2]] = true; });
  return map;
}

function dailyAutoRunWithChat() {
  var res = searchTenders({ publishFrom: safeTodayIso(), publishTo: safeTodayIso(), agencyQuery: '', keywordQuery: '', enableHistory: 'false' });
  var write = writeRows(res.rows || [], '每日查標');
  sendGoogleChatDailyReport(res.rows || [], write);
  return { ok: true, search: res, write: write };
}

function sendGoogleChatDailyReport(rows, write) {
  var url = PropertiesService.getScriptProperties().getProperty('GOOGLE_CHAT_WEBHOOK_URL');
  if (!url) return { ok: false, error: '未設定 GOOGLE_CHAT_WEBHOOK_URL' };
  var text = 'MoneyKimKim 今日查標完成\n新增：' + (write.inserted || 0) + ' 筆，略過：' + (write.skipped || 0) + ' 筆\n' + (rows || []).slice(0, 10).map(function (r, i) {
    return (i + 1) + '. ' + (r.title || r.fullTitle || '') + '｜' + (r.agency || '') + '｜' + (r.link || '');
  }).join('\n');
  UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', payload: JSON.stringify({ text: text }), muteHttpExceptions: true });
  return { ok: true };
}

function testGoogleChatNotify() {
  sendGoogleChatDailyReport([{ title: '測試標案', agency: '測試機關', link: '' }], { inserted: 1, skipped: 0 });
  return { ok: true, message: '已送出測試通知' };
}

function getRequiredProperty(key) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  if (!v) throw new Error('缺少 Script Property：' + key);
  return v;
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function splitWords(s) {
  return String(s || '').split(/[、,，\n\r\t]+/).map(function (x) { return x.trim(); }).filter(Boolean);
}

function safeTodayIso() {
  var tz = Session.getScriptTimeZone() || 'Asia/Taipei';
  return Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
}

function safeToRocDate(input) {
  var s = String(input || '').trim();
  if (!s) return '';
  var roc = s.match(/^(\d{2,3})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/);
  if (roc && Number(roc[1]) < 200) return pad3(roc[1]) + '/' + pad2(roc[2]) + '/' + pad2(roc[3]);
  var ad = s.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/);
  if (ad) return pad3(Number(ad[1]) - 1911) + '/' + pad2(ad[2]) + '/' + pad2(ad[3]);
  var d = new Date(s);
  if (!isNaN(d.getTime())) return dateToRoc(d);
  return s;
}

function dateToRoc(d) {
  var tz = Session.getScriptTimeZone() || 'Asia/Taipei';
  var y = Number(Utilities.formatDate(d, tz, 'yyyy')) - 1911;
  return pad3(y) + '/' + Utilities.formatDate(d, tz, 'MM') + '/' + Utilities.formatDate(d, tz, 'dd');
}

function parseRocOrAdDate(s) {
  s = String(s || '').trim();
  var m = s.match(/^(\d{2,4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/);
  if (!m) return null;
  var y = Number(m[1]);
  if (y < 200) y += 1911;
  return new Date(y, Number(m[2]) - 1, Number(m[3]));
}

function pad2(n) { return String(n).padStart(2, '0'); }
function pad3(n) { return String(n).padStart(3, '0'); }
