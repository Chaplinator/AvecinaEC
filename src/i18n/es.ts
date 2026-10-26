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
    needZone: "Primero elige tu zona. Toca el mapa o usa tu ubicación.",
    chooseZone: "Elegir mi zona",
    send: "Enviar reporte",
    sending: "Enviando…",
    cancel: "Cancelar",
    close: "Cerrar",
    doneTitle: "Recibimos tu reporte",
    doneBody:
      "Gracias por avisar. Un solo reporte no marca la zona en el mapa: se muestra cuando varios vecinos coinciden.",
    errors: {
      NETWORK: "No hay conexión. Revisa tu internet e intenta otra vez.",
      RATE_LIMITED: "Ya enviaste reportes hace poco. Espera unos minutos e intenta de nuevo.",
      VALIDATION_ERROR: "No pudimos enviar este reporte. Elige tu zona otra vez e intenta de nuevo.",
      SERVICE_UNAVAILABLE: "El servicio está ocupado. Intenta de nuevo en un momento.",
      FORBIDDEN: "No pudimos enviar el reporte. Recarga la página e intenta de nuevo.",
      INTERNAL: "Algo salió mal de nuestro lado. Intenta de nuevo en un momento.",
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
