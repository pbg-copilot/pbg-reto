import type { Seeder } from "../seed.js";

// Las categorías cubren los ejemplos que pide el PDF (§03).
const categories = [
  { code: "access", name: "Acceso", sort: 10 },
  { code: "permissions", name: "Permisos", sort: 20 },
  { code: "screens", name: "Funcionamiento de pantallas", sort: 30 },
  { code: "uploads", name: "Carga de archivos", sort: 40 },
  { code: "unexpected", name: "Comportamiento inesperado", sort: 50 },
  { code: "other", name: "Otro", sort: 90 },
];

// Sin objetivos de atención: el admin los configura (spec 007). No se prometen plazos.
const priorities = [
  { code: "low", name: "Baja", rank: 10 },
  { code: "medium", name: "Media", rank: 20 },
  { code: "high", name: "Alta", rank: 30 },
  { code: "urgent", name: "Urgente", rank: 40 },
];

export const ticketCatalogsSeeder: Seeder = {
  name: "ticket-catalogs",
  run: async (db) => {
    await db.insertInto("helpdesk.categories").values(categories).onConflict((oc) => oc.column("code").doNothing()).execute();
    await db
      .insertInto("helpdesk.priorities")
      .values(priorities.map((p) => ({ ...p, first_response_target_minutes: null, resolution_target_minutes: null })))
      .onConflict((oc) => oc.column("code").doNothing())
      .execute();
  },
};
