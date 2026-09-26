// 資料層：有 Firebase 設定就用雲端即時同步，否則存在本機 localStorage。
// 兩種模式提供同樣的介面：{ mode, put(collection, doc), remove(collection, id) }
// 資料有變動時會呼叫 onChange({ recipes, orders, photos, plans, devices, meta, pantry, loaded })。

export const COLLECTIONS = ['recipes', 'orders', 'photos', 'plans', 'devices', 'meta', 'pantry'];
const FIREBASE_VERSION = '10.12.2';

export async function createStore({ firebase, kitchenId }, onChange, onError) {
  if (firebase && firebase.apiKey && kitchenId) {
    try {
      return await createFirebaseStore(firebase, kitchenId, onChange, onError);
    } catch (err) {
      console.error(err);
      onError(err);
    }
  }
  return createLocalStore(onChange);
}

export function readLocal(collection) {
  try {
    return JSON.parse(localStorage.getItem('rb.data.' + collection)) || [];
  } catch {
    return [];
  }
}

function snapshot(data, loaded) {
  return { ...Object.fromEntries(COLLECTIONS.map(c => [c, [...data[c]]])), loaded };
}

function createLocalStore(onChange) {
  const data = Object.fromEntries(COLLECTIONS.map(c => [c, readLocal(c)]));
  const emit = () => onChange(snapshot(data, true));
  const write = c => {
    localStorage.setItem('rb.data.' + c, JSON.stringify(data[c]));
    emit();
  };

  // 同一支手機開了兩個分頁時保持一致
  window.addEventListener('storage', e => {
    const c = COLLECTIONS.find(c => e.key === 'rb.data.' + c);
    if (c) {
      data[c] = readLocal(c);
      emit();
    }
  });
  queueMicrotask(emit);

  return {
    mode: 'local',
    async put(c, doc) {
      const prev = data[c];
      const i = prev.findIndex(d => d.id === doc.id);
      data[c] = i >= 0 ? prev.map(d => (d.id === doc.id ? doc : d)) : [...prev, doc];
      try {
        write(c);
      } catch (err) {
        data[c] = prev;
        throw err.name === 'QuotaExceededError' ? new Error('手機空間不夠了，試著刪掉一些照片') : err;
      }
    },
    async remove(c, id) {
      data[c] = data[c].filter(d => d.id !== id);
      write(c);
    },
  };
}

async function createFirebaseStore(config, kitchenId, onChange, onError) {
  const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
  const { initializeApp } = await import(`${base}/firebase-app.js`);
  const fs = await import(`${base}/firebase-firestore.js`);

  const app = initializeApp(config);
  let db;
  try {
    // 離線時也能看到上次的資料，恢復網路後自動同步
    db = fs.initializeFirestore(app, { localCache: fs.persistentLocalCache() });
  } catch {
    db = fs.getFirestore(app);
  }

  const data = Object.fromEntries(COLLECTIONS.map(c => [c, []]));
  const received = new Set();
  const emit = () => onChange(snapshot(data, received.size === COLLECTIONS.length));

  // 網路很慢或離線時，最多等 5 秒就先用手上的資料顯示
  setTimeout(() => {
    if (received.size === COLLECTIONS.length) return;
    COLLECTIONS.forEach(c => received.add(c));
    emit();
  }, 5000);

  for (const c of COLLECTIONS) {
    fs.onSnapshot(
      fs.collection(db, 'kitchens', kitchenId, c),
      // 空的集合從「快取」變成「雲端確認過」時內容沒變，Firestore 預設不會通知；
      // 要打開 includeMetadataChanges 才收得到，否則會一直停在「載入中」
      { includeMetadataChanges: true },
      snap => {
        data[c] = snap.docs.map(d => d.data());
        // 空的本機快取不算載入完成，避免在還沒拿到雲端資料前就以為菜單是空的
        if (!snap.metadata.fromCache || !snap.empty) received.add(c);
        emit();
      },
      err => {
        console.error(err);
        received.add(c);
        emit();
        onError(err);
      },
    );
  }

  const ref = (c, id) => fs.doc(db, 'kitchens', kitchenId, c, id);
  return {
    mode: 'firebase',
    // Firestore 不接受 undefined，先用 JSON 清乾淨
    put: (c, doc) => fs.setDoc(ref(c, doc.id), JSON.parse(JSON.stringify(doc))),
    remove: (c, id) => fs.deleteDoc(ref(c, id)),
  };
}
