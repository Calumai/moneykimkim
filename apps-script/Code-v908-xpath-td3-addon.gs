/**
 * Loop 9.0.8 XPath td[3] addon
 *
 * 貼在 Code-v900.gs 最下面。
 * 依使用者提供 XPath：//table[@id="tpam"]/tbody[1]/tr[6]/td[3]
 * 實作方式：Apps Script 不能直接 XPath 解析 HTML，所以等價處理為：
 * 每一個 #tpam 表格列 tr 的第 3 個 td，就是案號＋標案名稱欄。
 *
 * 解析規則：
 * 1. td[3] 的 <br> 前面抓案號。
 * 2. td[3] 裡面 <a><span>...</span></a> 或 <a>...</a> 抓標案名稱。
 * 3. 如果只抓到案號，往下一層 detail 頁抓 #tenderNameText。
 */
VERSION = 'Loop 9.0.8';
UPDATED_AT = '2026-06-18 00:05';

function doGet() {
  return jsonResponse({
    ok: true,
    message: 'API 可以使用',
    backendVersion: VERSION,
    updatedAt: UPDATED_AT,
    note: '依 XPath //table[@id=tpam]/tbody/tr/td[3] 解析標案名稱；只抓案號則進 detail 補抓'
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

    // XPath 的 td[3]，JS array index 是 2
    var titleTd = rawCells[2] || '';
    var link = extractTenderLink(tr, sourceUrl) || sourceUrl;
    var tenderNo = extractTenderNoFromTd3_908(titleTd, cells[2] || '');
    var title = extractTenderTitleFromTd3_908(titleTd);

    if (isOnlyTenderNo908(title, tenderNo)) {
      var detailTitle = fetchTenderDetailTitle908(link);
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

function extractTenderNoFromTd3_908(tdHtml, fallback) {
  tdHtml = String(tdHtml || '');
  var beforeBr = tdHtml.split(/<br\s*\/?\s*>/i)[0] || tdHtml.split(/<a\s/i)[0] || '';
  var text = cleanHtml(beforeBr).replace(/\(更正公告\)|（更正公告）|更正公告/g, ' ').trim();
  var m = text.match(/[A-Za-z0-9][A-Za-z0-9_.\-]{3,}/);
  if (m) return m[0];
  m = String(fallback || '').match(/[A-Za-z0-9][A-Za-z0-9_.\-]{3,}/);
  return m ? m[0] : '';
}

function extractTenderTitleFromTd3_908(tdHtml) {
  tdHtml = String(tdHtml || '');
  var candidates = [];
  var m;

  // 最準：td[3] 裡面的 a/span 文字
  var linkSpanRe = /<a[^>]*href=["'][^"']*\/prkms\/urlSelector\/common\/tpam[^"']*["'][^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>[\s\S]*?<\/a>/gi;
  while ((m = linkSpanRe.exec(tdHtml)) !== null) candidates.push(cleanHtml(m[1]));

  // 備援：td[3] 裡所有 span 文字，但要避開更正公告
  var spanRe = /<span[^>]*>([\s\S]*?)<\/span>/gi;
  while ((m = spanRe.exec(tdHtml)) !== null) {
    var spanText = cleanHtml(m[1]);
    if (!/更正公告/.test(spanText)) candidates.push(spanText);
  }

  // 備援：td[3] 裡所有 a 文字
  var aRe = /<a[^>]*>([\s\S]*?)<\/a>/gi;
  while ((m = aRe.exec(tdHtml)) !== null) candidates.push(cleanHtml(m[1]));

  candidates = candidates.map(cleanTenderTitle908).filter(looksLikeTenderTitle908);
  candidates.sort(function (a, b) { return b.length - a.length; });
  return candidates[0] || '';
}

function fetchTenderDetailTitle908(url) {
  if (!url) return '';
  try {
    var res = UrlFetchApp.fetch(url, {
      method: 'get',
      muteHttpExceptions: true,
      followRedirects: true,
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept-Language': 'zh-TW,zh;q=0.9'
      }
    });
    var html = res.getContentText('UTF-8');
    var m = html.match(/<td[^>]*id=["']tenderNameText["'][^>]*>([\s\S]*?)<\/td>/i);
    if (m && m[1]) return cleanTenderTitle908(m[1]);
    m = html.match(/<td[^>]*headers=["']tb_02["'][^>]*>([\s\S]*?)<\/td>/i);
    if (m && m[1]) return cleanTenderTitle908(m[1]);
    return '';
  } catch (err) {
    return '';
  }
}

function cleanTenderTitle908(s) {
  return cleanHtml(s)
    .replace(/^標案名稱\s*[:：]?\s*/, '')
    .replace(/政府電子採購網|標案瀏覽|招標公告|決標公告|更正公告/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeTenderTitle908(s) {
  s = String(s || '').trim();
  if (!s) return false;
  if (/政府電子採購網|標案瀏覽|查詢結果|檢視|連結|更正公告/.test(s)) return false;
  if (/^[A-Za-z0-9_.\-\s|｜()（）]+$/.test(s)) return false;
  return s.length >= 4;
}

function isOnlyTenderNo908(title, tenderNo) {
  title = String(title || '').replace(/\s+/g, '').trim();
  tenderNo = String(tenderNo || '').replace(/\s+/g, '').trim();
  if (!title) return true;
  if (tenderNo && title === tenderNo) return true;
  if (/^[A-Za-z0-9_.\-]+$/.test(title)) return true;
  if (/政府電子採購網|標案瀏覽|查詢結果/.test(title)) return true;
  return false;
}
