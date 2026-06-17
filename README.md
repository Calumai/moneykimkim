# moneykimkim

政府採購每日查標整理 MVP。

## 功能

- 人工貼上政府採購網查詢結果
- 支援表格格式與欄位格式
- 關鍵字命中與初步分類
- 產生每日標案清單
- 產生可複製的群組回報文字
- 透過 Google Apps Script 寫入 Google Sheet

## 不做

- 不自動傳群組
- 不自動登入政府採購網
- 不自動領標
- 不自動付款、加值、請款
- 不把 Google private key 放在前端

## 使用

1. 部署 `apps-script/Code.gs` 到 Google Apps Script。
2. 設定 Apps Script 的 `SCRIPT_TOKEN`。
3. 開啟 GitHub Pages。
4. 打開網站，輸入密碼 `1234`。
5. 填入 Apps Script URL、Token、Google Sheet ID。
6. 貼上標案資料並寫入 Google Sheet。
