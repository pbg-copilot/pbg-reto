import { resolvePrincipal } from "../../modules/auth/repositories/session-principal-repository.js";
import { queryAuthorizedConversation, lockOwnedConversation } from "../../modules/conversations/repositories/conversation-access-repository.js";
import { createConversationTransactions } from "../../modules/conversations/services/conversation-transactions.js";
import { createAuthenticatedTransactionRunner } from "./authenticated-transaction.js";

// Preserve the public API while implementations depend on their specific modules.
export type { AuthorizedClient, AuthorizedClientProfile, Principal, AuthorizedConversation, AuthorizedAccount, AuthorizedAgency } from "./authorization-types.js";
export { resolvePrincipal };
export { getAuthorizedAccount, getAuthorizedAgency } from "../../modules/auth/repositories/account-access-repository.js";
export { findAuthorizedClient, searchAuthorizedClients, getAuthorizedClientProfile } from "../../modules/clients/repositories/client-access-repository.js";
export { getAuthorizedConversation, listAuthorizedConversations } from "../../modules/conversations/repositories/conversation-access-repository.js";

export const withAuthenticatedTransaction = createAuthenticatedTransactionRunner(resolvePrincipal);
export const { withAuthorizedConversationTransaction, withOwnedConversationTransaction } = createConversationTransactions({
  withAuthenticatedTransaction,
  findAuthorizedConversation: (db, principal, conversationId) => queryAuthorizedConversation(db, principal, conversationId, true),
  findOwnedConversation: lockOwnedConversation,
});
