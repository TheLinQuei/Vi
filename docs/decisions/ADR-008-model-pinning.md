# ADR-008 — Model pinning (Ollama v0)

## Problem

Unpinned models cause divergent behavior, flaky structured output, and endless “works on my machine.”

## Decision

**v0** supports **one** Ollama **model tag** and **one** documented capability profile (streaming on/off, tools on/off, etc.). Other models are **unsupported** until explicitly validated and documented.

**v0 recommendation:** keep **tool use off** in the main chat loop until voice, memory, and presence are stable — final choice recorded when implementation starts.

## Consequences

- Model upgrades are deliberate, tested changes.  

## Status

Accepted.
