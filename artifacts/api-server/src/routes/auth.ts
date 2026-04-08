import { Router } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { db, peopleTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { signToken, requireAuth } from "../lib/auth";
import { audit } from "../lib/auditLog";

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please wait 15 minutes before trying again." },
});

router.post("/auth/login", loginLimiter, async (req, res): Promise<void> => {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400).json({ error: "Email and password required" });
    return;
  }

  const [person] = await db.select().from(peopleTable).where(eq(peopleTable.email, email));
  if (!person) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const valid = await bcrypt.compare(password, person.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  if (person.active === false) {
    res.status(403).json({ error: "Account is deactivated. Contact your Board Secretary." });
    return;
  }

  const token = signToken({ userId: person.id, email: person.email, role: person.role });
  const { passwordHash: _, ...safeUser } = person;

  const isProd = process.env.NODE_ENV === "production";
  res.cookie("token", token, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "strict" : "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  });

  res.json({ token, user: { ...safeUser, avatarColor: person.avatarColor } });
  audit(req, "login", "person", person.id, { email: person.email, role: person.role });
});

router.get("/auth/me", requireAuth, async (req, res): Promise<void> => {
  const person = req.user!;
  const { passwordHash: _, ...safeUser } = person;
  res.json({ ...safeUser, avatarColor: person.avatarColor });
});

router.post("/auth/logout", async (_req, res): Promise<void> => {
  res.clearCookie("token", { path: "/" });
  res.json({ ok: true });
});

export default router;
