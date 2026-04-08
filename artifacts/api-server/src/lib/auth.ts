import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import { db, peopleTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

const JWT_SECRET = process.env.SESSION_SECRET;
if (!JWT_SECRET) {
  throw new Error("SESSION_SECRET environment variable is required — set it before starting the server.");
}

export interface AuthPayload {
  userId: string;
  email: string;
  role: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: typeof peopleTable.$inferSelect;
    }
  }
}

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

export function verifyToken(token: string): AuthPayload {
  return jwt.verify(token, JWT_SECRET) as AuthPayload;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const cookieToken = (req as any).cookies?.token as string | undefined;
  const headerToken = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice(7)
    : undefined;
  const token = cookieToken || headerToken;

  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const payload = verifyToken(token);
    const [person] = await db.select().from(peopleTable).where(eq(peopleTable.id, payload.userId));
    if (!person) {
      res.status(401).json({ error: "User not found" });
      return;
    }
    const { passwordHash: _, ...safeUser } = person;
    req.user = safeUser as typeof peopleTable.$inferSelect;
    next();
  } catch (err) {
    logger.warn({ err }, "Auth token invalid");
    res.status(401).json({ error: "Invalid token" });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || req.user.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}
