import { sql } from "kysely";
import type { Seeder } from "../seed.js";

// Catálogo de EJEMPLO (§03): contenido ficticio, marcado con is_example y la leyenda
// "Ejemplo — no es un procedimiento oficial de PBG". No sustituye procedimientos reales.

type SeedArticle = {
  slug: string;
  category: string;
  title: string;
  symptoms: string;
  applies_to: string;
  diagnosis_steps: string;
  solution: string;
  escalation_conditions: string;
  tags: string[];
};

const ESCALATE = "Si después de seguir los pasos el problema continúa, crea un ticket indicando qué pasos probaste y qué resultado obtuviste.";

export const SEED_ARTICLES: SeedArticle[] = [
  {
    slug: "no-puedo-iniciar-sesion",
    category: "access",
    title: "No puedo iniciar sesión: «Usuario o contraseña incorrectos»",
    symptoms: "Al ingresar aparece «Usuario o contraseña incorrectos» aunque crees que los datos son correctos. No puedo entrar a mi cuenta.",
    applies_to: "Web, todos los navegadores",
    diagnosis_steps: "1. Revisa que el usuario sea tu alias o tu correo completo, sin espacios al inicio o al final.\n2. Comprueba que Bloq Mayús esté desactivado.\n3. Usa el botón «Mostrar» para ver la contraseña que escribiste.",
    solution: "1. Escribe el usuario en minúsculas.\n2. Vuelve a escribir la contraseña a mano (no la pegues).\n3. Si hiciste más de 15 intentos en un minuto, espera un minuto: el acceso se bloquea temporalmente por seguridad.",
    escalation_conditions: "Crea un ticket si después de esperar un minuto y escribir los datos con cuidado sigues sin poder entrar. Nunca compartas tu contraseña en el ticket.",
    tags: ["login", "contraseña", "acceso"],
  },
  {
    slug: "restablecer-contrasena-no-llega",
    category: "access",
    title: "El correo para restablecer la contraseña no llega",
    symptoms: "Pedí restablecer la contraseña pero el correo no aparece en la bandeja de entrada.",
    applies_to: "Correo de restablecimiento",
    diagnosis_steps: "1. Espera al menos 5 minutos.\n2. Revisa las carpetas de spam, promociones y otros.\n3. Confirma que escribiste el correo con el que te registraste.",
    solution: "1. Busca en tu correo un mensaje con el asunto «Restablecer contraseña».\n2. Marca el remitente como seguro.\n3. Pide un nuevo correo: solo funciona el enlace más reciente.",
    escalation_conditions: "Crea un ticket si después de 30 minutos y dos intentos el correo no llega.",
    tags: ["contraseña", "correo", "restablecer"],
  },
  {
    slug: "sesion-se-cierra-sola",
    category: "access",
    title: "La sesión se cierra sola",
    symptoms: "Estoy trabajando y de repente vuelvo a la pantalla de inicio de sesión. La sesión se cierra sola o me saca de la cuenta.",
    applies_to: "Web",
    diagnosis_steps: "1. Revisa si iniciaste sesión con la misma cuenta en otro navegador, otro equipo o una ventana de incógnito.\n2. Revisa cuánto tiempo llevabas conectado: la sesión dura 8 horas.",
    solution: "Cada cuenta puede tener una sola sesión activa: al iniciar sesión en otro lugar se cierra la anterior. Usa un solo navegador y vuelve a ingresar. Si pasaron más de 8 horas, es el cierre automático por seguridad.",
    escalation_conditions: ESCALATE,
    tags: ["sesión", "logout", "acceso"],
  },
  {
    slug: "no-veo-un-modulo",
    category: "permissions",
    title: "No veo un módulo o una opción del menú",
    symptoms: "Un compañero ve una opción del menú que yo no veo. Me falta un módulo o una pantalla.",
    applies_to: "Web",
    diagnosis_steps: "1. Confirma con qué cuenta iniciaste sesión (menú de la cuenta, arriba a la derecha).\n2. Compara tu rol con el de tu compañero: las opciones dependen del rol.",
    solution: "Las opciones visibles dependen del rol de tu cuenta. Si necesitas una opción que tu rol no incluye, pide el acceso a tu responsable. El soporte no puede ampliar permisos sin esa autorización.",
    escalation_conditions: "Crea un ticket si tu responsable confirma que deberías tener acceso y la opción sigue sin aparecer después de cerrar e iniciar sesión.",
    tags: ["permisos", "rol", "menú"],
  },
  {
    slug: "dueno-agencia-no-ve-tickets-del-equipo",
    category: "permissions",
    title: "Como dueño de agencia no veo los tickets de mi equipo",
    symptoms: "Soy dueño o responsable de una agencia y no veo los tickets que abrieron los agentes de mi equipo.",
    applies_to: "Soporte · Mis tickets",
    diagnosis_steps: "1. Revisa en «Mis tickets» si se trata de tickets creados con tu propia cuenta.",
    solution: "Es el comportamiento esperado: cada persona ve solo sus propios tickets, aunque comparta agencia. Así se protege la información de cada agente. Si necesitas seguimiento de un caso, pide a la persona que te comparta el número del ticket y su estado.",
    escalation_conditions: "No requiere ticket salvo que no veas tickets creados con tu propia cuenta.",
    tags: ["permisos", "agencia", "tickets"],
  },
  {
    slug: "pantalla-en-blanco",
    category: "screens",
    title: "La pantalla queda en blanco después de actualizar",
    symptoms: "Después de una actualización la pantalla se queda en blanco o no termina de cargar.",
    applies_to: "Web · Chrome, Edge, Firefox y Safari recientes",
    diagnosis_steps: "1. Recarga la página con Ctrl+Shift+R (Cmd+Shift+R en Mac).\n2. Prueba en una ventana de incógnito.\n3. Revisa que tu navegador esté actualizado.",
    solution: "1. Haz una recarga forzada (Ctrl+Shift+R).\n2. Si funciona en incógnito, borra la caché del sitio en la configuración del navegador.\n3. Desactiva temporalmente las extensiones que bloquean contenido.",
    escalation_conditions: ESCALATE,
    tags: ["pantalla", "caché", "navegador"],
  },
  {
    slug: "boton-guardar-no-responde",
    category: "screens",
    title: "El botón Guardar no responde",
    symptoms: "Hago clic en Guardar y no pasa nada, o el botón queda deshabilitado.",
    applies_to: "Formularios web",
    diagnosis_steps: "1. Busca campos marcados en rojo o mensajes debajo de los campos.\n2. Revisa que tengas conexión a internet.\n3. Revisa si el botón muestra «Guardando…».",
    solution: "1. Completa los campos obligatorios marcados en rojo.\n2. Si el botón quedó en «Guardando…» más de un minuto, recarga la página: el sistema evita guardar dos veces lo mismo.",
    escalation_conditions: ESCALATE,
    tags: ["formulario", "guardar", "pantalla"],
  },
  {
    slug: "tabla-no-carga-datos",
    category: "screens",
    title: "Una tabla o listado no muestra datos",
    symptoms: "El listado aparece vacío o tarda mucho en cargar, aunque sé que hay datos.",
    applies_to: "Listados y reportes",
    diagnosis_steps: "1. Revisa los filtros activos y el rango de fechas.\n2. Quita la búsqueda escrita.\n3. Revisa si hay un aviso de incidente activo.",
    solution: "1. Pulsa «Todas» en cada filtro y amplía el rango de fechas.\n2. Recarga la página.\n3. Si hay un incidente de lentitud activo, espera a que se resuelva.",
    escalation_conditions: ESCALATE,
    tags: ["listado", "filtros", "lentitud"],
  },
  {
    slug: "archivo-rechazado",
    category: "uploads",
    title: "Mi archivo es rechazado al subirlo",
    symptoms: "Al adjuntar un archivo aparece «Tipo de archivo no permitido» o «El archivo supera el tamaño permitido».",
    applies_to: "Adjuntos en tickets y en el chat de soporte",
    diagnosis_steps: "1. Revisa el tipo: se aceptan PNG, JPG, WEBP, GIF, PDF y TXT.\n2. Revisa el tamaño: máximo 10 MB por archivo y 5 archivos por envío.",
    solution: "1. Convierte el archivo a PDF o PNG.\n2. Si pesa más de 10 MB, comprímelo o haz capturas solo de la parte relevante.\n3. No cambies la extensión a mano: el sistema revisa el contenido real del archivo.",
    escalation_conditions: ESCALATE,
    tags: ["adjuntos", "archivo", "tamaño"],
  },
  {
    slug: "carga-de-archivo-se-queda-en-progreso",
    category: "uploads",
    title: "La carga del archivo se queda en progreso",
    symptoms: "La barra de carga avanza y se detiene, o el archivo nunca termina de subir.",
    applies_to: "Adjuntos",
    diagnosis_steps: "1. Revisa tu conexión (prueba abrir otra página).\n2. Prueba con un archivo más pequeño.",
    solution: "1. Cancela y vuelve a intentar: reintentar no duplica el archivo.\n2. Si usas datos móviles o una red inestable, cambia a una red más estable.",
    escalation_conditions: ESCALATE,
    tags: ["adjuntos", "conexión"],
  },
  {
    slug: "datos-desactualizados-despues-de-guardar",
    category: "unexpected",
    title: "Los datos no se actualizan después de guardar",
    symptoms: "Guardé un cambio pero la pantalla sigue mostrando el valor anterior.",
    applies_to: "Web",
    diagnosis_steps: "1. Espera unos segundos: algunas pantallas se actualizan solas cada 30 segundos.\n2. Revisa si apareció un aviso de conflicto («Otro administrador actualizó…»).",
    solution: "1. Recarga la página.\n2. Si apareció un aviso de conflicto, elige «Aplicar mi cambio sobre la versión nueva» para no perder lo que escribiste.",
    escalation_conditions: ESCALATE,
    tags: ["actualizar", "datos", "conflicto"],
  },
  {
    slug: "mensaje-de-error-inesperado",
    category: "unexpected",
    title: "Aparece un mensaje de error inesperado",
    symptoms: "Aparece «No fue posible completar la solicitud» u otro error que no entiendo, o algo se comporta de forma inesperada.",
    applies_to: "Web",
    diagnosis_steps: "1. Anota la hora aproximada y la pantalla donde ocurrió.\n2. Haz una captura del mensaje.\n3. Intenta repetir la acción una vez.",
    solution: "Si el error no se repite, puedes continuar. Si se repite, crea un ticket con la hora, la pantalla, lo que intentabas hacer y la captura: eso permite al equipo investigar sin pedirte más datos.",
    escalation_conditions: "Crea un ticket siempre que el error se repita o te impida trabajar.",
    tags: ["error", "inesperado"],
  },
];

