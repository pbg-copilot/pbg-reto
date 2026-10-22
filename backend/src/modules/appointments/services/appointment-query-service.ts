import type { AppointmentRow } from "../domain/appointment-model.js";
import type { AppointmentQueryAccess, AppointmentQueryRepository, AppointmentQueryTransactions } from "./appointment-query-ports.js";

export class AppointmentQueryService {
  constructor(
    private readonly transactions: AppointmentQueryTransactions,
    private readonly repository: AppointmentQueryRepository,
    private readonly access: AppointmentQueryAccess,
  ) {}

  list(tokenHash: string, conversationId: string) {
    return this.transactions.authorized(tokenHash, conversationId, async (client, conversation, principal) => {
      const clientPath = conversation.active_client_path;
      const clientRecordId = conversation.active_client_record_id;
      if (!clientPath || !clientRecordId) return { state: "client_not_selected" as const };
      if (!(await this.access.getProfile(client, principal, clientPath, clientRecordId)))
        return { state: "client_not_found" as const };

      const rows = await this.repository.listConfirmed(client, clientPath, clientRecordId);
      const appointments: AppointmentRow[] = [];
      for (const row of rows) {
        if (await this.access.canReadAgent(client, principal, row.agent_account_id))
          appointments.push(row);
      }
      return { state: "loaded" as const, appointments };
    });
  }
}

export type AppointmentQueryResult = Awaited<ReturnType<AppointmentQueryService["list"]>>;
