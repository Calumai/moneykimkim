/**
 * Loop 9.0.1 title detail addon
 *
 * 問題：政府採購網搜尋結果的第 3 欄有時只吐出案號，標案名稱沒有出現在列表 HTML。
 * 修正：如果搜尋結果只解析到案號，就進入該標案 detail/link 頁再補抓完整標案名稱。
 *
 * 使用方式：貼在 Code-v900.gs 最下面即可。
 */

VERSION = 'Loop 9.0.1';
UPDATED_AT = '2026-06-17 22:20';

function doGet() {
  return jsonResponse({
    ok: true,
    message: 'API 可以使用',
    backendVersion: VERSION,
    updatedAt: UPDATED_AT,
    note: '修正標案列表只顯示案號時，自動進 detail 頁補抓完整標案名稱'
  });
}

function parsePccHtml(html, sourceUrl) {
  var rows = [];
  var table = extractTpamTable(html) || html;
  var trMatches = table.match(/<tr[\s\S]*?<\/tr>/gi) || [];

  trMatches.forEach(function (tr) {
    var rawCells = extractRawCells_(tr);
    var cells = rawCells.map(function (cell) { return cleanHtml(cell); }).filter(function (v) { return v !== ''; });

    if (cells.length < 9) return;
    if (cells[0] && /序號|項次/.test(cells[0])) return;

    var category = cells[5] || '';
    if (category.indexOf('勞務') < 0) return;

    var rawTitleCell = rawCells[2] || '';
    var listTitle = extractTitleFromTitleCell_(rawTitleCell, cells[2] || '');
    var tenderInfo = splitTenderNoAndTitle(listTitle || cells[2] || '');
    var link = extractTenderLink(tr, sourceUrl) || sourceUrl;

    // 若搜尋列表只顯示案號，就進標案頁補抓完整名稱。
    if (isOnlyTenderNo_(tenderInfo.title, tenderInfo.tenderNo)) {
      var detailTitle = fetchTenderDetailTitle_(link);
      if (detailTitle) {
        var merged = tenderInfo.tenderNo ? tenderInfo.tenderNo + ' ' + detailTitle : detailTitle;
        tenderInfo = splitTenderNoAndTitle(merged);
      }
    }

    var row = {
      tenderNo: tenderInfo.tenderNo,
      title: tenderInfo.title || cells[2] || '',
      fullTitle: tenderInfo.fullTitle || cells[2] || '',
      agency: cells[1] || '',
      publishDate: cells[6] || '',
      deadline: cells[7] || '',
      budget: cells[8] || '',
      link: link,
      summary: [cells[4] || '', category].filter(Boolean).join('｜'),
      category: category
    };

    if (row.title && row.agency) rows.push(row);
  });

  return rows;
}

function extractRawCells_(tr) {
  return tr.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || [];
}

function extractTitleFromTitleCell_(rawCell, fallbackText) {
  var candidates = [];
  var raw = String(rawCell || '');

  // 先抓 title / aria-label 這類屬性，有些政府網頁把完整名稱放在這裡。
  var attrRe = /(?:title|aria-label|data-original-title)=["']([^"']+)["']/gi;
  var m;
  while ((m = attrRe.exec(raw)) !== null) {
    candidates.push(decodeHtmlText_(m[1]));
  }

  // 再抓 a 標籤文字。
  var aRe = /<a[^>]*>([\s\S]*?)<\/a>/gi;
  while ((m = aRe.exec(raw)) !== null) {
    candidates.push(cleanHtml(m[1]));
  }

  candidates.push(String(fallbackText || ''));

  candidates = candidates.map(function (s) {
    return cleanHtml(s).replace(/\s+/g, ' ').trim();
  }).filter(Boolean);

  // 選最長的，通常就是完整標案名稱。
  candidates.sort(function (a, b) { return b.length - a.length; });
  return candidates[0] || fallbackText || '';
}

function isOnlyTenderNo_(title, tenderNo) {
  title = String(title || '').replace(/\s+/g, '').trim();
  tenderNo = String(tenderNo || '').replace(/\s+/g, '').trim();

  if (!title) return true;
  if (tenderNo && title === tenderNo) return true;
  if (/^[A-Za-z0-9_.\-]{4,}$/.test(title)) return true;
  if (title.length <= 12 && /^[A-Za-z0-9_.\-]+$/.test(title)) return true;

  return false;
}

function fetchTenderDetailTitle_(url) {
  if (!url) return '';

  try {
    var res = UrlFetchApp.fetch(url, {
      method: 'get',
      muteHttpExceptions: true,
      followRedirects: true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8'
      }
    });

    var html = res.getContentText('UTF-8');
    return extractTenderTitleFromDetailHtml_(html);
  } catch (err) {
    return '';
  }
}

function extractTenderTitleFromDetailHtml_(html) {
  html = String(html || '');

  var patterns = [
    /標案名稱\s*<\/[^>]+>\s*<[^>]+>\s*([\s\S]{1,500}?)<\/[^>]+>/i,
    /標案名稱[\s\S]{0,80}?<td[^>]*>([\s\S]{1,500}?)<\/td>/i,
    /標案名稱[\s\S]{0,80}?<span[^>]*>([\s\S]{1,500}?)<\/span>/i,
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
    /<title[^>]*>([\s\S]{1,300}?)<\/title>/i
  ];

  for (var i = 0; i < patterns.length; i++) {
    var m = html.match(patterns[i]);
    if (m && m[1]) {
      var s = cleanHtml(m[1]);
      s = s.replace(/政府採購網|標案瀏覽|決標公告|招標公告/g, '').replace(/[｜|-]+$/g, '').trim();
      if (s && !/^[A-Za-z0-9_.\-]{4,}$/.test(s)) return s;
    }
  }

  // 最後備援：找頁面文字中的「標案名稱 xxx」
  var text = cleanHtml(html);
  var t = text.match(/標案名稱\s*([^\s].{4,120}?)(機關名稱|標案案號|招標方式|標的分類|公告日期)/);
  if (t && t[1]) return t[1].trim();

  return '';
}

function decodeHtmlText_(s) {
  return String(s || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x([0-9a-f]+);/gi, function (_, h) { return String.fromCharCode(parseInt(h, 16)); })
    .replace(/&#(\d+);/g, function (_, d) { return String.fromCharCode(parseInt(d, 10)); });
}
