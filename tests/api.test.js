import test from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
process.env.AUTH_SECRET = "test-secret";

const productRows = [
  {
    id: 1,
    name: "Keyboard",
    description: "Mechanical keyboard",
    price: "99.90",
    stock: 8,
    created_at: "2026-03-18T00:00:00.000Z",
    updated_at: "2026-03-18T00:00:00.000Z"
  }
];

const userRows = [];

const fakePool = {
  async query(sql, params = []) {
    if (sql.includes("CREATE TABLE IF NOT EXISTS")) {
      return [[], undefined];
    }

    if (sql.startsWith("SELECT id, name, description, price, stock, created_at, updated_at FROM products ORDER BY")) {
      return [productRows.slice(), undefined];
    }

    if (sql.startsWith("INSERT INTO products")) {
      const next = {
        id: productRows.length + 1,
        name: params[0],
        description: params[1],
        price: String(params[2]),
        stock: params[3],
        created_at: "2026-03-18T00:00:00.000Z",
        updated_at: "2026-03-18T00:00:00.000Z"
      };
      productRows.unshift(next);
      return [{ insertId: next.id }, undefined];
    }

    if (sql.startsWith("SELECT id, name, description, price, stock, created_at, updated_at FROM products WHERE id = ?")) {
      return [productRows.filter((row) => row.id === params[0]), undefined];
    }

    if (sql.startsWith("UPDATE products SET")) {
      const row = productRows.find((item) => item.id === params[4]);
      if (!row) {
        return [{ affectedRows: 0 }, undefined];
      }
      row.name = params[0];
      row.description = params[1];
      row.price = String(params[2]);
      row.stock = params[3];
      return [{ affectedRows: 1 }, undefined];
    }

    if (sql.startsWith("DELETE FROM products WHERE id = ?")) {
      const index = productRows.findIndex((row) => row.id === params[0]);
      if (index === -1) {
        return [{ affectedRows: 0 }, undefined];
      }
      productRows.splice(index, 1);
      return [{ affectedRows: 1 }, undefined];
    }

    if (sql.startsWith("SELECT id, name, email, password_hash, password_salt, created_at FROM users WHERE email = ?")) {
      return [userRows.filter((row) => row.email === params[0]), undefined];
    }

    if (sql.startsWith("INSERT INTO users")) {
      const next = {
        id: userRows.length + 1,
        name: params[0],
        email: params[1],
        password_hash: params[2],
        password_salt: params[3],
        created_at: "2026-03-18T00:00:00.000Z"
      };
      userRows.push(next);
      return [{ insertId: next.id }, undefined];
    }

    if (sql.startsWith("SELECT id, name, email, created_at FROM users WHERE id = ?")) {
      return [userRows.filter((row) => row.id === params[0]).map(({ password_hash, password_salt, ...row }) => row), undefined];
    }

    throw new Error(`Unhandled SQL in test stub: ${sql}`);
  }
};

const db = await import("../src/db.js");
db.setPool(fakePool);
const { createApp } = await import("../server.js");

async function withServer(run) {
  const app = createApp();

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await run(baseUrl);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }
}

async function registerAndGetCookie(baseUrl) {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Renata",
      email: "renata@example.com",
      password: "secret123"
    })
  });

  const cookie = response.headers.get("set-cookie");
  assert.equal(response.status, 201);
  assert.ok(cookie);
  return cookie;
}

test("product routes require authentication", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/products`);
    assert.equal(response.status, 401);
  });
});

test("register creates a user session", async () => {
  userRows.length = 0;

  await withServer(async (baseUrl) => {
    const cookie = await registerAndGetCookie(baseUrl);

    const sessionResponse = await fetch(`${baseUrl}/api/auth/session`, {
      headers: { cookie }
    });

    assert.equal(sessionResponse.status, 200);
    const payload = await sessionResponse.json();
    assert.equal(payload.email, "renata@example.com");
  });
});

test("login returns a session cookie", async () => {
  userRows.length = 0;

  await withServer(async (baseUrl) => {
    await registerAndGetCookie(baseUrl);

    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "renata@example.com",
        password: "secret123"
      })
    });

    assert.equal(response.status, 200);
    assert.ok(response.headers.get("set-cookie"));
  });
});

test("authenticated user can create and list products", async () => {
  userRows.length = 0;

  await withServer(async (baseUrl) => {
    const cookie = await registerAndGetCookie(baseUrl);

    const createResponse = await fetch(`${baseUrl}/api/products`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie
      },
      body: JSON.stringify({
        name: "Mouse",
        description: "Wireless mouse",
        price: 49.5,
        stock: 10
      })
    });

    assert.equal(createResponse.status, 201);

    const listResponse = await fetch(`${baseUrl}/api/products`, {
      headers: { cookie }
    });
    const payload = await listResponse.json();

    assert.equal(listResponse.status, 200);
    assert.equal(Array.isArray(payload), true);
    assert.equal(payload[0].name, "Mouse");
  });
});

test("logout clears access to the session route", async () => {
  userRows.length = 0;

  await withServer(async (baseUrl) => {
    const cookie = await registerAndGetCookie(baseUrl);

    const logoutResponse = await fetch(`${baseUrl}/api/auth/logout`, {
      method: "POST",
      headers: { cookie }
    });
    assert.equal(logoutResponse.status, 204);

    const clearedCookie = logoutResponse.headers.get("set-cookie");
    const sessionCookie = clearedCookie.split(";")[0];
    const sessionResponse = await fetch(`${baseUrl}/api/auth/session`, {
      headers: { cookie: sessionCookie }
    });

    assert.equal(sessionResponse.status, 401);
  });
});

test("database helper rejects invalid stock", async () => {
  await assert.rejects(
    () =>
      db.createProduct({
        name: "Broken",
        description: "",
        price: 10,
        stock: -1
      }),
    /Stock must be an integer/
  );
});
