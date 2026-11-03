/* =========================================================
   Configuración de Firebase (inicio de sesión + base de datos)

   Mientras apiKey esté vacío, la app funciona en "modo local":
   sin inicio de sesión y con los datos solo en el dispositivo.

   Para activar las cuentas, pega aquí los datos de tu proyecto
   (Firebase → Configuración del proyecto → Tus apps → Web).
   Estos datos NO son secretos: la seguridad la dan las reglas
   de firestore.rules. Ver README, sección "Inicio de sesión".
   ========================================================= */
window.FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDze9zZVzLMrVswtQJ_-yGR8cu3c1rM42E',
  authDomain: 'finanzas-648d8.firebaseapp.com',
  projectId: 'finanzas-648d8',
  storageBucket: 'finanzas-648d8.firebasestorage.app',
  messagingSenderId: '1023723021603',
  appId: '1:1023723021603:web:e2072dcab2818ac6e99896'
};

window.APP_OPTIONS = {
  // false = se oculta "Crear cuenta". Las cuentas las creas tú en la consola de Firebase.
  allowSignup: true,
  // Mostrar el botón "Continuar con Google".
  googleLogin: true
};
