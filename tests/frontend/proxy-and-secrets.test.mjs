import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

/**
 * Helper to transpile and load TS modules in Node's native test runner.
 */
function loadModule(relPath, env = {}) {
  const filePath = path.resolve(relPath);
  const source = fs.readFileSync(filePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });

  const moduleObj = { exports: {} };
  const context = vm.createContext({
    exports: moduleObj.exports,
    module: moduleObj,
    require: (id) => {
      if (id === "next/server") {
        return {
          NextResponse: {
            json: (body, init) => ({
              status: init?.status || 200,
              body,
              json: async () => body,
            }),
          },
        };
      }
      throw new Error(`Unexpected require: ${id}`);
    },
    process: { env },
    fetch: globalThis.fetch,
    AbortController: globalThis.AbortController,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    Promise: globalThis.Promise,
  });

  vm.runInContext(transpiled.outputText, context);
  return moduleObj.exports;
}

test("getServiceConfig never returns or exposes backend secret tokens", () => {
  const { getServiceConfig } = loadModule("src/services/api-client.ts", {
    FASTAPI_API_KEY: "super-secret-backend-token-12345",
    JOBPILOT_API_AUTH_TOKEN: "another-secret-token",
  });

  const config = getServiceConfig();
  assert.equal(typeof config, "object");
  assert.equal("apiKey" in config, false, "Client config must not contain apiKey field");

  const jsonStr = JSON.stringify(config);
  assert.ok(!jsonStr.includes("super-secret-backend-token-12345"), "Token must not be present in client config");
  assert.ok(!jsonStr.includes("another-secret-token"), "Token must not be present in client config");
});

test("client source code contains zero NEXT_PUBLIC_FASTAPI_API_KEY occurrences", () => {
  const files = [
    "src/services/api-client.ts",
    "src/types/jobpilot.ts",
    "src/context/JobPilotContext.tsx",
    "src/app/review/page.tsx",
  ];

  for (const rel of files) {
    const content = fs.readFileSync(path.resolve(rel), "utf8");
    assert.ok(
      !content.includes("NEXT_PUBLIC_FASTAPI_API_KEY"),
      `File ${rel} must not contain NEXT_PUBLIC_FASTAPI_API_KEY`
    );
  }
});

test("Next.js server proxy rejects unpermitted paths with 403 Forbidden", async () => {
  const { GET, POST } = loadModule("src/app/api/backend/[...path]/route.ts", {
    FASTAPI_API_KEY: "secret-test-token",
    FASTAPI_URL: "http://127.0.0.1:8000",
  });

  // Attempting to access an unwhitelisted endpoint
  const unwhitelistedReq = new Request("http://localhost/api/backend/admin/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

  const response = await POST(unwhitelistedReq, {
    params: Promise.resolve({ path: ["admin", "config"] }),
  });

  assert.equal(response.status, 403);
  assert.match(response.body.detail, /not permitted through the backend proxy/);
});

test("Next.js server proxy rejects oversized payloads with 413 Content Too Large", async () => {
  const { POST } = loadModule("src/app/api/backend/[...path]/route.ts", {
    FASTAPI_API_KEY: "secret-test-token",
    FASTAPI_URL: "http://127.0.0.1:8000",
  });

  // Declared Content-Length > 15MB
  const oversizedReq = new Request("http://localhost/api/backend/jobs/analyze", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": "20000000", // 20 MB
    },
    body: JSON.stringify({ description: "job" }),
  });

  const response = await POST(oversizedReq, {
    params: Promise.resolve({ path: ["jobs", "analyze"] }),
  });

  assert.equal(response.status, 413);
  assert.match(response.body.detail, /exceeds the maximum allowed limit/);
});

test("Next.js server proxy injects server-side secret and forwards permitted requests", async () => {
  let capturedHeaders = {};
  let capturedUrl = "";

  const mockFetch = async (url, options) => {
    capturedUrl = url;
    capturedHeaders = options.headers;
    return {
      status: 200,
      text: async () => JSON.stringify({ status: "ok", service: "mock-fastapi" }),
    };
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;

  try {
    const { GET } = loadModule("src/app/api/backend/[...path]/route.ts", {
      FASTAPI_API_KEY: "prod-server-bearer-token-9999",
      FASTAPI_URL: "https://backend.example.com",
    });

    const healthReq = new Request("http://localhost/api/backend/health", {
      method: "GET",
    });

    const response = await GET(healthReq, {
      params: Promise.resolve({ path: ["health"] }),
    });

    assert.equal(response.status, 200);
    assert.equal(capturedUrl, "https://backend.example.com/api/v1/health");
    assert.equal(capturedHeaders["Authorization"], "Bearer prod-server-bearer-token-9999");
    assert.equal(capturedHeaders["X-API-Key"], "prod-server-bearer-token-9999");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
