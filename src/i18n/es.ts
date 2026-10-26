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
  consent: {
    title: "¿Usamos tu ubicación?",
    body: "Solo la usamos cuando tocas «Usar mi ubicación», para mostrarte el estado de tu zona sin que la busques en el mapa.",
    privacy:
      "Tu teléfono la convierte en una zona de unos 700 metros antes de usarla. No guardamos ni enviamos tu ubicación exacta. Si prefieres, usa la app sin ubicación: elige tu zona en el mapa.",
    accept: "Permitir",
    decline: "Ahora no",
  },
} as const;
