import { PostgresClientProfileRepository } from "./repositories/client-profile-repository.js";
import { ClientProfileService } from "./services/client-profile-service.js";

export function createClientProfileService(): ClientProfileService {
  return new ClientProfileService(new PostgresClientProfileRepository());
}
