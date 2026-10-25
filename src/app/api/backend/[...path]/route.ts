import { NextResponse } from "next/server";

/**
 * Next.js Server-Side API Proxy for JobPilot AI.
 *
 * Security & Architecture Guarantees:
 * 1. Server-to-server authentication: Injects FASTAPI_API_KEY server-side.
 *    The shared secret is NEVER exposed to the browser or client JavaScript bundle.
 * 2. Path whitelisting: Only explicitly permitted application paths can be proxied.
 * 3. Request-size limit: Rejects payloads over 15MB early with HTTP 413.
 * 4. Isolation: Prevents arbitrary SSRF or access to unauthorized backend endpoints.
 *
 * Note on Authentication Model:
 * This proxy enforces server-to-server security between the Next.js frontend and
 * the FastAPI backend. It does NOT provide per-user authentication or multi-tenant
 * isolation (which requires a database + user auth layer like Supabase Auth).
 */

const PERMITTED_ENDPOINTS: Record<string, string[]> = {
  "jobs/analyze": ["POST"],
  "resume/parse": ["POST"],
  "resume/upload": ["POST"],
  "jobs/match": ["POST"],
  "jobs/drafts": ["POST"],
  "applications/assist": ["POST"],
  health: ["GET"],
};

const MAX_PAYLOAD_BYTES = 15 * 1024 * 1024; // 15 MB

async function proxyRequest(
  request: Request,
  rawParams: Promise<{ path: string[] }> | { path: string[] },
  method: "GET" | "POST"
) {
  const resolved = await Promise.resolve(rawParams);
  const pathSegments = resolved.path || [];
  const joinedPath = pathSegments.join("/");

  // 1. Whitelist path check
  const allowedMethods = PERMITTED_ENDPOINTS[joinedPath];
  if (!allowedMethods || !allowedMethods.includes(method)) {
    return NextResponse.json(
      {
        detail: `Forbidden: Path '${joinedPath}' with method '${method}' is not permitted through the backend proxy.`,
      },
      { status: 403 }
    );
  }

  // 2. Request payload size check
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > MAX_PAYLOAD_BYTES) {
    return NextResponse.json(
      {
        detail: `Payload size (${contentLength} bytes) exceeds the maximum allowed limit of ${MAX_PAYLOAD_BYTES} bytes.`,
      },
      { status: 413 }
    );
  }

  // 3. Resolve backend URL and secret token (strictly server-side)
  const rawBackendUrl =
    process.env.FASTAPI_URL ||
    process.env.JOBPILOT_BACKEND_URL ||
    process.env.NEXT_PUBLIC_FASTAPI_URL ||
    "http://127.0.0.1:8000";
  const backendBase = rawBackendUrl.trim().replace(/\/+$/, "");

  // Secret token is read ONLY from server-side environment variables (NEVER NEXT_PUBLIC_)
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

  if (serverToken) {
    headers["Authorization"] = `Bearer ${serverToken}`;
    headers["X-API-Key"] = serverToken;
  }

  let body: BodyInit | null = null;
  if (method === "POST") {
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
