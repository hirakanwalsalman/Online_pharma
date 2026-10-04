-- Run this whole file in Supabase > SQL Editor.

create table if not exists medicines (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null,
  description text,
  price numeric(10,2) not null check (price >= 0),
  stock integer not null default 0 check (stock >= 0),
  image_url text,
  prescription_required boolean not null default false,
  generic_name text,
  brand_name text,
  manufacturer text,
  strength text,
  dosage_form text,
  pack_size text,
  uses text,
  directions text,
  side_effects text,
  storage_instructions text,
  expiry_info text,
  created_at timestamptz not null default now()
);
alter table medicines add column if not exists generic_name text;
alter table medicines add column if not exists brand_name text;
alter table medicines add column if not exists manufacturer text;
alter table medicines add column if not exists strength text;
alter table medicines add column if not exists dosage_form text;
alter table medicines add column if not exists pack_size text;
alter table medicines add column if not exists uses text;
alter table medicines add column if not exists directions text;
alter table medicines add column if not exists side_effects text;
alter table medicines add column if not exists storage_instructions text;
alter table medicines add column if not exists expiry_info text;

-- Prescription files and customer details remain private; customers can only
-- retrieve a request's status using the secret access key created by the client.
create table if not exists prescription_requests (
  id uuid primary key default gen_random_uuid(),
  medicine_id uuid not null references medicines(id),
  customer_name text not null,
  email text not null,
  phone text not null,
  prescription_path text not null,
  access_key_hash text not null check (access_key_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending_review'
    check (status in ('pending_review','approved','rejected','used')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null,
  email text not null,
  phone text not null,
  delivery_address text not null,
  city text not null,
  postal_code text,
  notes text,
  total_amount numeric(10,2) not null check (total_amount >= 0),
  status text not null default 'pending'
    check (status in ('pending','confirmed','processing','out_for_delivery','delivered','cancelled')),
  prescription_url text,           -- path inside the private "prescriptions" bucket
  created_at timestamptz not null default now()
);

create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  medicine_id uuid not null references medicines(id),
  quantity integer not null check (quantity > 0),
  unit_price numeric(10,2) not null check (unit_price >= 0),
  prescription_request_id uuid references prescription_requests(id),
  created_at timestamptz not null default now()
);
alter table order_items add column if not exists prescription_request_id uuid references prescription_requests(id);

-- Admins are Supabase Auth users listed here.
create table if not exists admins (user_id uuid primary key references auth.users(id) on delete cascade);
create or replace function is_admin() returns boolean
  language sql security definer stable
  set search_path = public
  as
  $$ select exists (select 1 from admins where user_id = auth.uid()) $$;
revoke all on function is_admin() from public;
grant execute on function is_admin() to anon, authenticated;

alter table medicines   enable row level security;
alter table orders      enable row level security;
alter table order_items enable row level security;
alter table admins      enable row level security;
alter table prescription_requests enable row level security;

-- Medicines: public read, admin write.
drop policy if exists "public reads medicines" on medicines;
drop policy if exists "admin writes medicines" on medicines;
create policy "public reads medicines" on medicines for select using (true);
create policy "admin writes medicines" on medicines for all using (is_admin()) with check (is_admin());

-- Orders: anyone may INSERT (checkout) but only admins may read/update/delete.
drop policy if exists "anyone places orders" on orders;
drop policy if exists "admin reads orders" on orders;
drop policy if exists "admin updates orders" on orders;
drop policy if exists "admin deletes orders" on orders;
create policy "anyone places orders" on orders for insert with check (status = 'pending');
create policy "admin reads orders"   on orders for select using (is_admin());
create policy "admin updates orders" on orders for update using (is_admin());
create policy "admin deletes orders" on orders for delete using (is_admin());

drop policy if exists "anyone adds order items" on order_items;
drop policy if exists "admin reads order items" on order_items;
create policy "anyone adds order items" on order_items for insert with check (true);
create policy "admin reads order items" on order_items for select using (is_admin());

-- Customers may submit review requests but only admins can read or decide them.
drop policy if exists "public submits prescription requests" on prescription_requests;
drop policy if exists "admin reads prescription requests" on prescription_requests;
drop policy if exists "admin reviews prescription requests" on prescription_requests;
create policy "public submits prescription requests" on prescription_requests for insert
  to anon, authenticated
  with check (
    status = 'pending_review'
    and exists (
      select 1 from medicines
      where medicines.id = prescription_requests.medicine_id and prescription_required
    )
  );
create policy "admin reads prescription requests" on prescription_requests for select using (is_admin());
create policy "admin reviews prescription requests" on prescription_requests for update using (is_admin()) with check (is_admin());
grant insert on prescription_requests to anon, authenticated;
grant select, update on prescription_requests to authenticated;

-- Customers can retrieve only the status of a request when they present its secret key hash.
create or replace function get_prescription_request_status(p_request_id uuid, p_access_key_hash text)
returns table(status text, medicine_id uuid)
  language sql security definer stable
  set search_path = public
  as $$
    select r.status, r.medicine_id
    from prescription_requests r
    where r.id = p_request_id and r.access_key_hash = p_access_key_hash
  $$;
revoke all on function get_prescription_request_status(uuid, text) from public;
grant execute on function get_prescription_request_status(uuid, text) to anon, authenticated;

-- Enforce approved prescriptions and decrement inventory in the same transaction
-- that inserts the order item, preventing client-side bypasses and overselling.
create or replace function process_order_item()
returns trigger
  language plpgsql security definer
  set search_path = public
  as $$
declare
  requires_prescription boolean;
  available_stock integer;
begin
  select prescription_required, stock into requires_prescription, available_stock
    from medicines where id = new.medicine_id for update;
  if not found or available_stock < new.quantity then
    raise exception 'Insufficient stock';
  end if;
  if requires_prescription and (
    new.prescription_request_id is null or not exists (
      select 1 from prescription_requests r
      where r.id = new.prescription_request_id
        and r.medicine_id = new.medicine_id
        and r.status = 'approved'
    )
  ) then
    raise exception 'A pharmacist-approved prescription is required for this medicine';
  end if;
  update medicines set stock = stock - new.quantity where id = new.medicine_id;
  if requires_prescription then
    update prescription_requests set status = 'used', reviewed_at = now()
    where id = new.prescription_request_id;
  end if;
  return new;
end $$;
drop trigger if exists order_items_require_prescription_approval on order_items;
create trigger order_items_require_prescription_approval
  before insert on order_items
  for each row execute function process_order_item();
revoke all on function process_order_item() from public, anon, authenticated;

-- Kept for compatibility with older clients, but stock is now handled by the
-- order-item trigger and this function must not be callable by public clients.
create or replace function place_order_stock(p_medicine uuid, p_qty int) returns void
  language plpgsql security definer as $$
begin
  update medicines set stock = stock - p_qty where id = p_medicine and stock >= p_qty;
  if not found then raise exception 'Insufficient stock'; end if;
end $$;
revoke all on function place_order_stock(uuid, int) from public, anon, authenticated;

-- Private storage bucket for prescriptions: upload only, no public read.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('prescriptions','prescriptions',false,5242880,array['image/jpeg','image/png','application/pdf'])
  on conflict (id) do update set
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "anyone uploads prescription" on storage.objects;
drop policy if exists "admin reads prescriptions" on storage.objects;
create policy "anyone uploads prescription" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'prescriptions');
create policy "admin reads prescriptions" on storage.objects for select to authenticated
  using (bucket_id = 'prescriptions' and is_admin());

