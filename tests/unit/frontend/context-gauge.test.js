// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetState = vi.fn();
const mockSetState = vi.fn();

const mockContextGauge = {
  classList: {
    _classes: new Set(),
    add(c) { this._classes.add(c); },
    remove(...cs) { cs.forEach((c) => this._classes.delete(c)); },
    contains(c) { return this._classes.has(c); },
  },
  title: "",
};
const mockContextGaugeFill = {
  style: { width: "" },
  classList: {
    _classes: new Set(),
    add(c) { this._classes.add(c); },
    remove(...cs) { cs.forEach((c) => this._classes.delete(c)); },
    contains(c) { return this._classes.has(c); },
  },
};
const mockContextGaugeLabel = { textContent: "" };

vi.mock("../../../public/js/core/store.js", () => ({
  getState: (...args) => mockGetState(...args),
  setState: (...args) => mockSetState(...args),
}));

vi.mock("../../../public/js/core/dom.js", () => ({
  $: {
    contextGauge: mockContextGauge,
    contextGaugeFill: mockContextGaugeFill,
    contextGaugeLabel: mockContextGaugeLabel,
  },
}));

let updateContextGauge, resetContextGauge;

beforeEach(async () => {
  vi.resetModules();

  const freshTokens = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, contextWindow: null };
  mockGetState.mockReset();
  mockSetState.mockReset();
  mockGetState.mockReturnValue(freshTokens);

  // Reset mock DOM element state
  mockContextGauge.classList._classes.clear();
  mockContextGauge.title = "";
  mockContextGaugeFill.style.width = "";
  mockContextGaugeFill.classList._classes.clear();
  mockContextGaugeLabel.textContent = "";

  vi.doMock("../../../public/js/core/store.js", () => ({
    getState: (...args) => mockGetState(...args),
    setState: (...args) => mockSetState(...args),
  }));

  vi.doMock("../../../public/js/core/dom.js", () => ({
    $: {
      contextGauge: mockContextGauge,
      contextGaugeFill: mockContextGaugeFill,
      contextGaugeLabel: mockContextGaugeLabel,
    },
  }));

  const mod = await import("../../../public/js/ui/context-gauge.js");
  updateContextGauge = mod.updateContextGauge;
  resetContextGauge = mod.resetContextGauge;
});

describe("context-gauge", () => {
  describe("updateContextGauge", () => {
    it("accumulates input tokens and calls setState", () => {
      updateContextGauge(100, 0, 0, 0);
      expect(mockSetState).toHaveBeenCalledWith("sessionTokens", expect.objectContaining({ input: 100 }));
    });

    it("passes all token types to setState", () => {
      updateContextGauge(100, 50, 200, 30);
      expect(mockSetState).toHaveBeenCalledWith("sessionTokens", expect.objectContaining({
        input: 100,
        output: 50,
        cacheRead: 200,
        cacheCreation: 30,
      }));
    });

    it("replaces tokens on each call (no accumulation)", () => {
      updateContextGauge(100, 0, 0, 0);
      updateContextGauge(50, 0, 0, 0);
      expect(mockContextGaugeLabel.textContent).toContain("50");
      expect(mockContextGaugeLabel.textContent).not.toContain("150");
    });

    it("renders gauge label with formatted tokens (input-only for context)", () => {
      updateContextGauge(1500, 500, 0, 0);
      // totalInput = input + cacheRead + cacheCreation = 1500, limit = 200000, pct = 1%
      expect(mockContextGaugeLabel.textContent).toBe("1.5k/200.0k · 1%");
    });

    it("sets gauge fill width as percentage", () => {
      // 100000 / 200000 = 50%
      updateContextGauge(100000, 0, 0, 0);
      expect(mockContextGaugeFill.style.width).toBe("50%");
    });

    it("adds warning class when usage >= 50%", () => {
      updateContextGauge(100000, 0, 0, 0); // 50%
      expect(mockContextGaugeFill.classList.contains("warning")).toBe(true);
      expect(mockContextGauge.classList.contains("warning")).toBe(true);
    });

    it("adds critical class when usage >= 80%", () => {
      updateContextGauge(160000, 0, 0, 0); // 80%
      expect(mockContextGaugeFill.classList.contains("critical")).toBe(true);
      expect(mockContextGauge.classList.contains("critical")).toBe(true);
    });

    it("does not add warning or critical class when usage < 50%", () => {
      updateContextGauge(10000, 0, 0, 0); // 5%
      expect(mockContextGaugeFill.classList.contains("warning")).toBe(false);
      expect(mockContextGaugeFill.classList.contains("critical")).toBe(false);
    });

    it("removes hidden class from gauge on render", () => {
      mockContextGauge.classList.add("hidden");
      updateContextGauge(1000, 0, 0, 0);
      expect(mockContextGauge.classList.contains("hidden")).toBe(false);
    });

    it("handles undefined/null token values gracefully", () => {
      updateContextGauge(undefined, null, undefined, null);
      expect(mockSetState).toHaveBeenCalledWith("sessionTokens", expect.objectContaining({
        input: 0,
        output: 0,
      }));
    });
  });

  describe("resetContextGauge", () => {
    it("sets sessionTokens to zeroed object", () => {
      resetContextGauge();
      expect(mockSetState).toHaveBeenCalledWith("sessionTokens", {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheCreation: 0,
        contextWindow: null,
      });
    });

    it("adds hidden class to gauge", () => {
      mockContextGauge.classList._classes.clear();
      resetContextGauge();
      expect(mockContextGauge.classList.contains("hidden")).toBe(true);
    });
  });

  describe("formatTokens (via gauge label output)", () => {
    it("formats millions with M suffix", () => {
      updateContextGauge(1_000_000, 0, 0, 0);
      expect(mockContextGaugeLabel.textContent).toContain("1.0M");
    });

    it("formats thousands with k suffix", () => {
      updateContextGauge(5000, 0, 0, 0);
      expect(mockContextGaugeLabel.textContent).toContain("5.0k");
    });

    it("formats small numbers as plain string", () => {
      updateContextGauge(500, 0, 0, 0);
      expect(mockContextGaugeLabel.textContent).toBe("500/200.0k · 0%");
    });
  });
});
