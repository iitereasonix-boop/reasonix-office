import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import type { z } from "zod";
import { requireUser, type SafeUser } from "@/lib/auth";

export const staffRoles = [Role.SENIOR_LAWYER, Role.TRAINEE_LAWYER, Role.SECRETARY];
export const officeRoles = [Role.SENIOR_LAWYER, Role.SECRETARY];

export class HttpError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

type Handler = (user: SafeUser, request: NextRequest) => Promise<Response | object>;

/** Wraps a route with the role check and turns thrown HttpErrors into JSON responses. */
export function route(allowed: Role[], handler: Handler) {
  return async (request: NextRequest) => {
    const { user, response } = await requireUser(allowed);
    if (response) return response;
    if (!user) return NextResponse.json({ error: "يلزم تسجيل الدخول." }, { status: 401 });
    try {
      const result = await handler(user, request);
      return result instanceof Response ? result : NextResponse.json(result);
    } catch (error) {
      if (error instanceof HttpError) return NextResponse.json({ error: error.message }, { status: error.status });
      console.error(error);
      return NextResponse.json({ error: "تعذر تنفيذ الطلب. حاول مرة أخرى." }, { status: 500 });
    }
  };
}

export async function parseBody<T>(request: NextRequest, schema: z.ZodType<T>, message: string) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw new HttpError(message);
  return parsed.data;
}

export function requireId(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) throw new HttpError("المعرّف مطلوب.");
  return id;
}

const attempts = new Map<string, { count: number; resetAt: number }>();

/** In-memory limiter: enough for one instance; use a shared store if the app is scaled out. */
export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  entry.count += 1;
  return entry.count <= limit;
}

export const clearRateLimit = (key: string) => attempts.delete(key);

export const clientIp = (request: NextRequest) =>
  request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
