# CLAUDE.md

This file gives Claude Code standing context about this repo. Claude reads it at the start of every session. Keep it short, specific, and current. If something changes, update this file.

## What this repo is

A shared learning space for the Hyper Island Innovation and Strategic Leadership cohort (2026-2027). Team members are mixed-experience, mostly new to coding. We use this repo to build prototypes, experiments, and small tools that explore ideas from the program.

## Who's working here

- Pelle (maintainer)
- [Add team members as they join]

Each person has their own folder under `/projects/yourname/` for individual experiments. Shared work goes under `/shared/`.

## Default stack

Unless there's a reason to deviate, use:

- **Framework**: Next.js (App Router) with TypeScript
- **Styling**: Tailwind CSS
- **Deployment**: Vercel (automatic via GitHub integration)
- **Package manager**: pnpm

Why this stack: it's the lowest-friction path with Claude Code, deploys instantly to Vercel, and has the most training data so Claude is reliable on it.

If someone has a strong reason to use something else (Python for data work, plain HTML for a quick prototype), that's fine. Note the reason in the project's own README.

## Conventions

### Code style

- TypeScript strict mode, no `any` unless commented why
- Functional components with hooks, no class components
- Server components by default in Next.js, client components only when needed
- Tailwind utility classes, no custom CSS unless unavoidable

### File and folder names

- Folders: `kebab-case` (e.g. `customer-feedback-tool`)
- React components: `PascalCase.tsx` (e.g. `FeedbackForm.tsx`)
- Utility files: `camelCase.ts` (e.g. `formatDate.ts`)

### Git

- Branch naming: `yourname/short-description` (e.g. `pelle/intro-page`)
- Commits: short, imperative mood, max 72 chars ("Add login form", not "added a login form")
- Pull requests: include a one-line description of what changed and why
- Never commit secrets, API keys, or `.env` files

### Writing voice (for any user-facing copy, docs, READMEs)

- Reflective but directional
- Personal without being private
- Avoid over-explaining
- Use contrasts and paradoxes when they sharpen a point
- **Never use em dashes**. Use commas, parentheses, or sentence breaks instead.

## What good looks like

- A new team member can clone the repo, open it in Codespaces, and see something running within 30 minutes
- Each `/projects/yourname/` folder has its own README explaining what's there
- Commits are small and frequent rather than large and rare
- Pull requests get reviewed within 24 hours during active weeks

## What to avoid

- Don't refactor someone else's project without asking them first
- Don't install heavy dependencies for small experiments (a 5-line script doesn't need a framework)
- Don't push directly to `main`. Always go through a branch and PR.
- Don't merge your own PRs without at least one teammate's review (except for typo fixes)

## How to ask Claude for help in this repo

Useful prompts:

- "Read my project folder and explain what's there"
- "Add a new page to my Next.js app at /about with [content]"
- "I'm getting this error: [paste]. What's happening?"
- "Review my latest changes and suggest improvements"
- "Help me write a commit message for the changes I just made"
- "Walk me through what `git rebase` does before I run it"

Claude has permission to read and edit files in this repo, but should always confirm before:

- Deleting files or folders
- Modifying anything in `/shared/` (ask the team first)
- Installing new top-level dependencies
- Changing CI config, Vercel config, or anything in `.github/`

## Project context

[Add notes here about specific projects, deadlines, themes the cohort is exploring, etc. Keep this section updated as the work evolves.]

## Links

- Team setup guide: [README.md](./README.md)
- Vercel project: [add URL once connected]
- Team channel: [add link]
