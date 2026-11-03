/* =========================================================
   RayFin — inicio de sesión y base de datos (Firebase)
   Solo se activa si firebase-config.js tiene la configuración.

   Estructura en Firestore:
     users/{uid}                       → ajustes, cuentas, categorías y metas
     users/{uid}/transactions/{txId}   → un documento por movimiento
   ========================================================= */

const FIREBASE_VERSION = '10.14.1';
const App = window.App;
const $ = sel => document.querySelector(sel);

if (App && App.CLOUD_ENABLED) {
  init().catch(err => {
    console.error(err);
    showScreen('error', 'No se pudo conectar con el servidor. Revisa tu conexión a internet y vuelve a intentarlo.');
  });
}

/* ---------- Pantalla de acceso ---------- */

const opts = { allowSignup: true, googleLogin: true, ...(window.APP_OPTIONS || {}) };

function showScreen(kind, message = '') {
  const screen = $('#authScreen');
  screen.hidden = false;
  document.body.classList.add('auth-mode');
  $('#authLoading').hidden = kind !== 'loading' && kind !== 'error';
  $('#authLoadingText').textContent = message || 'Cargando…';
  $('#authRetry').hidden = kind !== 'error';
  $('#authPanel').hidden = kind !== 'login';
  if (kind === 'login') authMsg(message, 'bad');
}

function hideScreen() {
  $('#authScreen').hidden = true;
}

function authMsg(text, cls = 'bad') {
  const el = $('#authMsg');
  el.textContent = text || '';
  el.className = 'auth-msg ' + cls;
}

const ERRORS = {
  'auth/invalid-credential': 'Correo o contraseña incorrectos.',
  'auth/invalid-login-credentials': 'Correo o contraseña incorrectos.',
  'auth/wrong-password': 'Correo o contraseña incorrectos.',
  'auth/user-not-found': 'No existe una cuenta con ese correo.',
  'auth/email-already-in-use': 'Ya existe una cuenta con ese correo. Prueba a entrar.',
  'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres.',
  'auth/invalid-email': 'El correo no es válido.',
  'auth/missing-password': 'Escribe tu contraseña.',
  'auth/too-many-requests': 'Demasiados intentos. Espera unos minutos.',
  'auth/network-request-failed': 'Sin conexión a internet.',
  'auth/user-disabled': 'Esta cuenta fue desactivada.',
  'auth/operation-not-allowed': 'Este método de acceso no está activado en Firebase (Authentication → Sign-in method).',
  'auth/unauthorized-domain': 'Este sitio no está autorizado en Firebase (Authentication → Settings → Authorized domains).',
  'auth/admin-restricted-operation': 'El registro de cuentas nuevas está desactivado.',
  'permission-denied': 'Tu cuenta no tiene permiso para usar esta app. Pide acceso al administrador.',
  'unavailable': 'Sin conexión con el servidor. Revisa tu internet.'
};
const errorText = e => ERRORS[e?.code] || 'Ocurrió un error: ' + (e?.message || e);

/* ---------- Inicio ---------- */

async function init() {
  showScreen('loading', 'Conectando…');
  const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
  const [{ initializeApp }, A, F] = await Promise.all([
    import(`${base}/firebase-app.js`),
    import(`${base}/firebase-auth.js`),
    import(`${base}/firebase-firestore.js`)
  ]);

  const config = App.EMULATOR
    ? { apiKey: 'demo-key', authDomain: 'localhost', projectId: 'demo-finanzas' }
    : window.FIREBASE_CONFIG;
  const app = initializeApp(config);
  const auth = A.getAuth(app);
  auth.languageCode = 'es';

  let db;
  try {
    db = F.initializeFirestore(app, {
      ignoreUndefinedProperties: true,
      localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() })
    });
  } catch {
    db = F.initializeFirestore(app, { ignoreUndefinedProperties: true });
  }
  if (App.EMULATOR) {
    A.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    F.connectFirestoreEmulator(db, '127.0.0.1', 8080);
  }

  setupForm(A, auth);

  let session = null;
  A.getRedirectResult(auth).catch(e => authMsg(errorText(e)));
  A.onAuthStateChanged(auth, async user => {
    if (session) { session.stop(); session = null; }
    if (!user) { window.Cloud = null; showScreen('login'); return; }
    session = await startSession(A, F, auth, db, user);
  });
}

