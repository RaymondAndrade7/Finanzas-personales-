# 💰 Mis Finanzas

App personal para llevar tus finanzas: registra ingresos y gastos, controla tu presupuesto, sigue tus metas de ahorro y recibe consejos según tus números.

Funciona en el celular y en la computadora, se puede **instalar como app** y funciona **sin internet**.

Tiene dos modos:
- **Modo local** (por defecto): sin cuentas; los datos quedan solo en el dispositivo.
- **Modo con cuentas** (opcional, con Firebase): **inicio de sesión** y **base de datos en la nube**. Cada persona tiene su cuenta, ve solo sus finanzas y las sincroniza entre celular y computadora. El plan gratuito alcanza de sobra para 5 personas o más.

## Qué incluye

| Sección | Qué hace |
|---|---|
| 🏠 **Inicio** | Ingresos, gastos, balance y tasa de ahorro del mes. Consejos automáticos, gráfico de gastos por categoría, regla **50/30/20**, tendencia de los últimos 6 meses y saldo de cada cuenta. |
| 📋 **Movimientos** | Lista por día de tus ingresos, gastos y transferencias entre cuentas. Puedes buscar y filtrar. Tócalo para editar o eliminar. |
| 🎯 **Presupuesto** | Límite mensual por categoría con barras de progreso (avisa al 85% y cuando te pasas). Sugerencia de reparto según tus ingresos. |
| 🐷 **Metas** | Metas de ahorro con progreso, fecha límite y cuánto ahorrar al mes. Calcula tu **fondo de emergencia** recomendado (3 a 6 meses de gastos). |
| ⚙️ **Ajustes** | Moneda (USD, EUR, VES, COP, USDT…), cuentas con saldo inicial, categorías (nombre, color, si es necesidad, gusto o ahorro), respaldo, importación, exportación a Excel (CSV) y datos de ejemplo. |

## Cómo usarla

### Opción 1: publicarla gratis con GitHub Pages (recomendado)
1. En GitHub, entra al repositorio → **Settings** → **Pages**.
2. En *Source* elige **Deploy from a branch**, la rama y la carpeta `/ (root)`, y guarda.
3. En un par de minutos estará en `https://raymondandrade7.github.io/Finanzas-personales-/`.
4. En el celular, abre ese enlace y elige **"Agregar a pantalla de inicio"** (iPhone: botón Compartir; Android: menú ⋮ → *Instalar app*).

### Opción 2: en tu computadora
Descarga el repositorio y abre `index.html` en el navegador. Para que funcione sin conexión, sírvelo con un servidor local, por ejemplo:

```bash
python3 -m http.server 8000
# luego abre http://localhost:8000
```

## Primeros pasos recomendados
1. En **Ajustes**, elige tu moneda y pon el saldo actual de cada cuenta.
2. Registra **todo** lo que gastes durante un mes con el botón **+**.
3. Después del primer mes, define límites en **Presupuesto**.
4. Crea tu **Fondo de emergencia** en Metas y abónale cada vez que cobres.
5. Cada domingo, revisa **Inicio** durante 10 minutos.

## 🔐 Inicio de sesión y base de datos (Firebase)

Configúralo una sola vez (unos 10 minutos). Es gratis con el plan **Spark**.

### 1. Crear el proyecto
1. Entra a <https://console.firebase.google.com> con tu cuenta de Google y toca **Agregar proyecto**. Ponle un nombre, por ejemplo `mis-finanzas`. Google Analytics no hace falta.
2. En la página del proyecto toca el ícono **`</>`** (Web) para registrar una app web. Ponle un nombre y **no** marques Hosting.
3. Firebase te muestra un bloque `firebaseConfig`. Copia esos valores en **`firebase-config.js`** de este repositorio (`apiKey`, `authDomain`, `projectId`, etc.).
   > Estos valores no son secretos: es normal que estén en el código. La seguridad la dan las reglas del paso 3.

### 2. Activar el inicio de sesión
1. Menú **Compilación → Authentication → Comenzar**.
2. En **Sign-in method** activa **Correo electrónico/contraseña** y, si quieres, **Google**.
3. En **Settings → Authorized domains** agrega `raymondandrade7.github.io` (necesario para el botón de Google).

### 3. Crear la base de datos y sus reglas
1. Menú **Compilación → Firestore Database → Crear base de datos**. Elige una ubicación cercana, por ejemplo `us-east1`, y empieza en **modo de producción**.
2. Ve a la pestaña **Reglas**, borra lo que haya, pega el contenido de **`firestore.rules`** y toca **Publicar**.

Listo. Al abrir la app aparecerá la pantalla de inicio de sesión.

### ¿Quién puede entrar?
Por defecto, cualquiera que tenga el enlace puede crear su cuenta, pero **cada persona solo ve sus propios datos**. Si quieres que solo entren tus 5 personas:
- **Opción A (recomendada):** en `firestore.rules` escribe los 5 correos en `allowed()`, cambia `allowAnyone()` por `allowed()` dentro de `isOwner` y vuelve a publicar las reglas.
- **Opción B:** pon `allowSignup: false` en `firebase-config.js` y crea tú las cuentas en **Authentication → Users → Agregar usuario**. Esto solo oculta el botón; la protección real es la opción A.

### Cómo se guardan los datos
```
users/{id-de-la-persona}                       ← ajustes, cuentas, categorías y metas
users/{id-de-la-persona}/transactions/{id}     ← un documento por movimiento
```
- Los cambios se sincronizan **en vivo** entre los dispositivos de la misma persona.
- Si no hay internet, la app sigue funcionando y sube los cambios cuando vuelve la conexión.
- La primera vez que alguien entra, si ese dispositivo tenía datos en modo local, la app ofrece **subirlos a su cuenta**.
- Al **cerrar sesión** se borra la copia del dispositivo, así que se puede usar un dispositivo compartido sin problema.

### Probar sin crear proyecto (para desarrolladores)
Con el [emulador de Firebase](https://firebase.google.com/docs/emulator-suite):
```bash
npx firebase-tools emulators:start --project demo-finanzas --only auth,firestore
python3 -m http.server 8000
# abre http://localhost:8000/?emulador
```

## ⚠️ Sobre tus datos
- **Modo local:** los datos se guardan en el navegador del dispositivo y no se envían a ningún servidor. Si borras los datos del navegador, se pierden: usa **Ajustes → Exportar respaldo** de vez en cuando.
- **Modo con cuentas:** los datos están en tu proyecto de Firebase (Google Cloud) y solo los puede leer su dueño. Igual puedes exportar un respaldo cuando quieras.

## Archivos
- `index.html`: estructura de la app
- `styles.css`: diseño (modo claro y oscuro automático)
- `app.js`: toda la lógica
- `cloud.js`: inicio de sesión y sincronización con Firebase
- `firebase-config.js`: aquí pegas la configuración de tu proyecto
- `firestore.rules`: reglas de seguridad de la base de datos
- `sw.js` y `manifest.json`: instalación y uso sin conexión

> Al publicar cambios en `styles.css` o en los `.js`, sube el número `?v=` en `index.html` para que todos los navegadores carguen la versión nueva.
- `icons/`: íconos de la app
