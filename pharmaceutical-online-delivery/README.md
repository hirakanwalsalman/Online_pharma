# MediDeliver – Pharmaceutical Online Delivery

A basic online pharmacy site: browse and search medicines, cart, checkout, prescription upload, and a protected admin order panel.
Built with **HTML5, CSS3, Vanilla JavaScript and Supabase** (no frameworks). Demo project, not a real pharmacy.

## Files
- `index.html` – page structure
- `style.css` – responsive styling
- `script.js` – medicines, cart, checkout, orders, admin logic
- `product.html`, `product.js` – medicine detail page and product information
- `supabase.js` – Supabase client (URL + anon key only)
- `schema.sql` – tables, constraints, RLS policies, private storage bucket, sample medicines
- `about.html`, `contact.html`, `privacy.html`, `terms.html`, `returns.html`, `prescription-policy.html` – demo information and policy pages

## Demo information and policy pages
- All license, pharmacist, business registration, phone, address and delivery statements are visibly placeholders. This project does not establish that MediDeliver is licensed or operational.
- The policy pages are illustrative templates, not legal advice or a substitute for review under applicable Pakistani law. Replace them with accurate business information and have them reviewed before launch.
- Do not use the demo storefront to submit real customer information or prescriptions.
- Prescription products follow a gated request/review/approval flow in the UI and are also protected by a database trigger before order items can be inserted. Apply the updated `schema.sql` to enable the review-request table, status RPC and trigger. Review decisions must be made by an authorized qualified pharmacist; an admin login alone does not verify professional credentials.
- Product details include generic and brand names, manufacturer, strength, dosage form, pack size, uses, directions, side effects, storage and expiry information. The seeded values are illustrative; batch expiry must be checked on the individual pack.

## Setup
1. Create a project at https://supabase.com.
2. **Project Settings > API**: copy the *Project URL* and the *anon public* key.
3. Paste them into `supabase.js` in place of `YOUR_SUPABASE_URL` and `YOUR_SUPABASE_ANON_KEY`. Never use the `service_role` key in frontend code.
4. **SQL Editor**: paste and run all of `schema.sql`. This creates the tables, RLS policies, the private `prescriptions` bucket and 6 sample medicines (edit or add more in **Table Editor > medicines**).
   The script also adds medicine-detail fields to an existing `medicines` table and fills only empty fields on its sample rows. Verify all product, manufacturer, usage, safety and batch-expiry details against approved packs and pharmacy records before live use.
5. **Admin user**: in **Authentication > Users** add a user (email + password). Copy its UUID and run:
   `insert into admins (user_id) values ('<uuid>');`
   Only a qualified, authorized pharmacist should review prescription requests; admin access alone does not verify professional credentials.
6. Run locally with a server, e.g. VS Code **Live Server** (right-click `index.html` > Open with Live Server), or `python -m http.server`.

## Security design
- **RLS is enabled on every table.** Public users can read medicines and *insert* orders, but cannot read, update or delete orders. Only users listed in `admins` can.
- **Prescriptions** go to a private bucket. Anyone can upload; only admins can read. Only the file path is stored in `orders.prescription_url`. Admins view files via signed URLs (`createSignedUrl`), never public links.
- **Stock** is decremented by a database trigger in the same transaction as order-item insertion, so the public has no UPDATE rights on `medicines`. It also rejects overselling and requires an approved request for prescription items.
- The total is calculated from prices fetched fresh from the database, not from browser-stored data.

## Limitations / future improvements
- Order creation is several client calls, not one transaction. Move it into a single Postgres function/Edge Function for atomicity.
- Customers cannot look up their own orders (no customer accounts yet). Add Supabase Auth for customers and policies like `auth.uid() = user_id`.
- The review interface records pending, approved or rejected decisions but cannot verify the reviewer's professional credentials. Configure access so only an authorized pharmacist can make prescription decisions.
- The admin panel does not yet display prescription files or order items.
- Add rate limiting/CAPTCHA, malware scanning, and a documented retention/deletion process for prescription uploads.
- Not manually tested against a live Supabase project yet: add your keys, then work through the checklist in your spec.