/* ---------- Formulario ---------- */

function setupForm(A, auth) {
  const form = $('#authForm');
  let mode = 'login';

  const setMode = m => {
    mode = m;
    $('#authSubmit').textContent = m === 'login' ? 'Entrar' : 'Crear cuenta';
    $('#authToggle').textContent = m === 'login' ? '¿No tienes cuenta? Crear una' : '¿Ya tienes cuenta? Entrar';
    $('#authTitle').textContent = m === 'login' ? 'Inicia sesión para ver tus finanzas' : 'Crea tu cuenta';
    $('#nameField').hidden = m === 'login';
    $('#authReset').hidden = m !== 'login';
    form.password.autocomplete = m === 'login' ? 'current-password' : 'new-password';
    authMsg('');
  };
  setMode('login');

  $('#authToggle').hidden = !opts.allowSignup;
  $('#authGoogleWrap').hidden = !opts.googleLogin;

  const busy = on => $$('#authPanel button').forEach(b => { b.disabled = on; });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const email = form.email.value.trim();
    const password = form.password.value;
    busy(true);
    authMsg('');
    try {
      if (mode === 'login') {
        await A.signInWithEmailAndPassword(auth, email, password);
      } else {
        const cred = await A.createUserWithEmailAndPassword(auth, email, password);
        const name = form.name.value.trim();
        if (name) await A.updateProfile(cred.user, { displayName: name });
      }
      form.password.value = '';
    } catch (err) {
      authMsg(errorText(err));
    } finally {
      busy(false);
    }
  });

  $('#authToggle').addEventListener('click', () => setMode(mode === 'login' ? 'signup' : 'login'));

  $('#authReset').addEventListener('click', async () => {
    const email = form.email.value.trim();
    if (!email) { authMsg('Escribe tu correo arriba y vuelve a tocar "Olvidé mi contraseña".'); form.email.focus(); return; }
    try {
      await A.sendPasswordResetEmail(auth, email);
      authMsg('Te enviamos un correo para restablecer tu contraseña. Revisa también la carpeta de spam.', 'ok');
    } catch (err) {
      authMsg(errorText(err));
    }
  });

  $('#authGoogle').addEventListener('click', async () => {
    const provider = new A.GoogleAuthProvider();
    busy(true);
    try {
      await A.signInWithPopup(auth, provider);
    } catch (err) {
      if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/cancelled-popup-request'].includes(err.code)) {
        await A.signInWithRedirect(auth, provider);
      } else if (err.code !== 'auth/popup-closed-by-user') {
        authMsg(errorText(err));
      }
    } finally {
      busy(false);
    }
  });

  $('#authRetry').addEventListener('click', () => location.reload());
}

function $$(sel) { return [...document.querySelectorAll(sel)]; }

/* ---------- Sesión y sincronización ---------- */

/*
  Fuentes de datos ("libros"):
    personal        → users/{uid}               (+ /transactions)   editable
    space:{id}      → spaces/{id}               (+ /transactions)   editable por sus miembros
    user:{uid}      → users/{uid de otra persona}                   solo lectura, si esa persona lo comparte
  Compartir lo personal: cada quien controla su propio campo `viewers` (uids que pueden leer)
  a partir de `shareSpaces` (espacios con cuyos miembros decidió compartir).
*/

const firstName = s => String(s || '').trim().split(/\s+/)[0] || '';

