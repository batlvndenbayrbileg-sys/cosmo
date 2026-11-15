This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Run Cosmo with a local model

Online (Vercel) Cosmo uses Claude. On your own machine you can also add a local language model through
[Ollama](https://ollama.com). It is used when Claude is unavailable, or instead of Claude when no `ANTHROPIC_API_KEY`
is set. The order is Claude, then the local model, then the built-in rules and templates.

1. Install Ollama from https://ollama.com/download and start it. It listens on `http://localhost:11434`.
2. Pull a model that supports tool calling, for example `ollama pull qwen3:8b`.
3. Add these two lines to `.env.local`:

   ```bash
   LOCAL_LLM_URL=http://localhost:11434
   LOCAL_LLM_MODEL=qwen3:8b
   ```

   Optional: `LOCAL_LLM_TIMEOUT_MS` (default 20000). Only `localhost`, `127.0.0.1` and `[::1]` are accepted, so health
   data stays on your machine. Set `LOCAL_LLM_ALLOW_REMOTE=1` to use another host.
4. Run `pnpm dev`. The server log says `local llm configured` at startup and `turn answered by claude / local / rules`
   for each turn.

Cosmo talks to Ollama's Anthropic-compatible endpoint (`/v1/messages`). Local text goes through the same safety checks
as Claude text, and crisis replies are always the fixed templates. If the local model is slow, fails or returns
something unusable, Cosmo uses its rules and templates for that turn.

Only the language model runs locally. Speech-to-text and text-to-speech (ElevenLabs) still need the internet.
Without them you can type to Cosmo. Leave both variables unset on Vercel; nothing changes there.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
