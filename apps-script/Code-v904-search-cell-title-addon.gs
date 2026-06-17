/**
 * Loop 9.0.4 search cell title addon
 *
 * 貼在 Code-v900.gs 最下面。
 * 修正搜尋結果頁標案名稱位置：
 * <a href="/prkms/urlSelector/common/tpam?...">
 *   <u><span id="1">完整標案名稱</span></u>
 * </a>
 */

VERSION = 'Loop 9.0.4';
UPDATED_AT = '2026-06-17 23:00';

function doGet() {
  return jsonResponse({
    ok: true,
    message: 'API 可以使用',
    backendVersion: VERSION,
    updatedAt: UPDATED_AT,
    note: '搜尋列表標案名稱改抓 a/u/span 內文字；detail 頁備援抓 tenderNameText'
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

    var titleCellRaw = rawCells[2] || '';
    var link = extractTenderLink(tr, sourceUrl) || sourceUrl;
    var tenderNo = extractTenderNoFromTitleCell(titleCellRaw, cells[2] || '');
    var title = extractTenderNameFromSearchCell(titleCellRaw);

    if (!title || title === tenderNo) {
      title = fetchTenderDetailTitle904(link);
    }

    var fullTitle = tenderNo && title ? tenderNo + '｜' + title : (title || cells[2] || '');

    var row = {
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
    };

    if (row.title && row.agency) rows.push(row);
  });

  return rows;
}

function extractTenderNoFromTitleCell(rawCell, fallbackText) {
  var cell = String(rawCell || '');

  // 移除 a 裡面的標案名稱，只看前面的案號文字
  var beforeA = cell.split(/<a\s/i)[0] || cell;
  var text = cleanHtml(beforeA).replace(/\(更正公告\)|（更正公告）|更正公告/g, '').trim();
  var m = text.match(/[A-Za-z0-9][A-Za-z0-9_.\-]{3,}/);
  if (m) return m[0];

  m = String(fallbackText || '').match(/[A-Za-z0-9][A-Za-z0-9_.\-]{3,}/);
  return m ? m[0] : '';
}

function extractTenderNameFromSearchCell(rawCell) {
  var raw = String(rawCell || '');
  var candidates = [];
  var m;

  // 最準：a href=/prkms/urlSelector/common/tpam 內的文字
  var aRe = /<a[^>]+href=["'][^"']*\/prkms\/urlSelector\/common\/tpam[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
  while ((m = aRe.exec(raw)) !== null) {
    candidates.push(cleanHtml(m[1]));
  }

  // 你提供的格式：a 裡的 span id="1"
  var spanRe = /<span[^>]*id=["']?\d+["']?[^>]*>([\s\S]*?)<\/span>/gi;
  while ((m = spanRe.exec(raw)) !== null) {
    candidates.push(cleanHtml(m[1]));
  }

  // 備援：所有 a 文字
  var anyARe = /<a[^>]*>([\s\S]*?)<\/a>/gi;
  while ((m = anyARe.exec(raw)) !== null) {
    candidates.push(cleanHtml(m[1]));
  }

  candidates = candidates.map(function (s) {
    return cleanTenderTitle904(s);
  }).filter(function (s) {
    return looksLikeTenderTitle904(s);
  });

  candidates.sort(function (a, b) { return b.length - a.length; });
  return candidates[0] || '';
}

function fetchTenderDetailTitle904(url) {
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
    var m = html.match(/<td[^>]*id=["']tenderNameText["'][^>]*>([\s\S]*?)<\/td>/i);
    if (m && m[1]) return cleanTenderTitle904(m[1]);
    m = html.match(/<td[^>]*headers=["']tb_02["'][^>]*>([\s\S]*?)<\/td>/i);
    if (m && m[1]) return cleanTenderTitle904(m[1]);
    return '';
  } catch (err) {
    return '';
  }
}

function cleanTenderTitle904(s) {
  return cleanHtml(s)
    .replace(/^標案名稱\s*[:：]?\s*/, '')
    .replace(/政府電子採購網|標案瀏覽|招標公告|決標公告/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeTenderTitle904(s) {
  s = String(s || '').trim();
  if (!s) return false;
  if (/政府電子採購網|標案瀏覽|查詢結果|檢視|連結/.test(s)) return false;
  if (/^[A-Za-z0-9_.\-\s|｜()（）]+$/.test(s)) return false;
  if (s.length < 4) return false;
  return true;
}
