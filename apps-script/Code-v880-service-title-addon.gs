/**
 * Loop 8.8.0 service/title addon
 *
 * 貼在目前 Code.gs 最下面即可。
 * 功能：
 * 1. 只保留政府採購網「勞務類」標案。
 * 2. 政府採購網第 3 欄拆出 tenderNo + 完整標案名稱。
 * 3. 強化關鍵字瞄準：命中幾個關鍵字、命中哪些字都寫進 rows。
 */

function parsePccHtml(html, sourceUrl) {
  var rows = [];
  var table = extractTpamTable(html) || html;
  var trMatches = table.match(/<tr[\s\S]*?<\/tr>/gi) || [];

  trMatches.forEach(function (tr) {
    var cells = extractCells(tr);
    if (cells.length < 9) return;
    if (cells[0] && /序號|項次/.test(cells[0])) return;

    var tenderInfo = splitTenderNoAndTitle_(cells[2] || '');
    var category = cells[5] || '';

    // 只抓勞務類。若政府採購網分類欄不是勞務，就不要放進清單。
    if (category.indexOf('勞務') < 0) return;

    var tenderMethod = cells[4] || '';
    var row = {
      tenderNo: tenderInfo.tenderNo,
      title: tenderInfo.title || cells[2] || '',
      fullTitle: tenderInfo.fullTitle || cells[2] || '',
      agency: cells[1] || '',
      publishDate: cells[6] || '',
      deadline: cells[7] || '',
      budget: cells[8] || '',
      link: extractTenderLink(tr, sourceUrl) || sourceUrl,
      summary: [tenderMethod, category].filter(Boolean).join('｜'),
      category: category
    };

    if (row.title && row.agency) rows.push(row);
  });

  return rows;
}

function splitTenderNoAndTitle_(raw) {
  var text = String(raw || '').replace(/\s+/g, ' ').trim();
  var tenderNo = '';
  var title = text;

  // 常見格式：115BB0005 標案名稱、HPCF1150006 標案名稱、115038 標案名稱
  var m = text.match(/^([A-Za-z0-9][A-Za-z0-9_.\-]{3,})\s+(.+)$/);
  if (m) {
    tenderNo = m[1];
    title = m[2];
  }

  return {
    tenderNo: tenderNo,
    title: title,
    fullTitle: tenderNo ? tenderNo + '｜' + title : title
  };
}

function classifyRows(rows, keywordText) {
  var words = splitWords(keywordText || '');

  rows.forEach(function (row) {
    var text = [row.tenderNo, row.title, row.fullTitle, row.agency, row.summary].join(' ');
    var matched = words.filter(function (w) { return w && text.indexOf(w) >= 0; });
    var notes = [];
    var priority = matched.length ? '可觀察' : '需人工確認';
    var amount = Number(String(row.budget || '').replace(/[^0-9]/g, ''));

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

function normalizeRow(row) {
  return {
    id: String(row.id || ''),
    dataStatus: String(row.dataStatus || '政府採購網自動搜尋結果'),
    title: String(row.fullTitle || row.title || ''),
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
