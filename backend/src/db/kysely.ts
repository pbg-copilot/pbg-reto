import { Kysely, PostgresDialect } from "kysely";
import { pool } from "../db.js";
import type { DB } from "./types.js";

// Kysely usa el mismo pool que el resto del backend: un solo pool por proceso.
export const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });

export type Database = Kysely<DB>;
