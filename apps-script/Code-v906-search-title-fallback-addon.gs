/**
 * Loop 9.0.6 search title fallback addon
 * 貼在 Code-v900.gs 最下面。
 *
 * 搜尋頁第 3 欄格式：
 *   案號 + <br> + <a href="/prkms/urlSelector/common/tpam?..."><span>標案名稱</span></a>
 *
 * 規則：
 * 1. 優先在搜尋結果頁抓 a/span 內文作為標案名稱。
 * 2. 若只抓到案號，就自動往下一層 detail 頁抓 #tenderNameText。
 */
VERSION = 'Loop 9.0.6';
UPDATED_AT = '2026-06-17 23:50';

function doGet() {
  return jsonResponse({
    ok: true,
    message: 'API 可以使用',
    backendVersion: VERSION,
    updatedAt: UPDATED_AT,
    note: '搜尋頁抓 a/span 標案名稱；若只抓到案號，自動進下一層 detail 抓 tenderNameText'
  });
}

function parsePccHtml(html, sourceUrl) {
  var rows = [];
  var table = extractTpamTable(html) || html;
  var trMatches = table.match(/<tr[\s\S]*?<\/tr>/gi) || [];

  trMatches.forEach(function (tr) {
    var rawCells = tr.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || [];
    var cells = rawCells.map(function (cell) { return cleanHtml(cell); });
    if (cells.length < 9) return;
    if (cells[0] && /序號|項次/.test(cells[0])) return;

    var category = cells[5] || '';
    if (category.indexOf('勞務') < 0) return;

    var titleCell = rawCells[2] || '';
    var link = extractTenderLink(tr, sourceUrl) || sourceUrl;
    var tenderNo = extractTenderNo906_(titleCell, cells[2] || '');
    var title = extractTenderName906_(titleCell);

    if (onlyTenderNo906_(title, tenderNo)) {
      var detailTitle = fetchDetailTitle906_(link);
      if (detailTitle) title = detailTitle;
    }

    var fullTitle = tenderNo && title ? tenderNo + '｜' + title : (title || cells[2] || '');

    rows.push({
      tenderNo: tenderNo,
      title: title || cells[2] || '',
      fullTitle: fullTitle,
      agency: cells[1] || '',
      publishDate: cells[6] || '',
      deadline: cells[7] || '',
      budget: cells[8] || '',
      link: link,
      summary: [cells[4] || '', category].filter(Boolean).join('｜'),
      category: category
    });
  });

  return rows.filter(function (r) { return r.agency && r.title; });
}

function extractTenderNo906_(rawCell, fallback) {
  var beforeA = String(rawCell || '').split(/<a\s/i)[0];
  var text = cleanHtml(beforeA).replace(/\(更正公告\)|（更正公告）|更正公告/g, ' ').trim();
  var m = text.match(/[A-Za-z0-9][A-Za-z0-9_.\-]{3,}/);
  if (m) return m[0];
  m = String(fallback || '').match(/[A-Za-z0-9][A-Za-z0-9_.\-]{3,}/);
  return m ? m[0] : '';
}

function extractTenderName906_(rawCell) {
  rawCell = String(rawCell || '');
  var candidates = [];
  var m;

  var aRe = /<a[^>]+href=["'][^"']*\/prkms\/urlSelector\/common\/tpam[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
  while ((m = aRe.exec(rawCell)) !== null) candidates.push(cleanHtml(m[1]));

  var spanRe = /<span[^>]*id=["']?\d+["']?[^>]*>([\s\S]*?)<\/span>/gi;
  while ((m = spanRe.exec(rawCell)) !== null) candidates.push(cleanHtml(m[1]));

  var anyARe = /<a[^>]*>([\s\S]*?)<\/a>/gi;
  while ((m = anyARe.exec(rawCell)) !== null) candidates.push(cleanHtml(m[1]));

  candidates = candidates.map(cleanTitle906_).filter(looksTitle906_);
  candidates.sort(function (a, b) { return b.length - a.length; });
  return candidates[0] || '';
}

function fetchDetailTitle906_(url) {
  if (!url) return '';
  try {
    var res = UrlFetchApp.fetch(url, {
      method: 'get',
      muteHttpExceptions: true,
      followRedirects: true,
      headers: {'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'zh-TW,zh;q=0.9'}
    });
    var html = res.getContentText('UTF-8');
    var m = html.match(/<td[^>]*id=["']tenderNameText["'][^>]*>([\s\S]*?)<\/td>/i);
    if (m && m[1]) return cleanTitle906_(m[1]);
    m = html.match(/<td[^>]*headers=["']tb_02["'][^>]*>([\s\S]*?)<\/td>/i);
    if (m && m[1]) return cleanTitle906_(m[1]);
    return '';
  } catch (err) {
    return '';
  }
}

function cleanTitle906_(s) {
  return cleanHtml(s)
    .replace(/^標案名稱\s*[:：]?\s*/, '')
    .replace(/政府電子採購網|標案瀏覽|招標公告|決標公告/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksTitle906_(s) {
  s = String(s || '').trim();
  if (!s) return false;
  if (/政府電子採購網|標案瀏覽|查詢結果|檢視|連結/.test(s)) return false;
  if (/^[A-Za-z0-9_.\-\s|｜()（）]+$/.test(s)) return false;
  return s.length >= 4;
}

function onlyTenderNo906_(title, tenderNo) {
  title = String(title || '').replace(/\s+/g, '').trim();
  tenderNo = String(tenderNo || '').replace(/\s+/g, '').trim();
  if (!title) return true;
  if (tenderNo && title === tenderNo) return true;
  if (/^[A-Za-z0-9_.\-]+$/.test(title)) return true;
  if (/政府電子採購網|標案瀏覽|查詢結果/.test(title)) return true;
  return false;
}
