import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
const root = new URL("../data/", import.meta.url);
const manifest = JSON.parse(
  readFileSync(new URL("manifest.json", root), "utf8"),
);
test("full replica preserves source table counts except explicit security exclusions", () => {
  assert.equal(manifest.format_version, 2);
  assert.equal(manifest.table_count, Object.keys(manifest.table_counts).length);
  assert.ok(manifest.table_count > 150);
  for (const [table, count] of Object.entries(manifest.source_table_counts))
    assert.equal(
      manifest.table_counts[table],
      manifest.empty_security_tables.includes(table) ? 0 : count,
      table,
    );
  assert.deepEqual(manifest.role_counts, {
    agent: 97,
    admin: 5,
    appeal_officer: 1,
    agency_owner: 4,
  });
  const aliases = JSON.parse(
    readFileSync(new URL("test-users.json", root), "utf8"),
  );
  assert.equal(
    aliases.find((a) => a.email === "agente067@reto.example").role,
    "agency_owner",
  );
  assert.equal(aliases.length, 107);
});
test("every distributed SQL shard matches its checksum and contains only test emails", async () => {
  for (const file of manifest.files) {
    assert.ok(file.bytes < 95 * 1024 * 1024, "GitHub-compatible shard size");
    const hash = createHash("sha256");
    for await (const part of createReadStream(new URL(file.path, root)))
      hash.update(part);
    assert.equal(hash.digest("hex"), file.sha256, file.path);
    const stream = createReadStream(new URL(file.path, root)).pipe(
      createGunzip(),
    );
    const decoder = new TextDecoder();
    let tail = "";
    for await (const part of stream) {
      const text = tail + decoder.decode(part, { stream: true });
      const matches = text.includes("@")
        ? [
            ...text.matchAll(
              /(?<![A-Za-z0-9._%+\-])[A-Za-z0-9._%+\-]{1,128}@[A-Za-z0-9.-]{1,255}\.[A-Za-z]{2,}/g,
            ),
          ]
        : [];
      for (const match of matches) {
        if (match.index + match[0].length > text.length - 256) continue;
        assert.ok(
          match[0].endsWith("@reto.example"),
          "Only masked email addresses may be exported",
        );
      }
      assert.equal(
        /(?:AKIA|ASIA)[A-Z0-9]{16}|ghp_[A-Za-z0-9]{20,}|sk_live_[A-Za-z0-9]{15,}/.test(
          text,
        ),
        false,
        "No production credentials",
      );
      tail = text.slice(-512);
    }
    for (const match of tail.matchAll(
      /(?<![A-Za-z0-9._%+\-])[A-Za-z0-9._%+\-]{1,128}@[A-Za-z0-9.-]{1,255}\.[A-Za-z]{2,}/g,
    ))
      assert.ok(
        match[0].endsWith("@reto.example"),
        "Only masked email addresses may be exported",
      );
  }
});
