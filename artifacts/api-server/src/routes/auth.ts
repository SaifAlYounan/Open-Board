import { Router } from "express";
import bcrypt from "bcryptjs";
import { db, peopleTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { signToken, requireAuth } from "../lib/auth";

const router = Router();

router.post("/auth/login", async (req, res): Promise<void> => {
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

  const token = signToken({ userId: person.id, email: person.email, role: person.role });
  const { passwordHash: _, ...safeUser } = person;
  res.json({ token, user: { ...safeUser, avatarColor: person.avatarColor } });
});

router.get("/auth/me", requireAuth, async (req, res): Promise<void> => {
  const person = req.user!;
  const { passwordHash: _, ...safeUser } = person;
  res.json({ ...safeUser, avatarColor: person.avatarColor });
});

router.post("/auth/logout", async (_req, res): Promise<void> => {
  res.json({ ok: true });
});

export default router;
