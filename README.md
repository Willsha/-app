# 🍳 我們的小廚房

兩個人用的食譜本＋點餐 App。可以加到 iPhone 主畫面，用起來就像一般 App（不需要 App Store、不需要 Mac）。

- **👨‍🍳 廚師**：儲存常做的菜（照片、食材、步驟），看訂單，一步一步的「做菜模式」（做菜時螢幕不會暗掉），自動整理「買菜清單」。
- **🥰 點餐的人**：瀏覽菜單點菜（可選幾份、哪一餐、留話給廚師），新增自己「想吃」的菜，查看訂單進度。
- **🎲 今天吃什麼**：選擇困難時抽一道菜，可以只抽「想吃」或「高評分」的。
- **⭐ 評分和心得**：上菜後點餐的人可以打星星、留一句話；菜單上會顯示「最愛 Top 5」和每道菜「做過幾次」。
- **📸 料理相簿**：做好菜拍一張，累積成兩個人的美食回憶；還沒有封面的菜會自動用第一張當封面。
- **✅ 做菜清單**：備料和步驟都可以一項一項打勾，進度會記住，做完一道菜後自動重設。
- **⏱️ 做菜計時器**：步驟裡寫「燉 20 分鐘」「半小時」會變成按鈕，按下去開始倒數，時間到會響。
- **📅 一週菜單**：規劃每天吃什麼；買菜清單會自動把未來 7 天要用的食材一起算進去。
- **🛒 自己加買菜項目**：加過的東西會存進「常買」，以後點一下就加入清單。
- **🏷️ 自訂分類**：在設定裡新增、改名、排序、刪除分類。
- **⚖️ 份量換算**：食譜頁和做菜模式可以調「幾人份」，食材份量自動換算（「2 顆」「1/2 杯」「三瓣」「三分之一碗」都會算；「適量」「少許」不變）。
- **🧊 家裡存貨**：在「買菜」頁切到「家裡存貨」，記錄冷藏、冷凍、常溫、調味料有什麼；買菜清單會自動扣掉家裡已經有的，買好的東西點一下就放進存貨。
- **⏰ 過期提醒**：存貨可以填到期日，快過期時菜單頁會提醒，還會列出可以用它做的菜；也可以設定每天早上發通知（見第 5 節）。
- **🔔 新訂單通知**：點餐、開始做、上菜、評分、新照片都會通知另一半的 iPhone（需要設定，見下方）。

## 檔案

| 檔案 | 用途 |
| --- | --- |
| `index.html` / `styles.css` / `app.js` | App 本體 |
| `store.js` | 資料存取（本機模式或 Firebase 雲端同步） |
| `timers.js` | 做菜計時器（從步驟文字找出時間） |
| `push.js` / `worker/push-worker.js` | 新訂單通知（App 端 / Cloudflare Worker） |
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

## 4. 新訂單通知（選填，約 10 分鐘，免費）

iPhone 要 **iOS 16.4 以上**，而且要從**主畫面的圖示**打開小廚房才收得到通知。
通知需要一個小伺服器幫忙轉送，用 Cloudflare Workers 的免費方案就夠了。

1. 到 <https://dash.cloudflare.com/sign-up> 註冊（免費）。
2. 左側選 **Workers & Pages** → **Create** → **Create Worker**（或「Start with Hello World」）→ 名稱例如 `kitchen-push` → **Deploy**。
3. 部署完按 **Edit code**，把編輯器裡的程式**全部刪掉**，換成這個儲存庫的 [`worker/push-worker.js`](worker/push-worker.js) 的內容 → **Deploy**。
4. 用手機打開 **https://willsha.github.io/-app/tools/keys.html** → **產生金鑰**。金鑰是在你手機上產生的，不會傳到任何地方。
5. 回到這個 Worker 的頁面 → **Settings** → **Variables and Secrets** → **Add**：
   - Type 選 **Secret**
   - Variable name：`VAPID_PRIVATE_JWK`
   - Value：貼上產生器的 **① 私鑰**（不要傳給別人，也不要放進 GitHub）
   - 按 **Deploy / Save**
6. 用瀏覽器打開 Worker 的網址（像 `https://kitchen-push.xxx.workers.dev`），看到「小廚房通知伺服器運作中 ✅」就成功了。
7. 把 Worker 的網址填進 `config.js` 的 `push.server`、產生器的 **② 公鑰**填進 `push.publicKey`，推上 `main`。
8. 兩支手機都打開小廚房 → 左上角 ⚙️ **設定** → **🔔 通知** → **開啟通知** → 允許。可以按「傳測試通知」試試看。

> `config.js` 裡的 `push.publicKey` 要和 Worker 的私鑰是同一組。如果要換新的金鑰，兩邊都要換，兩支手機也要重新按一次「開啟通知」。

## 5. 每天的過期提醒通知（選填，約 5 分鐘）

要先完成第 4 節的通知設定。每支手機可以在 App 的 **設定 → 🔔 通知** 裡自己選「幾點收到」，時間跟著手機所在地的時區（出國、搬家會自動調整）。

1. 把 Cloudflare Worker 的程式**換成最新版**：打開 Worker → **Edit code** → 全部刪掉，貼上 [`worker/push-worker.js`](worker/push-worker.js) 的最新內容 → **Deploy**。
   如果編輯器顯示「Only the latest version of your Worker can be edited」，就從上方的版本選單選最新的版本。
2. Worker 的 **Settings → Variables and Secrets** → **Add**：Key 填 `KITCHEN_ID`，Value 填你們的**廚房代碼**（App 設定頁看得到），**勾 Secret** → **Add variable and deploy**。
   （可選）`TIMEZONE`：舊版 App 沒回報時區的手機用這個時區，例如 `Europe/London`。
3. Worker 的 **Settings → Trigger Events** → **Add** → **Cron Triggers** → 填 `0 * * * *`（**每小時**執行一次）→ 儲存。
   Worker 每到整點會檢查「現在剛好是誰的提醒時間」，只通知那支手機。
4. 測試：App 的「家裡存貨」頁最下面按**現在檢查一次試試**。有快過期的東西的話，所有開了通知的手機都會馬上收到。

## 使用小提醒

- **照片**會自動壓縮後存起來。本機模式下手機的儲存空間有限（約數十張照片），用 Firebase 就沒這個問題。
- **備份**：設定 → 匯出備份，會存成一個 `.json` 檔；換手機時用「匯入備份」還原。
- **更新 App**：推新版本到 `main` 後，把 App 關掉再打開就會拿到新版（圖示要刪掉重新加入主畫面才會換）。
- **設定**在菜單頁左上角的 ⚙️。
- 她新增的菜會標上「💕 想吃」，如果還沒有做法，廚師的菜單上會顯示「待補做法」，點進去按「編輯」補上就好。

## 在電腦上試跑

```bash
npx http-server -c-1 .
# 打開 http://localhost:8080
```