export const articlesSeeder: Seeder = {
  name: "catalog-examples",
  run: async (db) => {
    for (const article of SEED_ARTICLES) {
      const existing = await db.selectFrom("helpdesk.articles").select("id").where("slug", "=", article.slug).executeTakeFirst();
      if (existing) continue;
      const created = await db
        .insertInto("helpdesk.articles")
        .values({
          slug: article.slug,
          category_code: article.category,
          is_example: true,
          published_version_id: null,
          source_ticket_id: null,
          created_by: null,
          archived_at: null,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const version = await db
        .insertInto("helpdesk.article_versions")
        .values({
          article_id: created.id,
          version: 1,
          title: article.title,
          symptoms: article.symptoms,
          applies_to: article.applies_to,
          diagnosis_steps: article.diagnosis_steps,
          solution: article.solution,
          escalation_conditions: article.escalation_conditions,
          tags: article.tags,
          reviewed_at: "2026-10-20",
          valid_until: null,
          published_at: sql`now()`,
          created_by: null,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await db
        .updateTable("helpdesk.articles")
        .set({ status: "published", published_version_id: version.id })
        .where("id", "=", created.id)
        .execute();
    }

    // Incidente de ejemplo vinculado a un artículo (demuestra §03: informar estado y vincular tickets).
    const incidentTitle = "Lentitud al cargar listados (ejemplo)";
    const hasIncident = await db.selectFrom("helpdesk.incidents").select("id").where("title", "=", incidentTitle).executeTakeFirst();
    if (!hasIncident) {
      const article = await db.selectFrom("helpdesk.articles").select("id").where("slug", "=", "tabla-no-carga-datos").executeTakeFirst();
      await db
        .insertInto("helpdesk.incidents")
        .values({
          title: incidentTitle,
          public_summary: "Algunos listados tardan más de lo normal en cargar. El equipo identificó la causa y está aplicando una corrección. (Incidente de ejemplo.)",
          status: "identified",
          category_code: "screens",
          article_id: article?.id ?? null,
          resolved_at: null,
          created_by: null,
        })
        .execute();
    }
  },
};