async function startSession(A, F, auth, db, user) {
  showScreen('loading', 'Cargando tus datos…');
  const me = user.uid;
  const myEmail = (user.email || '').toLowerCase();
  // El nombre puede guardarse un instante después de crear la cuenta: se lee en el momento.
  const nameNow = () => auth.currentUser?.displayName || user.displayName || myEmail.split('@')[0] || 'Yo';
  const myName = nameNow();
  const userRef = F.doc(db, 'users', me);
  const unsubs = [];
  let stopped = false;

  const refs = key => {
    if (key === 'personal') return { meta: userRef, col: F.collection(userRef, 'transactions'), kind: 'personal' };
    if (key.startsWith('space:')) {
      const ref = F.doc(db, 'spaces', key.slice(6));
      return { meta: ref, col: F.collection(ref, 'transactions'), kind: 'space' };
    }
    throw Object.assign(new Error('Solo lectura'), { code: 'read-only' });
  };

  const ledgerOf = s => ({
    version: s.version || 1,
    settings: s.settings,
    categories: s.categories,
    accounts: s.accounts,
    goals: s.goals,
    recurring: s.recurring || [],
    debts: s.debts || [],
    updatedAt: F.serverTimestamp()
  });
  const metaOf = (key, s) => key === 'personal'
    ? { ...ledgerOf(s), owner: { email: user.email || '', name: nameNow() } }
    : ledgerOf(s);

  async function replaceAll(key, s) {
    const { meta, col } = refs(key);
    const existing = await F.getDocs(col);
    const keep = new Set(s.transactions.map(t => t.id));
    const ops = [
      ...existing.docs.filter(d => !keep.has(d.id)).map(d => b => b.delete(d.ref)),
      ...s.transactions.map(t => b => b.set(F.doc(col, t.id), t)),
      b => b.set(meta, metaOf(key, s), { merge: true })
    ];
    for (let i = 0; i < ops.length; i += 400) {
      const batch = F.writeBatch(db);
      ops.slice(i, i + 400).forEach(op => op(batch));
      await batch.commit();
    }
  }

  // Primera vez: crear los datos de la cuenta (y ofrecer subir los datos locales)
  try {
    const snap = await F.getDoc(userRef);
    if (!snap.exists()) {
      let initial = App.defaultState();
      const local = App.readLocal();
      const n = local?.transactions?.length || 0;
      if (n && confirm(`Encontramos ${n} movimientos guardados en este dispositivo.\n¿Quieres subirlos a tu cuenta?`)) {
        initial = local;
        App.clearLocal();
      }
      await replaceAll('personal', initial);
    }
  } catch (err) {
    console.error(err);
    await A.signOut(auth).catch(() => {});
    showScreen('login', errorText(err));
    return { stop() {} };
  }

  /* ---- Escuchar un libro (documento + movimientos) ---- */
  function watchLedger(metaRef, col, { onData, onError, onMeta }) {
    let meta = null, txs = null, metaPending = false, txPending = false, ready = false, lastSig = '', dead = false;
    const emit = () => {
      if (dead || stopped || !meta || !txs) return;
      // Mientras haya cambios propios sin confirmar, la pantalla ya los muestra.
      if (ready && (metaPending || txPending)) return;
      const data = { ...meta, transactions: txs };
      const sig = JSON.stringify(data, (k, v) => ['updatedAt', 'owner', 'viewers', 'shareSpaces', 'members', 'memberInfo', 'invitedEmails', 'sharedPersonal'].includes(k) ? undefined : v);
      ready = true;
      if (sig !== lastSig) { lastSig = sig; onData(data); }
    };
    let u1 = () => {}, u2 = () => {};
    const fail = err => { if (!dead) { dead = true; u1(); u2(); onError && onError(err); } };
    u1 = F.onSnapshot(metaRef, { includeMetadataChanges: true }, s => {
      if (!s.exists()) { meta = null; return; }
      meta = s.data();
      metaPending = s.metadata.hasPendingWrites;
      onMeta && onMeta(meta);
      emit();
    }, fail);
    u2 = F.onSnapshot(col, { includeMetadataChanges: true }, s => {
      txs = s.docs.map(d => ({ ...d.data(), id: d.id }));
      txPending = s.metadata.hasPendingWrites;
      emit();
    }, fail);
    return () => { dead = true; u1(); u2(); };
  }

  const onErr = err => { console.error(err); App.toast('⚠️ ' + errorText(err)); };
  // Lo compartido es opcional: si las reglas de Firebase aún no están actualizadas, no molestar.
  const quiet = what => err => console.warn('Compartir no disponible (' + what + '):', err?.code || err);

  /* ---- Estado de lo compartido ---- */
  let myMeta = {};               // mi documento (incluye viewers y shareSpaces)
  let spaces = new Map();        // id → datos del espacio
  let invites = [];              // espacios a los que me invitaron
  const spaceWatchers = new Map();   // id → stop
  const partnerWatchers = new Map(); // uid → { stop, status, name }

  function publish() {
    if (stopped) return;
    const people = new Map();
    for (const sp of spaces.values()) {
      for (const uid of sp.members || []) {
        if (uid === me) continue;
        const info = (sp.memberInfo || {})[uid] || {};
        if (!people.has(uid)) people.set(uid, info);
      }
    }
    App.setSharing({
      me: { uid: me, name: nameNow(), email: myEmail },
      spaces: [...spaces.entries()].map(([id, sp]) => ({
        id,
        name: sp.name || 'Compartido',
        members: (sp.members || []).map(uid => ({ uid, me: uid === me, ...((sp.memberInfo || {})[uid] || {}) })),
        invitedEmails: sp.invitedEmails || [],
        iShare: (myMeta.shareSpaces || []).includes(id)
      })),
      invites: invites.map(sp => {
        const from = (sp.memberInfo || {})[sp.createdBy] || {};
        return { id: sp.id, name: sp.name || 'Compartido', from: from.name || from.email || 'Alguien' };
      }),
      partners: [...people.entries()].map(([uid, info]) => ({
        uid, name: info.name || info.email || 'Integrante', email: info.email || '',
        status: partnerWatchers.get(uid)?.status || 'loading'
      }))
    });
  }

  // Avisa a los integrantes que cambió el permiso para que vuelvan a intentar ver mis finanzas.
  const touchSpaces = ids => Promise.all(ids.filter(id => spaces.has(id)).map(id =>
    F.updateDoc(F.doc(db, 'spaces', id), { [`sharedAt.${me}`]: F.serverTimestamp() }).catch(() => {})));

  // Quiénes pueden leer mis finanzas personales: integrantes de los espacios que elegí.
  async function viewersFor(shareList) {
    const want = new Set();
    for (const id of shareList) {
      let sp = spaces.get(id);
      if (!sp) { try { sp = (await F.getDoc(F.doc(db, 'spaces', id))).data(); } catch { sp = null; } }
      (sp?.members || []).forEach(u => u !== me && want.add(u));
    }
    return [...want];
  }

  // Mantiene `viewers` al día cuando alguien entra o sale de un espacio (solo lo modifica su dueño).
  let syncing = false;
  async function syncViewers() {
    if (syncing) return;
    const shareList = myMeta.shareSpaces || [];
    const want = await viewersFor(shareList);
    const have = new Set(myMeta.viewers || []);
    if (want.length === have.size && want.every(u => have.has(u))) return;
    syncing = true;
    try {
      await F.setDoc(userRef, { viewers: want }, { merge: true });
      await touchSpaces(shareList);
    } catch (e) { onErr(e); } finally { syncing = false; }
  }

  // Finanzas personales de otra persona (solo lectura). Primero se confirma con el servidor
  // que hay permiso y solo entonces se escucha; si no lo hay, se espera el aviso (sharedAt).
  function watchPartner(uid, name) {
    const cur = partnerWatchers.get(uid);
    if (cur && (cur.status === 'ok' || cur.status === 'connecting')) return;
    if (cur && cur.checking) { cur.again = true; return; }
    const entry = cur || { status: 'loading', name, stop: () => {} };
    partnerWatchers.set(uid, entry);
    entry.checking = true;
    entry.again = false;
    const pref = F.doc(db, 'users', uid);
    F.getDocFromServer(pref).then(() => {
      entry.checking = false;
      if (stopped || partnerWatchers.get(uid) !== entry) return;
      entry.stop();
      entry.status = 'connecting';
      entry.stop = watchLedger(pref, F.collection(pref, 'transactions'), {
        onData: data => { entry.status = 'ok'; App.setStore('user:' + uid, data); publish(); },
        onError: () => { entry.status = 'denied'; App.dropStore('user:' + uid); publish(); }
      });
    }, err => {
      entry.checking = false;
      if (stopped || partnerWatchers.get(uid) !== entry) return;
      entry.status = err?.code === 'permission-denied' ? 'denied' : 'error';
      App.dropStore('user:' + uid);
      publish();
      if (entry.again) watchPartner(uid, name);
    });
  }

  function refreshPartners() {
    const wanted = new Map();
    for (const sp of spaces.values()) for (const uid of sp.members || []) {
      if (uid !== me) wanted.set(uid, ((sp.memberInfo || {})[uid] || {}).name);
    }
    for (const [uid, w] of partnerWatchers) {
      if (!wanted.has(uid)) { w.stop(); partnerWatchers.delete(uid); App.dropStore('user:' + uid); }
    }
    for (const [uid, name] of wanted) watchPartner(uid, name); // reintenta si antes no tenía permiso
  }

  // Mis finanzas personales
  let entered = false;
  unsubs.push(watchLedger(userRef, F.collection(userRef, 'transactions'), {
    onMeta: m => { myMeta = m || {}; syncViewers(); },
    onData: data => {
      App.setStore('personal', data);
      if (!entered) { entered = true; hideScreen(); App.enter(); }
    },
    onError: onErr
  }));

  // Espacios donde soy miembro
  unsubs.push(F.onSnapshot(F.query(F.collection(db, 'spaces'), F.where('members', 'array-contains', me)), { includeMetadataChanges: true }, snap => {
    const next = new Map();
    // Solo espacios ya confirmados por el servidor (uno recién creado aparece primero solo en este dispositivo)
    snap.docs.forEach(d => { if (!d.metadata.hasPendingWrites || spaces.has(d.id)) next.set(d.id, d.data()); });
    for (const [id, stop] of spaceWatchers) {
      if (!next.has(id)) { stop(); spaceWatchers.delete(id); App.dropStore('space:' + id); }
    }
    for (const id of next.keys()) {
      if (spaceWatchers.has(id)) continue;
      const ref = F.doc(db, 'spaces', id);
      spaceWatchers.set(id, watchLedger(ref, F.collection(ref, 'transactions'), {
        onData: data => App.setStore('space:' + id, data),
        // Si falla (p. ej. justo al unirse), se vuelve a intentar con el próximo cambio
        onError: err => { console.warn('espacio', id, err?.code); spaceWatchers.delete(id); }
      }));
    }
    spaces = next;
    refreshPartners();
    syncViewers();
    publish();
  }, quiet('espacios')));

  // Invitaciones recibidas
  if (myEmail) {
    unsubs.push(F.onSnapshot(F.query(F.collection(db, 'spaces'), F.where('invitedEmails', 'array-contains', myEmail)), snap => {
      invites = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(sp => !(sp.members || []).includes(me));
      publish();
    }, quiet('invitaciones')));
  }

  /* ---- Acciones de compartir ---- */
  const memberInfo = () => ({ name: nameNow(), email: myEmail });
  const cleanEmail = e => String(e || '').trim().toLowerCase();

  async function setShare(spaceId, on) {
    const list = new Set(myMeta.shareSpaces || []);
    on ? list.add(spaceId) : list.delete(spaceId);
    // Primero el permiso, luego el aviso (así los demás ya pueden leer cuando reintentan)
    const viewers = await viewersFor([...list]);
    await F.setDoc(userRef, { shareSpaces: [...list], viewers }, { merge: true });
    await F.updateDoc(F.doc(db, 'spaces', spaceId), { [`sharedPersonal.${me}`]: on, [`sharedAt.${me}`]: F.serverTimestamp() });
  }

  window.Cloud = {
    user,
    get uid() { return me; },
    get myName() { return nameNow(); },
    // Diagnóstico: estado de las conexiones con lo compartido
    get debug() {
      return {
        spaces: [...spaces.keys()],
        watching: [...spaceWatchers.keys()],
        partners: [...partnerWatchers].map(([uid, w]) => ({ uid, status: w.status, checking: !!w.checking }))
      };
    },
    saveMeta: (key, s) => F.setDoc(refs(key).meta, metaOf(key, s), { merge: true }),
    putTx: (key, tx) => F.setDoc(F.doc(refs(key).col, tx.id), tx),
    delTx: (key, id) => F.deleteDoc(F.doc(refs(key).col, id)),
    replaceAll,

    async createSpace({ name, email, share }) {
      const base = App.defaultState();
      base.accounts = [{ id: Math.random().toString(36).slice(2, 10), name: 'Cuenta conjunta', initial: 0 },
        { id: Math.random().toString(36).slice(2, 10), name: 'Efectivo', initial: 0 }];
      base.goals = [];
      base.settings = { ...base.settings, ...(App.stores.personal?.settings || {}) };
      const ref = await F.addDoc(F.collection(db, 'spaces'), {
        name: name || 'Casa',
        createdBy: me,
        members: [me],
        memberInfo: { [me]: memberInfo() },
        invitedEmails: email ? [cleanEmail(email)] : [],
        sharedPersonal: { [me]: !!share },
        ...ledgerOf(base)
      });
      if (share) await setShare(ref.id, true);
      return ref.id;
    },
    invite: (spaceId, email) => F.updateDoc(F.doc(db, 'spaces', spaceId), { invitedEmails: F.arrayUnion(cleanEmail(email)) }),
    cancelInvite: (spaceId, email) => F.updateDoc(F.doc(db, 'spaces', spaceId), { invitedEmails: F.arrayRemove(email) }),
    async acceptInvite(spaceId, share) {
      await F.updateDoc(F.doc(db, 'spaces', spaceId), {
        members: F.arrayUnion(me),
        invitedEmails: F.arrayRemove(myEmail),
        [`memberInfo.${me}`]: memberInfo(),
        [`sharedPersonal.${me}`]: !!share
      });
      if (share) await setShare(spaceId, true);
    },
    declineInvite: spaceId => F.updateDoc(F.doc(db, 'spaces', spaceId), { invitedEmails: F.arrayRemove(myEmail) }),
    setShare,
    renameSpace: (spaceId, name) => F.updateDoc(F.doc(db, 'spaces', spaceId), { name }),
    async leaveSpace(spaceId) {
      const ref = F.doc(db, 'spaces', spaceId);
      const sp = spaces.get(spaceId) || {};
      const list = new Set(myMeta.shareSpaces || []); list.delete(spaceId);
      await F.setDoc(userRef, { shareSpaces: [...list] }, { merge: true });
      if ((sp.members || []).length <= 1) {
        // Último integrante: se borra el espacio con sus movimientos
        const txs = await F.getDocs(F.collection(ref, 'transactions'));
        for (let i = 0; i < txs.docs.length; i += 400) {
          const b = F.writeBatch(db);
          txs.docs.slice(i, i + 400).forEach(d => b.delete(d.ref));
          await b.commit();
        }
        await F.deleteDoc(ref);
      } else {
        await F.updateDoc(ref, { members: F.arrayRemove(me), [`memberInfo.${me}`]: F.deleteField(), [`sharedPersonal.${me}`]: F.deleteField() });
      }
    },

    async logout() {
      // Espera a que se suban los cambios pendientes (máx. 4 s) y borra la copia local del dispositivo.
      await Promise.race([F.waitForPendingWrites(db), new Promise(r => setTimeout(r, 4000))]);
      stop();
      await A.signOut(auth);
      try { await F.terminate(db); await F.clearIndexedDbPersistence(db); } catch { /* sin caché */ }
      location.reload();
    }
  };

  function stop() {
    stopped = true;
    unsubs.forEach(u => u());
    spaceWatchers.forEach(s => s());
    partnerWatchers.forEach(w => w.stop());
  }
  return { stop };
}
