import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";
import "./src/loadEnv.js";

import {
  createProduct,
  createUser,
  deleteProduct,
  findUserByEmail,
  getProductById,
  initializeDatabase,
  listProducts,
  updateProduct,
  verifyUserPassword
} from "./src/db.js";

const PORT = Number(process.env.PORT ?? 3000);
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const AUTH_SECRET = process.env.AUTH_SECRET ?? "change-this-secret";
const COOKIE_NAME = "crud_session";

export function createApp() {
  const app = express();

  app.use(express.json());
  app.use(express.static(ROOT));

  app.get("/api/health", async (_request, response) => {
    try {
      await initializeDatabase();
      response.json({ ok: true });
    } catch (error) {
      response.status(500).json({
        ok: false,
        message: error instanceof Error ? error.message : "Database unavailable"
      });
    }
  });

  app.get("/api/auth/session", async (request, response) => {
    try {
      const session = readSession(request);

      if (!session) {
        response.status(401).json({ message: "Not authenticated." });
        return;
      }

      const user = await findUserByEmail(session.email);
      if (!user) {
        clearSessionCookie(response);
        response.status(401).json({ message: "Session expired." });
        return;
      }

      response.json({
        id: user.id,
        name: user.name,
        email: user.email
      });
    } catch (error) {
      response.status(401).json({ message: formatError(error) });
    }
  });

  app.post("/api/auth/register", async (request, response) => {
    try {
      const user = await createUser(request.body);
      setSessionCookie(response, { id: user.id, email: user.email });
      response.status(201).json(user);
    } catch (error) {
      response.status(400).json({ message: formatError(error) });
    }
  });

  app.post("/api/auth/login", async (request, response) => {
    try {
      const { email, password } = normalizeAuthPayload(request.body);
      const user = await verifyUserPassword(email, password);

      if (!user) {
        response.status(401).json({ message: "Invalid email or password." });
        return;
      }

      setSessionCookie(response, { id: user.id, email: user.email });
      response.json(user);
    } catch (error) {
      response.status(400).json({ message: formatError(error) });
    }
  });

  app.post("/api/auth/logout", (_request, response) => {
    clearSessionCookie(response);
    response.status(204).end();
  });

  app.use("/api/products", requireAuth);

  app.get("/api/products", async (_request, response) => {
    try {
      const products = await listProducts();
      response.json(products);
    } catch (error) {
      response.status(500).json({ message: formatError(error) });
    }
  });

  app.get("/api/products/:id", async (request, response) => {
    try {
      const product = await getProductById(Number(request.params.id));

      if (!product) {
        response.status(404).json({ message: "Product not found." });
        return;
      }

      response.json(product);
    } catch (error) {
      response.status(400).json({ message: formatError(error) });
    }
  });

  app.post("/api/products", async (request, response) => {
    try {
      const product = await createProduct(request.body);
      response.status(201).json(product);
    } catch (error) {
      response.status(400).json({ message: formatError(error) });
    }
  });

  app.put("/api/products/:id", async (request, response) => {
    try {
      const product = await updateProduct(Number(request.params.id), request.body);

      if (!product) {
        response.status(404).json({ message: "Product not found." });
        return;
      }

      response.json(product);
    } catch (error) {
      response.status(400).json({ message: formatError(error) });
    }
  });

  app.delete("/api/products/:id", async (request, response) => {
    try {
      const removed = await deleteProduct(Number(request.params.id));

      if (!removed) {
        response.status(404).json({ message: "Product not found." });
        return;
      }

      response.status(204).end();
    } catch (error) {
      response.status(400).json({ message: formatError(error) });
    }
  });

  app.use("/api", (_request, response) => {
    response.status(404).json({ message: "Route not found." });
  });

  return app;
}

function requireAuth(request, response, next) {
  try {
    const session = readSession(request);

    if (!session) {
      response.status(401).json({ message: "Authentication required." });
      return;
    }

    request.user = session;
    next();
  } catch (_error) {
    response.status(401).json({ message: "Authentication required." });
  }
}

function normalizeAuthPayload(input) {
  if (!input || typeof input !== "object") {
    throw new Error("Email and password are required.");
  }

  const email = String(input.email ?? "").trim().toLowerCase();
  const password = String(input.password ?? "");

  if (!email || !password) {
    throw new Error("Email and password are required.");
  }

  return { email, password };
}

function setSessionCookie(response, session) {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  const signature = signValue(payload);
  const value = `${payload}.${signature}`;

  response.setHeader("Set-Cookie", serializeCookie(COOKIE_NAME, value, 60 * 60 * 24));
}

function clearSessionCookie(response) {
  response.setHeader("Set-Cookie", serializeCookie(COOKIE_NAME, "", 0));
}

function readSession(request) {
  const cookies = parseCookies(request.headers.cookie ?? "");
  const rawValue = cookies[COOKIE_NAME];

  if (!rawValue) {
    return null;
  }

  const [payload, signature] = rawValue.split(".");
  if (!payload || !signature || signValue(payload) !== signature) {
    return null;
  }

  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

function signValue(value) {
  return crypto.createHmac("sha256", AUTH_SECRET).update(value).digest("base64url");
}

function parseCookies(cookieHeader) {
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const separator = part.indexOf("=");
      const key = separator === -1 ? part : part.slice(0, separator);
      const value = separator === -1 ? "" : decodeURIComponent(part.slice(separator + 1));
      cookies[key] = value;
      return cookies;
    }, {});
}

function serializeCookie(name, value, maxAgeSeconds) {
  return `${name}=${encodeURIComponent(value)}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; SameSite=Lax`;
}

function formatError(error) {
  return error instanceof Error ? error.message : "Unexpected error";
}

const app = createApp();

if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    console.log(`CRUD app is running at http://localhost:${PORT}`);
  });
}
