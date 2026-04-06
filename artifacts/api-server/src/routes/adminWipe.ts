import { Router } from "express";
import path from "path";
import fs from "fs";
import { clearAll, seed } from "../seed";

const router = Router();

const WIPE_SECRET = "wipe-easyboard-prod-2026";

router.post("/admin/wipe", async (req, res): Promise<void> => {
  if (req.headers["x-admin-secret"] !== WIPE_SECRET) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  try {
    const uploadsDir = path.join(process.cwd(), "uploads");
    if (fs.existsSync(uploadsDir)) {
      for (const f of fs.readdirSync(uploadsDir)) {
        fs.unlinkSync(path.join(uploadsDir, f));
      }
    }
    await clearAll();
    await seed();
    res.json({ ok: true, message: "Database wiped and re-seeded successfully." });
  } catch (err: any) {
    console.error("[admin/wipe]", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
