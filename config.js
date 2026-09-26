// 兩支手機同步設定
//
// 這裡是 Firebase 專案「cooking-app-50515」的網頁設定。
// （Firebase 的網頁設定不是密碼，放在這裡是正常做法；
//   資料的保護靠 Firestore 規則和廚房代碼，見 README。）
// 把 apiKey 清空的話，App 會回到「本機模式」。

export const CONFIG = {
  firebase: {
    apiKey: 'AIzaSyCY_9dadglR5yDDMbplEwGsV8duOdP3xVI',
    authDomain: 'cooking-app-50515.firebaseapp.com',
    projectId: 'cooking-app-50515',
    storageBucket: 'cooking-app-50515.firebasestorage.app',
    messagingSenderId: '501720692704',
    appId: '1:501720692704:web:ac8771e934eaab32f25d85',
  },

  // 新訂單通知（選填，見 README「新訂單通知」）
  // server：Cloudflare Worker 的網址；publicKey：通知用的公鑰（私鑰只放在 Worker 的 Secret）
  push: {
    server: '',
    publicKey: 'BJM13CUmw0hZVAwSN_FH_Kfzpo5Hgc5O9YzVdHNfUvWla5sim76UiKG0RKevprT-ji1IjieR7FUTKWhh9fi5C_I',
  },
};
