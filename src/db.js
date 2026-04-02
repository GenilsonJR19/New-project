import crypto from "node:crypto";

import mysql from "mysql2/promise";
import "./loadEnv.js";

let pool;

function getDatabaseConfig() {
  return {
    host: process.env.DB_HOST ?? "localhost",
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER ?? "root",
    password: process.env.DB_PASSWORD ?? "root",
    database: process.env.DB_NAME ?? "crud_app"
  };
}

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      ...getDatabaseConfig(),
      waitForConnections: true,
      connectionLimit: 10
    });
  }

  return pool;
}

export function setPool(nextPool) {
  pool = nextPool;
}

export async function initializeDatabase() {
  const connectionPool = getPool();

  await connectionPool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      email VARCHAR(190) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      password_salt VARCHAR(64) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await connectionPool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      description VARCHAR(500) DEFAULT '',
      price DECIMAL(10, 2) NOT NULL,
      stock INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
}

function normalizeProductInput(input) {
  if (!input || typeof input !== "object") {
    throw new Error("Product payload is required.");
  }

  const name = String(input.name ?? "").trim();
  const description = String(input.description ?? "").trim();
  const price = Number(input.price);
  const stock = Number(input.stock);

  if (!name) {
    throw new Error("Name is required.");
  }

  if (!Number.isFinite(price) || price < 0) {
    throw new Error("Price must be a number greater than or equal to 0.");
  }

  if (!Number.isInteger(stock) || stock < 0) {
    throw new Error("Stock must be an integer greater than or equal to 0.");
  }

  return { name, description, price, stock };
}

function normalizeUserInput(input) {
  if (!input || typeof input !== "object") {
    throw new Error("Name, email, and password are required.");
  }

  const name = String(input.name ?? "").trim();
  const email = String(input.email ?? "").trim().toLowerCase();
  const password = String(input.password ?? "");

  if (!name) {
    throw new Error("Name is required.");
  }

  if (!email || !email.includes("@")) {
    throw new Error("A valid email is required.");
  }

  if (password.length < 6) {
    throw new Error("Password must have at least 6 characters.");
  }

  return { name, email, password };
}

function normalizeId(id) {
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("A valid numeric id is required.");
  }
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 32, "sha256").toString("hex");
  return { salt, hash };
}

function mapProduct(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    price: Number(row.price),
    stock: row.stock,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapUser(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    createdAt: row.created_at
  };
}

export async function listProducts() {
  await initializeDatabase();
  const [rows] = await getPool().query(
    "SELECT id, name, description, price, stock, created_at, updated_at FROM products ORDER BY id DESC"
  );

  return rows.map(mapProduct);
}

export async function getProductById(id) {
  normalizeId(id);
  await initializeDatabase();
  const [rows] = await getPool().query(
    "SELECT id, name, description, price, stock, created_at, updated_at FROM products WHERE id = ?",
    [id]
  );

  return mapProduct(rows[0]);
}

export async function createProduct(input) {
  const product = normalizeProductInput(input);
  await initializeDatabase();
  const [result] = await getPool().query(
    "INSERT INTO products (name, description, price, stock) VALUES (?, ?, ?, ?)",
    [product.name, product.description, product.price, product.stock]
  );

  return getProductById(result.insertId);
}

export async function updateProduct(id, input) {
  normalizeId(id);
  const product = normalizeProductInput(input);
  await initializeDatabase();
  const [result] = await getPool().query(
    "UPDATE products SET name = ?, description = ?, price = ?, stock = ? WHERE id = ?",
    [product.name, product.description, product.price, product.stock, id]
  );

  if (result.affectedRows === 0) {
    return null;
  }

  return getProductById(id);
}

export async function deleteProduct(id) {
  normalizeId(id);
  await initializeDatabase();
  const [result] = await getPool().query("DELETE FROM products WHERE id = ?", [id]);
  return result.affectedRows > 0;
}

export async function findUserByEmail(email) {
  await initializeDatabase();
  const [rows] = await getPool().query(
    "SELECT id, name, email, password_hash, password_salt, created_at FROM users WHERE email = ?",
    [String(email).trim().toLowerCase()]
  );

  return rows[0] ?? null;
}

export async function createUser(input) {
  const user = normalizeUserInput(input);
  await initializeDatabase();

  const existing = await findUserByEmail(user.email);
  if (existing) {
    throw new Error("An account with this email already exists.");
  }

  const password = hashPassword(user.password);
  const [result] = await getPool().query(
    "INSERT INTO users (name, email, password_hash, password_salt) VALUES (?, ?, ?, ?)",
    [user.name, user.email, password.hash, password.salt]
  );

  const [rows] = await getPool().query(
    "SELECT id, name, email, created_at FROM users WHERE id = ?",
    [result.insertId]
  );

  return mapUser(rows[0]);
}

export async function verifyUserPassword(email, password) {
  const user = await findUserByEmail(email);

  if (!user) {
    return null;
  }

  const candidate = hashPassword(password, user.password_salt);
  const matches = crypto.timingSafeEqual(
    Buffer.from(candidate.hash, "hex"),
    Buffer.from(user.password_hash, "hex")
  );

  if (!matches) {
    return null;
  }

  return mapUser(user);
}
