import type { AuthorizedClient, Database, Principal } from "../../../shared/auth/authorization-types.js";
import { findAuthorizedClient } from "./client-access-repository.js";
import type { ClientSelectionAction, ClientSelectionRepository } from "../services/client-selection-ports.js";

export class PostgresClientSelectionRepository implements ClientSelectionRepository {
  findClient(db: Database, principal: Principal, documentPath: string, clientRecordId: string) {
    return findAuthorizedClient(db, principal, documentPath, clientRecordId);
  }

  async setActiveClient(db: Database, conversationId: string, selected: AuthorizedClient) {
    await db.query(
      `UPDATE reto.chat_conversations
          SET active_client_path = $2,
              active_client_record_id = $3,
              updated_at = now()
        WHERE id = $1`,
      [conversationId, selected.document_path, selected.client_record_id],
    );
  }

  async recordSelection(db: Database, principal: Principal, conversationId: string, action: ClientSelectionAction, selected: AuthorizedClient) {
    await db.query(
      `INSERT INTO reto.chat_actions(
         conversation_id, actor_account_id, actor_role, scope_agency_id,
         action_type, entity_type, entity_id, outcome
       ) VALUES($1, $2, $3, $4, $5, 'client', $6, 'succeeded')`,
      [
        conversationId,
        principal.accountId,
        principal.role,
        principal.agencyId,
        action,
        `${selected.document_path}#${selected.client_record_id}`,
      ],
    );
  }
}
