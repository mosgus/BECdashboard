# Blue Eagle — Complete Setup Guide (No Experience Required)

This guide assumes you have never used a command line, never installed a programming tool, and have no idea what any of this is. Every single step is spelled out. If you follow the steps in order, it will work.

**Time needed:** About 60–90 minutes the first time. Most of it is waiting. You don't have to stay at the computer during the download stages — the screen just shows progress bars.

**What you'll have at the end:** A website running on your own computer. You open it in your normal web browser at an address called `http://localhost:3000`.

**Important reading habits for this guide:**
- Lines in grey boxes like this — `example command` — are commands you copy and paste into a "terminal" window (don't worry, we'll open one in Step 1).
- "Enter" always means pressing the Enter/Return key on your keyboard.
- When you paste into a terminal and nothing visible happens for a while, **that's normal**. Wait. A blinking cursor with no text is the program working.

---

# Choose your operating system

Look at your computer:

- **MacBook / iMac / Mac mini** → follow **Part A** (macOS).
- **Any Windows laptop or desktop** → follow **Part B** (Windows).

Skip the part that doesn't apply to you.

---

# Part A · macOS

## A1. Open the Terminal app

1. Look at the top-right corner of your screen for a small magnifying-glass icon. Click it. (Or press the `⌘` key and the spacebar at the same time.)
2. A search box opens. Type the word `terminal` and press Enter.
3. A window opens with a white or black background and small text. This is **Terminal**. You will use this window a lot.
4. **Leave this window open the whole time.** If you close it by accident, just reopen it the same way.

When this guide says "type this command", it means:
- Click once inside the Terminal window so it's active.
- Highlight the command in this document with your mouse.
- Press `⌘ + C` to copy it.
- Go back to Terminal, click inside it, press `⌘ + V` to paste.
- Press Enter.

## A2. Install Homebrew (the tool that installs everything else)

**Why:** Homebrew is a helper program that makes installing everything else much easier. Without it, each piece of software would need its own installer.

**What to do:**

1. Copy the entire command below (all one line, even if it wraps on your screen):

   ```bash
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   ```

2. Paste it into Terminal. Press Enter.

3. It will say `Password:`. This is your **Mac login password** — the password you type when your Mac wakes up. Type it carefully. **You will not see the characters as you type** — not even dots. That is a security feature, not a bug. Press Enter when done.

4. It will print a message about what it's about to do and ask you to press Enter to continue, or Escape to cancel. Press Enter.

5. Wait 5 to 10 minutes. The screen will scroll with lots of text. This is normal.

6. When it finishes, look at the last 5–10 lines of output. It will print a short section called **"Next steps"** containing 2 or 3 commands, each starting with `echo` or `eval`. They look roughly like:
   ```
   echo >> /Users/yourname/.zprofile
   echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> /Users/yourname/.zprofile
   eval "$(/opt/homebrew/bin/brew shellenv)"
   ```
   **You must run each of those 3 commands one at a time, pressing Enter after each.** Copy each line, paste it into Terminal, press Enter. Then the next one.

7. Verify Homebrew works by typing this and pressing Enter:
   ```bash
   brew --version
   ```
   You should see a line like `Homebrew 4.3.12`. If you see "command not found" instead, close Terminal completely (`⌘ + Q`), open it again, and try `brew --version` once more.

## A3. Install the five tools the app needs

**Why:** The app is built from Python (the brain), Node.js (the web page), PostgreSQL (the database that remembers things), and Git (the tool that downloads the project).

**What to do:**

1. Copy and paste this command. Press Enter.
   ```bash
   brew install git python@3.12 node@20 postgresql@16
   ```

2. Wait 5 to 10 minutes. Lots of green text will scroll.

3. When it's done, verify each tool installed correctly. Type each of these and press Enter after each one:
   ```bash
   git --version
   ```
   ```bash
   python3.12 --version
   ```
   ```bash
   node --version
   ```
   ```bash
   psql --version
   ```
   Each should print a version number (e.g. `git version 2.46.0`, `Python 3.12.5`, `v20.17.0`, `psql (PostgreSQL) 16.4`). If any says "command not found", run `brew install <name>` again for the missing one.

## A4. Start the database

**Why:** PostgreSQL is a service that runs in the background. This command turns it on and tells Mac to auto-start it every time you reboot.

1. Type and press Enter:
   ```bash
   brew services start postgresql@16
   ```
2. You should see `Successfully started postgresql@16`.

3. Verify by typing:
   ```bash
   pg_isready
   ```
   You should see `/tmp:5432 - accepting connections`.

