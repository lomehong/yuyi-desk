import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { ConversationStore, type PeerRef } from "./conversations.js";

const tempDirs: string[] = [];
const peer: PeerRef = { key: "agent-1:workspace", title: "Builder", kind: "agent" };

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 })),
  );
});

async function createStore(): Promise<ConversationStore> {
  const dir = await mkdtemp(join(tmpdir(), "yuyi-conversations-"));
  tempDirs.push(dir);
  return new ConversationStore(dir, () => undefined);
}

describe("ConversationStore ack updates", () => {
  it("applies the latest matching ack without exposing correction rows as messages", async () => {
    const store = await createStore();
    await store.append(peer, {
      id: "local-1",
      hubId: "hub-1",
      at: 1,
      dir: "out",
      text: "run",
      ack: { ok: true, detail: "已注入", delivery: "injected" },
    });
    await store.appendAckUpdate(peer.key, "hub-1", { ok: false, detail: "injection failed" });

    const history = await store.history(peer.key);
    expect(history).toHaveLength(1);
    expect(history[0]?.ack).toEqual({ ok: false, detail: "injection failed" });

    const raw = await readFile(join(dirFor(store, peer.key)), "utf8");
    expect(raw).toContain('"type":"ack-update"');
  });

  it("does not overwrite a message with a different hub id", async () => {
    const store = await createStore();
    await store.append(peer, {
      id: "local-1",
      hubId: "hub-1",
      at: 1,
      dir: "out",
      text: "run",
      ack: { ok: true, delivery: "delivered" },
    });
    await store.appendAckUpdate(peer.key, "other-hub", { ok: false });

    expect((await store.history(peer.key))[0]?.ack).toEqual({ ok: true, delivery: "delivered" });
  });

  it("keeps the list ack on the latest message when an older hub id is corrected", async () => {
    const store = await createStore();
    await store.append(peer, {
      id: "local-1",
      hubId: "hub-1",
      at: 1,
      dir: "out",
      text: "first",
      ack: { ok: true, delivery: "injected" },
    });
    await store.append(peer, {
      id: "local-2",
      hubId: "hub-2",
      at: 2,
      dir: "out",
      text: "second",
      ack: { ok: true, delivery: "delivered" },
    });

    await store.appendAckUpdate(peer.key, "hub-1", { ok: false, delivery: "failed" });

    expect((await store.history(peer.key)).map((message) => message.ack?.delivery)).toEqual([
      "failed",
      "delivered",
    ]);
    expect((await store.list())[0]?.lastAck).toEqual({ ok: true, delivery: "delivered" });
  });
});

function dirFor(store: ConversationStore, peerKey: string): string {
  const home = (store as unknown as { dir: string }).dir;
  return join(home, `${peerKey.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120)}.jsonl`);
}

describe("ConversationStore management", () => {
  it("unarchives an archived conversation when a new incoming message arrives", async () => {
    const store = await createStore();
    await store.append(peer, { id: "m1", at: 1, dir: "in", text: "old" });
    await store.setArchived(peer.key, true);
    await store.append(peer, { id: "m2", at: 2, dir: "in", text: "new" });

    const [entry] = await store.list();
    expect(entry?.archivedAt).toBeUndefined();
    expect(entry?.unread).toBe(2);
  });

  it("hides archived rows by default and can include them explicitly", async () => {
    const store = await createStore();
    const other: PeerRef = { key: "agent-2:other", title: "Other", kind: "agent" };
    await store.append(peer, { id: "m1", at: 1, dir: "in", text: "old" });
    await store.append(other, { id: "m2", at: 2, dir: "in", text: "visible" });
    await store.setArchived(peer.key, true);

    expect((await store.list()).map((entry) => entry.peer.key)).toEqual([other.key]);
    expect((await store.list({ includeArchived: true })).map((entry) => entry.peer.key)).toEqual([
      other.key,
      peer.key,
    ]);
  });

  it("sorts pinned conversations first and restores time order after unpinning", async () => {
    const store = await createStore();
    const other: PeerRef = { key: "agent-2:other", title: "Other", kind: "agent" };
    await store.append(peer, { id: "m1", at: 1, dir: "in", text: "older" });
    await store.append(other, { id: "m2", at: 2, dir: "in", text: "newer" });
    await store.setPinned(peer.key, true);
    expect((await store.list()).map((entry) => entry.peer.key)).toEqual([peer.key, other.key]);

    await store.setPinned(peer.key, false);
    expect((await store.list()).map((entry) => entry.peer.key)).toEqual([other.key, peer.key]);
  });

  it("deletes only the local index and message file and emits a change event", async () => {
    const store = await createStore();
    const events: string[] = [];
    store.subscribe((event) => events.push(event.kind));
    await store.append(peer, { id: "m1", at: 1, dir: "in", text: "local" });

    expect(await store.deleteConversation(peer.key)).toBe(true);
    expect(await store.list()).toEqual([]);
    await expect(readFile(dirFor(store, peer.key), "utf8")).rejects.toThrow();
    expect(await store.deleteConversation(peer.key)).toBe(false);
    expect(events).toContain("conversation-changed");
  });
});

