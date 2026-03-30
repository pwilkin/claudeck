export class MessageStream {
  queue = [];
  resolve = null;
  reject = null;
  isDone = false;
  started = false;

  [Symbol.asyncIterator]() {
    if (this.started) throw new Error("Stream can only be iterated once");
    this.started = true;
    return this;
  }

  next() {
    if (this.queue.length > 0)
      return Promise.resolve({ done: false, value: this.queue.shift() });
    if (this.isDone)
      return Promise.resolve({ done: true, value: undefined });
    return new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }

  push(msg) {
    if (this.isDone) return;
    if (this.resolve) {
      const r = this.resolve;
      this.resolve = null;
      this.reject = null;
      r({ done: false, value: msg });
    } else {
      this.queue.push(msg);
    }
  }

  close() {
    this.isDone = true;
    if (this.resolve) {
      const r = this.resolve;
      this.resolve = null;
      this.reject = null;
      r({ done: true, value: undefined });
    }
  }

  error(err) {
    if (this.reject) {
      const r = this.reject;
      this.resolve = null;
      this.reject = null;
      r(err);
    }
  }
}
