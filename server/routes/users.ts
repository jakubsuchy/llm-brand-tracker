import type { Express } from "express";
import { requireRole } from "./helpers";

export function registerUserRoutes(app: Express) {
  // --- User management routes (admin only) ---
  app.get("/api/users", requireRole('admin'), async (req, res) => {
    const { getAllUsersWithRoles } = await import('../services/auth');
    const users = await getAllUsersWithRoles();
    res.json(users.map(u => ({ id: u.id, email: u.email, fullName: u.fullName, roles: u.roles, createdAt: u.createdAt, googleId: !!u.googleId })));
  });

  app.post("/api/users", requireRole('admin'), async (req, res) => {
    try {
      const { createUser, assignRole } = await import('../services/auth');
      const { email, fullName, password, roles } = req.body;
      if (!email || !fullName || !password) return res.status(400).json({ message: "All fields required" });
      const user = await createUser(email, fullName, password);
      for (const role of (roles || ['user'])) await assignRole(user.id, role);
      res.json({ id: user.id, email: user.email, fullName: user.fullName });
    } catch (err: any) {
      if (err.code === '23505') return res.status(409).json({ message: "Email already exists" });
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/users/:id", requireRole('admin'), async (req, res) => {
    try {
      const { db } = await import('../db');
      const { users } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');
      const userId = parseInt(req.params.id);
      const { email, fullName } = req.body;
      if (!email || !fullName) return res.status(400).json({ message: "Email and full name required" });
      const result = await db.update(users).set({ email, fullName }).where(eq(users.id, userId)).returning();
      if (result.length === 0) return res.status(404).json({ message: "User not found" });
      res.json({ id: result[0].id, email: result[0].email, fullName: result[0].fullName });
    } catch (err: any) {
      if (err.code === '23505') return res.status(409).json({ message: "Email already exists" });
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/users/:id/password", requireRole('admin'), async (req, res) => {
    try {
      const { hashPassword } = await import('../services/auth');
      const { db } = await import('../db');
      const { users } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');
      const userId = parseInt(req.params.id);
      const { password } = req.body;
      if (!password) return res.status(400).json({ message: "Password required" });
      const { hash, salt } = await hashPassword(password);
      const result = await db.update(users).set({ hashedPassword: hash, salt }).where(eq(users.id, userId)).returning();
      if (result.length === 0) return res.status(404).json({ message: "User not found" });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/users/:id/roles", requireRole('admin'), async (req, res) => {
    try {
      const { removeUserRoles, assignRole } = await import('../services/auth');
      const userId = parseInt(req.params.id);
      const { roles } = req.body;
      if (!roles || !Array.isArray(roles)) return res.status(400).json({ message: "Roles array required" });
      // Prevent removing your own admin role
      if (userId === req.user!.id && req.user!.roles.includes('admin') && !roles.includes('admin')) {
        return res.status(400).json({ message: "You cannot remove your own admin role" });
      }
      await removeUserRoles(userId);
      for (const role of roles) await assignRole(userId, role);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/users/:id", requireRole('admin'), async (req, res) => {
    try {
      const { removeUserRoles } = await import('../services/auth');
      const { db } = await import('../db');
      const { users } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');
      const userId = parseInt(req.params.id);
      if (userId === req.user!.id) {
        return res.status(400).json({ message: "You cannot delete your own account" });
      }
      await removeUserRoles(userId);
      const result = await db.delete(users).where(eq(users.id, userId)).returning();
      if (result.length === 0) return res.status(404).json({ message: "User not found" });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // --- API key regeneration (admin or self — intentionally no requireRole, uses manual check) ---
  app.post("/api/users/:id/api-key", async (req, res) => {
    const userId = parseInt(req.params.id);
    const isAdmin = req.user!.roles?.includes('admin');
    const isSelf = req.user!.id === userId;
    if (!isAdmin && !isSelf) {
      return res.status(403).json({ message: "Can only regenerate your own key or must be admin" });
    }
    const { regenerateApiKey } = await import('../services/auth');
    const newKey = await regenerateApiKey(userId);
    res.json({ apiKey: newKey });
  });
}
