/**
 * Loop 9.1.0 view button title addon
 *
 * 貼在 Code-v900.gs 最下面。
 *
 * 修正策略：
 * 1. 優先從搜尋結果列 tr 內的「檢視」按鈕 title 屬性抓完整標案名稱。
 *    例：title="檢視 標案名稱: 115年度優良教育人員表揚典禮場地布置及活動錄攝影服務採購"
 * 2. 再從 #tpam 每列 td[3] 的 a/span 抓標案名稱。
 * 3. 最後才進 detail 頁抓 #tenderNameText。
 *
 * 這樣可以避開 Geps3.CNS.pageCode2Img / JS 圖片化或動態轉碼問題。
 */
VERSION = 'Loop 9.1.0';
UPDATED_AT = '2026-06-18 00:20';

function doGet() {
  return jsonResponse({
    ok: true,
    message: 'API 可以使用',
    backendVersion: VERSION,
    updatedAt: UPDATED_AT,
    note: '優先從檢視按鈕 title 抓標案名稱；備援 td[3] a/span；最後 detail tenderNameText'
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

    var link = extractTenderLink(tr, sourceUrl) || sourceUrl;
    var titleTd = rawCells[2] || '';
    var tenderNo = extractTenderNoFromTd3_910(titleTd, cells[2] || '');

    // 最高優先：檢視按鈕 title 屬性
    var title = extractTitleFromViewButton910(tr);

    // 備援：td[3] 裡面的 a/span
    if (!title) title = extractTenderTitleFromTd3_910(titleTd);

    // 最後備援：只抓案號時才進 detail 頁
    if (isOnlyTenderNo910(title, tenderNo)) {
      var detailTitle = fetchTenderDetailTitle910(link);
      if (detailTitle) title = detailTitle;
    }

    if (!title) title = cells[2] || '';

    var fullTitle = tenderNo && title && title !== tenderNo
      ? tenderNo + '｜' + title
      : (title || cells[2] || '');

    rows.push({
      tenderNo: tenderNo,
      title: title,
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

function extractTitleFromViewButton910(tr) {
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
      var title = cleanTenderTitle910(decodeHtml910(m[1]));
      if (looksLikeTenderTitle910(title)) return title;
    }
  }
  return '';
}

function extractTenderNoFromTd3_910(tdHtml, fallback) {
  tdHtml = String(tdHtml || '');
  var beforeBr = tdHtml.split(/<br\s*\/?\s*>/i)[0] || tdHtml.split(/<a\s/i)[0] || '';
  var text = cleanHtml(beforeBr).replace(/\(更正公告\)|（更正公告）|更正公告/g, ' ').trim();
  var m = text.match(/[A-Za-z0-9][A-Za-z0-9_.\-]{3,}/);
  if (m) return m[0];
  m = String(fallback || '').match(/[A-Za-z0-9][A-Za-z0-9_.\-]{3,}/);
  return m ? m[0] : '';
}

function extractTenderTitleFromTd3_910(tdHtml) {
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

  candidates = candidates.map(cleanTenderTitle910).filter(looksLikeTenderTitle910);
  candidates.sort(function (a, b) { return b.length - a.length; });
  return candidates[0] || '';
}

function fetchTenderDetailTitle910(url) {
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
    if (m && m[1]) return cleanTenderTitle910(m[1]);
    m = html.match(/<td[^>]*headers=["']tb_02["'][^>]*>([\s\S]*?)<\/td>/i);
    if (m && m[1]) return cleanTenderTitle910(m[1]);
    return '';
  } catch (err) {
    return '';
  }
}

function cleanTenderTitle910(s) {
  return cleanHtml(decodeHtml910(s))
    .replace(/^標案名稱\s*[:：]?\s*/, '')
    .replace(/^檢視\s*標案名稱\s*[:：]?\s*/, '')
    .replace(/政府電子採購網|標案瀏覽|招標公告|決標公告|更正公告/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeTenderTitle910(s) {
  s = String(s || '').trim();
  if (!s) return false;
  if (/政府電子採購網|標案瀏覽|查詢結果|檢視|連結|更正公告/.test(s)) return false;
  if (/^[A-Za-z0-9_.\-\s|｜()（）]+$/.test(s)) return false;
  return s.length >= 4;
}

function isOnlyTenderNo910(title, tenderNo) {
  title = String(title || '').replace(/\s+/g, '').trim();
  tenderNo = String(tenderNo || '').replace(/\s+/g, '').trim();
  if (!title) return true;
  if (tenderNo && title === tenderNo) return true;
  if (/^[A-Za-z0-9_.\-]+$/.test(title)) return true;
  if (/政府電子採購網|標案瀏覽|查詢結果/.test(title)) return true;
  return false;
}

function decodeHtml910(s) {
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
