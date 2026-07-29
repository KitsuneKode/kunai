# Kunai — Provider Agent Workflow

Use this file as the repo-local instruction set for agent-driven provider work.

This is not a runtime provider contract doc. It is the operational workflow an agent should follow when the user asks to add, harden, or debug a provider.

## Trigger Conditions

Follow this workflow when:

- a new provider/site is being added
- an existing provider broke due to site drift
- the user wants multi-source inventory instead of first-stream-only scraping
- subtitles, quality variants, dub/sub variants, or mirror extraction need to improve
- screenshots or network findings need to be turned into implementation-ready notes

## Default Policy

For non-trivial provider work, dossier first and implementation second.

Primary references:

- [.docs/provider-intake.md](./provider-intake.md)
- [.docs/providers.md](./providers.md)
- [.docs/provider-examples.md](./provider-examples.md)
- [.plans/provider-hardening.md](../.plans/provider-hardening.md)
- [.docs/templates/provider-research-dossier.md](./templates/provider-research-dossier.md)

## Expected Workflow

1. collect the request and sample cases
2. create or update a dossier under `.docs/provider-dossiers/`
3. keep `Known`, `Suspected`, and `Unknown` separate
4. summarize the implementation contract before writing code
5. preserve regression samples and drift notes

## Output Requirements

A good provider pass should leave behind:

- dossier path
- sample URLs or titles
- known working cases
- known failing or missing cases
- implementation notes tied to repo contracts
- follow-up questions or unresolved gaps

## Guardrails

- do not assume the first discovered stream is the only useful candidate
- document mirrors, subtitles, audio variants, and quality labels whenever the site exposes them
- avoid storing raw sensitive token-bearing URLs in durable docs
- prefer evidence-backed notes over speculative implementation
- update repo docs if the provider model or workflow meaningfully changed
