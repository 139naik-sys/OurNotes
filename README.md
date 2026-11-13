# Our Notes

A shared notes app for two people. Black background, pastel notes, checklists, photos, live sync, installable on your phone, optional push notifications.

It is a static site (GitHub Pages) that talks to a free Supabase project for login, the database, live sync and photo storage.

```
index.html  style.css  app.js  config.js  sw.js  manifest.webmanifest  icons/
supabase/schema.sql              database + storage setup (run once)
supabase/functions/notify/       push notification function (optional)
```

## 1. Create the Supabase project

1. Sign up at supabase.com, then **New project** (free plan is fine). Pick the region closest to you (Mumbai or Singapore).
2. Wait for it to finish setting up.

## 2. Create the database

Dashboard -> **SQL Editor** -> **New query** -> paste everything from `supabase/schema.sql` -> **Run**.

## 3. Create your two accounts

Dashboard -> **Authentication** -> **Users** -> **Add user** -> **Create new user**. Enter email and password, tick **Auto Confirm User**. Do this once for you and once for him.

Then lock the door: **Authentication** -> **Sign In / Providers** (or **Settings**) -> turn **off** "Allow new users to sign up". That way nobody else can ever make an account.

## 4. Connect the app

Dashboard -> **Project Settings** -> **API**. Copy the **Project URL** and the **anon public** key into `config.js`.

The anon key is safe to publish. Your notes are protected by the login and the rules in `schema.sql`, not by hiding that key. Never put the `service_role` key anywhere in this folder.

Quick local test (optional): `python3 -m http.server 8000` in this folder, open http://localhost:8000.

## 5. Put it on GitHub Pages

1. Create a repo and push this folder's contents to it (files at the root of the repo).
2. Repo -> **Settings** -> **Pages** -> **Deploy from a branch** -> `main` / `(root)` -> Save.
3. After a minute it is live at `https://<your-username>.github.io/<repo-name>/`.

Both of you open that link, log in, and pick the name that shows on your notes. On your phone use **Add to Home Screen** (Chrome menu on Android, Share button on iPhone) to get it as an app.

If the repo is public, the code is public but your notes are not.

## 6. Phone notifications (optional)

Without this, new notes still appear instantly while the app is open, and unread notes get a "new" tag. This step adds real push alerts when the app is closed.

You need Node.js and the [Supabase CLI](https://supabase.com/docs/guides/cli) on your computer.

1. **Make push keys** (once):
   ```
   npx web-push generate-vapid-keys
   ```
   Put the **public** key in `config.js` as `VAPID_PUBLIC_KEY`. Keep the private one secret.

2. **Log in and link the project** (the project ref is the part of your project URL before `.supabase.co`):
   ```
   supabase login
   supabase link --project-ref YOUR-PROJECT-REF
   ```

3. **Save the secrets:**
   ```
   supabase secrets set VAPID_PUBLIC_KEY="..." VAPID_PRIVATE_KEY="..." VAPID_SUBJECT="mailto:you@example.com" WEBHOOK_SECRET="make-up-a-long-random-string"
   ```

4. **Deploy the function:**
   ```
   supabase functions deploy notify --no-verify-jwt
   ```

5. **Add the trigger:** Dashboard -> **Database** -> **Webhooks** -> **Create a new hook**
   - Table: `notes`, Events: **Insert** and **Update**
   - Type: **Supabase Edge Functions**, function: `notify`
   - HTTP header: name `x-webhook-secret`, value the same `WEBHOOK_SECRET` string as above

6. Push the updated `config.js` to GitHub. On each phone, tap the bell icon in the app and allow notifications.

**iPhone:** push only works on iOS 16.4 or newer, and only after the app is added to the Home Screen and opened from there. In a normal Safari tab the bell just shows a reminder about this.

Ticking a checklist box or changing a colour does not send a notification; adding or editing text, items or photos does.

## Good to know

- If you both edit the same note at the same moment, the last save wins.
- Photos are resized to about 1600px and stored privately; only logged-in users can see them. Up to 6 per note.
- The notes themselves need internet. The app shell loads offline.
- To rename the app, change the `<title>`, the logo text in `index.html`, and `name` in `manifest.webmanifest`.