**Now skip to [Part C · Download and set up the project](#part-c--download-and-set-up-the-project).**

---

# Part B · Windows

Windows cannot run this project directly — some of the tools are built for Linux and Mac only. The standard fix is to install **WSL2** (Windows Subsystem for Linux), a free Microsoft feature. It runs a small Linux computer inside your Windows PC. Once it's installed, the rest of this guide is identical to the Mac version.

## B1. Install WSL2

1. Click the **Start button** (the Windows icon in the bottom-left corner of your screen).
2. Type the word `PowerShell`. A result called **Windows PowerShell** appears.
3. **Right-click** on Windows PowerShell. A menu pops up. Click **"Run as administrator"**.
4. Windows asks "Do you want to allow this app to make changes to your device?" Click **Yes**.
5. A blue window opens. This is PowerShell running as administrator. It should say `PS C:\Windows\system32>` at the top.
6. Click once inside the blue window, then copy this command and paste it (right-click in PowerShell = paste):
   ```powershell
   wsl --install
   ```
7. Press Enter. Wait 5–10 minutes. It will download and install Ubuntu (a type of Linux).
8. When it says "The requested operation is successful. Changes will not be effective until the system is rebooted", **restart your computer** (Start → Power → Restart).
9. After restart, a black window titled **"Ubuntu"** opens on its own (may take a minute). It says:
   ```
   Installing, this may take a few minutes...
   Please create a default UNIX user account.
   Enter new UNIX username:
   ```
10. Type a username — all lowercase, no spaces. Something like `student` or your first name. Press Enter.
11. It asks `New password:`. Type a password (you won't see it as you type — normal). Press Enter.
12. It asks `Retype new password:`. Type the same password again. Press Enter.
13. You now see a prompt like `yourname@YOUR-PC:~$`. This is the Ubuntu terminal. **From now on, every command in this guide is typed here, not in PowerShell.**

**How to reopen Ubuntu later:** Click Start, type `Ubuntu`, click the orange Ubuntu icon.

**How to copy/paste in Ubuntu:**
- To **copy** from this document: highlight text with your mouse, press `Ctrl + C`.
- To **paste** into Ubuntu: click once inside the Ubuntu window, then press `Ctrl + Shift + V` (the Shift is important — plain Ctrl+V doesn't work in terminals).

## B2. Install the five tools the app needs

1. In the Ubuntu window, paste this command. Press Enter.
   ```bash
   sudo apt update && sudo apt upgrade -y
   ```
2. It asks for your **Ubuntu password** (the one you chose in step B1.11, not your Windows password). Type it (invisible as you type). Press Enter.
3. Wait 3–5 minutes. Lots of text scrolls.
4. Once it's done, paste this next command and press Enter:
   ```bash
   sudo apt install -y git python3.12 python3.12-venv python3-pip nodejs npm postgresql postgresql-contrib curl
   ```
5. If it asks for your password again, type it and press Enter. Wait 5–10 minutes.
6. Verify each tool is installed. Run these one at a time:
   ```bash
   git --version
   ```
   ```bash
   python3.12 --version
   ```
   ```bash
   node --version
   ```
   ```bash
   psql --version
   ```
   Each must print a version number. If `python3.12` says "command not found", run this, then try step 4 again:
   ```bash
   sudo add-apt-repository -y ppa:deadsnakes/ppa
   sudo apt update
   ```

## B3. Start the database

**Important:** WSL does not auto-start services. You must run this command every time you reboot Windows.

1. Paste and press Enter:
   ```bash
   sudo service postgresql start
   ```
2. You should see ` * Starting PostgreSQL 16 database server ... OK`.

3. Verify:
   ```bash
   pg_isready -h localhost -p 5432
   ```
   You should see `localhost:5432 - accepting connections`.

**Continue to Part C below.**

---

# Part C · Download and set up the project

Now the tools are installed. Next we download the actual app and get it running.

## C1. Download the project code

**On Mac:** use the Terminal window you already have open.
**On Windows:** use the Ubuntu window you already have open.

1. Type and press Enter:
   ```bash
   mkdir -p ~/projects
   ```
   (Nothing prints — that's correct. It created a folder.)

2. Type and press Enter:
   ```bash
   cd ~/projects
   ```
   (This moves you into the folder. Still no visible change.)

3. Type and press Enter:
   ```bash
   git clone https://github.com/ngrom17/blue-eagle.git
   ```
   Wait 30–60 seconds. You should see lines like "Cloning into 'blue-eagle'..." followed by progress counters.

4. Move into the newly-downloaded folder:
   ```bash
   cd blue-eagle
   ```

5. Verify you're in the right place:
   ```bash
   ls
   ```
   You should see a list with `backend`, `frontend`, `README.md`, and others.

## C2. Create the database

The app needs its own database named `blueeagle`, owned by a user named `blueeagle` with password `blueeagle`. (Three times the same word — that's not a mistake.)

### On Mac

Paste each of these, one at a time. Press Enter after each.

```bash
createdb blueeagle
```
```bash
psql blueeagle -c "CREATE USER blueeagle WITH PASSWORD 'blueeagle' SUPERUSER;"
```

You should see `CREATE ROLE` printed after the second command.

### On Windows (Ubuntu)

Paste each of these, one at a time. Press Enter after each. Your Ubuntu password may be requested for the first one.

```bash
sudo -u postgres createuser --superuser blueeagle
```
```bash
sudo -u postgres psql -c "ALTER USER blueeagle WITH PASSWORD 'blueeagle';"
```
```bash
sudo -u postgres createdb -O blueeagle blueeagle
```

### Verify the database works (both Mac and Windows)

```bash
psql -U blueeagle -d blueeagle -h localhost -c "SELECT 1;"
```

It will prompt `Password for user blueeagle:`. Type `blueeagle` and press Enter. You should see a table with the number `1`. If you see that, the database works.

## C3. Create the settings files

The app reads settings from three small text files. Create all three with these commands:

```bash
cp .env.example .env
```
```bash
cp .env.example backend/.env
```
```bash
cat > frontend/.env.local <<'EOF'
NEXT_PUBLIC_API_URL=http://localhost:8000
EOF
```

The defaults already match the database you just created, so you don't need to edit anything.

## C4. Install backend dependencies

This step downloads all the Python packages the backend needs (about 500 MB). Only done once.

```bash
cd ~/projects/blue-eagle/backend
```
```bash
python3.12 -m venv .venv
```
(This creates a folder called `.venv` — nothing visible prints. That's fine.)
```bash
source .venv/bin/activate
```
After this command, your prompt changes to start with `(.venv)`. This means you're now "inside" the isolated Python environment.

```bash
pip install -r requirements.txt
```
Wait 5–10 minutes. Lots of "Collecting..." and "Downloading..." lines will scroll. When it's done, you'll see something like `Successfully installed fastapi-0.115.0 ...`.

```bash
alembic upgrade head
```
This creates all the database tables. You should see lines ending with `Running upgrade ... -> 0013, demo seed`.

**Leave this Terminal/Ubuntu window open. This is "Terminal 1" — you'll use it in Part D to start the backend.**

## C5. Install frontend dependencies

This step downloads all the Node.js packages the web page needs (about 400 MB). Only done once.

1. **Open a second Terminal window** so you don't lose the first one.
   - **Mac:** in the menu bar at the top, click **Shell → New Window** (or press `⌘ + N`).
   - **Windows:** click the Start button, type `Ubuntu`, click the orange Ubuntu icon again. This gives you a second Ubuntu window.

2. In the new window, paste:
   ```bash
   cd ~/projects/blue-eagle/frontend
   ```
3. Then:
   ```bash
   npm install
   ```
   Wait 3–5 minutes. You may see yellow "warning" lines — those are normal, ignore them. Only red "error" lines matter. When it's done, you'll see a summary like `added 580 packages in 2m`.

**Leave this window open. This is "Terminal 2".**

---

# Part D · Start the app (do this every time you want to use it)

You need the database running, the backend running, and the frontend running — all at the same time. That means **2 or 3 terminal windows open**.

## D1. Start the database (Windows only; Mac does this automatically)

**Windows users:** if you just rebooted Windows, open a new Ubuntu window (Start → Ubuntu), paste this, and press Enter:
```bash
sudo service postgresql start
```

**Mac users:** skip this step — Homebrew keeps the database running in the background.

## D2. Start the backend (Terminal 1)

Go to Terminal 1 (the one where you installed backend dependencies; your prompt should still start with `(.venv)`). If you've closed it, open a new window and run:
```bash
cd ~/projects/blue-eagle/backend
```
```bash
source .venv/bin/activate
```

Then:
```bash
uvicorn main:app --reload --port 8000
```

Wait about 10 seconds. You should see:
```
INFO:     Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)
INFO:     Started reloader process [...]
INFO:     Started server process [...]
INFO:     Application startup complete.
```

**Do not close this window.** Leave it as-is.

## D3. Start the frontend (Terminal 2)

Go to Terminal 2 (the one where you ran `npm install`). If you've closed it, open a new window and run:
```bash
cd ~/projects/blue-eagle/frontend
```

Then:
```bash
npm run dev
```

Wait about 15 seconds. You should see:
```
▲ Next.js 16.x.x
- Local:        http://localhost:3000
- Network:      http://0.0.0.0:3000

✓ Ready in 4.2s
```

**Do not close this window either.**

## D4. Open the app in your browser

1. Open your normal web browser (Chrome, Safari, Edge, Firefox — any of them).
2. Click the address bar at the top.
3. Type this exactly and press Enter:
   ```
   http://localhost:3000
   ```
4. The Blue Eagle login page should load. Enter your name and click **Continue** to get in.

---

# Part E · Stopping the app

When you're done using the app:

1. Click on **Terminal 1** (the backend window). Press `Ctrl + C`. The text stops scrolling and you get your prompt back.
2. Click on **Terminal 2** (the frontend window). Press `Ctrl + C`. Same thing.
3. You can close the terminal windows now.
4. The database can stay running — it does no harm. Or, if you want to turn it off:
   - **Mac:** `brew services stop postgresql@16`
   - **Windows:** `sudo service postgresql stop`

---

> ⚠️ **Only running this on your own computer? You're fine.** The defaults in this guide are for **local use only** (the app answers on `localhost`, so only you can reach it). If you ever put this on a public URL — a Render/Vercel deployment, a cloud VM, an office server — you must set `CLASS_WRITE_KEY` (backend) and `NEXT_PUBLIC_CLASS_WRITE_KEY` (frontend) to a strong random string first. Without it, anyone who finds the URL can modify or delete any portfolio. See the **Security model** section in the project's `README.md` for details.

---

# Part F · Running the app tomorrow (and every day after)

Once everything above is done, you don't need to repeat any of it. Every day from now on it's just these steps:

### Mac — every day

1. Open Terminal (⌘ + space, type `terminal`, Enter).
2. Paste and press Enter after each:
   ```bash
   cd ~/projects/blue-eagle/backend
   source .venv/bin/activate
   uvicorn main:app --reload --port 8000
   ```
3. Open a second Terminal window (`⌘ + N`). Paste and press Enter after each:
   ```bash
   cd ~/projects/blue-eagle/frontend
   npm run dev
   ```
4. Open browser → `http://localhost:3000`.

### Windows — every day

1. Open Ubuntu (Start → Ubuntu).
2. Paste and press Enter:
   ```bash
   sudo service postgresql start
   ```
3. In the same window, paste and press Enter after each:
   ```bash
   cd ~/projects/blue-eagle/backend
   source .venv/bin/activate
   uvicorn main:app --reload --port 8000
   ```
4. Open a second Ubuntu window (Start → Ubuntu again). Paste and press Enter after each:
   ```bash
   cd ~/projects/blue-eagle/frontend
   npm run dev
   ```
5. Open browser → `http://localhost:3000`.

---

# Troubleshooting

**"command not found: brew" (Mac)**
Homebrew didn't finish its setup. Scroll up in Terminal to find the "Next steps" section printed after the install and run each command it lists. Then close and reopen Terminal.

**"command not found: python3.12" or "node"**
The install in A3 or B2 didn't finish. Run it again.

**"could not connect to server: Connection refused" when the backend starts**
The database isn't running.
- **Mac:** run `brew services start postgresql@16`.
- **Windows:** run `sudo service postgresql start`.

**"port 8000 is already in use"**
Something is already using port 8000 — probably a backend from earlier that you forgot to close. Easiest fix: restart your computer. That closes everything.

**"port 3000 is already in use"**
Same as above, but for the frontend. Restart your computer.

**The browser opens but pages are blank or say "Failed to fetch"**
Something is wrong with the connection between frontend and backend.
1. Look at Terminal 1 (backend) — any red errors? If it crashed, press `Ctrl + C` and start it again with the `uvicorn` command.
2. Check that the file `~/projects/blue-eagle/frontend/.env.local` contains exactly this line:
   ```
   NEXT_PUBLIC_API_URL=http://localhost:8000
   ```
   If it's wrong, fix it, then stop (`Ctrl + C`) and restart the frontend (`npm run dev`).

**Windows: "wsl: command not found"**
Your Windows is too old. Go to Settings → Windows Update and install all pending updates, then reboot and try again.

**"permission denied" errors in Ubuntu**
You skipped a `sudo` prefix somewhere. Look carefully at the command in this guide and re-type it exactly as shown.

**I closed a terminal by accident**
Just open a new one and re-run the "every day" commands from Part F.

**Nothing works and I don't know why**
Restart your computer and follow Part F from the top. This fixes 80% of "nothing works" problems.

---

# Glossary

- **Terminal** — the window with the cursor and black/white background where you type commands. On Windows (inside WSL) this is called Ubuntu.
- **Command** — one line of text you paste and press Enter on.
- **Backend** — the "brain" of the app. Runs on your computer on port 8000.
- **Frontend** — the visible web page. Runs on your computer on port 3000.
- **Database** — the storage for portfolios, holdings, etc. Runs on your computer on port 5432.
- **WSL (Windows Subsystem for Linux)** — a Microsoft-provided Linux environment that runs inside Windows. Used because some developer tools only work on Linux/Mac.
- **Homebrew** — the installer for Mac that adds missing developer tools.
- **`~/projects/blue-eagle`** — the folder on your computer where the app lives. The `~` means "my home folder."
- **`Ctrl + C`** — universal keyboard shortcut to stop a running command in the terminal.
