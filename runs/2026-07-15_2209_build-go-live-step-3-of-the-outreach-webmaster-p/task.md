# Task — 2026-07-15_2209_build-go-live-step-3-of-the-outreach-webmaster-p

## Objective
Build GO-LIVE step 3 of the outreach-webmaster pipeline, the sender, as code that cannot send by default: it consumes approved drafts from the existing review/export flow and sends via the SMTP_*/SENDER_* env config, but must refuse to run live unless ALL of an explicit --live flag, complete env config, and a per-run send cap are present, defaulting to a dry-run that only prints what it would send; follow docs/GO-LIVE.md and the repo's standing hard no-send gates and test conventions, and never send any email in any test or verification step.

## Repo
C:/Users/PC/Desktop/Sandbox Testing/outreach webmaster (branch: master)

## Risk
medium

## Validation plan
- TBD

## Agent Adapter
- pipeline template: feature
- builder: claude-code
- reviewer: codex
- surface: harness (v2)
