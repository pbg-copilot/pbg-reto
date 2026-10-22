import type { PoolClient } from "pg";
import type { Principal } from "../../../shared/auth/authorization-types.js";
import type { FollowUpRecord, FollowUpWrite } from "../domain/follow-up-model.js";
import type { FollowUpRepository } from "../services/follow-up-ports.js";

export type { FollowUpRecord } from "../domain/follow-up-model.js";

export class PostgresFollowUpRepository implements FollowUpRepository {
  async listPending(client: PoolClient, actorAccountId: string, clientPath: string, clientRecordId: string) {
    const { rows } = await client.query<FollowUpRecord>(
      `SELECT id, description, due_date::text AS due_date, status, created_at
         FROM reto.chat_follow_ups
        WHERE created_by_account_id = $1 AND client_document_path = $2
          AND client_record_id = $3 AND status = 'pending'
        ORDER BY due_date, created_at, id`,
      [actorAccountId, clientPath, clientRecordId],
    );
    return rows;
  }

  async create(
    client: PoolClient,
    followUp: FollowUpWrite,
  ): Promise<FollowUpRecord | null> {
    const { rows } = await client.query<FollowUpRecord>(
      `INSERT INTO reto.chat_follow_ups(
         conversation_id, client_document_path, client_record_id,
         created_by_account_id, description, due_date
       )
       SELECT $1, $2, $3, $4, $5, $6::date
        WHERE $6::date >= (now() AT TIME ZONE 'America/Bogota')::date
       RETURNING id, description, due_date::text AS due_date, status, created_at`,
      [followUp.conversationId, followUp.clientPath, followUp.clientRecordId,
        followUp.actorId, followUp.description, followUp.dueDate],
    );
    return rows[0] ?? null;
  }

  async complete(client: PoolClient, actorAccountId: string, clientPath: string, clientRecordId: string, followUpId: string) {
    const { rows } = await client.query<FollowUpRecord>(
      `UPDATE reto.chat_follow_ups
          SET status = 'completed', completed_at = now()
        WHERE id = $1 AND created_by_account_id = $2
          AND client_document_path = $3 AND client_record_id = $4
          AND status = 'pending'
        RETURNING id, description, due_date::text AS due_date, status, created_at`,
      [followUpId, actorAccountId, clientPath, clientRecordId],
    );
    return rows[0] ?? null;
  }

  async recordAction(
    client: PoolClient,
    conversationId: string,
    principal: Principal,
    action: "follow_up.created" | "follow_up.completed",
    followUpId: string,
  ) {
    await client.query(
      `INSERT INTO reto.chat_actions(
         conversation_id, actor_account_id, actor_role, scope_agency_id,
         action_type, entity_type, entity_id, outcome
       ) VALUES($1, $2, $3, $4, $5, 'follow_up', $6, 'succeeded')`,
      [conversationId, principal.accountId, principal.role, principal.agencyId, action, followUpId],
    );
    await client.query("UPDATE reto.chat_conversations SET updated_at = now() WHERE id = $1", [conversationId]);
  }
}
