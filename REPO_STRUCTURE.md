# Repo Structure Proposal

This is a starting structure for the team repo. Simple by design. You can evolve it as the team's needs become clearer, but don't add structure before you need it.

## Top-level layout

```
hyper-island-team/
├── README.md                  ← Team onboarding guide
├── CLAUDE.md                  ← Standing context for Claude Code
├── package.json               ← Root dependencies (Next.js, etc.)
├── pnpm-lock.yaml
├── tsconfig.json
├── tailwind.config.ts
├── next.config.js
├── .gitignore
├── .env.example               ← Template for env vars (never commit .env)
│
├── app/                       ← Next.js App Router
│   ├── layout.tsx             ← Shared layout for all pages
│   ├── page.tsx               ← Landing page (team intro)
│   └── projects/
│       ├── pelle/             ← Each person's section
│       │   └── page.tsx
│       ├── andreas/
│       └── mats/
│
├── projects/                  ← Individual experiments (non-Next.js too)
│   ├── pelle/
│   │   ├── README.md          ← What this project is
│   │   └── ...
│   ├── andreas/
│   └── mats/
│
├── shared/                    ← Code/assets multiple people use
│   ├── components/            ← Reusable UI components
│   ├── lib/                   ← Utility functions
│   └── assets/                ← Images, fonts, etc.
│
├── .devcontainer/             ← Codespaces config
│   └── devcontainer.json
│
└── .github/
    └── workflows/             ← (Add CI later when needed)
```

## Why this shape

**Two parallel folders for personal work (`app/projects/` and `projects/`)**

The `app/projects/yourname/` folder is for work that lives inside the shared Next.js site. If you build a page or feature that's part of the team site, it goes here.

The `projects/yourname/` folder is for everything else. Self-contained experiments that don't fit the shared site. Maybe a Python data analysis, a standalone HTML demo, a CLI tool. Each gets its own README.

This dual structure means people aren't forced into Next.js if they want to try something else, but everyone has a default home in the shared site.

**`/shared/` is opt-in**

Most code stays in personal folders. Only things multiple people use go in `/shared/`. This avoids the "someone broke my code" problem early on. As the team matures, more code will naturally migrate to `/shared/`.

**Devcontainer config included**

The `.devcontainer/devcontainer.json` file tells Codespaces exactly how to set up the environment. This means everyone gets the same Node version, the same pre-installed tools, the same VS Code extensions. One file, identical environment for everyone.

## Suggested `devcontainer.json`

```json
{
  "name": "Hyper Island Team",
  "image": "mcr.microsoft.com/devcontainers/typescript-node:20",
  "features": {
    "ghcr.io/devcontainers/features/github-cli:1": {}
  },
  "postCreateCommand": "pnpm install && curl -fsSL https://claude.ai/install.sh | bash",
  "customizations": {
    "vscode": {
      "extensions": [
        "esbenp.prettier-vscode",
        "bradlc.vscode-tailwindcss",
        "dbaeumer.vscode-eslint"
      ]
    }
  },
  "forwardPorts": [3000]
}
```

This auto-installs Claude Code in every new Codespace. People skip Step 3 in the README. Nice quality-of-life improvement once the team is comfortable.

## What to leave out for now

- **Testing setup** (Jest, Playwright). Add when something actually needs tests.
- **CI/CD workflows** beyond Vercel's automatic deploys. Vercel handles previews and production deploys for free.
- **Multiple environments** (staging, production). One environment is enough until it isn't.
- **Database**. Add when a project needs one. Supabase or Vercel Postgres are easy to bolt on.
- **Authentication**. Same logic. Add when a real project needs it. Clerk or NextAuth.

## Growth path

When the team outgrows this structure (six months in, maybe), the natural next steps:

1. Split `/projects/` into archived vs active
2. Promote successful experiments out of `/projects/yourname/` into their own top-level folder
3. Add a `/docs/` folder with team learnings, retrospectives, decisions
4. Introduce light code review conventions (required approvals on PRs to `main`)

But don't do any of this before there's a real pain point. Premature structure is just as costly as no structure.

## First commits to make

Once the repo exists, do these in order:

1. Add `README.md` and `CLAUDE.md` at the root
2. Run `pnpm create next-app@latest .` to scaffold the Next.js app
3. Add `.devcontainer/devcontainer.json`
4. Push to GitHub
5. Connect Vercel to the repo (one-click via Vercel dashboard)
6. Create the `/projects/pelle/` folder with your own intro project
7. Send the GitHub repo link to teammates with the onboarding README

That's the minimum viable shared environment.
