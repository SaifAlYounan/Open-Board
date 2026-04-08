import type { Request, Response, NextFunction } from "express";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUUID(value: string): boolean {
  return UUID_REGEX.test(value);
}

export function uuidParam(...params: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    for (const param of params) {
      const value = req.params[param];
      if (value && !UUID_REGEX.test(value)) {
        res.status(400).json({ error: `Invalid ${param} format` });
        return;
      }
    }
    next();
  };
}
