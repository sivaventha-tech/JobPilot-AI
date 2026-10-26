import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

function loadApiClientModule() {
  const filePath = path.resolve("src/services/api-client.ts");
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
      throw new Error(`Unexpected require: ${id}`);
    },
    process: { env: {} },
    fetch: globalThis.fetch,
    AbortController: globalThis.AbortController,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    URL: globalThis.URL,
    encodeURIComponent: globalThis.encodeURIComponent,
  });

  vm.runInContext(transpiled.outputText, context);
  return moduleObj.exports;
}

const {
  registerUserApi,
  loginUserApi,
  getCurrentUserApi,
  fetchWorkspaceJobsApi,
  createWorkspaceJobApi,
  updateWorkspaceJobApi,
  deleteWorkspaceJobApi,
  deleteAccountApi,
  SaaSClientError,
} = loadApiClientModule();

test("registerUserApi and loginUserApi call expected endpoints and parse session response", async () => {
  const mockFetch = async (url, options) => {
    assert.match(url, /\/auth\/register$/);
    assert.equal(options.method, "POST");
    const body = JSON.parse(options.body);
    assert.equal(body.email, "test@example.com");
    return {
      ok: true,
      status: 200,
      json: async () => ({
        user_id: "usr_123",
        email: "test@example.com",
        full_name: "Test User",
        role: "user",
        access_token: "jwt_token_abc",
        token_type: "Bearer",
      }),
    };
  };

  const session = await registerUserApi(
    { email: "test@example.com", password: "password123", full_name: "Test User" },
    { baseUrl: "http://localhost:8000", fetchImpl: mockFetch }
  );

  assert.equal(session.user_id, "usr_123");
  assert.equal(session.access_token, "jwt_token_abc");
});

test("registerUserApi handles 409 conflict appropriately", async () => {
  const mockFetch = async () => ({
    ok: false,
    status: 409,
    json: async () => ({ detail: "An account with this email already exists" }),
  });

  await assert.rejects(
    async () => {
      await registerUserApi(
        { email: "existing@example.com", password: "password123", full_name: "Existing" },
        { baseUrl: "http://localhost:8000", fetchImpl: mockFetch }
      );
    },
    (err) => {
      assert(err instanceof SaaSClientError);
      assert.equal(err.statusCode, 409);
      assert.match(err.message, /already exists/);
      return true;
    }
  );
});

test("Workspace CRUD client functions send user Bearer token and handle data correctly", async () => {
  let createdJobPayload = null;
  let updatedJobPayload = null;
  let deletedJobUrl = null;

  const mockFetch = async (url, options) => {
    assert.equal(options.headers.Authorization, "Bearer user_token_xyz");

    if (options.method === "GET" && url.endsWith("/workspace/jobs")) {
      return {
        ok: true,
        status: 200,
        json: async () => [
          {
            id: "job_1",
            title: "Frontend Engineer",
            company: "Acme Corp",
            status: "Saved",
          },
        ],
      };
    }

    if (options.method === "POST" && url.endsWith("/workspace/jobs")) {
      createdJobPayload = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        json: async () => createdJobPayload,
      };
    }

    if (options.method === "PUT" && url.includes("/workspace/jobs/job_1")) {
      updatedJobPayload = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: "job_1", ...updatedJobPayload }),
      };
    }

    if (options.method === "DELETE" && url.includes("/workspace/jobs/job_1")) {
      deletedJobUrl = url;
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: "deleted", detail: "Job removed", job_id: "job_1" }),
      };
    }

    if (options.method === "DELETE" && url.endsWith("/auth/account")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: "deleted", detail: "Account erased", user_id: "usr_123" }),
      };
    }

    throw new Error(`Unhandled mock request: ${options.method} ${url}`);
  };

  const jobs = await fetchWorkspaceJobsApi("user_token_xyz", {
    baseUrl: "http://localhost:8000",
    fetchImpl: mockFetch,
  });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].title, "Frontend Engineer");

  const newJob = await createWorkspaceJobApi(
    "user_token_xyz",
    {
      id: "job_2",
      title: "Backend Engineer",
      company: "Stripe",
      status: "Saved",
    },
    { baseUrl: "http://localhost:8000", fetchImpl: mockFetch }
  );
  assert.equal(newJob.title, "Backend Engineer");
  assert.equal(createdJobPayload.title, "Backend Engineer");

  const updated = await updateWorkspaceJobApi(
    "user_token_xyz",
    "job_1",
    { status: "Approved" },
    { baseUrl: "http://localhost:8000", fetchImpl: mockFetch }
  );
  assert.equal(updated.status, "Approved");
  assert.equal(updatedJobPayload.status, "Approved");

  const deleted = await deleteWorkspaceJobApi("user_token_xyz", "job_1", {
    baseUrl: "http://localhost:8000",
    fetchImpl: mockFetch,
  });
  assert.equal(deleted.status, "deleted");
  assert.match(deletedJobUrl, /workspace\/jobs\/job_1$/);

  const accountDeleted = await deleteAccountApi("user_token_xyz", {
    baseUrl: "http://localhost:8000",
    fetchImpl: mockFetch,
  });
  assert.equal(accountDeleted.status, "deleted");
});
