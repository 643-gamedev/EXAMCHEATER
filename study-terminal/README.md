# study-terminal

A tiny, free, open-source exam-study webapp with a green CRT-terminal look.
Chat with an AI tutor, generate quizzes, and generate flashcards — powered
entirely by a local, open-source AI model (no API keys, no per-token cost).

Built to be **portable**: clone it, run one script, and it works — in a
GitHub Codespace, on a laptop, or later completely offline.

## Stack (all free / open source)

| Piece      | Choice                                  |
|------------|------------------------------------------|
| Server     | Node.js + Express                         |
| AI model   | [Ollama](https://ollama.com) running a small open model (default: `phi3:mini`, ~2GB) |
| Accounts   | An `.xlsx` file (`data/users.xlsx`) via the `xlsx` library — zero setup |
| Frontend   | Plain HTML/CSS/JS, no build step, no framework |

Nothing here needs a paid API key. Once the model is pulled once, the AI
tutor runs 100% locally and works **without internet**.

## Quickstart (GitHub Codespaces or any machine)

```bash
git clone <your-fork-url> study-terminal
cd study-terminal
./install.sh
```

The script will:
1. Create `.env` from `.env.example`
2. `npm install`
3. Install Ollama if it's missing (asks first)
4. Pull the default model (`phi3:mini`) — this is the only step that needs internet

Then, each time you want to use it:

```bash
ollama serve        # terminal 1 — the local AI runtime
npm start            # terminal 2 — the web app
```

Open `http://localhost:3000`. In Codespaces, use the forwarded-port popup.

## Running fully offline

Once `ollama pull phi3:mini` has completed once, both `ollama serve` and
`npm start` work with **no internet connection at all** — the model lives
on disk. This makes the whole project usable on a plane, in an exam hall's
prep room with no wifi, etc.

To carry it to another machine offline: copy the whole `study-terminal`
folder plus your Ollama model cache (`~/.ollama`), or just re-run
`install.sh` there when you do have a connection once.

## LAN chat & file sharing

The **[4] lan chat** tab is a shared room for anyone who opens this same
server's address — on a real LAN, or over a Codespaces forwarded URL, it
works either way. No WebSockets or WebRTC: the browser just polls a plain
HTTP endpoint every ~2 seconds, which is all a local network needs.

- Text messages, images (shown inline), and any other file (shown as a
  download link) up to 20MB
- Nothing touches the cloud — messages and uploaded files live only in
  this server's memory/`data/lan-uploads` folder, and reset when the
  server restarts
- To use it with others nearby: find this machine's LAN IP
  (`ipconfig`/`ifconfig`), share `http://<that-ip>:3000`, everyone
  logs in (or uses guest mode) and opens the LAN chat tab

Good for splitting up review material or coordinating a study session —
not for passing answers during an actual test, which is cheating.

## Study guide generator

The **[5] study guide** tab turns a topic and/or pasted notes into a
structured guide (headings, key terms, likely exam questions). It defaults
to the local, free Ollama model, or you can bring your own API key for:

- **Anthropic (Claude)** — your key, sent straight to `api.anthropic.com`
- **OpenAI (ChatGPT)** — your key, sent straight to `api.openai.com`
- **OpenRouter** — your key, works with dozens of hosted models

Keys are only ever kept in your browser's `localStorage` and passed
through to the official provider for that one request — this server
never stores them.

## Swapping in a different model

Any [Ollama model](https://ollama.com/library) works. Smaller/faster:

```bash
ollama pull qwen2.5:0.5b     # extremely light, runs on almost anything
```

Then set `OLLAMA_MODEL=qwen2.5:0.5b` in `.env` and restart `npm start`.

## Guest mode

Click **[ continue as guest ]** on the login screen to skip accounts
entirely. A guest session:
- Isn't written to `data/users.xlsx` at all
- Keeps its token in `sessionStorage`, not `localStorage`
- Loses everything — login, chat, quiz, flashcards — the instant the
  tab or window is closed (or the browser clears it on `pagehide`)

Nothing about chats is ever stored server-side for *any* account type —
guest or not — so this is really just about whether the login itself
persists across a closed tab.

## Accounts today, Supabase/Firebase tomorrow

Right now, `server.js` stores users in `data/users.xlsx` (username +
bcrypt-hashed password). Every route only talks to three functions —
`loadUsers()`, `saveUsers()`, `findUser()` — so swapping the backing
store later (Supabase, Firebase, Postgres, whatever) means rewriting
just those three functions, not the routes or the frontend.

## Project layout

```
study-terminal/
  server.js          # Express app: auth + AI routes
  public/
    index.html        # terminal UI shell
    style.css          # green CRT styling
    app.js              # frontend logic (auth, chat, quiz, flashcards)
  data/users.xlsx     # created automatically on first run
  install.sh           # one-command setup, works anywhere
  .env.example
```

## Features

- **Login / register** — Excel-backed for now, JWT sessions
- **Chat tab** — free-form Q&A with an AI study tutor
- **Quiz tab** — generates a multiple-choice quiz on any topic, grades you live
- **Flashcards tab** — generates flip-cards on any topic

## License

MIT — do whatever you want with it.
