# How to Open a Pull Request (with Claude Code)

This is our team's walkthrough for getting your changes from your Codespace into the
`main` branch. We work almost entirely from **Claude Code in the Codespace terminal**,
so most of this happens without ever leaving the editor. The GitHub website only comes
in at the end, for the review conversation and the final merge.

> **What's a pull request (PR)?** It's a request to merge your changes into the shared
> `main` branch. It gives teammates a chance to review the work before it becomes part
> of the project. We never push directly to `main` — everything goes through a PR.

---

## Before you start

You should already be inside your Codespace with Claude Code running in the terminal
(the `claude` prompt). If you're not sure, your terminal prompt will look something
like this:

```
@HI-YourName → /workspaces/team-playground (main) $
```

The `(main)` part tells you which branch you're on. **You almost never want to work
directly on `main`** — the first step below moves you onto your own branch.

---

## The short version

If you just want the checklist, here it is. The rest of the doc explains each step.

1. Make sure `main` is up to date
2. Create a branch for your work
3. Make your changes (this is where Claude Code does the real work)
4. Check it still builds
5. Commit your changes
6. Push the branch to GitHub
7. Open the PR
8. Get it reviewed
9. Merge it
10. Clean up

---

## Step 1 — Start from an up-to-date `main`

Before branching, grab the latest version of `main` so you're not building on stale code.
Ask Claude Code:

> **"Switch to main and pull the latest changes."**

Or run it yourself:

```bash
git checkout main
git pull
```

---

## Step 2 — Create a branch

A branch is your own private copy of the code where you can experiment freely. Give it a
short, descriptive name. Our convention is:

```
yourname/short-description
```

For example: `pelle/fix-nav-spacing` or `mel/add-privacy-label`.

Ask Claude Code:

> **"Create a new branch called `yourname/short-description` and switch to it."**

Or run it yourself:

```bash
git checkout -b yourname/short-description
```

Your prompt should now show your new branch name in the parentheses instead of `main`.

---

## Step 3 — Make your changes

This is the part you already know — work with Claude Code as normal. Describe what you
want, let it edit files, try things out, run the dev server, iterate.

**Keep your PR small.** A PR that changes one thing is easy to review and quick to merge.
A PR that changes ten unrelated things is painful for everyone. If you find yourself doing
two unrelated things, that's usually two branches and two PRs.

---

## Step 4 — Check it still builds

Before you ask anyone to review, make sure you haven't broken anything. We use **pnpm**,
so ask Claude Code:

> **"Run the build and the linter and fix anything that's broken."**

Or run it yourself:

```bash
pnpm install
pnpm lint
pnpm build
```

If the build fails, fix it before moving on. Reviewers shouldn't be the ones discovering
that the project doesn't compile.

---

## Step 5 — Commit your changes

A commit is a saved snapshot of your work with a short message describing it. Claude Code
is good at this — it can look at what changed and write a sensible message for you.

> **"Stage all my changes and commit them with a clear message describing what I did."**

Or run it yourself:

```bash
git add .
git commit -m "Add privacy nutrition label to settings page"
```

**Write the message about *why*, not just *what*.** "Fix bug" tells a reviewer nothing.
"Fix nav overlapping logo on mobile" tells them exactly what to look for.

---

## Step 6 — Push your branch to GitHub

Pushing uploads your branch from the Codespace to GitHub so others can see it.

> **"Push this branch to GitHub."**

Or run it yourself:

```bash
git push -u origin yourname/short-description
```

The `-u origin ...` part only matters the first time you push a new branch; after that,
a plain `git push` is enough.

---

## Step 7 — Open the pull request

Here's the nice part — you can open the PR straight from Claude Code using the GitHub CLI
(`gh`), which is already installed in the Codespace. Ask:

> **"Open a pull request for this branch into main. Write a clear title and a description
> that explains what changed and why, and list anything reviewers should test."**

Claude Code will run something like this for you:

```bash
gh pr create --base main --title "Add privacy nutrition label" --body "..."
```

When it's done, it'll print a link to the PR on GitHub. **A good PR description saves
everyone time** — it should answer: what does this change, why, and what should a reviewer
check? If Claude Code's draft is thin, just ask it to expand the description.

---

## Step 8 — Get it reviewed

Now hop over to the **GitHub website** by clicking the PR link. This is where the review
conversation lives, and it's genuinely nicer in the browser than in the terminal.

On the PR page:

- **Request a reviewer** — click "Reviewers" on the right and pick a teammate. *(Our rule:
  every PR needs at least one approval before merging. Adjust this line if your team
  decides differently.)*
- Reviewers will leave comments, ask questions, or approve.
- If they ask for changes, **go back to your Codespace, make the changes with Claude Code,
  then commit and push again** (Steps 5–6). The PR updates automatically — you don't open
  a new one.

> **Tip:** You can also drive review from the terminal if you prefer —
> `gh pr view --web` opens the PR in your browser, and `gh pr checks` shows whether any
> automated checks passed.

---

## Step 9 — Merge it

Once you have approval and any checks are green, merge the PR. The simplest way is the
green **"Merge pull request"** button on the GitHub PR page.

Prefer the terminal? Ask Claude Code:

> **"Merge this PR and delete the branch."**

Or run it yourself:

```bash
gh pr merge --squash --delete-branch
```

We use **squash merge** so each PR becomes a single tidy commit on `main`.

---

## Step 10 — Clean up

Get yourself back onto a fresh `main` ready for the next task:

> **"Switch back to main and pull the latest."**

```bash
git checkout main
git pull
```

That's it — your work is now part of the project. 🎉

---

## When things go sideways

**"My branch has conflicts with main."**
This happens when someone else changed the same lines while you were working. Ask Claude
Code: *"Main has changed and my branch has conflicts. Pull the latest main into my branch
and help me resolve the conflicts."* It'll walk you through each conflict.

**"I committed to `main` by accident."**
Don't push. Ask Claude Code: *"I accidentally committed to main. Move my last commit onto
a new branch instead."*

**"I pushed but there's no PR link."**
You pushed the branch but skipped Step 7. Just ask Claude Code to open the PR now.

**"The build passed locally but fails on GitHub."**
Usually a missing dependency that wasn't committed. Make sure `pnpm-lock.yaml` is part of
your commit, then push again.

---

## The one rule to remember

**Never push directly to `main`.** Branch → commit → push → PR → review → merge. Every time.
