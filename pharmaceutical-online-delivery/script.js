// ---------- State ----------
const DELIVERY_FEE = 150;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "application/pdf"];
let medicines = [];
let cart = JSON.parse(localStorage.getItem("cart") || "[]"); // [{id, quantity}]
let prescriptionRequests = JSON.parse(localStorage.getItem("prescriptionRequests") || "[]");
let activePrescriptionMedicineId = null;
const $ = (id) => document.getElementById(id);

// Escape text so database values can't inject HTML (XSS protection)
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function showMessage(el, text, type = "") {
  el.textContent = text;
  el.className = "msg " + type;
  el.hidden = !text;
}

// ---------- Medicines (READ) ----------
async function fetchMedicines() {
  showMessage($("message"), "Loading medicines...");
  const { data, error } = await supabaseClient.from("medicines").select("*").order("name");
  if (error) return showMessage($("message"), "Could not load medicines: " + error.message, "error");
  medicines = data;
  showMessage($("message"), "");
  fillCategories();
  filterMedicines();
  try {
    await refreshPrescriptionStatuses();
    filterMedicines();
  } catch (error) {
    showMessage($("message"), "Could not verify prescription review status: " + error.message, "error");
  }
}

function fillCategories() {
  const cats = [...new Set(medicines.map((m) => m.category))].sort();
  $("categoryFilter").innerHTML = '<option value="">All Categories</option>' +
    cats.map((c) => `<option>${esc(c)}</option>`).join("");
}

// Search + filters combined
function filterMedicines() {
  const q = $("searchInput").value.trim().toLowerCase();
  const cat = $("categoryFilter").value;
  const avail = $("availabilityFilter").value;
  const rx = $("rxFilter").value;
  const list = medicines.filter((m) =>
    m.name.toLowerCase().includes(q) &&
    (!cat || m.category === cat) &&
    (!avail || (avail === "in") === (m.stock > 0)) &&
    (!rx || (rx === "yes") === m.prescription_required));
  renderMedicines(list);
}
const searchMedicines = filterMedicines; // search uses the same combined filter

