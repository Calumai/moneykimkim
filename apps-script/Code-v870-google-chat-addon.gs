/**
 * Loop 8.7.0 Google Chat 通知外掛
 *
 * 用法：
 * 1. 先貼上 Code-v850.gs 或目前主程式。
 * 2. 再把本檔整段貼在 Code.gs 最下面。
 * 3. Script Properties 新增 GOOGLE_CHAT_WEBHOOK_URL。
 * 4. 執行 testGoogleChatNotify() 測試通知。
 * 5. 執行 installDailyChatTrigger() 建立每天 08:00 自動查標 + 寫入 + 通知。
 *
 * 必要 Script Properties：
 * - SHEET_ID
 * - SCRIPT_TOKEN，可不填，預設 1234
 * - GOOGLE_CHAT_WEBHOOK_URL
 *
 * 選填 Script Properties：
 * - DAILY_AGENCY_QUERY
 * - DAILY_KEYWORD_QUERY
 * - DAILY_HISTORY_YEARS
 * - DAILY_HISTORY_THRESHOLD
 * - DAILY_HISTORY_WINDOW_DAYS
 */

function dailyAutoRunWithChat() {
  var result;
  try {
    result = dailyAutoRunCore_();
    sendGoogleChatDailyReport_(result);
    return result;
  } catch (err) {
    var errorResult = {
      ok: false,
      searched: 0,
      inserted: 0,
      skipped: 0,
      historical: 0,
      error: String(err && err.message ? err.message : err)
    };
    sendGoogleChatError_(errorResult.error);
    return errorResult;
  }
}

function dailyAutoRunCore_() {
  var props = PropertiesService.getScriptProperties();
  var today = todaySheetName();

  var query = {
    publishFrom: today,
    publishTo: today,
    agencyQuery: props.getProperty('DAILY_AGENCY_QUERY') || '原住民、客家、花蓮',
    keywordQuery: props.getProperty('DAILY_KEYWORD_QUERY') || '族語、客語、拍攝、攝影、教材、數位、網站、AI、影片、動畫、平台、母語、語料、文化',
    enableHistory: 'true',
    historyYears: props.getProperty('DAILY_HISTORY_YEARS') || '3',
    historyThreshold: props.getProperty('DAILY_HISTORY_THRESHOLD') || '80',
    historyWindowDays: props.getProperty('DAILY_HISTORY_WINDOW_DAYS') || '60'
  };

  var search = searchTenders(query);
  var rows = search.rows || [];
  var write = rows.length ? writeRows(rows, today) : { ok: true, inserted: 0, skipped: 0 };
  var historical = rows.filter(function (r) { return Number(r.historyScore || 0) >= 80; }).length;

  return {
    ok: true,
    date: today,
    query: query,
    searched: rows.length,
    inserted: Number(write.inserted || 0),
    skipped: Number(write.skipped || 0),
    historical: historical,
    searchMessage: search.message || '',
    sheetName: write.sheetName || today,
    topRows: rows.slice(0, 8),
    writeResult: write
  };
}

function sendGoogleChatDailyReport_(result) {
  var webhook = getGoogleChatWebhook_();
  if (!webhook) return { ok: false, error: '未設定 GOOGLE_CHAT_WEBHOOK_URL' };

  var lines = [];
  lines.push('📌 政府採購每日查標完成');
  lines.push('日期：' + (result.date || todaySheetName()));
  lines.push('搜尋筆數：' + result.searched);
  lines.push('新增寫入：' + result.inserted);
  lines.push('略過重複：' + result.skipped);
  lines.push('疑似往年標案：' + result.historical);

  if (result.topRows && result.topRows.length) {
    lines.push('');
    lines.push('前幾筆標案：');
    result.topRows.forEach(function (r, i) {
      var h = r.historyScore ? '｜往年相似 ' + r.historyScore + '%' : '';
      lines.push((i + 1) + '. [' + (r.priority || '需人工確認') + '] ' + cleanChatText_(r.title).slice(0, 80));
      lines.push('   ' + cleanChatText_(r.agency) + '｜截標：' + (r.deadline || '未填') + h);
      if (r.link) lines.push('   ' + r.link);
    });
  } else {
    lines.push('今日沒有符合條件的標案。');
  }

  return postGoogleChat_(webhook, lines.join('\n'));
}

function sendGoogleChatError_(message) {
  var webhook = getGoogleChatWebhook_();
  if (!webhook) return { ok: false, error: '未設定 GOOGLE_CHAT_WEBHOOK_URL' };
  return postGoogleChat_(webhook, '⚠️ 政府採購每日查標失敗\n' + String(message || '未知錯誤'));
}

function postGoogleChat_(webhook, text) {
  var res = UrlFetchApp.fetch(webhook, {
    method: 'post',
    contentType: 'application/json; charset=UTF-8',
    payload: JSON.stringify({ text: text }),
    muteHttpExceptions: true
  });

  return {
    ok: res.getResponseCode() >= 200 && res.getResponseCode() < 300,
    httpCode: res.getResponseCode(),
    response: res.getContentText()
  };
}

function getGoogleChatWebhook_() {
  return String(PropertiesService.getScriptProperties().getProperty('GOOGLE_CHAT_WEBHOOK_URL') || '').trim();
}

function cleanChatText_(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function testGoogleChatNotify() {
  var webhook = getGoogleChatWebhook_();
  if (!webhook) {
    return { ok: false, error: '請先在 Script Properties 設定 GOOGLE_CHAT_WEBHOOK_URL' };
  }
  return postGoogleChat_(webhook, '✅ Google Chat 通知測試成功\n政府採購每日查標工具已連接。');
}

function testDailyAutoRunWithChat() {
  return dailyAutoRunWithChat();
}

function installDailyChatTrigger() {
  removeDailyChatTrigger();
  ScriptApp.newTrigger('dailyAutoRunWithChat')
    .timeBased()
    .everyDays(1)
    .atHour(8)
    .nearMinute(0)
    .create();

  return { ok: true, message: '已建立每天早上 08:00 的 Google Chat 查標通知觸發器' };
}

function removeDailyChatTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  var removed = 0;
  triggers.forEach(function (trigger) {
    if (trigger.getHandlerFunction && trigger.getHandlerFunction() === 'dailyAutoRunWithChat') {
      ScriptApp.deleteTrigger(trigger);
      removed++;
    }
  });
  return { ok: true, removed: removed };
}
