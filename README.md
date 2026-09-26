# 🍳 我們的小廚房

兩個人用的食譜本＋點餐 App。可以加到 iPhone 主畫面，用起來就像一般 App（不需要 App Store、不需要 Mac）。

- **👨‍🍳 廚師**：儲存常做的菜（照片、食材、步驟），看訂單，一步一步的「做菜模式」（做菜時螢幕不會暗掉），自動整理「買菜清單」。
- **🥰 點餐的人**：瀏覽菜單點菜（可選幾份、哪一餐、留話給廚師），新增自己「想吃」的菜，查看訂單進度。

## 檔案

| 檔案 | 用途 |
| --- | --- |
| `index.html` / `styles.css` / `app.js` | App 本體 |
| `store.js` | 資料存取（本機模式或 Firebase 雲端同步） |
| `config.js` | Firebase 設定（選填） |
| `sw.js` / `manifest.webmanifest` / `icons/` | 讓 iPhone 可以加到主畫面、離線也能開 |

沒有任何建置步驟，全部都是純 HTML/CSS/JS。

---

## 1. 把 App 放上網（GitHub Pages，免費）

1. 把這個分支合併到 `main`。
2. 到 GitHub 儲存庫 → **Settings** → **Pages**。
3. **Source** 選 **Deploy from a branch**，Branch 選 `main`、資料夾選 `/ (root)`，按 **Save**。
4. 等一兩分鐘，網址會是 `https://<你的帳號>.github.io/-app/`。

> 免費帳號的 GitHub Pages 需要儲存庫是 **Public**。如果不想公開程式碼，也可以把整個資料夾拖到 [Netlify Drop](https://app.netlify.com/drop) 或 Cloudflare Pages，一樣免費。
> （公開的只有程式碼，你們的食譜和訂單存在手機或 Firebase，不會出現在 GitHub 上。）

## 2. 加到 iPhone 主畫面

1. 用 **Safari** 打開上面的網址。
2. 點下方的 **分享** 按鈕 → **加入主畫面**。
3. 主畫面會出現「小廚房」圖示，之後從這裡打開。
4. 第一次打開選身份：你選「廚師」，女朋友選「點餐的」。

## 3. 讓兩支手機同步（Firebase，免費，約 5 分鐘）

不設定的話，App 是 **本機模式**：資料只存在各自的手機上，彼此看不到。要讓她點的餐出現在你的手機上，請設定 Firebase：

1. 到 <https://console.firebase.google.com> 用 Google 帳號登入，**新增專案**（名稱隨意，Google Analytics 可以關掉）。
2. 左側選單 **Build → Firestore Database** → **建立資料庫** → 位置選 `asia-east1`（台灣）或離你們近的 → 選 **正式版模式（production mode）**。
3. Firestore 的 **規則（Rules）** 分頁，整段換成下面這段，按 **發布**：

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /kitchens/{kitchenId}/{document=**} {
         allow read, write: if kitchenId.size() >= 14;
       }
     }
   }
   ```

   意思是：只有知道「廚房代碼」的人才能讀寫那個廚房的資料。代碼是隨機產生的，別人猜不到——不要把代碼公開貼出去就好。

4. 回到 **專案總覽**（齒輪 ⚙️ → **專案設定**）→ 下方 **你的應用程式** → 點 **`</>`（網頁）** 圖示註冊一個網頁應用程式（不用勾 Hosting）。
5. 它會顯示一段 `firebaseConfig = { apiKey: ..., ... }`，把裡面的值貼到 `config.js` 對應的欄位，commit 並推上 `main`。
6. 在你的手機打開 App → **設定** → **建立新廚房**。畫面會顯示一組像 `ab3k-9xqz-m2pt` 的代碼（你手機上原本的食譜會一起上傳）。
7. 按 **傳代碼給另一半**，用 LINE / iMessage 傳給她。
8. 她打開 App → **設定** → 輸入代碼 → **加入**。完成！之後她點的餐會即時出現在你的「訂單」頁。

> Firebase 的免費方案（Spark）每天有 5 萬次讀取、2 萬次寫入，兩個人用非常夠。

## 使用小提醒

- **照片**會自動壓縮後存起來。本機模式下手機的儲存空間有限（約數十張照片），用 Firebase 就沒這個問題。
- **備份**：設定 → 匯出備份，會存成一個 `.json` 檔；換手機時用「匯入備份」還原。
- **更新 App**：推新版本到 `main` 後，關掉 App 再打開一兩次就會拿到新版。
- 她新增的菜會標上「💕 想吃」，如果還沒有做法，廚師的菜單上會顯示「待補做法」，點進去按「編輯」補上就好。

## 在電腦上試跑

```bash
npx http-server -c-1 .
# 打開 http://localhost:8080
```
