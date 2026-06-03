# Hyper Island Team Dev Environment

Welcome. This repo is our shared playground for building things together with Claude Code. The setup is designed so you can be writing and deploying code within 30 minutes, regardless of your background. No local installs, no "works on my machine" problems. Everything runs in the browser.

## What you need before starting

1. A **GitHub account**. Sign up at github.com if you don't have one. Use your real name so teammates can recognise you.
2. A **Claude Pro subscription** ($20/month). Sign up at claude.ai. The free tier doesn't include Claude Code.
3. A modern browser. Chrome, Edge, or Arc work best with Codespaces.

That's it. No terminal knowledge required.

## Step 1: Get access to the repo

Send your GitHub username to Pelle. You'll be added as a collaborator and receive an email invitation. Accept it.

## Step 2: Open the repo in Codespaces

1. Go to the repo on GitHub
2. Click the green **Code** button
3. Choose the **Codespaces** tab
4. Click **Create codespace on main**

Wait about 60 seconds. A browser-based VS Code will open, with the repo already loaded and ready to go. This is your dev environment. It's a real Linux computer running in the cloud, identical to everyone else's.

## Step 3: Install Claude Code in your Codespace

Open the terminal in Codespaces (View menu → Terminal, or Ctrl+`). Paste this command and press Enter:

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

When it finishes, close and reopen the terminal so it picks up the new command. Then run:

```bash
claude --version
```

You should see a version number. If you do, you're set.

## Step 4: Log in to Claude Code

In the terminal, run:

```bash
claude
```

It will give you a URL to open in your browser. Log in with your Claude Pro account, copy the code back into the terminal, and you're in.

## Step 5: Make your first contribution

1. Create your own folder under `/projects/yourname/`
2. Tell Claude what you want to build. For example: "Create a simple webpage in my projects/pelle/ folder that introduces me to the team"
3. Claude will write the code and ask permission before saving files. Say yes.
4. In the terminal, commit and push your work:

```bash
git checkout -b pelle/intro-page
git add .
git commit -m "Add intro page"
git push -u origin pelle/intro-page
```

If you're not sure what those commands mean, ask Claude. It will explain and walk you through it.

## Step 6: See your work live

Within a minute of pushing, Vercel will deploy your branch automatically and post a preview URL as a comment on the pull request. Open it. That's your work, live on the internet. Share the link with the team.

## Workflow conventions

- **Branches**: name them `yourname/short-description`. Example: `andreas/customer-feedback-tool`.
- **Folders**: keep your individual experiments under `/projects/yourname/`. Shared work goes under `/shared/`.
- **Commits**: short imperative messages. "Add login form", not "added login form" or "I added a login form today".
- **Pull requests**: open one when you want feedback or want to merge to main. Tag a teammate to review.
- **Asking for help**: if you're stuck, ask Claude first. If Claude is also stuck, post in the team channel with the error message and what you were trying to do.

## What if something breaks?

- **Codespace won't start**: refresh the browser. If still broken, delete the codespace and create a new one. Your code is safe in git.
- **Claude Code says "command not found" after install**: close and reopen the terminal.
- **Git push is rejected**: someone else pushed to the same branch. Run `git pull --rebase` and try again. Ask Claude if confused.
- **Vercel deployment failed**: check the Vercel comment on your PR for the error. Paste it into Claude and ask for help.

## A note on what we're optimising for

This setup prioritises **speed of learning** over best practices. We're not building production infrastructure. We're building a place where everyone can ship something within their first session and feel the loop of idea → code → deployed URL. Once people are comfortable, we'll add complexity (proper code review, testing, environments). Not before.

## Useful links

- Repo conventions and project context: [CLAUDE.md](./CLAUDE.md)
- Claude Code docs: https://docs.claude.com/en/docs/claude-code/overview
- Codespaces docs: https://docs.github.com/en/codespaces
- Vercel docs: https://vercel.com/docs

Questions? Ask in the team channel or DM Pelle.

