/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWeChatMessageSearch } from "./wechat-search-store";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const calls = vi.hoisted(() => ({
  hosts: ["host-1"],
  hostObjects: new Map<string, { serverId: string; connections: Array<Record<string, unknown>> }>(),
  requests: new Map<string, Array<Deferred<unknown>>>(),
}));

vi.mock("@/runtime/host-runtime", () => ({
  useHosts: () =>
    calls.hosts.map((serverId) => {
      const existing = calls.hostObjects.get(serverId);
      if (existing) return existing;
      const created = {
        serverId,
        connections: [{ type: "directTcp", endpoint: "localhost:6767" }],
      };
      calls.hostObjects.set(serverId, created);
      return created;
    }),
}));

vi.mock("@/yuyi/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/yuyi/api")>();
  return {
    ...actual,
    createYuyiClient: (host: { serverId: string }) => ({
      chats: {
        searchChatMessages: (query: string) => {
          const key = `${host.serverId}:${query}`;
          const pending = deferred<unknown>();
          const list = calls.requests.get(key) ?? [];
          list.push(pending);
          calls.requests.set(key, list);
          return pending.promise;
        },
      },
    }),
  };
});

function searchResult(id: string) {
  return {
    results: [
      {
        peer: { key: "agent-1:one", title: "One", kind: "agent" },
        message: { id, at: 1, dir: "in", text: id },
        summary: id,
        archived: false,
      },
    ],
  };
}

async function flushSearch() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
}

describe("useWeChatMessageSearch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    calls.hosts = ["host-1"];
    calls.requests.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces input and ignores a late response from the previous query", async () => {
    const view = renderHook(({ query }) => useWeChatMessageSearch("host-1", query), {
      initialProps: { query: "old" },
    });
    await flushSearch();
    view.rerender({ query: "new" });
    await flushSearch();

    calls.requests.get("host-1:new")![0]!.resolve(searchResult("new result"));
    await act(async () => undefined);
    expect(view.result.current.results[0]?.message.id).toBe("new result");
    calls.requests.get("host-1:old")![0]!.resolve(searchResult("old result"));
    await act(async () => undefined);
    expect(view.result.current.results[0]?.message.id).toBe("new result");
  });

  it("keeps a late response from the previous host out of the current snapshot", async () => {
    const view = renderHook(({ host }) => useWeChatMessageSearch(host, "target"), {
      initialProps: { host: "host-1" },
    });
    await flushSearch();
    calls.hosts = ["host-1", "host-2"];
    view.rerender({ host: "host-2" });
    await flushSearch();

    calls.requests.get("host-2:target")![0]!.resolve(searchResult("host two"));
    await act(async () => undefined);
    expect(view.result.current.results[0]?.message.id).toBe("host two");
    calls.requests.get("host-1:target")![0]!.resolve(searchResult("host one"));
    await act(async () => undefined);
    expect(view.result.current.results[0]?.message.id).toBe("host two");
  });

  it("does not search an empty query and exposes request failures", async () => {
    const view = renderHook(({ query }) => useWeChatMessageSearch("host-1", query), {
      initialProps: { query: " " },
    });
    await flushSearch();
    expect(calls.requests.size).toBe(0);

    view.rerender({ query: "failure" });
    await flushSearch();
    calls.requests.get("host-1:failure")![0]!.reject(new Error("HTTP 500"));
    await act(async () => undefined);
    expect(view.result.current.error).toBe("HTTP 500");
    expect(view.result.current.loading).toBe(false);
  });
});
