import test from "node:test";
import assert from "node:assert/strict";
import {
  resolvePrincipal, withAuthenticatedTransaction,
  withAuthorizedConversationTransaction, withOwnedConversationTransaction,
  getAuthorizedConversation, findAuthorizedClient, searchAuthorizedClients,
  getAuthorizedClientProfile, listAuthorizedConversations, getAuthorizedAccount, getAuthorizedAgency,
} from "../../backend/dist/shared/auth/authorization.js";
import { createAuthenticatedTransactionRunner } from "../../backend/dist/shared/auth/authenticated-transaction.js";
import { createConversationTransactions } from "../../backend/dist/modules/conversations/services/conversation-transactions.js";

const principal = { accountId: "agent", role: "agent", agencyId: "agency" };
const conversation = { id: "conversation", owner_account_id: "agent", active_client_path: null, active_client_record_id: null, status: "active" };

function fixture(options = {}) {
  const trace = [];
  const released = [];
  const client = {
    async query(sql, params) {
      const statement = sql.replace(/\s+/g, " ").trim();
      trace.push({ statement, params });
      if (options.fail?.[statement]) throw options.fail[statement];
      if (statement.includes("FROM reto.sessions")) {
        if (options.sessionError) throw options.sessionError;
        return { rows: options.authenticated === false ? [] : [{ id: principal.accountId, role: principal.role, agency_id: principal.agencyId }] };
      }
      if (statement.includes("FROM reto.chat_conversations")) return { rows: options.authorized === false ? [] : [conversation] };
      return { rows: [] };
    },
    release(error) { released.push(error); },
  };
  const pool = { async connect() { return client; } };
  return { client, pool, trace, released };
}
const statements = (f) => f.trace.map(({ statement }) => statement);

test("authenticated operation uses the same connection for session, work and commit", async () => {
  const f = fixture();
  const result = await withAuthenticatedTransaction(f.pool, "hash", async (client, actor) => {
    assert.equal(client, f.client);
    assert.deepEqual(actor, principal);
    await client.query("SELECT 'work'");
    return { saved: true };
  });
  assert.deepEqual(result, { authenticated: true, result: { saved: true } });
  assert.equal(statements(f)[0], "BEGIN");
  assert.ok(statements(f)[1].includes("FROM reto.sessions"));
  assert.equal(statements(f).at(-1), "COMMIT");
  assert.deepEqual(f.released, [undefined]);
});

test("missing session rolls back without calling the operation", async () => {
  const f = fixture({ authenticated: false });
  const result = await withAuthenticatedTransaction(f.pool, "hash", async () => assert.fail("Operation must not run"));
  assert.deepEqual(result, { authenticated: false });
  assert.equal(statements(f).at(-1), "ROLLBACK");
  assert.ok(!statements(f).includes("COMMIT"));
  assert.deepEqual(f.released, [undefined]);
});

for (const stage of ["session", "operation", "COMMIT"]) {
  test(`${stage} failure rolls back and preserves the original error`, async () => {
    const failure = new Error(stage);
    const f = fixture({ sessionError: stage === "session" ? failure : undefined, fail: stage === "COMMIT" ? { COMMIT: failure } : {} });
    await assert.rejects(() => withAuthenticatedTransaction(f.pool, "hash", async () => {
      if (stage === "operation") throw failure;
      return "saved";
    }), (error) => error === failure);
    assert.equal(statements(f).at(-1), "ROLLBACK");
    assert.deepEqual(f.released, [undefined]);
  });
}

test("BEGIN failure releases the connection without rolling back an unstarted transaction", async () => {
  const failure = new Error("begin");
  const f = fixture({ fail: { BEGIN: failure } });
  await assert.rejects(() => withAuthenticatedTransaction(f.pool, "hash", async () => assert.fail()), (error) => error === failure);
  assert.deepEqual(statements(f), ["BEGIN"]);
  assert.deepEqual(f.released, [undefined]);
});