-- Sample data (fictional, no medical claims)
insert into medicines (
  name, category, description, price, stock, image_url, prescription_required,
  generic_name, brand_name, manufacturer, strength, dosage_form, pack_size,
  uses, directions, side_effects, storage_instructions, expiry_info
)
select
  seed.name, seed.category, seed.description, seed.price, seed.stock, seed.image_url, seed.prescription_required,
  seed.generic_name, seed.brand_name, seed.manufacturer, seed.strength, seed.dosage_form, seed.pack_size,
  seed.uses, seed.directions, seed.side_effects, seed.storage_instructions, seed.expiry_info
from (values
 (
  'Pain Relief Tablets 500mg','Pain Relief','Sample pain relief tablets, pack of 20.',120,50,'https://placehold.co/300x200?text=Tablets',false,
  'Paracetamol','Relieva (illustrative)','Carewell Laboratories (illustrative)','500 mg','Tablet','20 tablets',
  'Temporary relief of mild to moderate pain and fever.',
  'Follow the approved pack label or prescriber instructions. Do not exceed the stated dose or combine with other paracetamol-containing products.',
  'May include nausea or rash. Taking more than directed can cause serious liver damage; seek urgent medical advice after an overdose.',
  'Store in a cool, dry place away from direct sunlight. Keep out of reach of children.',
  'Check the expiry date printed on the individual pack; expiry varies by batch.'
 ),
 (
  'Amoxicillin Capsules','Antibiotics','Sample antibiotic capsules, pack of 10.',350,20,'https://placehold.co/300x200?text=Capsules',true,
  'Amoxicillin','Amoxiva (illustrative)','Northstar Therapeutics (illustrative)','500 mg','Capsule','10 capsules',
  'Treatment of susceptible bacterial infections when prescribed by a qualified clinician. It does not treat viral infections such as colds or flu.',
  'Use only when prescribed. Follow the exact dose and duration on the prescription and pack label; complete the prescribed course unless your clinician advises otherwise.',
  'May include nausea, diarrhoea or rash. Stop and seek urgent medical help for breathing difficulty, facial swelling or a severe allergic reaction.',
  'Store as directed on the dispensing label and pack leaflet; protect from heat and moisture.',
  'Check the expiry date printed on the individual pack; expiry varies by batch.'
 ),
 (
  'Vitamin C 1000mg','Vitamins & Supplements','Sample vitamin C effervescent tablets.',450,30,'https://placehold.co/300x200?text=Vitamin+C',false,
  'Ascorbic acid','C-Viva (illustrative)','Brightleaf Consumer Health (illustrative)','1000 mg','Effervescent tablet','10 tablets',
  'Vitamin C supplement for dietary intake.',
  'Follow the pack label. Dissolve as directed before taking; do not exceed the stated serving.',
  'May cause stomach discomfort or diarrhoea. Ask a healthcare professional before use if you have a medical condition or take regular medicines.',
  'Keep tightly closed in a cool, dry place away from moisture.',
  'Check the expiry date printed on the individual pack; expiry varies by batch.'
 ),
 (
  'Cough Syrup 120ml','Cold & Flu','Sample cough syrup bottle.',220,0,'https://placehold.co/300x200?text=Syrup',false,
  'Active ingredients not specified','ClearBreath (illustrative)','Meadowline Healthcare (illustrative)','See product label','Oral syrup','120 ml bottle',
  'Intended use depends on the active ingredients stated on the actual product label.',
  'Follow the product label or advice from a pharmacist. Do not use until active ingredients and age-appropriate directions are confirmed.',
  'Side effects depend on the active ingredients. Read the patient leaflet and ask a pharmacist before use.',
  'Store as directed on the product label. Keep the bottle closed and out of reach of children.',
  'Check the expiry date printed on the individual bottle; expiry varies by batch.'
 ),
 (
  'Digital BP Monitor','Medical Devices','Sample upper-arm blood pressure monitor.',4500,8,'https://placehold.co/300x200?text=BP+Monitor',false,
  'Not applicable','PulseMate (illustrative)','Harborview Medical Devices (illustrative)','Not applicable','Digital upper-arm monitor','1 monitor',
  'For measurement and home monitoring of blood pressure; not for diagnosis.',
  'Use according to the device manual. Discuss readings and concerns with a qualified healthcare professional.',
  'Not applicable to the device itself. Incorrect cuff placement or use can produce inaccurate readings.',
  'Keep in a clean, dry place and follow the manufacturer manual for battery and cuff care.',
  'Check the device and cuff service-life or replacement information in the manufacturer manual.'
 ),
 (
  'Antiseptic Bandage Pack','First Aid','Sample assorted bandages.',150,100,'https://placehold.co/300x200?text=Bandages',false,
  'Not applicable','CarePatch (illustrative)','Fieldstone First Aid (illustrative)','Not applicable','Adhesive dressing','Assorted pack',
  'Covering and protecting minor cuts and grazes.',
  'Clean and dry the area first, then apply according to the pack instructions. Seek medical care for deep, infected or persistent wounds.',
  'Adhesive may cause skin irritation in some people. Stop use if irritation develops.',
  'Keep sealed in the original packaging in a clean, dry place.',
  'Check the expiry date printed on the individual pack; expiry varies by batch.'
 )
) as seed(
  name, category, description, price, stock, image_url, prescription_required,
  generic_name, brand_name, manufacturer, strength, dosage_form, pack_size,
  uses, directions, side_effects, storage_instructions, expiry_info
)
where not exists (select 1 from medicines existing where existing.name = seed.name);

