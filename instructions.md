# ClinicChart — Setup & Deployment Guide

ClinicChart is a static, client-only web app (HTML/CSS/vanilla JS ES modules) backed
by Supabase (Postgres + Auth + RLS). There is no server to run — you only need a
Supabase project and any static file host.

Files in this delivery:

| File                | Purpose                                                        |
|---------------------|------------------------------------------------------------------|
| `schema.sql`        | Database tables, indexes, RLS policies                          |
| `supabaseClient.js` | Supabase client init (put your credentials here)                |
| `index.html`        | App shell, modals, CDN script tags                              |
| `styles.css`        | Theme variables, component classes, high-contrast mode          |
| `app.js`            | All application logic (auth, CRUD, labs engine, AI extraction)  |
| `instructions.md`   | This file                                                        |

---

## 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com) → **New project**.
2. Pick a name, database password, and region. Wait for provisioning (~2 min).
3. In **Project Settings → API**, copy:
   - **Project URL**
   - **anon public** key

---

## 2. Run the database schema

1. Open **SQL Editor** in the Supabase dashboard.
2. Paste the entire contents of `schema.sql` and click **Run**.
3. Confirm in **Table Editor** that these tables now exist: `profiles`, `patients`,
   `patient_pmh`, `patient_psh`, `patient_medications`, `encounters`,
   `encounter_orders`, `global_labs`, `doctor_custom_labs`, `lab_results`.
4. `schema.sql` is written to be safely re-runnable (it drops/recreates policies
   and triggers) if you need to apply an update later.

### What the schema sets up automatically

- **RLS on every table.** Doctors can only see/edit rows where `doctor_id = auth.uid()`
  (directly, or via a join to their own patients for PMH/PSH/medications).
- **`global_labs`** is readable by any authenticated doctor but only writable by
  accounts with `profiles.is_admin = true`.
- **A trigger (`handle_new_user`)** automatically inserts a `profiles` row whenever
  someone signs up through Supabase Auth, so you never have to manually link
  `auth.users` to `profiles`.

---

## 3. Inject your credentials

Open `supabaseClient.js` and replace the two placeholders:

```js
const SUPABASE_URL = 'YOUR_SUPABASE_URL_HERE';       // e.g. https://xxxxx.supabase.co
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY_HERE';
```

Never paste your **service role** key here — this file ships to every browser.
Only the anon/public key belongs in client code; RLS is what keeps data private.

---

## 4. Create the first (admin) doctor account

The app's sign-up form creates a normal (non-admin) doctor account by default.
To create your first **admin** account:

1. In the running app, click **Need an account? Sign up**, and register with your
   email/password.
2. In Supabase dashboard → **SQL Editor**, run:
   ```sql
   update public.profiles set is_admin = true where email = 'you@yourclinic.com';
   ```
3. Reload the app and sign in. You should now see an **Admin** item in the sidebar.

> By default, Supabase requires email confirmation before sign-in. For local
> testing you can disable this under **Authentication → Providers → Email →
> "Confirm email"**, or confirm the user manually from **Authentication → Users**.

---

## 5. Creating additional doctor accounts (admin workflow)

The browser app **cannot** create new Supabase Auth users directly — that requires
the service role key, which must never be shipped to a browser. As the admin, add
new doctors one of two ways:

**Option A — Dashboard (simplest):**
Authentication → Users → **Add user** → enter email + a temporary password →
share the credentials with the doctor. Their `profiles` row is created
automatically by the trigger on first login; they'll appear under
**Admin → Doctor Accounts** in the app.

**Option B — Script (for bulk onboarding):**
Run this once with Node.js, using your **service role key** (keep it server-side
only, e.g. in a local `.env` you delete afterward — never commit it):

```js
import { createClient } from '@supabase/supabase-js';

const admin = createClient(
  'YOUR_SUPABASE_URL_HERE',
  'YOUR_SERVICE_ROLE_KEY_HERE' // Project Settings > API > service_role — SECRET
);

const { data, error } = await admin.auth.admin.createUser({
  email: 'newdoctor@yourclinic.com',
  password: 'TemporaryPassw0rd!',
  email_confirm: true,
});
console.log(error || data.user.id);
```

---

## 6. Local testing

No build step is required. From the folder containing all five app files, run
any static server, for example:

```bash
python3 -m http.server 8080
# or
npx serve .
```

Then open `http://localhost:8080`. Opening `index.html` directly via `file://`
will **not** work because ES module imports require an HTTP origin.

---

## 7. Doctor-side setup: Gemini API key (for AI lab extraction)

Each doctor manages their own key — the app never ships a shared key:

1. Get a free key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
2. In the app, go to **Settings → AI Lab Extraction**, paste the key, and save.
3. The key is stored in that doctor's own `profiles.gemini_api_key` row (protected
   by RLS — only that doctor can read it) and is only ever sent from their browser
   directly to Google's `generativelanguage.googleapis.com` endpoint.

---

## 8. Bulk-importing the global lab library (admin)

1. Prepare an `.xlsx` or `.csv` file with **no required header row**, columns:
   - A: Lab Test Name
   - B: Unit
   - C: Lower Reference Limit
   - D: Upper Reference Limit
2. Sign in as admin → **Admin → Global Lab Library → Bulk import** → choose the file.
3. Rows are **upserted by lab name**: re-importing updates existing global labs
   without duplicating rows, and never touches any doctor's `doctor_custom_labs`.

---

## 9. Deployment

### Netlify (drag-and-drop)
1. Go to [app.netlify.com/drop](https://app.netlify.com/drop).
2. Drag the folder containing `index.html`, `styles.css`, `app.js`,
   `supabaseClient.js` (with credentials already filled in) onto the page.
3. Netlify gives you a live URL immediately. Optionally add a custom domain
   under **Site settings → Domain management**.

### GitHub Pages
1. Create a new GitHub repository and push these files to the `main` branch
   (root, or a `/docs` folder).
2. Repository → **Settings → Pages** → set source to `main` (or `main /docs`).
3. Your app will be live at `https://<username>.github.io/<repo>/` within a
   few minutes.

### Post-deploy checklist
- [ ] `supabaseClient.js` has real credentials (not placeholders).
- [ ] In Supabase → **Authentication → URL Configuration**, add your deployed
      URL to **Site URL** and **Redirect URLs** so auth flows work correctly.
- [ ] Sign in as admin and confirm the **Admin** tab is visible.
- [ ] Create a test patient, encounter, and lab result to confirm RLS/writes work.
- [ ] Test the theme switcher (Light / Dark / High-contrast) persists on reload.

---

## 10. Troubleshooting

| Symptom | Likely cause |
|---|---|
| Blank page, console shows CORS/module errors | Opened via `file://` instead of a local server |
| "No profile found" after sign-up | Email confirmation is pending — confirm via dashboard or disable confirmation for testing |
| Admin tab never appears | `profiles.is_admin` wasn't set to `true` for your account — re-run the SQL in step 4 |
| Global lab import silently does nothing | First column of each row must be a non-empty lab name; a literal header cell "Lab Test Name" is auto-skipped |
| AI extraction returns "No lab values found" | The uploaded file may be a scanned image with low text quality, or the Gemini key is invalid/rate-limited — check the browser console for the raw API error |
