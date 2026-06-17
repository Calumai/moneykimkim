/**
 * Loop 8.9.0 keyword matrix addon
 *
 * 貼在 Code.gs 最下面即可。
 * 功能：
 * 1. 政府採購網查詢改成「機關關鍵字 × 每一個標案關鍵字」逐一查詢。
 * 2. 不再只靠前端瞄準，也不把所有標案關鍵字黏成一串。
 * 3. 會額外加一組 tenderName 空白的查詢，避免漏掉未命中但仍可能相關的標案。
 * 4. 仍建議搭配 Code-v880-service-title-addon.gs：只保留勞務類、拆出完整標題。
 *
 * 建議貼上順序：
 * Code-v850.gs
 * Code-v870-google-chat-addon.gs，可選
 * Code-v880-service-title-addon.gs
 * Code-v890-keyword-matrix-addon.gs  ← 最後貼這個
 */

VERSION = 'Loop 8.9.0';
UPDATED_AT = '2026-06-17 21:50';

function doGet() {
  return jsonResponse({
    ok: true,
    message: 'API 可以使用',
    backendVersion: VERSION,
    updatedAt: UPDATED_AT,
    note: '機關關鍵字 × 每一個標案關鍵字逐一查詢；建議搭配勞務類過濾外掛'
  });
}

function buildCurrentPccUrls(query, agencies) {
  query = query || {};
  var from = toYmdSlash(query.publishFrom || todaySheetName());
  var to = toYmdSlash(query.publishTo || query.publishFrom || todaySheetName());
  var aList = (agencies && agencies.length) ? agencies : splitWords(query.agencyQuery || '花蓮');
  var kList = splitWords(query.keywordQuery || '');

  // 空白關鍵字也查一次，避免政府採購網標題寫法不同而漏掉。
  var tenderNames = [''].concat(kList);
  var urls = [];
  var seen = {};

  aList.slice(0, 8).forEach(function (agency) {
    tenderNames.slice(0, 18).forEach(function (keyword) {
      var url = buildPccUrl({
        orgName: agency,
        tenderName: keyword,
        startDate: from,
        endDate: to,
        pageSize: '50'
      });
      if (!seen[url]) {
        seen[url] = true;
        urls.push(url);
      }
    });
  });

  return urls;
}

function searchTenders(query) {
  query = query || {};

  var agencies = splitWords(query.agencyQuery || '花蓮');
  var urls = buildCurrentPccUrls(query, agencies);
  var found = [];
  var debugItems = [];
  var maxUrls = Math.max(1, Math.min(Number(query.maxSearchUrls || 80), 120));

  urls.forEach(function (url, index) {
    if (index >= maxUrls) return;
    var result = fetchTextWithDebug(url);
    debugItems.push(result.debug);
    if (result.ok) {
      parsePccHtml(result.text, url).forEach(function (row) {
        row.sourceQueryUrl = url;
        row.sourceKeyword = extractQueryParam_(url, 'tenderName');
        found.push(row);
      });
    }
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
    message: buildSearchMessageV890_(unique, debugItems, urls, maxUrls),
    rows: unique,
    checkedUrls: Math.min(urls.length, maxUrls),
    plannedUrls: urls.length,
    debug: debugItems.slice(0, 3)
  };
}

function buildSearchMessageV890_(rows, debugItems, urls, maxUrls) {
  if (rows.length) {
    var historical = rows.filter(function (r) { return Number(r.historyScore || 0) >= 80; }).length;
    return '搜尋完成，共找到 ' + rows.length + ' 筆；已逐一查詢關鍵字組合 ' + Math.min(urls.length, maxUrls) + ' 組；其中 ' + historical + ' 筆疑似往年出現過。';
  }
  var first = debugItems[0] || {};
  return '查詢已送出，但沒有解析到標案。HTTP=' + (first.httpCode || '未知') + '。已嘗試關鍵字組合 ' + Math.min(urls.length, maxUrls) + ' 組。第一個查詢網址：' + (first.url || '') + '。頁面前段：' + (first.preview || '').slice(0, 300);
}

function extractQueryParam_(url, key) {
  var re = new RegExp('[?&]' + key + '=([^&]*)');
  var m = String(url || '').match(re);
  return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : '';
}
