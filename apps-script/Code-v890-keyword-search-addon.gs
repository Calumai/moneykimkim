/**
 * Loop 8.9.0 keyword-search addon
 *
 * 貼在目前 Code.gs 最下面即可。
 * 功能：
 * 1. 政府採購網搜尋時，不把全部關鍵字黏成一串。
 * 2. 會改成「機關關鍵字 × 標案關鍵字」逐一搜尋。
 * 3. 例如：花蓮+族語、花蓮+客語、花蓮+教材、花蓮+網站。
 * 4. 另外保留一次 tenderName 空白的機關搜尋，避免漏掉政府標題寫法不同的案子。
 * 5. 回傳時合併去重，並保留勞務類過濾與關鍵字瞄準。
 */

function searchTenders(query) {
  query = query || {};

  var agencies = splitWords(query.agencyQuery || '花蓮');
  var keywords = splitWords(query.keywordQuery || '');
  var urls = buildKeywordMatrixPccUrls_(query, agencies, keywords);
  var found = [];
  var debugItems = [];

  urls.forEach(function (item, index) {
    if (index >= 60) return;
    var result = fetchTextWithDebug(item.url || item);
    result.debug.searchAgency = item.agency || '';
    result.debug.searchKeyword = item.keyword || '';
    debugItems.push(result.debug);

    if (result.ok) {
      parsePccHtml(result.text, item.url || item).forEach(function (row) {
        row.searchAgency = item.agency || '';
        row.searchKeyword = item.keyword || '';
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
    message: buildKeywordMatrixSearchMessage_(unique, debugItems, urls),
    rows: unique,
    checkedUrls: urls.length,
    debug: debugItems.slice(0, 6)
  };
}

function buildKeywordMatrixPccUrls_(query, agencies, keywords) {
  var from = toYmdSlash(query.publishFrom || todaySheetName());
  var to = toYmdSlash(query.publishTo || query.publishFrom || todaySheetName());
  var aList = agencies.length ? agencies : [''];
  var kList = keywords.length ? keywords : [''];
  var out = [];
  var seen = {};

  aList.slice(0, 8).forEach(function (agency) {
    // 保留一次空白標案名稱搜尋，抓該機關全部勞務案，再由系統關鍵字瞄準。
    pushKeywordMatrixUrl_(out, seen, agency, '', from, to);

    // 每個標案關鍵字都獨立送政府採購網查一次。
    kList.slice(0, 20).forEach(function (keyword) {
      pushKeywordMatrixUrl_(out, seen, agency, keyword, from, to);
    });
  });

  return out;
}

function pushKeywordMatrixUrl_(out, seen, agency, keyword, from, to) {
  var url = buildPccUrl({
    orgName: agency || '',
    tenderName: keyword || '',
    startDate: from,
    endDate: to,
    pageSize: '50'
  });
  if (seen[url]) return;
  seen[url] = true;
  out.push({ url: url, agency: agency || '', keyword: keyword || '' });
}

function buildKeywordMatrixSearchMessage_(rows, debugItems, urls) {
  var keywordSearches = urls.filter(function (x) { return x.keyword; }).length;
  var agencyOnlySearches = urls.length - keywordSearches;

  if (rows.length) {
    var historical = rows.filter(function (r) { return Number(r.historyScore || 0) >= 80; }).length;
    return '搜尋完成，共找到 ' + rows.length + ' 筆。已逐一查詢 ' + keywordSearches + ' 組關鍵字，另含 ' + agencyOnlySearches + ' 組機關全查；疑似往年標案 ' + historical + ' 筆。';
  }

  var first = debugItems[0] || {};
  return '查詢已送出，但沒有解析到標案。已逐一查詢 ' + keywordSearches + ' 組關鍵字。HTTP=' + (first.httpCode || '未知') + '。頁面前段：' + (first.preview || '').slice(0, 300);
}

function classifyRows(rows, keywordText) {
  var words = splitWords(keywordText || '');

  rows.forEach(function (row) {
    var text = [row.tenderNo, row.title, row.fullTitle, row.agency, row.summary, row.searchKeyword].join(' ');
    var matched = words.filter(function (w) { return w && text.indexOf(w) >= 0; });
    var notes = [];
    var priority = matched.length ? '可觀察' : '需人工確認';
    var amount = Number(String(row.budget || '').replace(/[^0-9]/g, ''));

    if (row.searchKeyword) notes.push('政府採購網逐字搜尋：' + row.searchKeyword);
    if (matched.length) notes.push('關鍵字瞄準：命中 ' + matched.length + ' 個（' + matched.join('、') + '）');
    if (/勞務/.test(row.summary || row.category || '')) notes.push('標案類別：勞務類');
    if (/維運|維護/.test(text)) {
      notes.push('維運／維護類，可能已有原廠商');
      priority = '低優先';
    }
    if (/系統|資訊|網站|平台|平臺/.test(text) && amount && amount < 1000000) {
      notes.push('資訊系統類且低於 100 萬，先低優先');
      priority = '低優先';
    }
    if (!notes.length) notes.push('未命中預設關鍵字，需人工確認');

    row.matchedKeywords = matched;
    row.keywordHitCount = matched.length;
    row.keywordTargeting = matched.length ? ('命中 ' + matched.length + ' 個：' + matched.join('、')) : '未命中';
    row.notes = notes;
    row.priority = row.priority || priority;
  });

  return rows;
}
