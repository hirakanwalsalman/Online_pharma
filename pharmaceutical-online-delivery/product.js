function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[character]));
}

function detailRow(label, value) {
  return `<div class="detail-row"><dt>${label}</dt><dd>${escapeHtml(value || "Not provided by the pharmacy.")}</dd></div>`;
}

async function loadProduct() {
  const message = document.getElementById("productMessage");
  const details = document.getElementById("productDetails");
  const productId = new URLSearchParams(window.location.search).get("id");
  if (!productId) {
    message.textContent = "Choose a product from the catalogue to see its details.";
    return;
  }

  const { data: product, error } = await supabaseClient
    .from("medicines")
    .select("*")
    .eq("id", productId)
    .maybeSingle();
  if (error) {
    message.className = "msg error";
    message.textContent = `Could not load product details: ${error.message}`;
    return;
  }
  if (!product) {
    message.className = "msg error";
    message.textContent = "This product could not be found in the catalogue.";
    return;
  }

  document.title = `${product.name} | MediDeliver`;
  message.hidden = true;
  details.hidden = false;
  const genericName = product.generic_name || "Not provided by the pharmacy.";
  const brandName = product.brand_name || "Not provided by the pharmacy.";
  const image = product.image_url && !product.image_url.startsWith("https://placehold.co/")
    ? `<img class="product-detail-image" src="${escapeHtml(product.image_url)}" alt="${escapeHtml(product.name)}">`
    : `<div class="product-detail-image medicine-visual visual-${escapeHtml(String(product.category || "").toLowerCase().replace(/[^a-z0-9]+/g, "-"))}" role="img" aria-label="${escapeHtml(product.name)} product illustration">
        <div class="medicine-pack">
          <span class="pack-brand"><i>+</i> MEDIDELIVER</span>
          <span class="pack-accent"></span>
          <strong>${escapeHtml(product.name)}</strong>
          <span class="pack-category">${escapeHtml(product.category)}</span>
        </div>
        <span class="pack-orbit"></span>
      </div>`;
  const prescriptionBadge = product.prescription_required
    ? '<span class="tag rx">Prescription required</span>'
    : '<span class="tag">No prescription required</span>';

  details.innerHTML = `
    <div class="product-detail-hero">
      ${image}
      <div class="product-overview">
        <span class="eyebrow">${escapeHtml(product.category || "HEALTH ESSENTIALS")}</span>
        <h1>${escapeHtml(product.name)}</h1>
        <p class="generic-summary">${escapeHtml(genericName)} · ${escapeHtml(product.strength || "Strength not provided")}</p>
        <div class="product-badges">${prescriptionBadge}<span class="tag">${product.stock > 0 ? "In stock" : "Currently unavailable"}</span></div>
        <p class="product-price">PKR ${Number(product.price).toFixed(2)}</p>
        <a class="btn" href="index.html#medicines">Back to catalogue</a>
      </div>
    </div>
    <section class="product-information" aria-labelledby="product-information-heading">
      <div class="section-heading">
        <div><span class="eyebrow">PRODUCT INFORMATION</span><h2 id="product-information-heading">Details &amp; guidance</h2></div>
      </div>
      <dl class="detail-list">
        ${detailRow("Generic name", product.generic_name)}
        ${detailRow("Brand name", product.brand_name)}
        ${detailRow("Manufacturer", product.manufacturer)}
        ${detailRow("Strength", product.strength)}
        ${detailRow("Dosage form", product.dosage_form)}
        ${detailRow("Pack size", product.pack_size)}
        ${detailRow("Uses", product.uses)}
        ${detailRow("Directions", product.directions)}
        ${detailRow("Side effects", product.side_effects)}
        ${detailRow("Storage", product.storage_instructions)}
        ${detailRow("Expiry information", product.expiry_info)}
        ${detailRow("Prescription required", product.prescription_required ? "Yes" : "No")}
      </dl>
      <aside class="product-safety-note">
        <strong>Important information</strong>
        <p>Product details are general information and must be checked against the original pack, leaflet and current pharmacy records. Follow your prescriber's or pharmacist's directions. Expiry dates vary by batch and must be checked on the individual pack.</p>
        ${product.prescription_required ? '<p>This item requires a valid prescription and pharmacist approval before it can be added to the cart or checked out. <a href="prescription-policy.html">Read the prescription policy</a>.</p>' : ""}
      </aside>
    </section>
  `;
}

loadProduct().catch((error) => {
  const message = document.getElementById("productMessage");
  message.className = "msg error";
  message.textContent = `Could not load product details: ${error.message}`;
});
