/**
 * Loop 8.9.0 keyword-combo addon
 *
 * 貼在目前 Code.gs 最下面即可。
 * 建議順序：
 * 1. Code-v850.gs 主程式
 * 2. Code-v880-service-title-addon.gs 勞務類與完整標題
 * 3. Code-v890-keyword-combo-addon.gs 逐一關鍵字搜尋
 *
 * 功能：
 * - 不再只用機關查完再瞄準。
 * - 政府採購網搜尋階段會做「機關關鍵字 × 標案關鍵字」逐一查詢。
 * - 例如：花蓮 + 族語、花蓮 + 客語、花蓮 + 攝影、花蓮 + 教材……
 * - 同時保留「機關 + 空白標案名稱」作為漏網備援。
 * - 最後再交給原本 uniqueRows() 去重。
 */

var LOOP_890_VERSION = 'Loop 8.9.0';
var LOOP_890_UPDATED_AT = '2026-06-17 21:50';

function doGet() {
  return jsonResponse({
    ok: true,
    message: 'API 可以使用',
    backendVersion: LOOP_890_VERSION,
    updatedAt: LOOP_890_UPDATED_AT,
    note: '機關關鍵字 × 標案關鍵字逐一搜尋，並保留勞務類與完整標題處理'
  });
}

function buildCurrentPccUrls(query, agencies) {
  query = query || {};

  var from = toYmdSlash(query.publishFrom || todaySheetName());
  var to = toYmdSlash(query.publishTo || query.publishFrom || todaySheetName());
  var aList = agencies && agencies.length ? agencies : [''];
  var kList = splitWords(query.keywordQuery || '');

  // 安全限制，避免關鍵字太多時 GAS 跑太久。
  var maxAgency = Number(query.maxAgencySearch || 6);
  var maxKeyword = Number(query.maxKeywordSearch || 12);
  maxAgency = Math.max(1, Math.min(maxAgency, 10));
  maxKeyword = Math.max(1, Math.min(maxKeyword, 20));

  var urls = [];
  var seen = {};

  function addUrl(agency, keyword, reason) {
    var url = buildPccUrl({
      orgName: agency || '',
      tenderName: keyword || '',
      startDate: from,
      endDate: to,
      pageSize: '50'
    });
    if (!seen[url]) {
      seen[url] = true;
      urls.push(url);
    }
  }

  aList.slice(0, maxAgency).forEach(function (agency) {
    // 備援：機關全部標案查一次，避免政府採購網標題欄沒有剛好命中關鍵字而漏掉。
    addUrl(agency, '', 'agency-only');

    // 主邏輯：每一個標案關鍵字都查一次。
    kList.slice(0, maxKeyword).forEach(function (keyword) {
      addUrl(agency, keyword, 'agency-keyword');
    });
  });

  // 若沒有機關，但有關鍵字，則用全站標案關鍵字查詢。
  if ((!aList.length || (aList.length === 1 && !aList[0])) && kList.length) {
    kList.slice(0, maxKeyword).forEach(function (keyword) {
      addUrl('', keyword, 'keyword-only');
    });
  }

  return urls;
}

function buildSearchMessage(rows, debugItems) {
  if (rows.length) {
    var historical = rows.filter(function (r) { return Number(r.historyScore || 0) >= 80; }).length;
    var serviceCount = rows.filter(function (r) { return /勞務/.test([r.category, r.summary].join(' ')); }).length;
    return '搜尋完成，共找到 ' + rows.length + ' 筆；勞務類 ' + serviceCount + ' 筆；其中 ' + historical + ' 筆疑似往年出現過。搜尋方式：機關關鍵字 × 標案關鍵字逐一查詢。';
  }

  var first = debugItems[0] || {};
  var flags = [];
  flags.push(first.hasTpam ? '有 #tpam' : '沒有 #tpam');
  flags.push(first.hasTable ? '有 table' : '沒有 table');
  flags.push(first.hasTenderText ? '有標案文字' : '沒有標案文字');
  flags.push(first.hasDeadlineText ? '有截標文字' : '沒有截標文字');

  return '查詢已送出，但沒有解析到標案。' +
    ' HTTP=' + (first.httpCode || '未知') + '，' + flags.join('，') +
    '。搜尋方式：機關關鍵字 × 標案關鍵字逐一查詢。' +
    ' 第一個查詢網址：' + (first.url || '') +
    '。頁面前段：' + (first.preview || '').slice(0, 300);
}

function debugKeywordComboUrls(query) {
  query = query || {};
  var agencies = splitWords(query.agencyQuery || '花蓮');
  var urls = buildCurrentPccUrls(query, agencies);
  return {
    ok: true,
    backendVersion: LOOP_890_VERSION,
    urlCount: urls.length,
    sampleUrls: urls.slice(0, 20)
  };
}
