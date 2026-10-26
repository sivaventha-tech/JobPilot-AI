import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

/**
 * Transpiles and loads a TypeScript module in Node's native test runner VM.
 */
function loadModule(relPath) {
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
      throw new Error(`Unexpected require in unit test: ${id}`);
    },
    process: { env: {} },
    URL: globalThis.URL,
  });

  vm.runInContext(transpiled.outputText, context);
  return moduleObj.exports;
}

test("formatSafeExternalUrl returns valid absolute URLs and rejects unsafe/empty values", () => {
  const { formatSafeExternalUrl, isValidExternalUrl } = loadModule("src/services/api-client.ts");

  // Valid HTTPS and HTTP URLs
  assert.equal(
    formatSafeExternalUrl("https://www.linkedin.com/jobs/view/example-linearstack-101"),
    "https://www.linkedin.com/jobs/view/example-linearstack-101"
  );
  assert.equal(
    formatSafeExternalUrl("https://careers.finverse.example.com/openings/staff-frontend-102"),
    "https://careers.finverse.example.com/openings/staff-frontend-102"
  );
  assert.equal(
    formatSafeExternalUrl("http://company.example.com/jobs/123"),
    "http://company.example.com/jobs/123"
  );
  assert.equal(
    formatSafeExternalUrl("www.naukri.com/job-listings-novapulse"),
    "https://www.naukri.com/job-listings-novapulse"
  );
  assert.equal(
    formatSafeExternalUrl("careers.google.com/jobs/results/123456"),
    "https://careers.google.com/jobs/results/123456"
  );

  // Rejection of empty, missing, or whitespace-only inputs
  assert.equal(formatSafeExternalUrl(null), null);
  assert.equal(formatSafeExternalUrl(undefined), null);
  assert.equal(formatSafeExternalUrl(""), null);
  assert.equal(formatSafeExternalUrl("   "), null);

  // Rejection of dangerous or non-navigable protocols and fragments
  assert.equal(formatSafeExternalUrl("#"), null);
  assert.equal(formatSafeExternalUrl("#section"), null);
  assert.equal(formatSafeExternalUrl("javascript:alert(1)"), null);
  assert.equal(formatSafeExternalUrl("javascript:void(0)"), null);
  assert.equal(formatSafeExternalUrl("data:text/html,<script>alert(1)</script>"), null);
  assert.equal(formatSafeExternalUrl("file:///C:/passwords.txt"), null);
  assert.equal(formatSafeExternalUrl("not-a-valid-domain"), null);

  // Helper boolean validation
  assert.equal(isValidExternalUrl("https://linkedin.com"), true);
  assert.equal(isValidExternalUrl(""), false);
  assert.equal(isValidExternalUrl(null), false);
  assert.equal(isValidExternalUrl("#"), false);
});

test("getInternalJobPath distinguishes internal dynamic routes from external URLs and handles invalid IDs", () => {
  const { getInternalJobPath, isValidJobId } = loadModule("src/services/api-client.ts");

  // Valid internal job routes
  assert.equal(isValidJobId("job-101"), true);
  assert.equal(isValidJobId("job_senior_react"), true);
  assert.equal(getInternalJobPath("job-101"), "/jobs/job-101");
  assert.equal(getInternalJobPath("job-ai-engineer-102"), "/jobs/job-ai-engineer-102");

  // Invalid IDs fallback gracefully to /
  assert.equal(isValidJobId(""), false);
  assert.equal(isValidJobId(null), false);
  assert.equal(isValidJobId(undefined), false);
  assert.equal(isValidJobId("job/with/slashes"), false);
  assert.equal(isValidJobId("../job-traversal"), false);

  assert.equal(getInternalJobPath(""), "/");
  assert.equal(getInternalJobPath(null), "/");
  assert.equal(getInternalJobPath(undefined), "/");
  assert.equal(getInternalJobPath("../traversal"), "/");
});

test("Stored initial mock jobs have verifiable external URLs or explicit empty state", () => {
  const { formatSafeExternalUrl } = loadModule("src/services/api-client.ts");
  const mockDataContent = fs.readFileSync(path.resolve("src/lib/mock-data.ts"), "utf8");

  // Verify that jobs with URLs have real http/https protocols
  assert.match(
    mockDataContent,
    /applicationUrl:\s*"https:\/\/www\.linkedin\.com\/jobs\/view\/example-linearstack-101"/
  );
  assert.match(
    mockDataContent,
    /applicationUrl:\s*"https:\/\/careers\.finverse\.example\.com\/openings\/staff-frontend-102"/
  );
  assert.match(
    mockDataContent,
    /applicationUrl:\s*"https:\/\/www\.naukri\.com\/job-listings-novapulse-health-ai-103"/
  );

  // Verify job-105 explicitly has no external URL, which must evaluate to null without crashing or navigating to /
  assert.match(mockDataContent, /id:\s*"job-105"[\s\S]*?applicationUrl:\s*""/);
  assert.equal(formatSafeExternalUrl(""), null);
});

test("Dashboard and Tracker source files enforce safe external links with target=_blank and rel=noopener noreferrer", () => {
  const dashboardContent = fs.readFileSync(path.resolve("src/app/page.tsx"), "utf8");
  const trackerContent = fs.readFileSync(path.resolve("src/app/tracker/page.tsx"), "utf8");
  const jobDetailContent = fs.readFileSync(path.resolve("src/app/jobs/[id]/page.tsx"), "utf8");

  // Dashboard must link job titles to internal /jobs/${job.id} route
  assert.match(dashboardContent, /href=\{`\/jobs\/\$\{job\.id\}`\}/);

  // Dashboard must open external links in a new tab with noopener noreferrer
  assert.match(dashboardContent, /target="_blank"/);
  assert.match(dashboardContent, /rel="noopener noreferrer"/);

  // Tracker must link job titles to internal /jobs/${job.id} route
  assert.match(trackerContent, /href=\{`\/jobs\/\$\{job\.id\}`\}/);
  assert.match(trackerContent, /target="_blank"/);
  assert.match(trackerContent, /rel="noopener noreferrer"/);

  // Job Details dynamic route page must handle both safe external links and internal breadcrumb navigation
  assert.match(jobDetailContent, /params\?\.id/);
  assert.match(jobDetailContent, /formatSafeExternalUrl\(job\?\.applicationUrl\)/);
  assert.match(jobDetailContent, /target="_blank"/);
  assert.match(jobDetailContent, /rel="noopener noreferrer"/);
  assert.match(jobDetailContent, /href="\/"/);
  assert.match(jobDetailContent, /href="\/tracker"/);
});
