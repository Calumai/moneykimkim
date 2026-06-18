/**
 * Loop 9.0.6 no default agency safe addon
 *
 * 貼在 Code-v900.gs 與 Code-v910-view-title-addon.gs 最下面。
 * 用這支取代 Code-v905-no-default-agency-addon.gs，不要再貼 905。
 *
 * 修正：
 * 1. 機關欄位空白時，不可自動改成花蓮。
 * 2. 機關欄位有填時，每個詞都用 orgName 做「機關名稱關鍵字搜尋」。
 * 3. 補上 safeToRocDate_906，避免 toRocDate is not defined。
 */

VERSION = 'Loop 9.0.6';
UPDATED_AT = '2026-06-18 00:45';

function doGet() {
  return jsonResponse({
    ok: true,
    message: 'API 可以使用',
    backendVersion: VERSION,
    updatedAt: UPDATED_AT,
    note: '機關空白＝不限機關；機關有填＝orgName 關鍵字搜尋；已修 toRocDate is not defined'
  });
}

function searchTenders(query) {
  query = query || {};
  var urls = buildCurrentPccUrls(query);
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
      row.sourceAgencyKeyword = item.agency || '';
      row.sourceKeyword = item.keyword || '';
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
  var urls = buildCurrentPccUrls(query).slice(0, Number(query.maxSearchUrls || 80));
  return {
    ok: true,
    query: query,
    urls: urls,
    message: '機關空白時 orgName 為空白，不會預設花蓮'
  };
}

function buildCurrentPccUrls(query) {
  query = query || {};

  var from = safeToRocDate_906(query.publishFrom || safeTodayIso_906());
  var to = safeToRocDate_906(query.publishTo || query.publishFrom || safeTodayIso_906());

  // 機關關鍵字：空白代表不限機關；有填就逐一放進 orgName 做模糊搜尋。
  var agencies = splitWords(query.agencyQuery || '');
  var agencyList = agencies.length ? agencies : [''];

  // 標案名稱關鍵字：逐一搜尋；空白代表不限制標案名稱。
  var keywords = splitWords(query.keywordQuery || query.tenderKeywordQuery || query.tenderNameQuery || '');
  var keywordList = keywords.length ? keywords : [''];

  var out = [];
  agencyList.slice(0, 12).forEach(function (agency) {
    keywordList.slice(0, 24).forEach(function (keyword) {
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

function safeTodayIso_906() {
  var tz = Session.getScriptTimeZone() || 'Asia/Taipei';
  return Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
}

function safeToRocDate_906(input) {
  var s = String(input || '').trim();
  if (!s) return '';

  // 已是民國格式，例如 115/06/18 或 115-06-18
  var roc = s.match(/^(\d{2,3})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/);
  if (roc && Number(roc[1]) < 200) {
    return pad3_906(roc[1]) + '/' + pad2_906(roc[2]) + '/' + pad2_906(roc[3]);
  }

  // 西元格式 yyyy-mm-dd
  var ad = s.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/);
  if (ad) {
    return pad3_906(Number(ad[1]) - 1911) + '/' + pad2_906(ad[2]) + '/' + pad2_906(ad[3]);
  }

  // Date 物件或其他可解析日期
  var d = new Date(s);
  if (!isNaN(d.getTime())) {
    var tz = Session.getScriptTimeZone() || 'Asia/Taipei';
    var y = Number(Utilities.formatDate(d, tz, 'yyyy')) - 1911;
    var m = Utilities.formatDate(d, tz, 'MM');
    var day = Utilities.formatDate(d, tz, 'dd');
    return pad3_906(y) + '/' + m + '/' + day;
  }

  return s;
}

function pad2_906(n) {
  return String(n).padStart(2, '0');
}

function pad3_906(n) {
  return String(n).padStart(3, '0');
}
