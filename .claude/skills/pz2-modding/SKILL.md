---
name: pz2-modding
description: Definitions, proven techniques, game API facts and rules for modding Planet Zoo 2 (Cobra engine, OVL archives, Lua 5.3, Coherent Gameface UI). Use for any Planet Zoo 2 / PZ2 modding work in this repo - building or installing mods, hooking game Lua, injecting or testing UI, reading game data stores and events, debugging crashes - and keep it updated with anything new learned.
---

# Planet Zoo 2 modding

The repo's knowledge base for modding Planet Zoo 2 (PZ2). It holds what has been **proven** in the
game, what is still **open**, and the rules every mod here follows. Details live in `reference/`;
read the file for the area you are working in.

## This skill updates itself

This file and `reference/` are the source of truth. Keep them current as part of the work, not as
an afterthought:

- **When you learn something about PZ2 or its modding** (a format detail, an API, an event name, a
  data path, a pitfall, a crash cause, a tool trick), add it to the matching `reference/` file
  **in the same change** that used it. Create a new reference file if no topic fits, and list it in
  the index below.
- **When something here turns out wrong or outdated** (e.g. after a game patch), fix or delete it.
  Don't leave contradictions.
- Mark how sure a fact is: **proven** (seen in game), **offline** (seen in files, tests or
  decompiled code only), or **guess**. Upgrade the mark once it is confirmed.
- Note the game version for anything a patch could change. Current: **1.0.5, build 1023906** (second PC, from
  2026-10-16 10:01; facts marked 1.0.4 were seen on build 1018486 and are unchecked since).
- Add one dated line to `reference/changelog.md` per update.
- Keep entries short: the fact, why it matters, where it's used (file path). No session narration.

## Ground rules (always)

1. **Never touch the exe or Denuvo.** No patching, unpacking, proxy DLLs, or bypassing online or
   offline activation. Each new game build needs one online launch with Steam online.