function renderMedicines(list) {
  const grid = $("medicineGrid");
  if (!list.length) { grid.innerHTML = "<p>No medicines found.</p>"; return; }
  grid.innerHTML = list.map((m) => {
    const imageUrl = String(m.image_url || "");
    const categoryClass = String(m.category || "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const image = !imageUrl || imageUrl.startsWith("https://placehold.co/")
      ? `<div class="medicine-visual visual-${categoryClass}" role="img" aria-label="${esc(m.name)} product illustration">
          <div class="medicine-pack">
            <span class="pack-brand"><i>+</i> MEDIDELIVER</span>
            <span class="pack-accent"></span>
            <strong>${esc(m.name)}</strong>
            <span class="pack-category">${esc(m.category)}</span>
          </div>
          <span class="pack-orbit"></span>
        </div>`
      : `<img src="${esc(imageUrl)}" alt="${esc(m.name)}" loading="lazy">`;
    const description = String(m.description || "").replace(/^sample\s+/i, "");
    const request = m.prescription_required ? prescriptionRequestForMedicine(m.id) : null;
    const action = m.stock < 1
      ? '<button class="btn" disabled>Out of stock</button>'
      : !m.prescription_required
        ? `<button class="btn" data-add="${m.id}">Add to Cart</button>`
        : request?.status === "approved"
          ? `<button class="btn" data-add="${m.id}">Add to Cart</button><span class="rx-approved">Prescription approved</span>`
          : request?.status === "pending_review"
            ? `<button class="btn" disabled>Under pharmacist review</button><button class="btn secondary rx-status" data-check-request="${m.id}">Check review status</button>`
            : request?.status === "rejected"
              ? `<span class="rx-rejected">Prescription needs attention</span><button class="btn" data-request="${m.id}">Resubmit prescription</button>`
                : request?.status === "used"
                  ? `<span class="rx-approved">Previous prescription used</span><button class="btn" data-request="${m.id}">Upload New Prescription</button>`
                  : `<button class="btn" data-request="${m.id}">Upload Prescription</button>`;
    return `
    <div class="card">
      ${image}
      <strong>${esc(m.name)}</strong>
      <span class="tag">${esc(m.category)}</span>
      ${m.prescription_required ? '<span class="tag rx">Prescription required</span>' : ""}
      <small>${esc(description)}</small>
      <a class="product-link" href="product.html?id=${encodeURIComponent(m.id)}">View product details <span aria-hidden="true">→</span></a>
      <strong>PKR ${Number(m.price).toFixed(2)}</strong>
      ${m.stock > 0 ? `<span class="in">In stock (${m.stock})</span>` : '<span class="out">Out of stock</span>'}
      ${action}
    </div>`;
  }).join("");
}

// ---------- Cart ----------
function prescriptionRequestForMedicine(medicineId) {
  for (let i = prescriptionRequests.length - 1; i >= 0; i--) {
    if (prescriptionRequests[i].medicineId === medicineId) return prescriptionRequests[i];
  }
  return null;
}

function savePrescriptionRequests() {
  localStorage.setItem("prescriptionRequests", JSON.stringify(prescriptionRequests));
}

async function hashAccessKey(accessKey) {
  const bytes = new TextEncoder().encode(accessKey);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function refreshPrescriptionStatuses() {
  for (const request of prescriptionRequests) {
    const { data, error } = await supabaseClient.rpc("get_prescription_request_status", {
      p_request_id: request.id,
      p_access_key_hash: await hashAccessKey(request.accessKey),
    });
    if (error) throw error;
    if (!data?.length || data[0].medicine_id !== request.medicineId) {
      throw new Error("A saved prescription request could not be verified.");
    }
    request.status = data[0].status;
  }
  savePrescriptionRequests();
}

function startPrescriptionRequest(medicineId) {
  const med = medicines.find((item) => item.id === medicineId);
  if (!med || !med.prescription_required || med.stock < 1) return;
  activePrescriptionMedicineId = medicineId;
  $("prescriptionRequestForm").reset();
  $("prescriptionProduct").textContent = `Request pharmacist review for ${med.name}.`;
  showMessage($("prescriptionRequestError"), "");
  showMessage($("prescriptionRequestConfirmation"), "");
  $("prescriptionReview").hidden = false;
  $("prescriptionReview").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function checkPrescriptionStatus(medicineId) {
  const request = prescriptionRequestForMedicine(medicineId);
  if (!request) return;
  const button = document.querySelector(`[data-check-request="${CSS.escape(medicineId)}"]`);
  if (button) { button.disabled = true; button.textContent = "Checking..."; }
  try {
    const { data, error } = await supabaseClient.rpc("get_prescription_request_status", {
      p_request_id: request.id,
      p_access_key_hash: await hashAccessKey(request.accessKey),
    });
    if (error) throw error;
    if (!data?.length || data[0].medicine_id !== request.medicineId) {
      throw new Error("The prescription request could not be verified.");
    }
    request.status = data[0].status;
    savePrescriptionRequests();
    filterMedicines();
    if (request.status === "approved") {
      showMessage($("message"), "Prescription approved. You can now add the medicine to your cart.");
    } else if (request.status === "rejected") {
      showMessage($("message"), "The pharmacist needs more information. Please submit a new prescription.");
    } else {
      showMessage($("message"), "Your prescription is still awaiting pharmacist review.");
    }
  } catch (error) {
    showMessage($("message"), "Could not check prescription status: " + error.message, "error");
  }
}

function addToCart(id) {
  const med = medicines.find((m) => m.id === id);
  if (!med || med.stock < 1) return;
  const request = med.prescription_required ? prescriptionRequestForMedicine(id) : null;
  if (med.prescription_required && request?.status !== "approved") {
    return showMessage($("message"), "A pharmacist must approve your prescription before this medicine can be added to the cart.", "error");
  }
  const item = cart.find((i) => i.id === id);
  if (item) {
    if (item.quantity >= med.stock) return alert("Sorry, the requested quantity is not available.");
    item.quantity++;
  } else cart.push({
    id,
    quantity: 1,
    ...(med.prescription_required ? { prescriptionRequestId: request.id } : {}),
  });
  showMessage($("message"), "");
  saveCart();
}

function saveCart() {
  localStorage.setItem("cart", JSON.stringify(cart));
  renderCart();
}
function removeFromCart(id) { cart = cart.filter((i) => i.id !== id); saveCart(); }
function updateCartQuantity(id, change) {
  const item = cart.find((i) => i.id === id);
  const med = medicines.find((m) => m.id === id);
  if (!item || !med) return;
  const q = item.quantity + change;
  if (q < 1) return removeFromCart(id);
  if (q > med.stock) return alert("Sorry, the requested quantity is not available.");
  item.quantity = q;
  saveCart();
}
function calculateCartTotal() {
  return cart.reduce((sum, i) => {
    const m = medicines.find((x) => x.id === i.id);
    return sum + (m ? m.price * i.quantity : 0);
  }, 0);
}
function cartNeedsPrescription() {
  return cart.some((i) => medicines.find((m) => m.id === i.id)?.prescription_required);
}

function renderCart() {
  $("cartCount").textContent = cart.reduce((n, i) => n + i.quantity, 0);
  const box = $("cartItems");
  if (!cart.length) {
    box.innerHTML = "<p>Your cart is empty. Browse our medicines and add products to your cart.</p>";
  } else {
    box.innerHTML = cart.map((i) => {
      const m = medicines.find((x) => x.id === i.id);
      if (!m) return "";
      return `<div class="cart-row">
        <span><strong>${esc(m.name)}</strong><br>PKR ${Number(m.price).toFixed(2)} each</span>
        <span class="qty"><button data-dec="${m.id}">−</button> ${i.quantity} <button data-inc="${m.id}">+</button></span>
        <span>PKR ${(m.price * i.quantity).toFixed(2)}</span>
        <button class="btn danger" data-remove="${m.id}">Remove</button></div>`;
    }).join("") + `<p><strong>Subtotal: PKR ${calculateCartTotal().toFixed(2)}</strong></p>`;
  }
  renderSummary();
}

function renderSummary() {
  const sub = calculateCartTotal();
  const lines = cart.map((i) => {
    const m = medicines.find((x) => x.id === i.id);
    return m ? `<div class="sum-line"><span>${esc(m.name)} x${i.quantity}</span><span>PKR ${(m.price * i.quantity).toFixed(2)}</span></div>` : "";
  }).join("");
  $("orderSummary").innerHTML = `<h3>Order Summary</h3>${lines || "<p>No items.</p>"}
    <hr><div class="sum-line"><span>Subtotal</span><span>PKR ${sub.toFixed(2)}</span></div>
    <div class="sum-line"><span>Delivery Fee</span><span>PKR ${cart.length ? DELIVERY_FEE : 0}</span></div>
    <div class="sum-line"><strong>Total</strong><strong>PKR ${(cart.length ? sub + DELIVERY_FEE : 0).toFixed(2)}</strong></div>`;
  $("rxBox").hidden = !cartNeedsPrescription();
  if (cartNeedsPrescription()) {
    const reviewState = cart
      .filter((item) => medicines.find((medicine) => medicine.id === item.id)?.prescription_required)
      .map((item) => prescriptionRequests.find((request) => request.id === item.prescriptionRequestId)?.status);
    $("rxBox").querySelector("p").textContent = reviewState.every((status) => status === "approved")
      ? "Every prescription item in your cart has pharmacist approval."
      : "Pharmacist approval is required before prescription medicines can be checked out.";
  }
}

// ---------- Checkout validation ----------
function validateCheckoutForm(f) {
  const v = (n) => f.elements[n].value.trim();
  if (!cart.length) return "Your cart is empty.";
  if (!v("name") || !v("email") || !v("phone") || !v("address") || !v("city")) return "Please fill in all required fields.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v("email"))) return "Please enter a valid email address.";
  if (!/^(\+92|0)?3\d{9}$/.test(v("phone").replace(/[\s-]/g, ""))) return "Please enter a valid Pakistani mobile number, e.g. 03001234567.";
  if (cartNeedsPrescription()) {
    for (const item of cart) {
      const med = medicines.find((medicine) => medicine.id === item.id);
      if (!med?.prescription_required) continue;
      const request = prescriptionRequests.find((entry) => entry.id === item.prescriptionRequestId);
      if (!request || request.status !== "approved" || request.medicineId !== med.id) {
        return `A pharmacist must approve the prescription for ${med.name} before checkout.`;
      }
    }
  }
  return null;
}

// Re-check stock in Supabase right before ordering
async function checkStock() {
  const ids = cart.map((i) => i.id);
  const { data, error } = await supabaseClient.from("medicines").select("id,stock,price").in("id", ids);
  if (error) throw error;
  for (const item of cart) {
    const m = data.find((d) => d.id === item.id);
    if (!m || m.stock < item.quantity) throw new Error("Sorry, the requested quantity is not available.");
  }
  return data; // fresh prices from the database
}

// Upload to the PRIVATE bucket; we store only the file path, not a public URL
async function uploadPrescription(file) {
  const ext = file.type === "application/pdf" ? "pdf" : file.type === "image/png" ? "png" : "jpg";
  const path = `${crypto.randomUUID()}.${ext}`;
  const { error } = await supabaseClient.storage.from("prescriptions").upload(path, file, { contentType: file.type });
  if (error) throw error;
  return path;
}

$("prescriptionRequestForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const button = $("submitPrescriptionBtn");
  const errorBox = $("prescriptionRequestError");
  showMessage(errorBox, "");
  const med = medicines.find((item) => item.id === activePrescriptionMedicineId);
  const file = $("requestRxFile").files[0];
  if (!med?.prescription_required) return showMessage(errorBox, "Choose a prescription medicine first.", "error");
  if (!form.reportValidity()) return;
  if (!file) return showMessage(errorBox, "Select your prescription file.", "error");
  if (!ALLOWED_TYPES.includes(file.type)) return showMessage(errorBox, "Prescription must be a JPG, PNG or PDF file.", "error");
  if (file.size > MAX_FILE_SIZE) return showMessage(errorBox, "Prescription file must be 5 MB or smaller.", "error");
  if (!/^(\+92|0)?3\d{9}$/.test(form.elements.phone.value.trim().replace(/[\s-]/g, ""))) {
    return showMessage(errorBox, "Please enter a valid Pakistani mobile number, e.g. 03001234567.", "error");
  }

  button.disabled = true;
  button.textContent = "Submitting...";
  let uploadedPath = null;
  let requestCreated = false;
  try {
    uploadedPath = await uploadPrescription(file);
    const accessKey = crypto.randomUUID() + crypto.randomUUID();
    const requestId = crypto.randomUUID();
    const { error } = await supabaseClient.from("prescription_requests").insert({
      id: requestId,
      medicine_id: med.id,
      customer_name: form.elements.name.value.trim(),
      email: form.elements.email.value.trim(),
      phone: form.elements.phone.value.trim(),
      prescription_path: uploadedPath,
      access_key_hash: await hashAccessKey(accessKey),
      status: "pending_review",
    });
    if (error) throw error;
    requestCreated = true;
    prescriptionRequests.push({
      id: requestId,
      medicineId: med.id,
      accessKey,
      status: "pending_review",
    });
    savePrescriptionRequests();
    activePrescriptionMedicineId = null;
    form.reset();
    $("prescriptionReview").hidden = true;
    showMessage(
      $("prescriptionRequestConfirmation"),
      `Your prescription for ${med.name} has been submitted for pharmacist review. Use “Check review status” on the product to see the decision.`,
      "success",
    );
    filterMedicines();
  } catch (error) {
    if (uploadedPath && !requestCreated) {
      const { error: cleanupError } = await supabaseClient.storage.from("prescriptions").remove([uploadedPath]);
      if (cleanupError) {
        error.message += ` Prescription upload cleanup failed: ${cleanupError.message}`;
      }
    }
    showMessage(errorBox, error.message || "Could not submit prescription for review.", "error");
  } finally {
    button.disabled = false;
    button.textContent = "Submit for pharmacist review";
  }
});

async function createOrder(f, freshMeds, prescriptionPath) {
  // Total is computed from fresh DB prices, not from browser data
  const subtotal = cart.reduce((s, i) => s + freshMeds.find((m) => m.id === i.id).price * i.quantity, 0);
  const id = crypto.randomUUID(); // generated here because anonymous users cannot SELECT the new row back
  const { error } = await supabaseClient.from("orders").insert({
    id, customer_name: f.elements.name.value.trim(), email: f.elements.email.value.trim(),
    phone: f.elements.phone.value.trim(), delivery_address: f.elements.address.value.trim(),
    city: f.elements.city.value.trim(), postal_code: f.elements.postal.value.trim() || null,
    notes: f.elements.notes.value.trim() || null, total_amount: subtotal + DELIVERY_FEE,
    status: "pending", prescription_url: prescriptionPath,
  });
  if (error) throw error;
  return id;
}

async function createOrderItems(orderId, freshMeds) {
  const rows = cart.map((i) => ({
    order_id: orderId, medicine_id: i.id, quantity: i.quantity,
    unit_price: freshMeds.find((m) => m.id === i.id).price,
    prescription_request_id: i.prescriptionRequestId || null,
  }));
  const { error } = await supabaseClient.from("order_items").insert(rows);
  if (error) throw error;
}

$("checkoutForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target, btn = $("placeOrderBtn"), err = $("formError");
  showMessage(err, "");
  try {
    await refreshPrescriptionStatuses();
    filterMedicines();
  } catch (error) {
    return showMessage(err, "Could not verify pharmacist approval: " + error.message, "error");
  }
  const verifiedProblem = validateCheckoutForm(f);
  if (verifiedProblem) return showMessage(err, verifiedProblem, "error");
  btn.disabled = true; btn.textContent = "Placing order...";
  try {
    const fresh = await checkStock();
    const rxPath = null;
    const orderId = await createOrder(f, fresh, rxPath);
    await createOrderItems(orderId, fresh);
    cart = []; saveCart(); f.reset();
    showMessage($("confirmation"), `Your order has been placed successfully. Thank you for shopping with us. Order ID: ${orderId}`, "success");
    fetchMedicines(); // refresh stock numbers
  } catch (ex) {
    showMessage(err, ex.message || "Something went wrong.", "error");
  } finally {
    btn.disabled = false; btn.textContent = "Place Order";
  }
});

// ---------- Admin: order management ----------
const STATUSES = ["pending", "confirmed", "processing", "out_for_delivery", "delivered", "cancelled"];
const PRESCRIPTION_STATUSES = ["pending_review", "approved", "rejected", "used"];

async function fetchPrescriptionRequests() {
  const { data, error } = await supabaseClient.from("prescription_requests")
    .select("id,medicine_id,customer_name,email,phone,prescription_path,status,created_at,medicine:medicines(name)")
    .order("created_at", { ascending: false });
  if (error) {
    $("prescriptionRequestList").innerHTML = `<div class="msg error">${esc(error.message)}</div>`;
    return;
  }
  const rows = await Promise.all(data.map(async (request) => {
    const { data: signed, error: signedError } = await supabaseClient.storage
      .from("prescriptions").createSignedUrl(request.prescription_path, 300);
    if (signedError) throw signedError;
    return `<tr>
      <td>${esc(request.medicine?.name || "Unknown medicine")}</td>
      <td>${esc(request.customer_name)}<br>${esc(request.email)}<br>${esc(request.phone)}</td>
      <td><a href="${esc(signed.signedUrl)}" target="_blank" rel="noopener">View prescription</a></td>
      <td>${new Date(request.created_at).toLocaleString()}</td>
      <td>${request.status === "used"
        ? "Used in an order"
        : `<select data-prescription-status="${request.id}">${PRESCRIPTION_STATUSES.map((status) => `<option value="${status}" ${status === request.status ? "selected" : ""}>${status.replace("_", " ")}</option>`).join("")}</select>`}</td>
    </tr>`;
  }));
  $("prescriptionRequestList").innerHTML = `<h3>Prescription reviews</h3><p class="note">Prescription decisions must be made by a qualified pharmacist.</p>
    <div class="table-wrap"><table><thead><tr><th>Medicine</th><th>Customer</th><th>File</th><th>Submitted</th><th>Review status</th></tr></thead>
    <tbody>${rows.length ? rows.join("") : "<tr><td colspan='5'>No prescription requests.</td></tr>"}</tbody></table></div>`;
}

async function fetchOrders() {
  const { data, error } = await supabaseClient.from("orders")
    .select("id,customer_name,total_amount,status,created_at").order("created_at", { ascending: false });
  if (error) return ($("orderList").innerHTML = `<div class="msg error">${esc(error.message)}</div>`);
  $("orderList").innerHTML = `<div class="table-wrap"><table><tr><th>ID</th><th>Customer</th><th>Total</th><th>Date</th><th>Status</th><th></th></tr>` +
    (data.length ? data.map((o) => `<tr><td>${o.id.slice(0, 8)}</td><td>${esc(o.customer_name)}</td>
      <td>PKR ${Number(o.total_amount).toFixed(2)}</td><td>${new Date(o.created_at).toLocaleDateString()}</td>
      <td><select data-status="${o.id}">${STATUSES.map((s) => `<option ${s === o.status ? "selected" : ""}>${s}</option>`).join("")}</select></td>
      <td><button class="btn danger" data-cancel="${o.id}">Delete</button></td></tr>`).join("") : "<tr><td colspan='6'>No orders.</td></tr>") +
    "</table></div>";
}
async function updateOrderStatus(id, status) {
  const { error } = await supabaseClient.from("orders").update({ status }).eq("id", id);
  if (error) alert(error.message);
}
async function updatePrescriptionStatus(id, status) {
  if (!PRESCRIPTION_STATUSES.includes(status)) return;
  const reviewedAt = status === "pending_review" ? null : new Date().toISOString();
  const { error } = await supabaseClient.from("prescription_requests")
    .update({ status, reviewed_at: reviewedAt }).eq("id", id);
  if (error) {
    alert(error.message);
    return;
  }
  try {
    await fetchPrescriptionRequests();
  } catch (fetchError) {
    $("prescriptionRequestList").innerHTML = `<div class="msg error">${esc(fetchError.message)}</div>`;
  }
}
async function cancelOrder(id) {
  if (!confirm("Delete this order permanently?")) return;
  const { error } = await supabaseClient.from("orders").delete().eq("id", id);
  if (error) alert(error.message); else fetchOrders();
}

async function refreshAuthUI() {
  const { data } = await supabaseClient.auth.getSession();
  const loggedIn = !!data.session;
  $("loginForm").hidden = loggedIn;
  $("logoutBtn").hidden = !loggedIn;
  if (loggedIn) {
    fetchOrders();
    fetchPrescriptionRequests().catch((error) => {
      $("prescriptionRequestList").innerHTML = `<div class="msg error">${esc(error.message)}</div>`;
    });
  } else {
    $("orderList").innerHTML = "";
    $("prescriptionRequestList").innerHTML = "";
  }
}
$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const { error } = await supabaseClient.auth.signInWithPassword({ email: $("adminEmail").value, password: $("adminPassword").value });
  if (error) alert(error.message);
  refreshAuthUI();
});
$("logoutBtn").addEventListener("click", async () => { await supabaseClient.auth.signOut(); refreshAuthUI(); });

// ---------- Event wiring ----------
["searchInput", "categoryFilter", "availabilityFilter", "rxFilter"].forEach((id) => $(id).addEventListener("input", filterMedicines));
document.addEventListener("click", (e) => {
  const d = e.target.dataset;
  if (d.request) startPrescriptionRequest(d.request);
  if (d.checkRequest) checkPrescriptionStatus(d.checkRequest);
  if (d.add) addToCart(d.add);
  if (d.inc) updateCartQuantity(d.inc, 1);
  if (d.dec) updateCartQuantity(d.dec, -1);
  if (d.remove) removeFromCart(d.remove);
  if (d.cancel) cancelOrder(d.cancel);
});
document.addEventListener("change", (e) => {
  if (e.target.dataset.status) updateOrderStatus(e.target.dataset.status, e.target.value);
  if (e.target.dataset.prescriptionStatus) updatePrescriptionStatus(e.target.dataset.prescriptionStatus, e.target.value);
});
$("menuBtn").addEventListener("click", () => $("nav").classList.toggle("open"));

// ---------- Start ----------
renderCart();
fetchMedicines().then(renderCart);
refreshAuthUI();
