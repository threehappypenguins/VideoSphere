# Docker Desktop and Appwrite Setup

This guide gets you from zero to running **Docker Desktop** and **Appwrite** in a local Docker container so VideoSphere can use it for auth and the database.

**Terminal instructions** in this doc are given for **Linux**, **macOS**, and **Windows** (PowerShell and CMD) so any developer can follow along.

---

## 1. Install Docker Desktop

1. **Download**
   - [Docker Desktop](https://docs.docker.com/desktop/install/) (pick your distro)
   - Or from [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop)

2. **Install** using the instructions for your OS. On Linux you typically:
   - Install the `.deb` or `.rpm` package, or use the convenience script.
   - Add your user to the `docker` group so you can run Docker without `sudo`:  
     `sudo usermod -aG docker $USER`  
     Then log out and back in (or reboot).

3. **Start Docker Desktop** and wait until it shows “Docker Desktop is running”.

4. **Check** in a terminal (same on all platforms):
   ```bash
   docker --version
   docker compose version
   ```
   You should see Docker and Docker Compose (v2) versions.

---

## 2. Run Appwrite in a Local Docker Container

Appwrite provides an **installer** that creates a folder with config and starts the stack. You run it once; it asks a few questions and creates an `appwrite` directory in your project.

### One-time setup

1. **Open a terminal** in the project root (where `package.json` and `Dockerfile` are).

2. **Run the Appwrite installer:**
   - **Linux / macOS (bash):**
     ```bash
     docker run -it --rm \
       --volume /var/run/docker.sock:/var/run/docker.sock \
       --volume "$(pwd)"/appwrite:/usr/src/code/appwrite:rw \
       --entrypoint="install" \
       appwrite/appwrite:1.8.1
     ```
   - **Windows (PowerShell):**
     ```powershell
     docker run -it --rm `
       --volume /var/run/docker.sock:/var/run/docker.sock `
       --volume ${pwd}/appwrite:/usr/src/code/appwrite:rw `
       --entrypoint="install" `
       appwrite/appwrite:1.8.1
     ```
   - **Windows (CMD):**
     ```cmd
     docker run -it --rm ^
       --volume /var/run/docker.sock:/var/run/docker.sock ^
       --volume "%cd%/appwrite":/usr/src/code/appwrite:rw ^
       --entrypoint="install" ^
       appwrite/appwrite:1.8.1
     ```

3. **Answer the prompts:**
   - **DNS A record hostname** — for local dev you can use `localhost`.
   - **Main hostname** — e.g. `localhost` (or the hostname you’ll use in the browser).
   - **Secret key** — use a long random string (or generate one); this encrypts sensitive data.
      - **Linux / macOS:** run `openssl rand -base64 32` in the terminal.
      - **Windows (PowerShell):** run:
        ```powershell
        $b = New-Object byte[] 32; $rng=[System.Security.Cryptography.RandomNumberGenerator]::Create(); $rng.GetBytes($b); $rng.Dispose(); [Convert]::ToBase64String($b)
        ```
      - **Windows (CMD):** use an [online base64 generator](https://www.random.org/strings/) or type a long random string; the installer will accept it.
      - The key is saved in `appwrite/.env` as `_APP_OPENSSL_KEY_V1`. Keep a backup somewhere secure (e.g. password manager) in case you lose the `appwrite/` folder.

   - **HTTP port** — e.g. `80` (or `8080` if 80 is in use).
   - **HTTPS port** — e.g. `443` (or `8443` if 443 is in use).
   - Accept the rest as defaults.

   The installer creates an `appwrite` folder with `docker-compose.yml` and `.env`. The folder is in `.gitignore` so secrets and local config are not committed.

4. **Start Appwrite:**
   - **Linux / macOS:**
     ```bash
     cd appwrite
     docker compose up -d --remove-orphans
     cd ..
     ```
   - **Windows (PowerShell):**
     ```powershell
     cd appwrite
     docker compose up -d --remove-orphans
     cd ..
     ```
   - **Windows (CMD):**
     ```cmd
     cd appwrite
     docker compose up -d --remove-orphans
     cd ..
     ```
   The first start can take a few minutes. When it’s ready, you can open the Console in your browser (see below).

### Your Appwrite URL

- If you chose **port 80**: `http://localhost/v1` (API) and `http://localhost` (Console).
- If you chose **port 8080**: `http://localhost:8080/v1` and `http://localhost:8080`.

Use the **API endpoint** in `.env.local` as `NEXT_PUBLIC_APPWRITE_ENDPOINT` (e.g. `http://localhost/v1` or `http://localhost:8080/v1`).

**If you open the API URL in a browser** (e.g. `http://localhost/v1`), you’ll see a JSON 404 like `"Route not found"` with `version: "1.8.1"`. That’s **normal** — there is no page at `/v1`; it’s the base URL for the API. The app and SDK call specific routes under `/v1` (e.g. `/v1/health`, `/v1/databases`). Use **http://localhost** (or port 8080) for the Console UI; use the `/v1` URL only in `.env.local` and in code. To confirm the app can talk to Appwrite, use the [connection test](http://localhost:3000/api/dev/test-appwrite) (section 5).

### Daily use

From the project root:

- **Start Appwrite**
  - Linux / macOS: `cd appwrite && docker compose up -d && cd ..`
  - Windows PowerShell: `cd appwrite; docker compose up -d; cd ..`
  - Windows CMD: `cd appwrite & docker compose up -d & cd ..`
- **Stop Appwrite**
  - Linux / macOS: `cd appwrite && docker compose stop && cd ..`
  - Windows PowerShell: `cd appwrite; docker compose stop; cd ..`
  - Windows CMD: `cd appwrite & docker compose stop & cd ..`
- **View logs**
  - Linux / macOS: `cd appwrite && docker compose logs -f` (Ctrl+C to exit)
  - Windows PowerShell: `cd appwrite; docker compose logs -f`
  - Windows CMD: `cd appwrite & docker compose logs -f`

---

## 3. Appwrite Console — create account, project, and API key (step-by-step)

You only need to create an account, a project, and an API key in the Console. **You do not create the database or tables manually** — a setup script does that for you (section 3d). Follow these steps exactly.

### 3a. Create your account

1. Open your browser and go to **http://localhost** (or **http://localhost:8080** if you used port 8080 when installing Appwrite).
2. You should see the Appwrite **login / welcome** screen.
3. Click **Create account** (or **Sign up**).
4. Enter **Email** (e.g. `you@example.com`) and **Password**; confirm password if asked.
5. Click **Create account** (or **Sign up**). You are now logged in and will see the Console home.

### 3b. Create a project and get the Project ID

1. On the left sidebar, click **Create project** (or the **+** next to "Projects"), or click **Start from scratch** / **Create your first project** on the home screen.
2. In **Name**, type: `VideoSphere` (or any name you like).
3. Click **Create** (or **Create project**).
4. The project opens. To get the **Project ID** (long string like `65a1b2c3d4e5f6789...`):
   - In the left sidebar, click **Overview** (or the project name at the top, or the **gear/settings** icon).
   - On the **Overview** or **Settings** page, find **Project ID**.
   - Click **Copy** next to it (or select the ID and copy). Save it — you'll paste it into `.env.local` in section 4.

### 3c. Create an API key

1. Stay in the same project. In the left sidebar, open **Overview** (or **Settings**).
2. Find **API Keys** (under **Integration**). Click the **API Keys** tab.
3. Click **Create API key**.
4. **Name:** type `VideoSphere dev` (or any name).
5. **Expiration:** leave "No expiration" for local dev.
6. **Scopes:** enable **Database** (check the Database category — that enables its scopes for your tables). For auth and user management, also enable **Auth** (check the Auth category). You do not need Functions, Storage, Messaging, or Sites for VideoSphere.
7. Click **Create**.
8. **Important:** Copy the **API secret** — on the key details page, next to the key name (e.g. "VideoSphere dev") there is a button labeled **API secret**. Click it to copy the secret. Paste that value into `.env.local` as `APPWRITE_API_KEY`.

You're done in the Console. Put **Project ID** and **API key** into `.env.local` (section 4), then run the setup script (section 3d) to create the database and tables.

### 3d. Create the database and tables (run the setup script)

VideoSphere uses a **setup script** that creates the database and tables for you (similar in spirit to running a migration). You do **not** need to create the database or tables by hand in the Console.

1. Make sure `.env.local` is configured (section 4) and the connection test (section 5) returns `ok: true`.
2. From the **project root** in a terminal, run: `pnpm run setup:appwrite` (same on Linux, macOS, and Windows).
3. The script creates a database and the tables the app needs (e.g. drafts, upload jobs). If you see "Setup complete" or no errors, you're done. If the script says the database or tables already exist, that's fine — it's safe to run more than once.

If you prefer to create the database and tables manually in the Console instead of using the script, see **Appendix A** at the end of this doc.

---

## 4. Configure `.env.local` (step-by-step)

Do this once so the Next.js app can talk to Appwrite.

1. **Create `.env.local`** from the example (in the project root):
   - **Linux / macOS:** `cp .env.example .env.local`
   - **Windows (PowerShell):** `Copy-Item .env.example .env.local`
   - **Windows (CMD):** `copy .env.example .env.local`

2. **Open `.env.local`** in your editor.

3. **Appwrite section** — set these three; the rest can stay as placeholders for now:
   - **`NEXT_PUBLIC_APPWRITE_ENDPOINT`**  
     Your Appwrite API URL. If you used port 80: `http://localhost/v1`. If you used 8080: `http://localhost:8080/v1`. No trailing slash.
   - **`NEXT_PUBLIC_APPWRITE_PROJECT_ID`**  
     From the Appwrite Console: open your project (e.g. VideoSphere) → **Settings** (gear or "Overview") → copy **Project ID** (long string like `65a1b2c3d4e5f6789...`).
   - **`APPWRITE_API_KEY`**  
     From the Console: same project → **Settings** → **API Keys** → **Create API Key**. Give it a name (e.g. "VideoSphere dev"), enable scopes **Database** and **Auth** (check those categories), create it, then click **API secret** on the key details page to copy the secret. Paste into `APPWRITE_API_KEY` in `.env.local`.

4. **Save `.env.local`.** Leave Stripe and OpenRouter as placeholders until you add those features.

---

## 5. Test that the app can connect to Appwrite

1. **Start Appwrite** (if it’s not already running):
   - Linux / macOS: `cd appwrite && docker compose up -d && cd ..`
   - Windows PowerShell: `cd appwrite; docker compose up -d; cd ..`
   - Windows CMD: `cd appwrite & docker compose up -d & cd ..`

2. **Start the Next.js app** (same on all platforms):
   ```bash
   pnpm install
   pnpm dev
   ```

3. **Open the connection test in your browser:**  
   [http://localhost:3000/api/dev/test-appwrite](http://localhost:3000/api/dev/test-appwrite)

4. **Interpret the result:**
   - **`{ "ok": true, "message": "Connected to Appwrite" }`** — Endpoint, project ID, and API key are correct; the app can reach the DB.
   - **Missing env vars** — You’ll see which of the three Appwrite variables are missing. Add them to `.env.local`, save, and restart `pnpm dev` (Ctrl+C, then `pnpm dev` again).
   - **Appwrite request failed** — Check that Appwrite is running (e.g. `cd appwrite && docker compose ps` on Linux/macOS, or `cd appwrite; docker compose ps` on Windows PowerShell), that the endpoint URL matches how you open the Console (e.g. `http://localhost/v1`), and that the API key has at least **Databases** read scope. Then try the test URL again.

After you see `ok: true`, your `.env` is set up and the app is successfully connecting to the database.

---

## 6. Run VideoSphere Against Local Appwrite

- **Development (recommended):** Run the app on your machine and point it at Appwrite in Docker. From the project root run `pnpm dev` (same on Linux, macOS, and Windows). Open [http://localhost:3000](http://localhost:3000). The app will use the Appwrite URL from `.env.local`.

- **Run the app in Docker too:** Use the main `docker-compose.yml` in the project root. The app container must be able to reach Appwrite (e.g. same Docker network or `host.docker.internal`). See comments in `docker-compose.yml` for endpoint options.

---

## 7. Troubleshooting

| Issue | What to try |
|-------|---------------------|
| `Cannot connect to Docker daemon` | Start Docker Desktop; on Linux ensure you’re in the `docker` group and have logged out/in. |
| Appwrite containers exit or won’t start | Run `cd appwrite && docker compose logs` (Linux/macOS) or `cd appwrite; docker compose logs` (Windows) and fix any port or config errors. |
| “Startup takes a few minutes” | Normal on non-Linux hosts; wait and refresh the Console. |
| App can’t reach Appwrite | Confirm `NEXT_PUBLIC_APPWRITE_ENDPOINT` matches how you open the Console (e.g. `http://localhost/v1` or `http://localhost:8080/v1`). |
| Port 80 or 443 in use | Pick different HTTP/HTTPS ports during the Appwrite installer (e.g. 8080 / 8443). |

---

## Summary

- **Docker Desktop** — install and start it; use `docker` and `docker compose` from the terminal.
- **Appwrite** — run the one-time installer, then `cd appwrite && docker compose up -d` to start.
- **Configure .env.local** — copy from `.env.example`, then set the three Appwrite variables (endpoint, project ID, API key) as in section 4.
- **Test connection** — run `pnpm dev` and open [http://localhost:3000/api/dev/test-appwrite](http://localhost:3000/api/dev/test-appwrite). When you see `ok: true`, the app is connected to the DB.
- **VideoSphere** — run `pnpm dev` and use [http://localhost:3000](http://localhost:3000) for the app.

---

## Appendix A: Create database and tables manually in the Console

If you prefer not to use the setup script, you can create the database and tables by hand in the Appwrite Console. Follow these steps exactly.

1. In the Appwrite Console, open your project (e.g. VideoSphere). In the left sidebar, click **Databases** (or **Tables** / **Data**).
2. Click **Create database** (or **Add database**). **Name:** type `VideoSphere`. **Database ID:** type `videosphere` (or leave blank to auto-generate). Click **Create**.
3. Open the new database. Click **Create table** (or **Add table**). Create these three tables one by one:

   **Table 1 — Drafts**
   - **Name:** `Drafts`. **Table ID:** `drafts`. Click **Create**.
   - Go to **Columns**. Click **Create column** for each:
     - **Key:** `userId`, **Type:** String, **Size:** 255, **Required:** Yes.
     - **Key:** `title`, **Type:** String, **Size:** 500, **Required:** Yes.
     - **Key:** `description`, **Type:** String, **Size:** 5000, **Required:** Yes.
     - **Key:** `tags`, **Type:** String, **Size:** 2000, **Required:** Yes. (Store tags as a JSON string, e.g. `["tag1","tag2"]`; the app parses it when reading.)
     - **Key:** `createdAt`, **Type:** Datetime, **Required:** Yes.
     - **Key:** `updatedAt`, **Type:** Datetime, **Required:** Yes.

   **Table 2 — Upload Jobs**
   - **Name:** `Upload Jobs`. **Table ID:** `upload_jobs`. Click **Create**.
   - **Columns:** `userId` (String, 255, required), `draftId` (String, 255, not required), `status` (String, 64, required), `errorMessage` (String, 2000, not required), `createdAt` (Datetime, required), `updatedAt` (Datetime, required).

   **Table 3 — User Profiles**
   - **Name:** `User Profiles`. **Table ID:** `user_profiles`. Click **Create**.
   - **Columns:** `userId` (String, 255, required), `email` (String, 255, required), `isSupporter` (Boolean, required), `role` (String, 32, required), `createdAt` (Datetime, required), `updatedAt` (Datetime, required).

4. When all three tables exist, you can use the app. The setup script (section 3d) creates the same structure so you don’t have to do this manually.
