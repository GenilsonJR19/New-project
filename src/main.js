const registerForm = document.querySelector("#register-form");
const loginForm = document.querySelector("#login-form");
const logoutButton = document.querySelector("#logout-button");
const authMessage = document.querySelector("#auth-message");
const sessionBadge = document.querySelector("#session-badge");
const inventoryPanel = document.querySelector("#inventory-panel");
const productsPanel = document.querySelector("#products-panel");
const form = document.querySelector("#product-form");
const productId = document.querySelector("#product-id");
const formTitle = document.querySelector("#form-title");
const submitButton = document.querySelector("#submit-button");
const message = document.querySelector("#message");
const tableBody = document.querySelector("#products-table");
const resetButton = document.querySelector("#reset-button");
const refreshButton = document.querySelector("#refresh-button");

const fields = {
  name: document.querySelector("#name"),
  description: document.querySelector("#description"),
  price: document.querySelector("#price"),
  stock: document.querySelector("#stock")
};

let currentUser = null;

function setMessage(text, isError = false) {
  message.textContent = text;
  message.style.color = isError ? "#8a3030" : "#8c4024";
}

function setAuthMessage(text, isError = false) {
  authMessage.textContent = text;
  authMessage.style.color = isError ? "#8a3030" : "#8c4024";
}

function setAuthenticatedState(user) {
  currentUser = user;
  const authenticated = Boolean(user);

  sessionBadge.textContent = authenticated ? `Signed in as ${user.name}` : "Signed out";
  inventoryPanel.classList.toggle("is-disabled", !authenticated);
  productsPanel.classList.toggle("is-disabled", !authenticated);
  logoutButton.disabled = !authenticated;

  if (!authenticated) {
    tableBody.replaceChildren();
    setMessage("Log in to load products.");
    resetForm();
  }
}

function resetForm() {
  form.reset();
  productId.value = "";
  formTitle.textContent = "Add product";
  submitButton.textContent = "Create product";
}

function populateForm(product) {
  productId.value = String(product.id);
  fields.name.value = product.name;
  fields.description.value = product.description ?? "";
  fields.price.value = product.price;
  fields.stock.value = product.stock;
  formTitle.textContent = `Edit product #${product.id}`;
  submitButton.textContent = "Update product";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(Number(value));
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options
  });

  if (response.status === 204) {
    return null;
  }

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message ?? "Request failed");
  }

  return data;
}

function renderProducts(products) {
  tableBody.replaceChildren();

  if (products.length === 0) {
    const row = document.createElement("tr");
    row.innerHTML = '<td class="empty-state" colspan="5">No products yet. Create your first one above.</td>';
    tableBody.append(row);
    return;
  }

  products.forEach((product) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${product.name}</td>
      <td>${product.description ?? ""}</td>
      <td>${formatCurrency(product.price)}</td>
      <td>${product.stock}</td>
      <td>
        <div class="row-actions">
          <button type="button" data-action="edit" data-id="${product.id}">Edit</button>
          <button type="button" class="delete-button" data-action="delete" data-id="${product.id}">Delete</button>
        </div>
      </td>
    `;
    tableBody.append(row);
  });
}

async function loadProducts() {
  if (!currentUser) {
    return;
  }

  try {
    setMessage("Loading products...");
    const products = await requestJson("/api/products");
    renderProducts(products);
    setMessage(`Loaded ${products.length} product${products.length === 1 ? "" : "s"}.`);
  } catch (error) {
    setMessage(error.message, true);
  }
}

async function loadSession() {
  try {
    const user = await requestJson("/api/auth/session");
    setAuthenticatedState(user);
    setAuthMessage(`Welcome back, ${user.name}.`);
    await loadProducts();
  } catch (_error) {
    setAuthenticatedState(null);
    setAuthMessage("Create an account or log in to continue.");
  }
}

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    const user = await requestJson("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: document.querySelector("#register-name").value.trim(),
        email: document.querySelector("#register-email").value.trim(),
        password: document.querySelector("#register-password").value
      })
    });

    registerForm.reset();
    loginForm.reset();
    setAuthenticatedState(user);
    setAuthMessage("Account created and signed in.");
    await loadProducts();
  } catch (error) {
    setAuthMessage(error.message, true);
  }
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    const user = await requestJson("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: document.querySelector("#login-email").value.trim(),
        password: document.querySelector("#login-password").value
      })
    });

    loginForm.reset();
    setAuthenticatedState(user);
    setAuthMessage("Logged in successfully.");
    await loadProducts();
  } catch (error) {
    setAuthMessage(error.message, true);
  }
});

logoutButton.addEventListener("click", async () => {
  try {
    await requestJson("/api/auth/logout", { method: "POST" });
    setAuthenticatedState(null);
    setAuthMessage("Logged out.");
  } catch (error) {
    setAuthMessage(error.message, true);
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const payload = {
    name: fields.name.value.trim(),
    description: fields.description.value.trim(),
    price: fields.price.value,
    stock: fields.stock.value
  };

  const isEditing = productId.value !== "";
  const url = isEditing ? `/api/products/${productId.value}` : "/api/products";
  const method = isEditing ? "PUT" : "POST";

  try {
    await requestJson(url, {
      method,
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    resetForm();
    await loadProducts();
    setMessage(isEditing ? "Product updated successfully." : "Product created successfully.");
  } catch (error) {
    setMessage(error.message, true);
  }
});

tableBody.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) {
    return;
  }

  const { action, id } = target.dataset;
  if (!action || !id) {
    return;
  }

  try {
    if (action === "edit") {
      const product = await requestJson(`/api/products/${id}`);
      populateForm(product);
      setMessage(`Editing product #${id}.`);
      return;
    }

    await requestJson(`/api/products/${id}`, { method: "DELETE" });
    if (productId.value === id) {
      resetForm();
    }
    await loadProducts();
    setMessage("Product deleted successfully.");
  } catch (error) {
    setMessage(error.message, true);
  }
});

resetButton.addEventListener("click", () => {
  resetForm();
  setMessage("Form cleared.");
});

refreshButton.addEventListener("click", () => {
  loadProducts();
});

resetForm();
setAuthenticatedState(null);
loadSession();
