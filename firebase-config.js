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
  apiKey: '',
  authDomain: '',
  projectId: '',
  storageBucket: '',
  messagingSenderId: '',
  appId: ''
};

window.APP_OPTIONS = {
  // false = se oculta "Crear cuenta". Las cuentas las creas tú en la consola de Firebase.
  allowSignup: true,
  // Mostrar el botón "Continuar con Google".
  googleLogin: true
};
