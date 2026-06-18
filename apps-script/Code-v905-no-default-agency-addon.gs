/**
 * Loop 9.0.5 no default agency addon
 *
 * 貼在 Code-v900.gs 最下面，再貼 Code-v904-search-cell-title-addon.gs 也可以。
 * 修正：機關關鍵字空白時，不可自動改成花蓮。
 * 規則：
 * - 機關欄位空白：orgName = ''，表示不限機關。
 * - 機關欄位有填：用逗號/頓號拆開，每一個字都放進 orgName 做機關名稱關鍵字搜尋。
 * - 標案欄位有填：逐一拆標案名稱關鍵字。
 * - 標案欄位空白：tenderName = ''，只查機關關鍵字。
 */

VERSION = 'Loop 9.0.5';
UPDATED_AT = '2026-06-17 23:20';

function doGet() {
  return jsonResponse({
    ok: true,
    message: 'API 可以使用',
    backendVersion: VERSION,
    updatedAt: UPDATED_AT,
    note: '機關空白＝不限機關；機關有填＝用 orgName 做機關關鍵字搜尋，不再預設花蓮'
  });
}

function searchTenders(query) {
  query = query || {};
  var agencies = splitWords(query.agencyQuery || '');
  var urls = buildCurrentPccUrls(query, agencies);
  var maxUrls = Number(query.maxSearchUrls || 80);
  urls = urls.slice(0, maxUrls);

  var all = [];
  urls.forEach(function (item) {
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
      row.sourceKeyword = item.keyword || '';
      row.sourceAgencyKeyword = item.agency || '';
    });
    all = all.concat(parsed);
  });

  var unique = uniqueRows(all);
  var classified = classifyRows(unique, query);
  var enriched = enrichHistory(classified, query);

  return {
    ok: true,
    rows: enriched,
    searchedUrls: urls.length,
    message: '完成：查詢 ' + urls.length + ' 組，找到 ' + enriched.length + ' 筆勞務類標案'
  };
}

function debugSearch(query) {
  query = query || {};
  var agencies = splitWords(query.agencyQuery || '');
  var urls = buildCurrentPccUrls(query, agencies).slice(0, Number(query.maxSearchUrls || 80));
  return {
    ok: true,
    query: query,
    agencies: agencies.length ? agencies : ['不限機關'],
    urls: urls,
    message: '機關空白時 orgName 為空白，不會預設花蓮'
  };
}

function buildCurrentPccUrls(query, agencies) {
  query = query || {};
  var from = toRocDate(query.publishFrom || todaySheetName());
  var to = toRocDate(query.publishTo || query.publishFrom || todaySheetName());

  // 重要：沒有機關關鍵字時，用空字串，代表不限機關。
  var aList = agencies && agencies.length ? agencies : [''];

  // 重要：標案名稱關鍵字逐一搜尋；沒有標案關鍵字時，用空字串。
  var kList = splitWords(query.keywordQuery || query.tenderKeywordQuery || query.tenderNameQuery || '');
  var tenderNames = kList.length ? kList : [''];

  var out = [];
  aList.slice(0, 12).forEach(function (agency) {
    tenderNames.slice(0, 24).forEach(function (keyword) {
      out.push({
        agency: agency || '',
        keyword: keyword || '',
        url: buildPccUrl({
          orgName: agency || '',
          tenderName: keyword || '',
          startDate: from,
          endDate: to,
          pageSize: '50'
        })
      });
    });
  });
  return out;
}
