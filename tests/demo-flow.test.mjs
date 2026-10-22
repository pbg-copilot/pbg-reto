import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { clientFixtures, futureLocalStart, inBackend, login, query, request } from "./demo-helpers.mjs";

test("PBG-14: demo local reproducible con persistencia real", { timeout: 180_000 }, async (t) => {
  async function step(name, run) {
    let passed = false;
    await t.test(name, async () => { await run(); passed = true; });
    assert.ok(passed, `La demo se detuvo en: ${name}`);
  }
  const primary = await login();
  const secondary = await login("agente002");
  const token = primary.token;
  const clients = clientFixtures(primary.agent.id);
  assert.ok(clients.length >= 2, "La réplica debe contener dos clientes del agente099.");
  assert.ok(clients[0].has_quotes, "La réplica debe contener cotizaciones del agente099.");
  const selected = clients[0];
  const title = `Demo PBG-14 ${randomUUID()}`;
  const conversation = (await request("/api/conversations", { token, method: "POST", body: { title }, status: 201 })).conversation;
  const path = `/api/conversations/${conversation.id}`;
  const selection = (client) => ({ documentPath: client.document_path, clientRecordId: client.client_record_id });
  const chatBody = (kind, content, extra = {}) => ({
    kind, content, expectedClientPath: selected.document_path, expectedClientRecordId: selected.client_record_id, ...extra,
  });
  let appointment;
  try {
    await step("buscar y seleccionar cliente, consultar expediente y cotizaciones", async () => {
      const found = await request(`/api/clients?q=${encodeURIComponent(selected.client_record_id)}`, { token });
      assert.ok(found.clients.some((item) => item.client_record_id === selected.client_record_id));
      await request(`${path}/client`, { token, method: "POST", body: selection(selected) });
      const profile = await request(`${path}/client`, { token });
      assert.equal(profile.client.id, selected.client_record_id);
      const quotes = await request(`${path}/quotes`, { token });
      assert.equal(quotes.quotes_status, "loaded");
      assert.ok(quotes.quotes.length > 0);
      assert.equal(quotes.rules.status, "unavailable");
      assert.ok(quotes.missing.length > 0);
    });

    await step("persistir mensajes y aislar el historial al cambiar cliente", async () => {
      const content = "Mensaje de control de la demo PBG-14";
      await request(`${path}/messages`, { token, method: "POST", body: { content }, status: 201 });
      const saved = await request(path, { token });
      assert.ok(saved.messages.some((item) => item.content === content));
      assert.equal(saved.conversation.active_client_record_id, selected.client_record_id);
      await request(`${path}/client`, { token, method: "POST", body: selection(clients[1]) });
      assert.equal((await request(path, { token })).messages.length, 0);
      await request(`${path}/client`, { token, method: "POST", body: selection(selected) });
      assert.ok((await request(path, { token })).messages.some((item) => item.content === content));
    });

    let confirmation;
    let schedule;
    await step("recuperar captura de datos y confirmación pendiente tras recargar", async () => {
      await request(`${path}/appointment-chat`, { token, method: "POST", body: chatBody("request_details", "Agendar cita"), status: 201 });
      assert.equal((await request(`${path}/appointment-chat/state`, { token })).state, "details");
      // Select a free interval without modifying any pre-existing appointment.
      for (let attempt = 0; attempt < 10; attempt++) {
        const localStart = futureLocalStart();
        const availability = await request(`/api/appointments/availability?${new URLSearchParams({ agentAccountId: primary.agent.id, localStart, durationMinutes: "30", timeZone: "America/Bogota" })}`, { token });
        if (availability.availability_status === "no_conflict") {
          schedule = { action: "create", agentAccountId: primary.agent.id, localStart, durationMinutes: 30, timeZone: "America/Bogota" };
          break;
        }
      }
      assert.ok(schedule, "No se encontró un intervalo libre para la demo.");
      confirmation = (await request(`${path}/appointments/confirm`, { token, method: "POST", body: schedule, status: 201 })).confirmation;
      await request(`${path}/appointment-chat`, { token, method: "POST", body: chatBody("review", "Revisar cita de demostración", { confirmationId: confirmation.id }), status: 201 });
      const restored = await request(`${path}/appointment-chat/state`, { token });
      assert.equal(restored.state, "confirmation");
      assert.equal(restored.confirmation.id, confirmation.id);
      assert.equal(restored.confirmation.interval.start_at, confirmation.interval.start_at);
      assert.equal(restored.confirmation.interval.duration_minutes, 30);
      assert.equal(restored.confirmation.interval.time_zone, "America/Bogota");
    });

    await step("crear cita, recuperar reintento sin duplicados y auditar", async () => {
      const body = { confirmationId: confirmation.id, idempotencyKey: confirmation.id };
      const created = await request(`${path}/appointments`, { token, method: "POST", body, status: 201 });
      appointment = created.appointment;
      const replay = await request(`${path}/appointments`, { token, method: "POST", body });
      assert.equal(replay.idempotent_replay, true);
      assert.equal(replay.appointment.id, appointment.id);
      const [counts] = query(`SELECT
        (SELECT count(*)::int FROM reto.chat_appointments WHERE conversation_id = $1) appointments,
        (SELECT count(*)::int FROM reto.chat_actions WHERE conversation_id = $1 AND idempotency_key = $2) actions`, [conversation.id, confirmation.id]);
      assert.equal(counts.appointments, 1);
      assert.equal(counts.actions, 1);
      const [audit] = query("SELECT outcome, actor_account_id FROM reto.chat_actions WHERE conversation_id = $1 AND idempotency_key = $2", [conversation.id, confirmation.id]);
      assert.equal(audit.outcome, "succeeded");
      assert.equal(audit.actor_account_id, primary.agent.id);
    });

    await step("listar la cita por API y por chat sin proveedor externo", async () => {
      await request(`${path}/appointment-chat`, { token, method: "POST", body: chatBody("created", "Confirmar", { appointmentId: appointment.id }), status: 201 });
      assert.equal((await request(`${path}/appointment-chat/state`, { token })).state, "idle");
      assert.ok((await request(`${path}/appointments`, { token })).appointments.some((item) => item.id === appointment.id));
      const response = await request(`${path}/appointment-chat`, { token, method: "POST", body: chatBody("appointments_list", "Lista las citas del cliente"), status: 201 });
      assert.ok(response.messages.some((item) => item.sender_role === "assistant" && item.content.includes("30 minutos") && item.content.includes("America/Bogota")));
      // The calendar belongs to the client, independently of the conversation that created it.
      const other = (await request("/api/conversations", { token, method: "POST", body: { title: `${title} segunda` }, status: 201 })).conversation;
      await request(`/api/conversations/${other.id}/client`, { token, method: "POST", body: selection(selected) });
      assert.ok((await request(`/api/conversations/${other.id}/appointments`, { token })).appointments.some((item) => item.id === appointment.id));
    });

    await step("rechazar el cruce y conservar una sola cita confirmada", async () => {
      const conflicting = (await request(`${path}/appointments/confirm`, { token, method: "POST", body: schedule, status: 201 })).confirmation;
      const conflict = await request(`${path}/appointments`, { token, method: "POST", body: { confirmationId: conflicting.id, idempotencyKey: conflicting.id }, status: 409 });
      assert.equal(conflict.error, "slot_taken");
      const [counts] = query("SELECT count(*)::int AS count FROM reto.chat_appointments WHERE conversation_id = $1 AND status = 'confirmed'", [conversation.id]);
      assert.equal(counts.count, 1);
      const [audit] = query("SELECT outcome, error_code FROM reto.chat_actions WHERE conversation_id = $1 AND idempotency_key = $2", [conversation.id, conflicting.id]);
      assert.equal(audit.outcome, "conflict");
      assert.equal(audit.error_code, "slot_taken");
    });

    await step("rechazar conversación y cliente ajenos, y devolver búsquedas vacías", async () => {
      const foreign = await request(path, { token: secondary.token, status: 404 });
      assert.equal(foreign.messages, undefined);
      const own = (await request("/api/conversations", { token: secondary.token, method: "POST", body: { title: `${title} acceso` }, status: 201 })).conversation;
      const denied = await request(`/api/conversations/${own.id}/client`, { token: secondary.token, method: "POST", body: selection(selected), status: 404 });
      assert.equal(denied.client, undefined);
      assert.deepEqual((await request(`/api/clients?q=${randomUUID()}`, { token })).clients, []);
    });

    await step("simular caída real del adaptador de IA en loopback sin guardar respuestas", async () => {
      const result = inBackend(`
        import assert from 'node:assert/strict';
        import Fastify from 'fastify';
        import { createServer } from 'node:http';
        import { createHash } from 'node:crypto';
        import { pool } from './dist/infrastructure/database/db.js';
        import { AssistantService } from './dist/modules/assistant/services/assistant-service.js';
        import { PostgresAssistantEvidenceRepository } from './dist/modules/assistant/repositories/assistant-evidence-repository.js';
        import { OpenAiCompatibleAssistantProvider } from './dist/modules/assistant/providers/assistant-provider.js';
        import { registerAssistantRoutes } from './dist/modules/assistant/routes/assistant-routes.js';
        let calls = 0;
        const server = createServer((req, res) => { calls++; req.resume(); res.writeHead(503); res.end('{}'); });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const app = Fastify();
        try {
          const config = { provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:' + server.address().port + '/v1', model: 'demo-local', apiKey: 'demo-local', externalDataAuthorized: true };
          registerAssistantRoutes(app, { pool, digest: token => createHash('sha256').update(token).digest('hex'), tokenOf: () => ${JSON.stringify(token)}, assistantConfig: config, assistantService: new AssistantService(new PostgresAssistantEvidenceRepository(), new OpenAiCompatibleAssistantProvider(config)) });
          const before = await pool.query('SELECT count(*)::int AS n FROM reto.chat_messages WHERE conversation_id = $1', [${JSON.stringify(conversation.id)}]);
          const response = await app.inject({ method: 'POST', url: ${JSON.stringify(`${path}/assistant`)}, payload: { content: 'Resumen para demo de fallo local' } });
          const after = await pool.query('SELECT count(*)::int AS n FROM reto.chat_messages WHERE conversation_id = $1', [${JSON.stringify(conversation.id)}]);
          assert.equal(response.statusCode, 502);
          assert.equal(response.json().error, 'assistant_provider_error');
          assert.equal(before.rows[0].n, after.rows[0].n);
          assert.equal(calls, 1);
          console.log(JSON.stringify({ status: response.statusCode, calls, messagesUnchanged: true }));
        } finally { await app.close(); await new Promise(resolve => server.close(resolve)); await pool.end(); }
      `);
      assert.equal(result.messagesUnchanged, true);
    });

    await step("comprobar persistencia SQL y expiración de sesión secundaria", async () => {
      const [persisted] = query(`SELECT owner_account_id, active_client_record_id,
        (SELECT count(*)::int FROM reto.chat_messages WHERE conversation_id = c.id) AS messages
        FROM reto.chat_conversations c WHERE id = $1`, [conversation.id]);
      assert.equal(persisted.owner_account_id, primary.agent.id);
      assert.equal(persisted.active_client_record_id, selected.client_record_id);
      assert.ok(persisted.messages >= 7);
      query("UPDATE reto.sessions SET expires_at = now() - interval '1 second' WHERE agent_id = $1 RETURNING agent_id", [secondary.agent.id]);
      await request("/auth/me", { token: secondary.token, status: 401 });
    });
  } finally {
    // Release only the appointment created by this run, through the confirmed API flow.
    if (appointment) {
      const cancellation = (await request(`${path}/appointments/confirm`, { token, method: "POST", body: { action: "cancel", appointmentId: appointment.id }, status: 201 })).confirmation;
      await request(`${path}/appointments`, { token, method: "POST", body: { confirmationId: cancellation.id, idempotencyKey: cancellation.id }, status: 201 });
    }
    await request("/auth/logout", { token, method: "POST", status: 204 });
  }
});
