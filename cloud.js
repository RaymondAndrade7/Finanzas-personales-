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

async function startSession(A, F, auth, db, user) {
  showScreen('loading', 'Cargando tus datos…');
  const userRef = F.doc(db, 'users', user.uid);
  const txCol = F.collection(userRef, 'transactions');
  const unsubs = [];
  let stopped = false;

  const metaOf = s => ({
    version: s.version || 1,
    settings: s.settings,
    categories: s.categories,
    accounts: s.accounts,
    goals: s.goals,
    owner: { email: user.email || '', name: user.displayName || '' },
    updatedAt: F.serverTimestamp()
  });

  async function replaceAll(s) {
    const existing = await F.getDocs(txCol);
    const keep = new Set(s.transactions.map(t => t.id));
    const ops = [
      ...existing.docs.filter(d => !keep.has(d.id)).map(d => b => b.delete(d.ref)),
      ...s.transactions.map(t => b => b.set(F.doc(txCol, t.id), t)),
      b => b.set(userRef, metaOf(s))
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
      await replaceAll(initial);
    }
  } catch (err) {
    console.error(err);
    await A.signOut(auth).catch(() => {});
    showScreen('login', errorText(err));
    return { stop() {} };
  }

  window.Cloud = {
    user,
    saveMeta: s => F.setDoc(userRef, metaOf(s)),
    putTx: tx => F.setDoc(F.doc(txCol, tx.id), tx),
    delTx: id => F.deleteDoc(F.doc(txCol, id)),
    replaceAll,
    async logout() {
      // Espera a que se suban los cambios pendientes (máx. 4 s) y borra la copia local del dispositivo.
      await Promise.race([F.waitForPendingWrites(db), new Promise(r => setTimeout(r, 4000))]);
      stop();
      await A.signOut(auth);
      try { await F.terminate(db); await F.clearIndexedDbPersistence(db); } catch { /* sin caché */ }
      location.reload();
    }
  };

  // Escuchar cambios (también los hechos desde otro dispositivo)
  let meta = null, txs = null, metaPending = false, txPending = false;
  let entered = false, lastSig = '';
  const emit = () => {
    if (stopped || !meta || !txs) return;
    // Mientras haya cambios propios sin confirmar, la pantalla ya los muestra.
    if (entered && (metaPending || txPending)) return;
    const data = { ...meta, transactions: txs };
    const sig = JSON.stringify(data, (k, v) => (k === 'updatedAt' || k === 'owner') ? undefined : v);
    if (sig !== lastSig) { lastSig = sig; App.setState(data); }
    if (!entered) { entered = true; hideScreen(); App.enter(); }
  };
  const onErr = err => {
    console.error(err);
    App.toast('⚠️ ' + errorText(err));
  };

  unsubs.push(F.onSnapshot(userRef, { includeMetadataChanges: true }, s => {
    meta = s.data() || null;
    metaPending = s.metadata.hasPendingWrites;
    emit();
  }, onErr));
  unsubs.push(F.onSnapshot(txCol, { includeMetadataChanges: true }, s => {
    txs = s.docs.map(d => ({ ...d.data(), id: d.id }));
    txPending = s.metadata.hasPendingWrites;
    emit();
  }, onErr));

  function stop() {
    stopped = true;
    unsubs.forEach(u => u());
  }
  return { stop };
}
