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

test("Next.js server proxy rejects unauthenticated requests to expensive endpoints with 401 Unauthorized", async () => {
  const { POST } = loadModule("src/app/api/backend/[...path]/route.ts", {
    FASTAPI_API_KEY: "secret-test-token",
    FASTAPI_URL: "http://127.0.0.1:8000",
  });

  // Attempting to call jobs/analyze without user session
  const anonAnalyzeReq = new Request("http://localhost/api/backend/jobs/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description: "Software engineer role" }),
  });
  const analyzeRes = await POST(anonAnalyzeReq, {
    params: Promise.resolve({ path: ["jobs", "analyze"] }),
  });
  assert.equal(analyzeRes.status, 401);
  assert.match(analyzeRes.body.detail, /Authentication required/);

  // Attempting to call resume/parse without user session
  const anonResumeReq = new Request("http://localhost/api/backend/resume/parse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data_base64: "JVBERi0xLjc=" }),
  });
  const resumeRes = await POST(anonResumeReq, {
    params: Promise.resolve({ path: ["resume", "parse"] }),
  });
  assert.equal(resumeRes.status, 401);
  assert.match(resumeRes.body.detail, /Authentication required/);
});

test("Next.js server proxy rejects oversized payloads with 413 Content Too Large", async () => {
  const { POST } = loadModule("src/app/api/backend/[...path]/route.ts", {
    FASTAPI_API_KEY: "secret-test-token",
    FASTAPI_URL: "http://127.0.0.1:8000",
  });

  // Declared Content-Length > 15MB with user auth
  const oversizedReq = new Request("http://localhost/api/backend/jobs/analyze", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": "20000000", // 20 MB
      Authorization: "Bearer authenticated-user-session-token",
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
    // Secure boundary: server key must NOT masquerade as user Bearer token
    assert.equal(capturedHeaders["Authorization"], undefined);
    assert.equal(capturedHeaders["X-API-Key"], "prod-server-bearer-token-9999");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Next.js server proxy forwards user JWT and permits SaaS workspace routes", async () => {
  let capturedHeaders = {};
  let capturedUrl = "";
  let capturedMethod = "";

  const mockFetch = async (url, options) => {
    capturedUrl = url;
    capturedHeaders = options.headers;
    capturedMethod = options.method;
    return {
      status: 200,
      text: async () => JSON.stringify({ id: "job-abc-123", title: "Isolated Job" }),
    };
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;

  try {
    const { GET, PUT } = loadModule("src/app/api/backend/[...path]/route.ts", {
      FASTAPI_API_KEY: "server-gateway-key",
      FASTAPI_URL: "http://127.0.0.1:8000",
    });

    // 1. Client sends user token to access tenant-isolated job route
    const userJobReq = new Request("http://localhost/api/backend/workspace/jobs/job-abc-123", {
      method: "GET",
      headers: {
        Authorization: "Bearer user-session-jwt-token-aarav",
      },
    });

    const res = await GET(userJobReq, {
      params: Promise.resolve({ path: ["workspace", "jobs", "job-abc-123"] }),
    });

    assert.equal(res.status, 200);
    assert.equal(capturedUrl, "http://127.0.0.1:8000/api/v1/workspace/jobs/job-abc-123");
    assert.equal(capturedMethod, "GET");
    // Verify user JWT was preserved for backend tenant isolation
    assert.equal(capturedHeaders["Authorization"], "Bearer user-session-jwt-token-aarav");
    // Verify server gateway secret was forwarded via X-API-Key
    assert.equal(capturedHeaders["X-API-Key"], "server-gateway-key");

    // 2. Client updates tenant-isolated draft with PUT
    const draftPutReq = new Request("http://localhost/api/backend/workspace/jobs/job-abc-123/draft", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer user-session-jwt-token-aarav",
      },
      body: JSON.stringify({ coverLetter: "Tailored letter" }),
    });

    const putRes = await PUT(draftPutReq, {
      params: Promise.resolve({ path: ["workspace", "jobs", "job-abc-123", "draft"] }),
    });
    assert.equal(putRes.status, 200);
    assert.equal(capturedUrl, "http://127.0.0.1:8000/api/v1/workspace/jobs/job-abc-123/draft");
    assert.equal(capturedMethod, "PUT");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