2. **Mods are drop-in folders.** `Win64\ovldata\<Pack>\`, with `Manifest.xml` and OVLs. No game
   files are changed. The only thing written to the profile is the mod's own `PZ2QoL` entry in
   the player save's data store (`Saves\player`, MainPlayer `SetData`; developer-approved
   2026-10-16, for device-local data such as Franchise habitat assignments; see
   `reference/lua-runtime.md`). It holds two areas: `Assign` (per-zoo data, 64 KB cap) and `Prefs`
   (player-wide settings across zoos, 4 000-character cap). Short ASCII strings only, `pcall` around
   every call, and never anything else in that save. Uninstalling means deleting the
   folder. Data a mod must keep (e.g. PZ2QoL's habitat assignments, per zoo, Franchise included)
   goes in that player-save entry (mod files can't be written in retail). No mod data goes into
   park or online saves; PZ2QoL only keeps a read-only world serialisation client in offline
   parks so saves from the 2026-10-16 park-save builds load as before and their data moves over.
3. **Online (Franchise) safety.** Never change what is sent to Frontier's servers. Any automation
   that acts online:
   - only ever starts from the player's click (never a timer or the background). That click is
     the opt-in: there are no "allow in Franchise" switches (developer, 2026-10-16). Franchise is
     the mod's main target, so every feature should work there. **Exception** (developer,
     2026-10-19): the per-species Auto mode (Species board) runs on its schedule by itself, in
     Franchise too; turning it on for a species is the opt-in (or, with the Kin setting
     `autoOnAssign`, off by default, setting a habitat aside for it). **Second exception** (developer,
     2026-10-19): "Let out stuck aquarium animals" (`pz2qol.boxrelease.lua`) unboxes animals the
     game boxed and left, hands-free, on by default (Kin setting `releaseBoxed` turns it off);
     with the Kin setting `overdueBox` (off by default; turning it on is the opt-in) it also
     boxes and lets out a mother still pregnant at twice her species' pregnancy, once per
     pregnancy;
   - does one action at a time, each confirmed by the game (or timed out), with a pause after
     each (player-adjustable; moves 0.5 s default and minimum, developer 2026-10-18; listings 1 s
     minimum). The market lister uses that same pause after a server
     error (developer, 2026-10-16: no longer back-off); "Find a habitat" still pauses 8 s;
   - **skips a step that fails and carries on; only the player's Stop ends a run.** The developer
     decided this on 2026-10-16 and accepts the risk: in-game crashes have followed server
     refusals. Don't show the player warnings about it.
4. **Fail soft.** Wrap every hook in `pcall`. If anything is missing, fall back to the vanilla
   view or behaviour. Hook by module or function name, not by offset.
5. **Ship nothing of Frontier's** (no decompiled code, no assets) except unavoidable copies of the
   game's own UI entry pages that redirect to the mod (see `reference/ui-gameface.md`).
6. **Packaging:** a plain zip only. No installers, and nothing that runs outside the game. A DLL
   *inside the mod folder* that the game's own Lua loads (`package.loadlib`, like the debug trace
   DLLs) does not break this rule (developer, 2026-10-18). A native helper is still undecided
   (`docs/RESEARCH-native-helper.md`): Nexus may quarantine a zip with DLLs, and crash dumps list
   loaded modules.

## Core definitions

| Term | Meaning |
|---|---|
| **Cobra** | Frontier's engine (PZ1, PC2, JWE3, PZ2). |
| **OVL / OVS** | Frontier archive format. PZ2 uses cobra-tools' **Planet Coaster 2** profile, with header byte 4 (`version_flag`) set to `0x01`. |
| **Content pack** | A folder in `Win64\ovldata\`. Every pack gets `tryrequire("Database.<Pack>LuaDatabase")`, which is the mod entry point. |
| **Main.ovl** | The pack's Lua. Mods ship **plain-text** Lua; the game compiles it at load. |
| **UI overlay** | A pack's extra UI files (HTML/JS/CSS) in an OVL, loaded with `api.ui2.LoadOverlay` and `MapResources`. |
| **Gameface** | Coherent Gameface (cohtml): the HTML/JS UI runtime. The game UI is Preact. |
| **View** | A Gameface page owned by a Lua controller, e.g. `FrontEndUI` (hub, `Frontend.html`) and `HUDUI` (`HUD.html`). |
| **DataStore** | The game's UI data model: values at context paths such as `['hubAnimalsData','animalStorageData','list']`. |
| **Hub** | The start-screen globe world (`startscreenglobe`): Market, Animal Storage, Franchise. |
| **0xFDEAD** | Frontier's own fatal-error exception, raised deliberately with `RaiseException`. |

## Reference index

| File | Covers |
|---|---|
| `reference/archives-and-build.md` | OVL format, cobra-tools, pack layout, build and install tools, pitfalls |
| `reference/lua-runtime.md` | Entry point, require hooks, coroutines and threads, `api.*` namespaces, view and overlay lifecycle |
| `reference/ui-gameface.md` | Gameface quirks, view redirects, DataStore and collections, row recycling, CSS rules |
| `reference/game-data-and-events.md` | Data contexts, UI events, enums, trade and listing limits, server errors |
| `reference/debugging.md` | Trace DLL breadcrumbs, crash dumps and how to read them, known crashes |
| `reference/animals-and-breeding.md` | Lineage and parent APIs, the game's inbreeding rule, habitat membership, kin-related UI surfaces |
| `reference/cheats-and-debug.md` | Vanilla rename cheats, native cheat functions, the retail debug stub, launch args, dev tools |
| `reference/testing.md` | Unit, Lua and browser-harness tests and when to run each |
| `reference/changelog.md` | Dated log of updates to this skill |

## Workflow for a mod change

1. Read the relevant reference files. Find the game code you are hooking in the decompiled Lua or
   the unpacked UI (`reference/archives-and-build.md` explains how to get them).
2. Change the mod in `mods/<Pack>/`.
3. Run the tests (`reference/testing.md`). For UI changes, run the browser harness and **look at the
   screenshots**.
4. Build fresh, then install only while the game is closed (`reference/archives-and-build.md`).
5. In game: check `dbg/trace.log` (debug builds; its ` LOG ` lines are the detailed log with values,
   `reference/debugging.md`) and the crash dumps if anything goes wrong.
6. **Update this skill** with whatever you learned.
