// Textos de la UI centralizados (i18n desde el inicio, aunque solo exista español).
export const es = {
  app: {
    name: "SeFue",
    description: "Mira en tiempo real qué sectores están sin luz, agua o internet.",
    unofficial: "Información comunitaria, no oficial.",
    emergency: "Para emergencias llama al ECU 911.",
  },
  map: {
    ariaLabel: "Mapa de Guayaquil dividido en zonas",
    loading: "Cargando el mapa…",
    attribution: "© OpenStreetMap · Protomaps",
  },
  zone: {
    none: "Elige tu zona para ver su estado.",
    selected: "Zona elegida. Toca otra parte del mapa para cambiarla.",
    clear: "Quitar zona",
  },
  location: {
    use: "Usar mi ubicación",
    withdraw: "Dejar de usar mi ubicación",
    locating: "Buscando tu ubicación…",
    denied: "Sin problema. Toca el mapa para elegir tu zona.",
    unavailable: "No pudimos obtener tu ubicación. Toca el mapa para elegir tu zona.",
    outside: "Parece que estás fuera de Guayaquil, y por ahora solo cubrimos esa ciudad. Toca el mapa para elegir una zona.",
  },
  report: {
    open: "Reportar un problema",
    title: "¿Qué está pasando?",
    types: {
      power: "Se fue la luz",
      water: "Se fue el agua",
      internet: "Se cayó el internet",
      flood: "Calle inundada",
    },
    providerTitle: "¿Cuál es tu proveedor?",
    providers: { netlife: "Netlife", cnt: "CNT", claro: "Claro", xtrim: "Xtrim", otro: "Otro" },
    needZone: "Para reportar, dinos en qué zona estás. Toca el mapa o usa tu ubicación.",
    chooseZone: "Elegir mi zona en el mapa",
    send: "Enviar reporte",
    sending: "Enviando…",
    verifying: "Verificando que eres una persona…",
    cancel: "Cancelar",
    close: "Cerrar",
    doneTitle: "Listo, recibimos tu reporte",
    doneBody:
      "Gracias por avisar. Para que el mapa sea confiable, una zona se marca cuando varios vecinos reportan lo mismo. Tu aviso ya cuenta.",
    errors: {
      NETWORK: "Parece que no hay conexión. Revisa tus datos o el WiFi y vuelve a intentar.",
      RATE_LIMITED:
        "Ya tenemos un reporte tuyo reciente para esta zona. Puedes volver a intentarlo en unos minutos.",
      VALIDATION_ERROR: "No pudimos enviar el reporte. Elige tu zona otra vez y vuelve a intentar.",
      SERVICE_UNAVAILABLE: "Estamos recibiendo muchos avisos. Intenta de nuevo en un momento.",
      FORBIDDEN: "No pudimos enviar el reporte. Recarga la página y vuelve a intentar.",
      CAPTCHA_REQUIRED: "No pudimos verificar que eres una persona. Vuelve a intentar.",
      CAPTCHA_UNAVAILABLE: "No pudimos completar la verificación. Revisa tu conexión y vuelve a intentar.",
      INTERNAL: "Tuvimos un problema de nuestro lado. Intenta de nuevo en un momento.",
    },
  },
  consent: {
    title: "¿Usamos tu ubicación?",
    body: "Solo la usamos cuando tocas «Usar mi ubicación», para mostrarte el estado de tu zona sin que la busques en el mapa.",
    privacy:
      "Tu teléfono la convierte en una zona de unos 700 metros antes de usarla. No guardamos ni enviamos tu ubicación exacta. Si prefieres, usa la app sin ubicación: elige tu zona en el mapa.",
    accept: "Permitir",
    decline: "Ahora no",
  },
} as const;
