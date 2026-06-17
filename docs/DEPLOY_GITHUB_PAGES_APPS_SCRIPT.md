# GitHub Pages + Google Apps Script 部署說明

## 1. 部署 Google Apps Script

1. 開啟 Google Apps Script。
2. 建立新專案。
3. 將 `apps-script/Code.gs` 全部貼上。
4. 到「專案設定」新增指令碼屬性：
   - 名稱：`SCRIPT_TOKEN`
   - 值：自行設定一組內部 token
5. 部署 > 新增部署作業 > Web App。
6. 執行身分選「我」。
7. 存取權依公司需求設定。
8. 複製 Web App URL。

## 2. 準備 Google Sheet

1. 建立或打開每日招標查詢 Google Sheet。
2. 複製 Sheet ID。Sheet ID 是網址 `/d/` 與 `/edit` 中間那段。

## 3. 開啟 GitHub Pages

1. 進入 GitHub repo 設定。
2. 找到 Pages。
3. Source 選擇 Deploy from branch。
4. Branch 選擇 `main`。
5. Folder 選擇 `/public`。
6. 儲存後等待 GitHub Pages 產生網址。

## 4. 使用網站

1. 打開 GitHub Pages 網址。
2. 輸入入口密碼：`1234`。
3. 填入 Apps Script Web App URL、API Token、Google Sheet ID、分頁名稱。
4. 貼上政府採購網查詢結果。
5. 按「解析標案」。
6. 確認清單。
7. 按「寫入 Google Sheet」。

## 5. 目前不做的事

- 不自動傳群組。
- 不自動登入政府採購網。
- 不自動領標。
- 不自動付款、加值、請款。
- 不把 Google private key 放在前端。

## 6. 注意事項

前端密碼 `1234` 僅作為內部入口提示，不是正式資安機制。真正避免外部亂寫入的是 Apps Script 的 `SCRIPT_TOKEN`。
