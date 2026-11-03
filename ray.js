'use strict';

/* =========================================================
   Ray — el personaje de RayFin (una chispa de energía).
   Se dibuja por capas: color del cuerpo, expresión y accesorios.
   window.Ray.svg({ mood, skin, hat, eyes, neck })
   ========================================================= */
(function () {
  const INK = '#0a0a0a';
  const L = '#c8f031';
  let uid = 0;

  /* ---------- Colores del cuerpo ---------- */
  const SKINS = {
    lima:  { name: 'Lima',  top: '#ecff7a', bottom: '#b2dc16', cheek: '#ff7a59' },
    oro:   { name: 'Oro',   top: '#fff1a6', bottom: '#f2b70f', cheek: '#ff6f59' },
    menta: { name: 'Menta', top: '#c6fff2', bottom: '#2fd6b0', cheek: '#ff7a8a' },
    coral: { name: 'Coral', top: '#ffd0c2', bottom: '#ff6f59', cheek: '#c2303f' },
    uva:   { name: 'Uva',   top: '#ead6ff', bottom: '#9b5cff', cheek: '#ff7ab8' },
    hielo: { name: 'Hielo', top: '#ffffff', bottom: '#a9c8e6', cheek: '#ff8fa3' }
  };

  /* ---------- Expresiones ---------- */
  const EYES = {
    normal: `<g class="ray-blink"><ellipse cx="84" cy="118" rx="8" ry="10.5" fill="${INK}"/><ellipse cx="116" cy="118" rx="8" ry="10.5" fill="${INK}"/>
      <circle cx="86.5" cy="114" r="3" fill="#fff"/><circle cx="118.5" cy="114" r="3" fill="#fff"/></g>`,
    feliz: `<path d="M76 121 Q84 108 92 121" stroke="${INK}" stroke-width="5.5" fill="none" stroke-linecap="round"/>
      <path d="M108 121 Q116 108 124 121" stroke="${INK}" stroke-width="5.5" fill="none" stroke-linecap="round"/>`,
    preocupado: `<g class="ray-blink"><ellipse cx="84" cy="121" rx="7" ry="8.5" fill="${INK}"/><ellipse cx="116" cy="121" rx="7" ry="8.5" fill="${INK}"/>
      <circle cx="86" cy="118" r="2.4" fill="#fff"/><circle cx="118" cy="118" r="2.4" fill="#fff"/></g>
      <path d="M74 111 L91 105 M126 111 L109 105" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`,
    dormido: `<path d="M76 119 Q84 126 92 119" stroke="${INK}" stroke-width="5" fill="none" stroke-linecap="round"/>
      <path d="M108 119 Q116 126 124 119" stroke="${INK}" stroke-width="5" fill="none" stroke-linecap="round"/>`
  };
  const MOUTH = {
    normal: `<path d="M93 136 Q100 141 107 136" stroke="${INK}" stroke-width="4" fill="none" stroke-linecap="round"/>`,
    feliz: `<path d="M88 133 Q100 150 112 133 Z" fill="${INK}"/><path d="M94 141 Q100 146 106 141" fill="#ff7a59"/>`,
    preocupado: `<path d="M91 142 Q100 135 109 142" stroke="${INK}" stroke-width="4" fill="none" stroke-linecap="round"/>`,
    dormido: `<ellipse cx="100" cy="139" rx="4" ry="3.5" fill="${INK}"/>`
  };

  /* ---------- Accesorios ---------- */
  const HATS = {
    gorra: { name: 'Gorra', svg: () => cap('#151515', '#2a2a2a', '#444') },
    gorraLima: { name: 'Gorra lima', svg: () => cap(L, '#9fcf12', '#9fcf12') },
    lana: { name: 'Gorro de lana', svg: () => `
      <path d="M62 88 C62 52 138 52 138 88 Z" fill="#ff6f59"/>
      <path d="M68 66 V86 M80 58 V86 M92 55 V86 M104 55 V86 M116 57 V86 M128 62 V86" stroke="#e85a45" stroke-width="3"/>
      <rect x="58" y="80" width="84" height="14" rx="7" fill="#f2f2f2"/>
      <circle cx="100" cy="50" r="10" fill="#f2f2f2"/>` },
    copa: { name: 'Sombrero de copa', svg: () => `
      <rect x="74" y="40" width="52" height="44" rx="5" fill="#151515"/>
      <rect x="74" y="70" width="52" height="8" fill="${L}"/>
      <rect x="58" y="80" width="84" height="9" rx="4.5" fill="#151515"/>` },
    audifonos: { name: 'Audífonos', svg: () => `
      <path d="M52 116 C52 62 148 62 148 116" stroke="#151515" stroke-width="8" fill="none" stroke-linecap="round"/>
      <rect x="40" y="104" width="18" height="30" rx="8" fill="#151515"/><rect x="142" y="104" width="18" height="30" rx="8" fill="#151515"/>
      <rect x="44" y="110" width="6" height="18" rx="3" fill="${L}"/><rect x="150" y="110" width="6" height="18" rx="3" fill="${L}"/>` },
    corona: { name: 'Corona', svg: () => `
      <path d="M72 86 L72 62 L86 74 L100 54 L114 74 L128 62 L128 86 Z" fill="#ffd23f" stroke="#e0a800" stroke-width="2.5" stroke-linejoin="round"/>
      <circle cx="100" cy="78" r="4.5" fill="${L}"/><circle cx="82" cy="80" r="3" fill="#ff6f59"/><circle cx="118" cy="80" r="3" fill="#2fd6b0"/>` }
  };
  const GLASSES = {
    sol: { name: 'Lentes de sol', svg: () => `
      <rect x="68" y="108" width="28" height="19" rx="8" fill="#111"/><rect x="104" y="108" width="28" height="19" rx="8" fill="#111"/>
      <path d="M96 114 H104" stroke="#111" stroke-width="4"/>
      <path d="M73 113 l7 -3.5 M109 113 l7 -3.5" stroke="${L}" stroke-width="2.5" stroke-linecap="round"/>` },
    redondos: { name: 'Lentes redondos', svg: () => `
      <circle cx="84" cy="118" r="13" fill="#ffffff22" stroke="#151515" stroke-width="3.5"/>
      <circle cx="116" cy="118" r="13" fill="#ffffff22" stroke="#151515" stroke-width="3.5"/>
      <path d="M97 116 Q100 113 103 116" stroke="#151515" stroke-width="3" fill="none"/>` },
    trader: { name: 'Visor trader', svg: () => `
      <rect x="64" y="107" width="72" height="20" rx="10" fill="#151515"/>
      <path d="M72 121 L82 114 L90 119 L100 111 L110 116 L120 110 L128 113" stroke="${L}" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` }
  };
  const NECK = {
    mono: { name: 'Moño', svg: () => `
      <path d="M100 160 L84 151 L84 169 Z M100 160 L116 151 L116 169 Z" fill="#151515"/>
      <rect x="96" y="155" width="8" height="10" rx="3" fill="#333"/>` },
    bufanda: { name: 'Bufanda', svg: () => `
      <path d="M62 152 Q100 168 138 152 L138 162 Q100 178 62 162 Z" fill="#ff6f59"/>
      <path d="M118 160 L124 186 L112 186 L108 164 Z" fill="#e85a45"/>
      <path d="M70 156 V164 M84 160 V168 M98 162 V170" stroke="#e85a45" stroke-width="2.5"/>` },
    cadena: { name: 'Cadena de oro', svg: () => `
      <path d="M70 150 Q100 172 130 150" stroke="#ffd23f" stroke-width="3.5" fill="none" stroke-dasharray="1 5" stroke-linecap="round"/>
      <path d="M100 160 L108 168 L100 178 L92 168 Z" fill="${L}" stroke="#e0a800" stroke-width="1.5"/>` }
  };

  function cap(color, brim, button) {
    return `<path d="M62 88 C62 48 138 48 138 88 Z" fill="${color}"/>
      <path d="M64 87 H170 a6 6 0 0 1 -6 7 H64 Z" fill="${brim}"/>
      <circle cx="100" cy="53" r="3.5" fill="${button}"/>`;
  }

  /**
   * Dibuja a Ray.
   * @param {object} o  mood: normal|feliz|preocupado|dormido · skin · hat · eyes · neck
   */
  function svg(o = {}) {
    const id = 'ray' + (++uid);
    const skin = SKINS[o.skin] || SKINS.lima;
    const mood = EYES[o.mood] ? o.mood : 'normal';
    const hat = HATS[o.hat], eyes = GLASSES[o.eyes], neck = NECK[o.neck];
    return `<svg class="ray ray-${mood}" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Ray">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${skin.top}"/><stop offset="1" stop-color="${skin.bottom}"/></linearGradient></defs>
      <ellipse class="ray-shadow" cx="100" cy="188" rx="40" ry="6" fill="#000" opacity=".3"/>
      <g class="ray-body">
        <path class="ray-spark s1" d="M152 50 l3 8 8 3 -8 3 -3 8 -3 -8 -8 -3 8 -3 Z" fill="#fff" opacity=".85"/>
        <path class="ray-spark s2" d="M46 68 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2 Z" fill="#fff" opacity=".6"/>
        <ellipse cx="84" cy="178" rx="13" ry="7" fill="#151515"/><ellipse cx="116" cy="178" rx="13" ry="7" fill="#151515"/>
        <path d="M100 24 C112 50 152 70 152 120 C152 152 129 174 100 174 C71 174 48 152 48 120 C48 94 62 82 72 62 C78 78 84 84 92 86 C90 64 94 46 100 24 Z" fill="url(#${id})"/>
        <path d="M100 24 C112 50 152 70 152 120 C152 136 146 150 136 160 C146 140 144 104 116 82 C108 70 104 50 100 24 Z" fill="#fff" opacity=".18"/>
        <ellipse cx="72" cy="134" rx="8" ry="5" fill="${skin.cheek}" opacity=".45"/><ellipse cx="128" cy="134" rx="8" ry="5" fill="${skin.cheek}" opacity=".45"/>
        <path d="M52 128 L40 138 M148 128 L160 138" stroke="#151515" stroke-width="6" stroke-linecap="round"/>
        ${EYES[mood]}${MOUTH[mood]}
        ${eyes ? eyes.svg() : ''}
        ${neck ? neck.svg() : ''}
        ${hat ? hat.svg() : ''}
        ${mood === 'dormido' ? `<g class="ray-zzz" fill="#fff" font-family="Inter,sans-serif" font-weight="800"><text x="138" y="70" font-size="18">z</text><text x="152" y="52" font-size="13" opacity=".7">z</text></g>` : ''}
      </g>
    </svg>`;
  }

  /* ---------- Catálogo (precio en puntos; 0 = regalo de bienvenida) ---------- */
  const CATALOG = [
    { slot: 'skin', id: 'lima', price: 0 },
    { slot: 'skin', id: 'menta', price: 300 },
    { slot: 'skin', id: 'coral', price: 300 },
    { slot: 'skin', id: 'uva', price: 400 },
    { slot: 'skin', id: 'hielo', price: 500 },
    { slot: 'skin', id: 'oro', price: 1500 },
    { slot: 'hat', id: 'gorra', price: 0 },
    { slot: 'hat', id: 'gorraLima', price: 150 },
    { slot: 'hat', id: 'lana', price: 200 },
    { slot: 'hat', id: 'audifonos', price: 350 },
    { slot: 'hat', id: 'copa', price: 600 },
    { slot: 'hat', id: 'corona', price: 2000 },
    { slot: 'eyes', id: 'redondos', price: 0 },
    { slot: 'eyes', id: 'sol', price: 250 },
    { slot: 'eyes', id: 'trader', price: 800 },
    { slot: 'neck', id: 'mono', price: 0 },
    { slot: 'neck', id: 'bufanda', price: 200 },
    { slot: 'neck', id: 'cadena', price: 1000 }
  ];
  const SLOTS = { skin: 'Color', hat: 'Cabeza', eyes: 'Lentes', neck: 'Cuello' };
  const itemName = it => (it.slot === 'skin' ? SKINS : it.slot === 'hat' ? HATS : it.slot === 'eyes' ? GLASSES : NECK)[it.id]?.name || it.id;

  window.Ray = { svg, CATALOG, SLOTS, SKINS, itemName };
})();
