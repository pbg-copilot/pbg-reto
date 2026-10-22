import type { PoolClient } from "pg";
import type { Principal } from "../../../shared/auth/authorization.js";

export async function recordAppointmentAction(
  client: PoolClient,
  principal: Principal,
  conversationId: string,
  actionType: string,
  entityId: string,
  outcome: "succeeded" | "rejected" | "conflict" | "failed",
  errorCode: string | null,
  idempotencyKey: string,
  idempotencyFingerprint: string,
  resultSnapshot: object,
): Promise<void> {
  await client.query(
    `INSERT INTO reto.chat_actions(
       conversation_id, actor_account_id, actor_role, scope_agency_id,
       action_type, entity_type, entity_id, outcome, error_code,
       idempotency_key, idempotency_fingerprint, result_snapshot
     ) VALUES($1, $2, $3, $4, $5, 'appointment', $6, $7, $8, $9, $10, $11::jsonb)`,
    [
      conversationId,
      principal.accountId,
      principal.role,
      principal.agencyId,
      actionType,
      entityId,
      outcome,
      errorCode,
      idempotencyKey,
      idempotencyFingerprint,
      JSON.stringify(resultSnapshot),
    ],
  );
}
