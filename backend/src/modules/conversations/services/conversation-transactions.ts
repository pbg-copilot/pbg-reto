import type { Pool, PoolClient } from "pg";
import type { AuthorizedConversation, Database, Principal } from "../../../shared/auth/authorization-types.js";
import type { AuthenticatedTransactionRunner } from "../../../shared/auth/authenticated-transaction.js";

type ConversationLookup = (db: Database, principal: Principal, conversationId: string) => Promise<AuthorizedConversation | null>;
type ConversationOperation<T> = (client: PoolClient, conversation: AuthorizedConversation, principal: Principal) => Promise<T>;
type ConversationTransactionResult<T> =
  | { authenticated: false }
  | { authenticated: true; authorized: false }
  | { authenticated: true; authorized: true; result: T };

type Dependencies = {
  withAuthenticatedTransaction: AuthenticatedTransactionRunner;
  findAuthorizedConversation: ConversationLookup;
  findOwnedConversation: ConversationLookup;
};

export function createConversationTransactions({ withAuthenticatedTransaction, findAuthorizedConversation, findOwnedConversation }: Dependencies) {
  async function run<T>(
    pool: Pool, tokenHash: string, conversationId: string,
    lookup: ConversationLookup, operation: ConversationOperation<T>,
  ): Promise<ConversationTransactionResult<T>> {
    const transaction = await withAuthenticatedTransaction(pool, tokenHash, async (client, principal) => {
      const conversation = await lookup(client, principal, conversationId);
      if (!conversation) return { authorized: false } as const;
      return { authorized: true, result: await operation(client, conversation, principal) } as const;
    });
    if (!transaction.authenticated) return { authenticated: false };
    if (!transaction.result.authorized) return { authenticated: true, authorized: false };
    return { authenticated: true, authorized: true, result: transaction.result.result };
  }

  function withAuthorizedConversationTransaction<T>(
    pool: Pool, tokenHash: string, conversationId: string, operation: ConversationOperation<T>,
  ): Promise<ConversationTransactionResult<T>> {
    return run(pool, tokenHash, conversationId, findAuthorizedConversation, operation);
  }

  function withOwnedConversationTransaction<T>(
    pool: Pool, tokenHash: string, conversationId: string,
    operation: (client: PoolClient, principal: Principal, conversation: AuthorizedConversation) => Promise<T>,
  ): Promise<ConversationTransactionResult<T>> {
    return run(pool, tokenHash, conversationId, findOwnedConversation,
      (client, conversation, principal) => operation(client, principal, conversation));
  }

  return { withAuthorizedConversationTransaction, withOwnedConversationTransaction };
}
