# RayFin

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

## 🎯 Plan de ahorro

En **Metas → Mi plan de ahorro** eliges cuánto apartar cada mes: un **porcentaje de tus ingresos** (20% recomendado) o un **monto fijo**. Si aún no registraste tu sueldo del mes, puedes indicar tu **ingreso mensual esperado**.

- En **Inicio** verás cuánto llevas ahorrado de la meta, si vas *en camino*, *en riesgo* o ya la *alcanzaste*, **cuánto puedes gastar todavía este mes (y por día)**, el historial de 6 meses y tu racha de meses cumpliendo.
- Cuenta como ahorro lo que no gastas de tus ingresos, incluido lo que envías a la categoría *Ahorro e inversión*.
- En un **espacio compartido** se ven los planes de cada integrante (de quienes comparten sus finanzas personales) y el total que ahorran juntos.

## ⚡ Ray

Ray es el personaje de RayFin: una chispa de energía que vive en tu **Inicio** y te habla en un globo de diálogo (tócalo para ver más consejos).

- **Su ánimo depende de tus finanzas:** feliz si cumples tu plan de ahorro, preocupado si te pasas del presupuesto o del plan, dormido si llevas una semana sin registrar nada.
- **Tócalo para abrir su armario** y cambiarle el color, la gorra, los lentes o lo que lleva en el cuello. Hay regalos de bienvenida; el resto se desbloqueará con puntos.
- En un **espacio compartido** aparecen los Rays de cada integrante, juntos.

## 🏆 Puntos y logros

Ganas puntos por buenos hábitos y los gastas en el **armario de Ray**. Los ves en **Metas → Puntos y logros**.

| Cada mes | Puntos |
|---|---|
| Cumplir tu plan de ahorro (al cerrar el mes) | +300 |
| Respetar todos tus presupuestos (al cerrar el mes) | +150 |
| Registrar movimientos: 5 por día con registros (máx. 20 días) | hasta +100 |
| En pareja: todo el equipo cumplió su plan | +200 |

Además hay **11 logros** de una sola vez (primer movimiento, rachas de 3 y 6 meses, regla 50/30/20, fondo de emergencia de 3 meses, metas cumplidas, etc.). Cada 500 puntos Ray sube de **nivel**, y cuando ganas puntos Ray lo celebra con confeti.

Los puntos se calculan a partir de tus datos, así que son los mismos en todos tus dispositivos.

## 👥 Finanzas compartidas (pareja, familia, roommates)

Requiere el modo con cuentas (Firebase).

- **Espacio compartido:** en **Ajustes → Finanzas compartidas** creas un espacio (por ejemplo *Casa*) e invitas a otra persona con el **correo con el que entra a RayFin**. Al abrir la app, esa persona verá la invitación y podrá aceptarla.
- En el espacio **todos los integrantes registran y editan** movimientos, presupuestos y metas. Cada movimiento muestra **quién lo registró**, y el inicio muestra los **aportes del mes** de cada uno.
- **Ver las finanzas personales del otro:** al crear o aceptar el espacio puedes marcar *"Que pueda ver mis finanzas personales"*. Es **solo lectura**: nadie puede modificar tus finanzas personales, y puedes dejar de compartirlas cuando quieras.
- Arriba de la app aparece un selector para cambiar entre **Yo · Casa · (la otra persona)**.
- La app no envía correos: después de invitar, avísale a la otra persona (hay un botón para hacerlo por WhatsApp).

> **Importante:** si ya tenías RayFin configurado, vuelve a copiar el contenido de `firestore.rules` en **Firestore → Reglas → Publicar**. Sin las reglas nuevas, compartir no funciona.

## ⚠️ Sobre tus datos
- **Modo local:** los datos se guardan en el navegador del dispositivo y no se envían a ningún servidor. Si borras los datos del navegador, se pierden: usa **Ajustes → Exportar respaldo** de vez en cuando.
- **Modo con cuentas:** los datos están en tu proyecto de Firebase (Google Cloud) y solo los puede leer su dueño. Igual puedes exportar un respaldo cuando quieras.

## 🧪 Pruebas automáticas

En `tests/` hay pruebas que abren la app en un navegador real y revisan los flujos importantes: movimientos, plan de ahorro, monedas, pagos fijos, deudas, reportes, puntos, bienvenida, bloqueo y, con el emulador de Firebase, compartir en pareja y las reglas de seguridad.

Se corren solas en GitHub (pestaña **Actions**) en cada cambio. Para correrlas en tu computadora (necesitas Node.js 20 y Java):

```bash
cd tests
npm install
npx playwright install chromium
npm test
```

## Archivos
- `index.html`: estructura de la app
- `styles.css`: diseño (modo claro y oscuro)
- `js/nucleo.js`, `calculos.js`, `inicio.js`, `vistas.js`, `formularios.js`, `acciones.js`, `arranque.js`: la app, en el orden en que se cargan
- `js/fijos.js` (pagos fijos), `js/deudas.js`, `js/pareja.js` (aportes y cuentas claras), `js/reportes.js`, `js/bienvenida.js`, `js/bloqueo.js`, `js/ray.js` (el personaje)
- `js/cloud.js`: inicio de sesión y sincronización con Firebase
- `js/splash.js`, `js/auth-bg.js`: presentación y fondo animado del acceso
- `firebase-config.js`: configuración de tu proyecto de Firebase
- `firestore.rules`: reglas de seguridad de la base de datos
- `sw.js` y `manifest.json`: instalación y uso sin conexión
- `icons/`: íconos de la app
- `tests/`: pruebas automáticas

> Al publicar cambios en `styles.css` o en los `.js`, sube el número `?v=` en `index.html` (y `CACHE` en `sw.js`) para que todos los navegadores carguen la versión nueva.
