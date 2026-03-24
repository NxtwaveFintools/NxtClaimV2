import "@testing-library/jest-dom";

process.env.GEMINI_API_KEY ||= "test-gemini-key";

if (typeof globalThis.Response === "undefined") {
  globalThis.Response = class ResponsePolyfill {
    constructor(body = null, init = {}) {
      this._body = body;
      this.status = typeof init.status === "number" ? init.status : 200;
      this.ok = this.status >= 200 && this.status < 300;
    }

    async blob() {
      if (this._body instanceof Blob) {
        return this._body;
      }

      if (typeof this._body === "string") {
        return new Blob([this._body]);
      }

      if (this._body == null) {
        return new Blob();
      }

      return new Blob([this._body]);
    }
  };
}