-- Populate illustrative detail fields for the existing sample rows without
-- overwriting values a pharmacy has already entered.
update medicines as current set
  generic_name = coalesce(current.generic_name, seed.generic_name),
  brand_name = coalesce(current.brand_name, seed.brand_name),
  manufacturer = coalesce(current.manufacturer, seed.manufacturer),
  strength = coalesce(current.strength, seed.strength),
  dosage_form = coalesce(current.dosage_form, seed.dosage_form),
  pack_size = coalesce(current.pack_size, seed.pack_size),
  uses = coalesce(current.uses, seed.uses),
  directions = coalesce(current.directions, seed.directions),
  side_effects = coalesce(current.side_effects, seed.side_effects),
  storage_instructions = coalesce(current.storage_instructions, seed.storage_instructions),
  expiry_info = coalesce(current.expiry_info, seed.expiry_info)
from (values
  ('Pain Relief Tablets 500mg','Paracetamol','Relieva (illustrative)','Carewell Laboratories (illustrative)','500 mg','Tablet','20 tablets','Temporary relief of mild to moderate pain and fever.','Follow the approved pack label or prescriber instructions. Do not exceed the stated dose or combine with other paracetamol-containing products.','May include nausea or rash. Taking more than directed can cause serious liver damage; seek urgent medical advice after an overdose.','Store in a cool, dry place away from direct sunlight. Keep out of reach of children.','Check the expiry date printed on the individual pack; expiry varies by batch.'),
  ('Amoxicillin Capsules','Amoxicillin','Amoxiva (illustrative)','Northstar Therapeutics (illustrative)','500 mg','Capsule','10 capsules','Treatment of susceptible bacterial infections when prescribed by a qualified clinician. It does not treat viral infections such as colds or flu.','Use only when prescribed. Follow the exact dose and duration on the prescription and pack label; complete the prescribed course unless your clinician advises otherwise.','May include nausea, diarrhoea or rash. Stop and seek urgent medical help for breathing difficulty, facial swelling or a severe allergic reaction.','Store as directed on the dispensing label and pack leaflet; protect from heat and moisture.','Check the expiry date printed on the individual pack; expiry varies by batch.'),
  ('Vitamin C 1000mg','Ascorbic acid','C-Viva (illustrative)','Brightleaf Consumer Health (illustrative)','1000 mg','Effervescent tablet','10 tablets','Vitamin C supplement for dietary intake.','Follow the pack label. Dissolve as directed before taking; do not exceed the stated serving.','May cause stomach discomfort or diarrhoea. Ask a healthcare professional before use if you have a medical condition or take regular medicines.','Keep tightly closed in a cool, dry place away from moisture.','Check the expiry date printed on the individual pack; expiry varies by batch.'),
  ('Cough Syrup 120ml','Active ingredients not specified','ClearBreath (illustrative)','Meadowline Healthcare (illustrative)','See product label','Oral syrup','120 ml bottle','Intended use depends on the active ingredients stated on the actual product label.','Follow the product label or advice from a pharmacist. Do not use until active ingredients and age-appropriate directions are confirmed.','Side effects depend on the active ingredients. Read the patient leaflet and ask a pharmacist before use.','Store as directed on the product label. Keep the bottle closed and out of reach of children.','Check the expiry date printed on the individual bottle; expiry varies by batch.'),
  ('Digital BP Monitor','Not applicable','PulseMate (illustrative)','Harborview Medical Devices (illustrative)','Not applicable','Digital upper-arm monitor','1 monitor','For measurement and home monitoring of blood pressure; not for diagnosis.','Use according to the device manual. Discuss readings and concerns with a qualified healthcare professional.','Not applicable to the device itself. Incorrect cuff placement or use can produce inaccurate readings.','Keep in a clean, dry place and follow the manufacturer manual for battery and cuff care.','Check the device and cuff service-life or replacement information in the manufacturer manual.'),
  ('Antiseptic Bandage Pack','Not applicable','CarePatch (illustrative)','Fieldstone First Aid (illustrative)','Not applicable','Adhesive dressing','Assorted pack','Covering and protecting minor cuts and grazes.','Clean and dry the area first, then apply according to the pack instructions. Seek medical care for deep, infected or persistent wounds.','Adhesive may cause skin irritation in some people. Stop use if irritation develops.','Keep sealed in the original packaging in a clean, dry place.','Check the expiry date printed on the individual pack; expiry varies by batch.')
) as seed(
  name, generic_name, brand_name, manufacturer, strength, dosage_form, pack_size,
  uses, directions, side_effects, storage_instructions, expiry_info
)
where current.name = seed.name;

-- To make yourself admin: sign up a user in Authentication, then run:
-- insert into admins (user_id) values ('<that user id>');