for (const rollbackFailure of [new Error("rollback"), "connection lost"]) {
  test(`rollback failure marks the connection unusable (${typeof rollbackFailure})`, async () => {
    const original = new Error("operation failed");
    const f = fixture({ fail: { ROLLBACK: rollbackFailure } });
    await assert.rejects(() => withAuthenticatedTransaction(f.pool, "hash", async () => { throw original; }), (error) => error === original);
    assert.equal(f.released.length, 1);
    assert.ok(f.released[0] instanceof Error);
    if (rollbackFailure instanceof Error) assert.equal(f.released[0], rollbackFailure);
  });
}

test("principal resolution can be replaced without replacing the transaction lifecycle", async () => {
  const f = fixture();
  const run = createAuthenticatedTransactionRunner(async (db, hash) => {
    assert.equal(db, f.client); assert.equal(hash, "hash"); return principal;
  });
  assert.deepEqual(await run(f.pool, "hash", async () => 7), { authenticated: true, result: 7 });
  assert.deepEqual(statements(f), ["BEGIN", "COMMIT"]);
});

for (const [mode, run] of [["authorized", withAuthorizedConversationTransaction], ["owned", withOwnedConversationTransaction]]) {
  test(`${mode} lookup locks the conversation and preserves callback argument order`, async () => {
    const f = fixture();
    const result = await run(f.pool, "hash", conversation.id, async (client, second, third) => {
      assert.equal(client, f.client);
      assert.deepEqual(mode === "owned" ? second : third, principal);
      assert.equal(mode === "owned" ? third : second, conversation);
      return "done";
    });
    assert.deepEqual(result, { authenticated: true, authorized: true, result: "done" });
    const lookup = f.trace.find(({ statement }) => statement.includes("FROM reto.chat_conversations"));
    assert.ok(lookup.statement.endsWith("FOR UPDATE"));
    assert.deepEqual(lookup.params.slice(0, 2), [conversation.id, principal.accountId]);
    // Client selection needs ownership lookup even before a new client is authorized.
    assert.equal(lookup.statement.includes("pbg_state_documents"), mode === "authorized");
    assert.equal(statements(f).at(-1), "COMMIT");
  });
  test(`${mode} lookup skips the callback when access is denied`, async () => {
    const f = fixture({ authorized: false });
    assert.deepEqual(await run(f.pool, "hash", conversation.id, async () => assert.fail()), { authenticated: true, authorized: false });
    assert.equal(statements(f).at(-1), "COMMIT");
  });
  test(`${mode} lookup never runs without authentication`, async () => {
    const f = fixture({ authenticated: false });
    assert.deepEqual(await run(f.pool, "hash", conversation.id, async () => assert.fail()), { authenticated: false });
    assert.ok(!f.trace.some(({ statement }) => statement.includes("FROM reto.chat_conversations")));
  });
}

test("conversation lookup dependencies are replaceable and failures roll back", async () => {
  const f = fixture();
  const error = new Error("lookup failed");
  const transactions = createConversationTransactions({
    withAuthenticatedTransaction,
    findAuthorizedConversation: async () => { throw error; },
    findOwnedConversation: async () => conversation,
  });
  await assert.rejects(() => transactions.withAuthorizedConversationTransaction(f.pool, "hash", conversation.id, async () => assert.fail()), (failure) => failure === error);
  assert.equal(statements(f).at(-1), "ROLLBACK");
});

test("read-only conversation lookup does not add a write lock", async () => {
  const f = fixture();
  assert.equal(await getAuthorizedConversation(f.client, principal, conversation.id), conversation);
  assert.ok(!statements(f)[0].endsWith("FOR UPDATE"));
});

test("public facade keeps session, resource reads and empty result conventions", async () => {
  const db = { async query() { return { rows: [] }; } };
  assert.equal(await resolvePrincipal(db, "hash"), null);
  assert.equal(await findAuthorizedClient(db, principal, "book", "client"), null);
  assert.equal(await getAuthorizedClientProfile(db, principal, "book", "client"), null);
  assert.equal(await getAuthorizedAccount(db, principal, "account"), null);
  assert.equal(await getAuthorizedAgency(db, principal, "agency"), null);
  assert.deepEqual(await searchAuthorizedClients(db, principal, "Ana", 20), []);
  assert.deepEqual(await listAuthorizedConversations(db, principal, "Ana"), []);
});
