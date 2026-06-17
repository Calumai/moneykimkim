/**
 * Loop 9.0.3 titleText addon
 *
 * 貼在 Code-v900.gs 最下面。
 * 修正重點：detail 頁標案名稱直接抓：
 * <td headers="tb_02" class="tbg_4R" id="tenderNameText">標案名稱</td>
 */

VERSION = 'Loop 9.0.3';
UPDATED_AT = '2026-06-17 22:50';

function doGet() {
  return jsonResponse({
    ok: true,
    message: 'API 可以使用',
    backendVersion: VERSION,
    updatedAt: UPDATED_AT,
    note: '標案 detail 頁改抓 #tenderNameText / headers=tb_02 / class=tbg_4R'
  });
}

function fetchTenderDetailTitle(url) {
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

    return extractTenderTitleFromDetailHtml(res.getContentText('UTF-8'));
  } catch (err) {
    return '';
  }
}

function extractTenderTitleFromDetailHtml(html) {
  html = String(html || '');

  // 最準：你提供的格式 id=tenderNameText
  var m = html.match(/<td[^>]*id=["']tenderNameText["'][^>]*>([\s\S]*?)<\/td>/i);
  if (m && m[1]) return cleanTenderTitleText(m[1]);

  // 備援：headers=tb_02
  m = html.match(/<td[^>]*headers=["']tb_02["'][^>]*>([\s\S]*?)<\/td>/i);
  if (m && m[1]) return cleanTenderTitleText(m[1]);

  // 備援：class=tbg_4R 且內容像標案名稱
  var all = html.match(/<td[^>]*class=["'][^"']*tbg_4R[^"']*["'][^>]*>[\s\S]*?<\/td>/gi) || [];
  for (var i = 0; i < all.length; i++) {
    var text = cleanTenderTitleText(all[i]);
    if (looksLikeTenderTitle(text)) return text;
  }

  return '';
}

function cleanTenderTitleText(s) {
  return cleanHtml(s)
    .replace(/^標案名稱\s*[:：]?\s*/, '')
    .replace(/政府電子採購網|標案瀏覽|招標公告|決標公告/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeTenderTitle(s) {
  s = String(s || '').trim();
  if (!s) return false;
  if (/政府電子採購網|標案瀏覽|查詢結果|檢視|連結/.test(s)) return false;
  if (/^[A-Za-z0-9_.\-\s|｜()（）]+$/.test(s)) return false;
  return /採購|委託|服務|計畫|工程|租賃|勞務|維護|建置|製作|資訊|系統|文化|教材|網站|平台|拍攝|影片|防治/.test(s) || s.length >= 8;
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
    var tenderInfo = splitTenderNoAndTitle(cells[2] || '');

    if (isOnlyTenderNo(tenderInfo.title, tenderInfo.tenderNo)) {
      var detailTitle = fetchTenderDetailTitle(link);
      if (detailTitle) tenderInfo = splitTenderNoAndTitle((tenderInfo.tenderNo ? tenderInfo.tenderNo + ' ' : '') + detailTitle);
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

function isOnlyTenderNo(title, tenderNo) {
  title = String(title || '').replace(/\s+/g, '').trim();
  tenderNo = String(tenderNo || '').replace(/\s+/g, '').trim();
  if (!title) return true;
  if (tenderNo && title === tenderNo) return true;
  if (/^[A-Za-z0-9_.\-]+$/.test(title)) return true;
  if (/政府電子採購網|標案瀏覽|查詢結果/.test(title)) return true;
  return false;
}
