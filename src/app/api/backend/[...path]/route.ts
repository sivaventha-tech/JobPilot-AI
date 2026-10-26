import { NextResponse } from "next/server";

/**
 * Next.js Server-Side API Proxy for JobPilot AI.
 *
 * Security & SaaS Architecture Guarantees:
 * 1. Multi-Tenant Token Forwarding: If an end-user provides a Bearer token, it is forwarded
 *    to FastAPI for tenant isolation and row-level authorization.
 * 2. Server-to-server gateway: Injects FASTAPI_API_KEY as X-API-Key or fallback Bearer token.
 *    The server secret is NEVER exposed to browser client JavaScript bundles.
 * 3. Path whitelisting: Only permitted endpoints (including /workspace/jobs/*, /auth/*, /profile)
 *    can be accessed.
 * 4. Request-size limit: Rejects payloads over 15MB early with HTTP 413.
 * 5. Full REST verb support: GET, POST, PUT, DELETE.
 */

const PERMITTED_STATIC_ENDPOINTS: Record<string, string[]> = {
  "jobs/analyze": ["POST"],
  "resume/parse": ["POST"],
  "resume/upload": ["POST"],
  "jobs/match": ["POST"],
  "jobs/drafts": ["POST"],
  "applications/assist": ["POST"],
  "auth/register": ["POST"],
  "auth/login": ["POST"],
  "auth/me": ["GET"],
  "auth/account": ["DELETE"],
  profile: ["GET", "PUT"],
  "workspace/jobs": ["GET", "POST"],
  "billing/usage": ["GET"],
  "billing/webhook": ["POST"],
  health: ["GET"],
};

const REQUIRE_USER_AUTH_STATIC = new Set([
  "jobs/analyze",
  "resume/parse",
  "resume/upload",
  "jobs/match",
  "jobs/drafts",
  "applications/assist",
  "profile",
  "billing/usage",
  "auth/me",
  "auth/account",
]);

function requiresUserAuthentication(joinedPath: string): boolean {
  if (REQUIRE_USER_AUTH_STATIC.has(joinedPath)) {
    return true;
  }
  if (joinedPath.startsWith("workspace/jobs")) {
    return true;
  }
  return false;
}

const MAX_PAYLOAD_BYTES = 15 * 1024 * 1024; // 15 MB

function isPathPermitted(joinedPath: string, method: string): boolean {
  if (PERMITTED_STATIC_ENDPOINTS[joinedPath]?.includes(method)) {
    return true;
  }
  // Dynamic parameterized workspace routes:
  // workspace/jobs/{id}
  if (/^workspace\/jobs\/[^/]+$/.test(joinedPath) && ["GET", "PUT", "DELETE"].includes(method)) {
    return true;
  }
  // workspace/jobs/{id}/draft
  if (/^workspace\/jobs\/[^/]+\/draft$/.test(joinedPath) && ["GET", "PUT"].includes(method)) {
    return true;
  }
  // workspace/jobs/{id}/attempts
  if (/^workspace\/jobs\/[^/]+\/attempts$/.test(joinedPath) && ["GET", "POST"].includes(method)) {
    return true;
  }
  return false;
}

async function proxyRequest(
  request: Request,
  rawParams: Promise<{ path: string[] }> | { path: string[] },
  method: "GET" | "POST" | "PUT" | "DELETE"
) {
  const resolved = await Promise.resolve(rawParams);
  const pathSegments = resolved.path || [];
  const joinedPath = pathSegments.join("/");

  // 1. Whitelist path check
  if (!isPathPermitted(joinedPath, method)) {
    return NextResponse.json(
      {
        detail: `Forbidden: Path '${joinedPath}' with method '${method}' is not permitted through the backend proxy.`,
      },
      { status: 403 }
    );
  }

  // 2. User authentication enforcement on expensive and tenant-owned endpoints
  const clientAuth = request.headers.get("authorization");
  if (requiresUserAuthentication(joinedPath)) {
    const tokenPart = clientAuth ? clientAuth.replace(/^Bearer\s+/i, "").trim() : "";
    if (!tokenPart) {
      return NextResponse.json(
        {
          detail: "Authentication required. Please sign in or create an account to access this endpoint.",
        },
        { status: 401 }
      );
    }
  }

  // 3. Request payload size check
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > MAX_PAYLOAD_BYTES) {
    return NextResponse.json(
      {
        detail: `Payload size (${contentLength} bytes) exceeds the maximum allowed limit of ${MAX_PAYLOAD_BYTES} bytes.`,
      },
      { status: 413 }
    );
  }

  // 4. Resolve backend URL and secret token (strictly server-side)
  const rawBackendUrl =
    process.env.FASTAPI_URL ||
    process.env.JOBPILOT_BACKEND_URL ||
    process.env.NEXT_PUBLIC_FASTAPI_URL ||
    "http://127.0.0.1:8000";
  const backendBase = rawBackendUrl.trim().replace(/\/+$/, "");

  const serverToken = (
    process.env.FASTAPI_API_KEY ||
    process.env.JOBPILOT_BACKEND_API_KEY ||
    process.env.JOBPILOT_API_AUTH_TOKEN ||
    ""
  ).trim();

  const targetUrl = joinedPath === "health"
    ? `${backendBase}/api/v1/health`
    : `${backendBase}/api/v1/${joinedPath}`;

  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  // Forward user's Bearer token for tenant identity when provided (never use serverToken as user identity)
  if (clientAuth) {
    headers["Authorization"] = clientAuth;
  }

  // Forward server-to-server gateway key exclusively via X-API-Key header
  if (serverToken) {
    headers["X-API-Key"] = serverToken;
  }

  // Forward Stripe signature header for webhook verification
  const stripeSig = request.headers.get("stripe-signature");
  if (stripeSig) {
    headers["Stripe-Signature"] = stripeSig;
  }

  let body: BodyInit | null = null;
  if (method === "POST" || method === "PUT") {
    headers["Content-Type"] =
      request.headers.get("content-type") || "application/json";
    body = await request.text();
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 25000);

  try {
    const backendResponse = await fetch(targetUrl, {
      method,
      headers,
      body,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const responseData = await backendResponse.text();
    let jsonBody: unknown;
    try {
      jsonBody = JSON.parse(responseData);
    } catch {
      jsonBody = { raw: responseData };
    }

    return NextResponse.json(jsonBody, {
      status: backendResponse.status,
    });
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    const msg =
      err instanceof Error
        ? err.name === "AbortError"
          ? "Backend request timed out after 25s."
          : err.message
        : "Failed to connect to backend.";

    return NextResponse.json(
      {
        detail: `Backend proxy communication error: ${msg}`,
      },
      { status: 502 }
    );
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ path: string[] }> }
) {
  return proxyRequest(request, context.params, "GET");
}

export async function POST(
  request: Request,
  context: { params: Promise<{ path: string[] }> }
) {
  return proxyRequest(request, context.params, "POST");
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ path: string[] }> }
) {
  return proxyRequest(request, context.params, "PUT");
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ path: string[] }> }
) {
  return proxyRequest(request, context.params, "DELETE");
}
