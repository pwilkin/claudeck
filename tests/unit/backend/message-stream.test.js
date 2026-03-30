import { describe, it, expect, vi } from "vitest";
import { MessageStream } from "../../../server/message-stream.js";

describe("MessageStream", () => {
  it("yields pushed messages in order", async () => {
    const stream = new MessageStream();
    stream.push("a");
    stream.push("b");

    const iter = stream[Symbol.asyncIterator]();
    const r1 = await iter.next();
    expect(r1).toEqual({ done: false, value: "a" });
    const r2 = await iter.next();
    expect(r2).toEqual({ done: false, value: "b" });
  });

  it("blocks on next() until push() resolves it", async () => {
    const stream = new MessageStream();
    const iter = stream[Symbol.asyncIterator]();

    const nextPromise = iter.next();
    await new Promise((r) => setTimeout(r, 10));

    stream.push("delayed");
    const result = await nextPromise;
    expect(result).toEqual({ done: false, value: "delayed" });
  });

  it("returns done:true after close()", async () => {
    const stream = new MessageStream();
    const iter = stream[Symbol.asyncIterator]();

    stream.push("first");
    await iter.next();

    stream.close();
    const result = await iter.next();
    expect(result).toEqual({ done: true, value: undefined });
  });

  it("returns done:true immediately when already closed", async () => {
    const stream = new MessageStream();
    stream.close();

    const iter = stream[Symbol.asyncIterator]();
    const result = await iter.next();
    expect(result).toEqual({ done: true, value: undefined });
  });

  it("resolves pending next() with done:true on close()", async () => {
    const stream = new MessageStream();
    const iter = stream[Symbol.asyncIterator]();

    const nextPromise = iter.next();
    stream.close();
    const result = await nextPromise;
    expect(result).toEqual({ done: true, value: undefined });
  });

  it("ignores push() after close()", async () => {
    const stream = new MessageStream();
    stream.close();
    stream.push("ignored");

    const iter = stream[Symbol.asyncIterator]();
    const result = await iter.next();
    expect(result).toEqual({ done: true, value: undefined });
  });

  it("throws on second iterator", () => {
    const stream = new MessageStream();
    stream[Symbol.asyncIterator]();
    expect(() => stream[Symbol.asyncIterator]()).toThrow("Stream can only be iterated once");
  });

  it("rejects pending next() on error()", async () => {
    const stream = new MessageStream();
    const iter = stream[Symbol.asyncIterator]();

    const nextPromise = iter.next();
    stream.error(new Error("test error"));
    await expect(nextPromise).rejects.toThrow("test error");
  });

  it("queues multiple pushes without a pending consumer", async () => {
    const stream = new MessageStream();
    stream.push("x");
    stream.push("y");
    stream.push("z");

    const iter = stream[Symbol.asyncIterator]();
    expect((await iter.next()).value).toBe("x");
    expect((await iter.next()).value).toBe("y");
    expect((await iter.next()).value).toBe("z");
  });

  it("handles push after previous push was queued (no pending next)", async () => {
    const stream = new MessageStream();
    const iter = stream[Symbol.asyncIterator]();

    stream.push("a");
    expect((await iter.next()).value).toBe("a");

    stream.push("b");
    expect((await iter.next()).value).toBe("b");
  });
});