describe("ConversationStore search and history windows", () => {
  it("searches Chinese and case-insensitive text in reverse time order with a limit", async () => {
    const store = await createStore();
    await store.append(peer, { id: "m1", at: 1, dir: "in", text: "首次验证" });
    await store.append(peer, { id: "m2", at: 2, dir: "out", text: "REPLY 验证" });
    await store.append(peer, { id: "m3", at: 3, dir: "in", text: "其他" });

    expect((await store.searchMessages("验证")).map((result) => result.message.id)).toEqual([
      "m2",
      "m1",
    ]);
    expect((await store.searchMessages("reply")).map((result) => result.message.id)).toEqual([
      "m2",
    ]);
    expect(
      (await store.searchMessages("验证", { limit: 1 })).map((result) => result.message.id),
    ).toEqual(["m2"]);
    expect(await store.searchMessages("   ")).toEqual([]);
  });

  it("includes archived messages only when requested", async () => {
    const store = await createStore();
    await store.append(peer, { id: "m1", at: 1, dir: "in", text: " archived target " });
    await store.setArchived(peer.key, true);

    expect(await store.searchMessages("target")).toEqual([]);
    const results = await store.searchMessages("target", { includeArchived: true });
    expect(results[0]?.archived).toBe(true);
    expect(results[0]?.message.id).toBe("m1");
  });

  it("skips malformed lines and never exposes ack-update rows as search results", async () => {
    const store = await createStore();
    await store.append(peer, { id: "m1", hubId: "hub-1", at: 1, dir: "out", text: "run" });
    await store.appendAckUpdate(peer.key, "hub-1", { ok: false, delivery: "failed" });
    const file = dirFor(store, peer.key);
    await writeFile(file, `${await readFile(file, "utf8")}not-json\n`, "utf8");

    const results = await store.searchMessages("run");
    expect(results.map((result) => result.message.id)).toEqual(["m1"]);
    expect(results[0]?.message.ack?.delivery).toBe("failed");
  });

  it("honors an aborted search without reading more results", async () => {
    const store = await createStore();
    await store.append(peer, { id: "m1", at: 1, dir: "in", text: "target" });
    const controller = new AbortController();
    controller.abort();

    expect(await store.searchMessages("target", { signal: controller.signal })).toEqual([]);
  });

  it("returns a bounded window around a message and null for an unknown target", async () => {
    const store = await createStore();
    for (let index = 1; index <= 5; index += 1) {
      await store.append(peer, { id: `m${index}`, at: index, dir: "in", text: `message ${index}` });
    }

    expect((await store.historyAround(peer.key, "m3", 1))?.map((message) => message.id)).toEqual([
      "m2",
      "m3",
      "m4",
    ]);
    expect(await store.historyAround(peer.key, "missing", 2)).toBeNull();
  });
});

describe("ConversationStore task messages", () => {
  it("keeps parent links and deduplicates repeated Hub delivery", async () => {
    const store = await createStore();
    const taskPeer: PeerRef = { key: "task:task_root", title: "任务", kind: "task" };
    const message = {
      id: "local-1",
      hubId: "hub-broadcast-1",
      at: 1,
      dir: "out" as const,
      text: "broadcast",
      taskId: "task_child",
      parentTaskId: "task_root",
    };
    await store.append(taskPeer, message);
    await store.append(taskPeer, { ...message, id: "local-duplicate" });

    expect(await store.taskMessages("task_root")).toEqual([message]);
  });

  it("groups real replies by their task root across segments without duplicates", async () => {
    const store = await createStore();
    await store.appendTaskMessage({
      id: "root-1",
      hubId: "hub-root",
      at: 1,
      dir: "out",
      text: "root",
      taskId: "task_root",
    });
    await store.appendTaskMessage({
      id: "child-1",
      hubId: "hub-child",
      at: 2,
      dir: "in",
      text: "child",
      taskId: "task_child",
      parentTaskId: "task_root",
    });
    await store.appendTaskMessage({
      id: "grandchild-1",
      hubId: "hub-grandchild",
      at: 3,
      dir: "in",
      text: "grandchild",
      taskId: "task_grandchild",
      parentTaskId: "task_child",
    });
    await store.appendTaskMessage({
      id: "child-duplicate",
      hubId: "hub-child",
      at: 2,
      dir: "in",
      text: "child",
      taskId: "task_child",
      parentTaskId: "task_root",
    });

    expect((await store.taskMessages("task_root")).map((message) => message.text)).toEqual([
      "root",
      "child",
      "grandchild",
    ]);
  });
});
