import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import { pool } from "../db.js";
import type { DB } from "./types.js";

// DATE (OID 1082) como texto "YYYY-MM-DD": sin conversión a medianoche local.
pg.types.setTypeParser(1082, (value) => value);

// Kysely usa el mismo pool que el resto del backend: un solo pool por proceso.
export const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });

export type Database = Kysely<DB>;
