# 💰 Mis Finanzas

App personal para llevar tus finanzas: registra ingresos y gastos, controla tu presupuesto, sigue tus metas de ahorro y recibe consejos según tus números.

Funciona en el celular y en la computadora, se puede **instalar como app** y funciona **sin internet**. No necesita servidor ni cuenta: tus datos se guardan solo en tu dispositivo.

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

## ⚠️ Sobre tus datos
- Se guardan en el almacenamiento del navegador del dispositivo donde uses la app. **No se envían a ningún servidor.**
- Si borras los datos del navegador, los pierdes. Usa **Ajustes → Exportar respaldo** de vez en cuando.
- Para pasar tus datos a otro dispositivo: exporta el respaldo en uno e impórtalo en el otro.

## Archivos
- `index.html`: estructura de la app
- `styles.css`: diseño (modo claro y oscuro automático)
- `app.js`: toda la lógica
- `sw.js` y `manifest.json`: instalación y uso sin conexión
- `icons/`: íconos de la app
