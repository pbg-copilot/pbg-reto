import { PostgresClientQuoteRepository } from "./repositories/client-quote-repository.js";
import { ClientQuoteService } from "./services/client-quote-service.js";

export function createClientQuoteService(): ClientQuoteService {
  return new ClientQuoteService(new PostgresClientQuoteRepository());
}
