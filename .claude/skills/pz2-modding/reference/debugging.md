# Debugging and crashes

## Trace DLL breadcrumbs (debug builds)

There is no `io` library and no visible log, so the mod logs by **loading tiny DLLs**. **proven**

- `tools/trace/pz2_trace.c` is built once and copied as `dbg\cp_<name>.dll`, one copy for each name
  in `tools/trace/checkpoints.txt`.
- Two ways to log:
  - `package.loadlib(dir.."cp_<name>.dll", "*")` runs `DllMain`, which appends
    `HH:MM:SS.mmm tid=<thread> cp_<name>.dll` to `dbg\trace.log`. It logs **once per name**
    (`Core:Checkpoint`).
  - **Repeating breadcrumbs** (`Core:Mark`): `package.loadlib(path, "mark")` returns the DLL's
    exported `int mark(void *L)`, and each call appends a line. It never touches the Lua API.
- From JS, `breadcrumb(name)` (errors.js) sends `engine.trigger('PZ2QoL_Trace', name)`, and Lua
  marks `js_<name>`. A heartbeat goes every 10 s, plus filter, select-all and lister steps.
- **A name missing from `checkpoints.txt` is silently not logged.** Add new names there. `tests/checkpoints.test.mjs` fails on a literal page breadcrumb (`js_<name>`) or a `main.js` install step (`js_step_<letters of its name>`) the list lacks; names built at run time are not checked.
- `trace_listener_ok` / `trace_listener_failed` show whether the JS→Lua trace listener registered.
- Server errors are marked as `srv_<Name>`, or as `srv_code_<N>` when the enum name can't be
  resolved.
- The crash reporter creates a 0-byte `.dmp` at game launch and fills it in on a crash, so ignore
  0-byte dumps.

## The error banner

- `errors.js` shows every `reportError` not marked silent, and Lua's `PZ2QoL_Error` (`Errors:Flush`), in a banner with Details and Dismiss.
- The Kin setting `errorBanner` (default on, under Alerts) switches the banner off: `main.js` passes it to `setErrorBanner`. Every report is still kept (`getErrorLog`, its entry `shown: false`), written to the detailed log and the console, and heard by `onErrorReported` (the lister stops a run on server errors either way).
- With no mod page up, Lua's fallback dialog for server errors is outside the setting.

## Detailed log (debug builds, 2026-10-18)

Free-text lines **with values** in the same `dbg\trace.log`, so one play session can be read back
and every Market desk / lister animal followed end to end. Built for PZ2QoL 3.0.0. **Proven** on Y:
2026-10-18 (1.0.5, Franchise): `log_channel_ok` at boot, 2,924 `LOG` lines from Lua and both pages in
a 16-minute session, with one desk run readable animal by animal. Gap found: `lister resolve_keys`
logged only which keys failed (the first 12), not what `StorageGetIDAndAIDType` returned for them,
and the same line every second (724 identical lines in 10 minutes). Fixed 2026-10-18: `resolve_keys`
only when the answer changes (`types`, `via`, `same`), plus one `resolve_fail` line per failure
shape; the page backs failed keys off instead of asking every second.

**How the text gets out (the channel).**
- The exe exports **no Lua C API**. Checked 2026-10-18 on 1.0.5 by reading the export table
  (read only): 359 names, all Wwise `AK::*`, AMD AGS, `D3D12SDK*`, `NvOptimusEnablement` and three
  Frontier log calls `fLogSetGlobalLogLevel`, `fLogGetGlobalLogLevel`, `fLogSetLevel(const char*,
  const char*)`. No `lua_*` names, not even as strings. So a DLL function cannot read its Lua
  arguments. **offline (proven absent)**
- Rejected: reading the string out of the `lua_State` memory by layout (Frontier's Lua has a
  custom header and 32-bit floats, so the layout is unknown; a wrong guess reads wild memory, and
  a vectored crash handler may see even a caught access violation). Rejected: calling `fLog*`
  (changes the game's own logging; where its output goes is unknown, **guess**).
- **Built: spelling.** `Core:LogText(s)` calls one `mark` per byte through more copies of the
  tracer: `lg_clr.dll` (start the line), `lg_20.dll` … `lg_7e.dll` (append that printable ASCII
  byte; anything else is written `?`), `lg_end.dll` (write the line). The copies keep the line in
  `lg_core.dll` (loaded lazily from the first `mark`, never from `DllMain`), **per thread**
  (SRW lock, 32 slots, 1500 bytes), so lines from different game threads never mix. The lg_* copies
  write nothing when loaded. Still no Lua API and no game memory touched: a broken channel loses
  lines, nothing else. Offline: 2000 lines of ~100 characters in 0.37 s with a 32-bit build and
  cobra-tools' Lua 5.3 (`package.loadlib` + `mark`), i.e. ~0.2 ms a line including the file append.
- Fail soft: no `lg_end`/`lg_clr` (a release build, or an older debug build) → `Core.bLogOff`, one
  checkpoint `log_channel_missing`, and every later call returns at once. The first written line
  marks `log_channel_ok`. A missing byte DLL only drops that character.
- The build (`--debug-trace`) copies the 98 `lg_*` files next to the `cp_*` ones.
- Not used: the game's own logs. `%LOCALAPPDATA%\Frontier Developments\Planet Zoo 2` holds only
  `Config_Local` and `UserAudio`; `api.debug.Trace` and `api.debug.WriteStringToFile` reach no file
  in retail (above, `lua-runtime.md`); Gameface `console.log` has no file (**guess**: none found).

**Line format.** The DLL prefixes time and thread; Lua and the page add a source, a sequence, an
area, an event, then `key=value` pairs:

```
<HH:MM:SS.mmm> tid=<thread> LOG lua#<seq> <area> <event> k=v k=v ...
<HH:MM:SS.mmm> tid=<thread> LOG js#<seq>@<page time> <area> <event> k=v k=v ...
```

- Lead keys first when present: `run`, `i` (1-based place in the run), `guid`, `key` (storage
  row), `step`; then Lua sorts the rest, JS keeps its order. Values with spaces, `=` or `"` are
  quoted; tables print as `[a,b]` / `[k:v]` one level deep; values are cut at 160 characters
  (`~`), lines at 900. Keys containing token/password/account/steam/session/email/user/auth are
  written `[redacted]`. Animal GUIDs, species, prices and server codes are logged; nothing about
  the player's account.
- `js` lines reach Lua in batches every 150 ms (`PZ2QoL_Log`, `\n`-separated, at most 100 per
  batch, 400 a second; extra lines are counted and reported as `log dropped n=<N>`), so their DLL
  time can trail the page time (`@…`) by up to ~0.2 s plus a frame. Order by the page time inside
  `js`, by the DLL time across sources.
- APIs: Lua `Core:Log(area, event, tData)` / `Core:LogText(line)` (`pz2qol.core.lua`); JS
  `dlog(area, event, data)`, `logPriceDecision(where, id, advice, extra)` (`debuglog.js`).
  Both never throw. The page waits for Lua's `PZ2QoL_LogState` (`on` in a debug build, sent when
  the view is ready); until then it keeps up to 500 lines; `off` (release) makes `dlog` a no-op.
- **Ctrl+Shift+L** on the hub or park page opens a small panel with the newest lines (Area filter,
  Older/Newer, Copy, Clear): the fallback when the file channel is missing. The page keeps the last
  2000 lines. Copy: no clipboard in the game's UI (**guess**: shows "No clipboard"); take a
  screenshot instead. Keyboard events reaching the page in game: **guess**.

**Areas and events.**

| Area | Events |
|---|---|
| `lua` | `view_ready` (view, version), `report` (src, title, detail, show: every Errors report) |
| `server` | `error` (code, name, req, reqName, listeners): every franchise server error |
| `lister` (Lua engine) | `storage_open/close`, `hello` (storage, rows, online, missing, running), `resolve_keys` (n, failed, failedKeys ≤ 12, types: id types of the found `[0:4,2:..]`, via: `[id:..,lossy:..,fp:..,none:..]`, same: identical answers since the last line; logged only on change), `resolve_fail` (one per failure shape: key (a sample), n, ok (pcall), idType, numType, id (tostring, ≤ 40), nType, row (found in the list), why: nil/zero/fraction/userdata/table/badstring/error/collision/duplicate + `+ambiguous`/`+nofp`), `start` (run, req, n, paceMs, online), `job` (one per animal: guid, hint key, price, hours), `animal`, `step` (step, from, secs, msg), `resolve` / `resolve_none` (key, via hint/list, rows, the row's timer, moving, maturity, species, gender), `watch`, `seen` (the page's report text, on change), `select` (key, native id, what the data showed before), `wait_data` (what it still waits for), `data_same`, `price` (job price, limits pmin/pmax/pdef, hours hmin/hmax/hdef, price, capped, usedDefault, src page/lua), `untradeable`, `busy` (why: db/requests/connecting/loading/peek), `busy_requests_ignored`, `quiet`, `changed` (key/selection), `data_changed`, `unselectable` (why, the page's last view), `send` (key, price, hours, data print), `server_error` (code, name, req, ignored: false or why not counted, afterSend), `result` (status, kind, detail, price, hours, sent, afterSend, err), `end` (phase, msg, counts), `stop`, `pace`, `desk_filters`, `desk_restore`, `error`, `tick_failed`; 2026-10-18 (`docs/PLAN-desk-quick-release.md` Phase 0): `start` has `mode` (list/check) and `releaseable`, `resolve` has the row's `source`, `select` has `net`, `select_net` (before, after, first, busy, luaBusy, pageConn, dbType: does a select send a request?), `quick` (trade, qt/qtValue/qtPrice/qtWhy, qr/qrValue/qrPrice/qrWhy, rehome, source, releaseable, src, v), the vanilla quick handlers' `probe_call` (kind, nargs, type, len, count, kmin, kmax, ktypes, net) / `probe_id` (k, vtype, v, key, via, guid) / `probe_after` / `probe_busy` / `probe_idle` / `probe_server_error` (code, name, req, ms) / `probe_gone` (guid, ms) / `probe_end`; Phase 2 quick runs: `send_quick` (key, mode, native, price, rows, fp, data), `quick_gone` (ms, key, mode, err), `quick_timeout` / `quick_ambiguous` (ms), `quick_nopage` (n), `quick_reloaded` (how: hello/report), `quick_server_error` (code, req, afterSend), `quick_transient` (state, ms), `quick_flags` (ms), `refused_then_quick` (key, mode, detail, n); 2026-10-19 mode `unlist` (My listings): `send_unlist` (key, price, timer), `unlisted` (ms, key, err), `unlist_server_error` (code, name, req, afterSend) |
| `lister` (page) | `sell_click`, `list_request`, `list_path` (engine or old path, why), `caps`, `resolve` (rows, cached, asked, got, failed, mismatch, backedOff, retry, via), `job_built` (noIdBlocked), `job_left_out` (why: noid, noguid, pregnant, …), `list_started` (count, asked, noid), `engine_start`, `engine_started`, `engine_state` (on change), `engine_result` (each result as the page first sees it), `engine_stop`, `engine_pace`, `page_watch`, `page_seen`, `page_watch_end`, `stop_click`; the old click path: `legacy_start/animal/select/selected/send/answer/result/stop/end`, `legacy_server_state` |
| `peek` (Lua) | `start`, `requested`, `state` (every state sent), `page`, `ready` (secs, frames), `release`, `dbstate` |
| `peek` (page) | `start`, `request`, `reply`, `page_read` (rows, cc, pages, book), `page_stale`, `page_reply`, `done` (listings, cc, pages, added), `failed`, `all_start/all_species/all_end` |
| `pricing` | `decision` (where job/desk/legacy, id, price, base, conf, method, comps, tier, medal, medalMode, sameMedal, morph, morphMode, guessed, score, market, game, offset, reason; once per animal and outcome), `book_recorded` (observed, valid, book, per species/source) |
| `desk` | `refused_option` (value), `tick_refused` (asked, inStorage, ticked, notAllowed), `quick_confirm` / `quick_confirm_ignored` (how, ms), `mode` (mode, accepted), `quick_sheet` (go, skip, total, exact), `quick_hold_cancel` (why, ms), `quick_sheet_close` (why), `quick_start` / `quick_started` (mode, n, guids), `quick_accepted` (mode), `check_click` (n, species), `check_started` (ok, n, req, paceMs), `category` (guid, cat, block, was: a row's category from a verdict), `verdicts_cleared` (floor), `open` (keys, pageRows, scope, species, filters, hours, offset), `rail` (source, pageRows, rows, guids, engine, Lua rows), `rail_counts` (species:total/sellable/listed, six a line), `prices` (the shown species: rows, priced, min/median/max, conf counts, book, checked), `filters` (patch, shown, ticked), `tick`, `tick_shown`, `list_click` (ticked, listable, noId, noIdBlocked, noIdTotal), `list_result`, `retry`, `duration`, `scope`, `filters_ask/answer`, `notice`, `close` |
| `reprice` (My listings, `repricerun.js` / `marketreprice.js`) | `tick` (which, ticked), `sheet` (n, old, next), `start` (n, hours, total), `off_end` (phase, off, failed, stop), `relist_start` (auto, n, asked, found), `relist_end` (phase, action, relisted, sold, left), `quick_start` (auto, mode, n, asked, found), `action` (action, accepted), `stop` (phase); `start` and `sheet` carry `action`; the desk's `view` (sell/listings) |
| `ui` | `page_start`, `report` (every error banner entry, shown or silent) |

**Reading a run (for an agent).** Copy `dbg\trace.log` out before the next install (installs
replace it). Then:
1. `grep " LOG "` for the log alone; keep the `cp_*` / `js_*` lines around a time for context
   (boot, crashes, `report_*`).
2. Find the run: `lister list_request` / `desk list_click` (page), then Lua `lister start run=<N>`
   and its `job` lines (guid → hint key, price, hours).
3. One animal: `grep "run=<N> i=<i> "` or `grep "guid=<guid>"` gives `animal` → `step` …
   `resolve` → `select` → `wait_data` → `price` → `send` → `server_error`? → `result`, and the
   page's `engine_result` for the same guid. `result` says why (`kind`, `detail`, `err`,
   `afterSend`).
4. The run's end: `lister end run=<N>` (phase, counts); a refusal or crash: the `server error` /
   `lister server_error` lines right before, and the crash dump time (see below).
5. Prices: `pricing decision where=job guid=<guid>` gives the inputs behind the job's price.
6. Note: after a result the engine's `step=pause` line already carries the next `i` (no guid).

## Lister stalls

- Every lister wait has a timeout: select 5 s, trade allowed 3 s, confirm 30 s. While waiting, the
  status shows `(waiting Ns of Ms)` and marks `js_lister_waiting`.
- Per-animal marks: `js_lister_select` → `selected` → `add` → `confirmed`, or `skip` / `stop`.
- 2026-10-14, second PC: a 33-animal run "never got past the 6th". **Cause found 2026-10-15**:
  Lua delivered server errors to only one mod view (`Hub:GetModUI()`, which prefers the HUD), but
  the lister runs on the hub page. It never saw the error, waited the 30 s confirm timeout, then
  stopped the run. Fix: every ready mod view gets the error; the non-showing ones get a silent
  copy (4th event arg `true`). **proven** by trace (`report_server` 0.3 s after `lister_add`,
  then `lister_waiting`, then `lister_stop` 30 s later); fix **offline**.
- Server timeouts (`DidNotGetResponse`) are a known game issue, and the listing can still go
  through. The lister waits another 8 s, then skips the animal as "unconfirmed" and carries on.
  A missing confirmation also skips instead of stopping (the user asked for this).
- `Core:MarkNumber(prefix, n)` spells a number into the trace (`chr_0..9`, `chr_minus`, `chr_dot`,
  `chr_end`). Unresolved server error codes log `srv_unknown_code` and `srv_request` this way.
- Release builds have no `dbg\`, so every trace is a no-op.
- Reinstalling replaces `dbg\trace.log`, so copy it out before installing.

## Crash dumps

- Location: `%TEMP%\Frontier Developments\Planet Zoo 2\CrashDumps\*.dmp` (about 250–500 KB).
  `crash_reporter.exe` uploads them to Backtrace; its log is `%TEMP%\crash_reporter.exe.log`.
- Summarise with `tools/crashsum.py`, using a Python that has `pip install minidump`. It prints:
  - exception code, faulting thread **name** and module;
  - modules referenced on that thread's stack;
  - `game_running_time` and `world_current_name`/`state`;
  - the mod list and Lua coroutine stacks.
- Each dump embeds:
  - a JSON block (game version, GPU, world, running time);
  - fHeap and GPU memory summaries;
  - "Mod Information";
  - **every Lua coroutine's stack**, which tells you which hub mode or screen was active;
  - F3D adapter status.
  There is **no fatal message text and no heap**.
- **0xFDEAD** is Frontier's deliberate fatal (`RaiseException` in KernelBase). It shows up on
  whichever thread hit the fatal (`Render`, `fTask Wn`, `Main`), so the thread alone doesn't
  identify the cause.
- To work out the cause, line up the dump time (game start + `game_running_time`) with the last
  `trace.log` lines.
- **Lua panics** (`crash_reason: lua_panic`) are uploaded as a JSON report and the `.dmp` is then
  **deleted**. `%TEMP%\crash_reporter.exe.log` keeps the whole report: `lua_error` (file:line and
  message), the Lua stack and the park info. Copy it before the next crash overwrites it.
  **proven** (2026-10-16)
- The crash time is the reporter's `Initialised` line, not the upload time. The reporter shows a
  dialog first and uploads when the player closes it (minutes later). **proven**
- `.\PZ2QoL\Errors.lua(207): field resume` appears in every dump's Lua stacks. That is PZ2QoL's
  `coroutine.resume` wrapper, which every game coroutine goes through, so it does not mean mod
  code crashed. `cp_report_lua` just before a Lua panic is the same wrapper seeing the game's error.
- Game Lua bytecode has its line info stripped, but `luadec -dis` prints each function's
  `Defined at line`. Map a crash line to the function whose start is the last one before it.
  **offline**

## Known crashes (open)

| When | What | Status |
|---|---|---|
| 2026-10-14, second PC, Animal Storage (21:29, 22:41, 22:48, 22:59) | 0xFDEAD on the Render or fTask thread. GPU memory fine (4 of 16 GB). No mod frames on the stack. | **Open.** 22:59 came **4 s after a Franchise server error** (and one 2 min earlier didn't crash). Suspects: the server error itself, or the mod's error toast. The server error code isn't known yet. |
| 2026-10-15, second PC, Animal Storage, lister run (19:42:58, 19:50:33) | 0xFDEAD on fTask W22 / W14, 0.5 s and 0.24 s after the server answered the listing request (type 42) with **code 5**. No mod frames. Trace numbers via `Core:MarkNumber`. | **Cause found:** the game's own handling of that reply (vanilla), triggered by lister requests. Mitigated in 1.2.1: stop at the first unnamed code, pause after every request, and wait for `IsDatabaseOperationInProgress` to be false. The Oct 14 22:59 crash (4 s after a server error) is probably the same. |
| 2026-10-16, second PC, Animal Storage (between 00:14:52.7 and 00:15:01) | Game gone without a Frontier dump (none written after 2026-10-15 21:26). Trace stops mid-heartbeat. The only mod activity in the last 48 min: JS Kin scans every 5–20 s (900+ fine before). Last lister run 23:13, last Kin move 23:26. Vanilla refusals 255 on request 49 at 00:12:50–00:14:04. | **Probably vanilla**, but not proven without a dump. If it repeats, check whether request-49 refusals came just before. |
| 2026-10-16 03:07:54, second PC, Franchise park, 1.0.4 (dump `3af65885…`) | Access violation (0xc0000005) in PlanetZoo2.exe on fTask W8, 37 min in. No mod frames. 3 s after the server refused request 31 with code 5 (`NotAllowed`), the third refusal in 18 s. The last Kin move was 24 s earlier. Request 31 is also refused with no Kin moves at all (02:43, 02:51, 10:10). | **Probably vanilla** (the game's handling of the refusal, like the 10-15 crashes), not proven. |
| 2026-10-16 10:40:59, second PC, Franchise park "Save the Euro", **1.0.5** | Lua panic: `ModeHelper.lua:77: Error running mode Select: AnimalMovementEditMode.lua:1158: table index is nil`. In 1.0.4 bytecode, line 1158 falls in `SetupAnimalMovementContext`, where `tSpeciesCounts[GetSpeciesFromGUID(guid)]` gets a nil species for a selected animal. PZ2QoL never opens that mode: the player did, with the game's own Move. 81 Kin moves in that session, the last 45 s before. | **Vanilla code**, no nil check. The likely trigger is a stale selection: an animal the game's UI still had selected, moved or sent away just before. The Kin moves may make that likelier. The 1.0.5 bytecode of this file is byte-identical to 1.0.4, so the mapping holds. **Guarded** by PZ2QoL.Guards: if a selected GUID has no species, it sets `bFailedToVerify` (the game's own path: "Move failed", leave the mode) and reports "Move cancelled to prevent a crash". Every species use in the mode is gated by that flag. Trace `guard_move_patched` / `guard_move_stale`. **offline** (Lua test 13). |
| 2026-10-17 04:34:33 and 04:45:04, second PC, Franchise, **1.0.5** (dumps `d09a7218…`, `f854f941…`) | 0xFDEAD on fTask W15 / W12 while `startscreenglobe` is `activating`, Lua stack in `SaveAgent._ReturnToStartScreenNow` (**exit to main menu**, which in Franchise first saves the zoo: `SaveFranchiseZooNowWithoutMessage`). Both times the same sequence: park opened, the mod's autosave **Save now** about 10 s later, exit with save about 10 s after that, crash 1.5–2 s after the save (0.1 s after the post-`UnsetAutosave` `RequestSave`). No `report_*` marks (no Lua error or assert) before it. Park→hub trips without a save (60+ in the 4 h trace, many seconds after a mod autosave) never crashed; Save and quit to desktop after Save now did not crash either (10-16 14:20, 15:06). | **Open.** Exit-with-save to the menu crashed 2 of 2; no exit-with-save without a recent mod autosave has been traced yet, so mod autosave vs. save-API wrappers vs. vanilla is not settled. Repeating `x_*` marks (SaveAgent save/return, FrontEnd/HUD init/ready/shutdown, StartScreenHUD activate, ModeHelper.SetModes, park end) added to find the step. |
| 2026-10-18 21:05:57, Y:, exit to main menu from a Franchise park, **PZ2QoL 3.0.1 debug** (dump `6d5c0b58…`) | Access violation on the **Main** thread in `exhibits:GetAllAnimalIDs` (`luaapi_perworld`) from `Kin:Scan` → `_StartPark`, 0.65 s after `StartScreenHUD.Activate` (world `startscreenglobe`). | **Mod**, fixed offline: exit to the menu never calls `HeatMapManager.Shutdown` (no `x_park_end` in the trace), so the last park tick stayed fresh for `nTickFresh` (1 s) and a JS scan request in that second reached the unloaded park. `Kin:SetStartScreen` (called from the StartScreenHUD Activate/Deactivate wrappers in `pz2qol.hub.lua`) now blocks every park API while the start screen is up. Lua test 10 (start screen up, tick fresh: no scan). |
| 2026-10-18 20:20:37, Y:, Animal Storage, Market desk listing run, **PZ2QoL 3.0.0 debug** (dump `3f4d438e…`) | Access violation (0xc0000005) in PlanetZoo2.exe on fTask W20, the thread running the mod's Lua. **Mod frames on the Lua stack**: `Lister:Advance` → `_Step` → `_QuickGone` → `_QuickState` → `_List` → `GetDataStoreContextAsTable` on the storage list. The run's listings were refused (code 255, request 42) and each refused animal was quick-traded; the crash came at the first look (250 ms) after the **third** quick send (`StorageUIQuickTradeAnimals`), while the game rebuilds the list (the row leaves at ~0.33 s). The first two quick trades read the same window without crashing. | **Mod**, fixed offline: the lister waits `nQuickFirstLook` (1 s) after a quick send before reading the list (also when a run is stopped), and checks `network.loadingItems` before the list. Rule: never read the storage list as a table while a quick trade or release is being applied. Lua test `test_lister.lua` (no read in the second after a send). |
| 2026-10-20 19:41 and 19:51 CEST, a player's PC (Nexus comment 177936207), Franchise, 22 habitats / ~340 animals, Auto mode on for every species, **PZ2QoL 3.2.0** (dumps not received) | Native access violation (read) at `PlanetZoo2.exe+0x22E61C`, a few minutes after loading a park, twice. Lua stack (matches v3.2.0 source line for line): `ModeHelper.lua(483)` → `AnimalStorageHubMode.Advance` hook (`pz2qol.lister.lua:3319`) → `_ProbeTick` → `_List` (3211) → `GetDataStoreContextAsTable` (377). Same log: `Kin action failed - Contraception could not be changed: bad animal id x01a1583f-…` and server `code 5`. The player says turning Auto mode off everywhere stopped it; a second player (comment 177968520) reports Auto mode crashing in Franchise with no details. | **Mod, fixed offline (2026-10-21, after 3.2.0).** Same class as the 10-18 crash: the Phase 0b quick-trade/release probe (`_ProbeQuick` / `_ProbeTick`, log only) reads the storage list as a table every 0.25 s for 60 s right after the game's `OnQuickTradeAnimals` / `OnReleaseAnimalsToWild`, with none of the `nQuickFirstLook` / `network.loadingItems` guards the engine got. Fix: the probe runs only in debug builds (`Core.bTrace`; it only logs), and even then reads the list neither in the `nQuickFirstLook` second after the handler (or a previous probe) nor while `loadingItems`. Tests: `test_lister.lua` 0b. Auto mode never calls those handlers, so why turning it off helped is **not known**; the contraception error was a separate bug (exhibit UID as a GUID, animals-and-breeding.md). |
| 2026-10-15 21:26:41 and 21:26:57, second PC (dumps `c225fb0e…`, `c8e76e3a…`) | Access violation in `exhibits:GetAllAnimalIDs` from Kin.lua at 6 s, `introsequence`. | **Mod**, fixed (see "per-world API called outside a park" below). |
| 2026-10-14, local, while the hub world was deactivating (21:52, 22:00, 22:14) | 0xFDEAD | Probably the mod's overlay still mapped at shutdown. Fixed by unloading it in `OnPrepareToShutdown`. The unload runs cleanly on exit (2026-10-15); no crash since. |

## PZ2QoL Autosave (2026-10-16, `pz2qol.autosave.lua`, `autosavecore.js`)

- The game's own "autosave now": `api.save.RequestAutosave(api.player.GetGameOwner(), "zooauto")`.
  Retail callers: `editors.animal.releasetowilduimode.lua` and the scenario event
  `EventActionRequestAutosave`. It writes the game's usual rotating slot, and the game's callback
  (`OnAutosaveComplete`) re-arms the next one. **Proven 2026-10-16** (Franchise park, 2.0 debug
  build): 8 requests, each written and answered by the callback about 2 s later, every 2 min
  after the player picked 2 min. Retail Lua does **not** see `-autosaveinterval`
  (`save_arg_none`).
- The mod's clock counts park time only (it ticks from `HeatMapManager.Advance`; a long frame counts
  1 s at most) and **keeps counting across hub trips**. It resets on any zoo save: the game's
  autosave callback, the mod's own request, or a manual save (`api.save.RequestSave` with
  `tInfo.type == GetIdentForSaveID(ID_Zoo)`; profile saves use `ID_Player` and are ignored).
- It only requests while the game has an autosave armed: `SetAutosave`/`SetNewAutosave` mean armed,
  `UnsetAutosave` and the callback mean not armed. It waits 30 s after arming. On a refusal or no
  answer within 90 s it retries after 60 s, and shows each failure reason once per session.
- After its own save it calls `ResetAutosaveTimer`, so the game's 10-minute timer doesn't add an
  extra save right after.
- Setting: off (the game's own behaviour) or 2–60 min, **minimum 2** (clamped in Lua). Default
  5 min. It is kept in Lua for the game session, since the UI can't keep files. Events:
  `PZ2QoL_AutosaveSet(min)`, `PZ2QoL_AutosaveNow()`, `PZ2QoL_AutosaveGet()` →
  `PZ2QoL_AutosaveState(json)`, also pushed every 10 s in the park. Trace: `autosave_*`.

## Saving before a crash (assessed 2026-10-16, not built)

- Native fatals (0xFDEAD, access violations) run no Lua. Only native code (an exception handler)
  could react, and that would mean hooking the game's fatal path. Rule 1 rules that out.
- Game saves are asynchronous: `ParkLoadSaveManager:SaveParkToSaveToken` calls
  `api.save.RequestSave` and then yields until its `oncomplete` fires. It then asks
  `franchise:RequestPlanetHubSave()`. A save started as the game dies can't finish, and a half-made
  save is worse than none. **offline** (decompiled `managers.parkloadsavemanager.lua`, 1.0.4)
- Lua panics pass through PZ2QoL's `coroutine.resume` wrapper first, but `ModeHelper` raises the
  error in the same frame, so there's no time to save. What works instead is to make the failing
  game function fail soft (wrap it by name, as rule 4 says).
- Autosaving more often is the safe option. **offline** (decompiled GameMain
  `managers.parkloadsavemanager.lua`, 1.0.4), untested in game:
  - The launch option `-autosaveinterval <n>` is in **seconds** (the console command
    `SetAutoSaveInterval` prints "Autosave reset to N second intervals"). It goes to
    `api.save.SetAutosave{interval}` and is sent again at every park activation and autosave, so
    nothing overrides it during a session. Without it the engine's default applies (value unknown).
  - There is no autosave frequency setting in the game's menus.
  - All parks share one rotating pool of `zooauto` slots (`GetNumAutosaveSlotsForType`, count
    unknown; oldest overwritten). A very short interval fills every slot with near-identical recent
    states and pushes out other parks' autosaves. Each autosave also writes the config files.
  - Autosave doesn't call `franchise:RequestPlanetHubSave()`; only a manual save does.
  - Recommended: **300** (5 min). Don't go below 120; use 600 for several parks or a very large zoo.
  - **Seen on the second PC, no launch option (2026-10-16):** the first autosave came about 10 min
    after the park loaded, both times (park 02:31:31 → 02:42:06; 10:03:27 → 10:13:47). So the
    default is probably **600 s**. **But no second autosave followed** in the next 25 and 27 min
    (until the 03:07 and 10:40 crashes), so a plain 10-minute timer doesn't fit. The game Lua has
    nothing that would suspend it then; the cause is in the engine and unknown. Only 3 `zooauto`
    files exist, so the pool probably has 3 slots. Saves are in `Saved Games\Frontier
    Developments\Planet Zoo 2\<steamid>\Saves`; `Save_remote.config.xml` has an empty `<Autosave />`.
  - **The autosave chain** (GameMain `Managers.ParkLoadSaveManager`, **offline**):
    `SelectAppropriateAutosaveSlot` registers `api.save.RegisterAutosaveCallback` →
    `OnAutosaveComplete`, which starts `self.autosaveCoroutine` (resumed in `Advance`) **only if
    none is alive**. That coroutine's `_SelectAppropriateAutosaveSlot` enumerates the autosaves and
    arms the *next* one with `api.save.SetAutosave(oldest token, {interval})` or `SetNewAutosave`.
    It gives up silently on `"Failed to enumerate autosaves!"`, and it can yield while deleting
    surplus slots. If any link fails, no further autosave is armed, which would explain "only the
    first one".
  - **Why autosaves are rare (proven 2026-10-16 11:17–11:35, SaveTrace):** the default timer is
    **600 s** (armed 11:17:03, written 11:27:13, then re-armed straight away, so the chain works).
    But `DarwinWorld.OnDeactivate` calls `ClearAutosaveSlot` (UnsetAutosave) whenever the park
    world deactivates, e.g. on a trip to the hub (Animal Storage, Market). `OnActivate` then calls
    `ResetAutosaveTimer` + `SelectAppropriateAutosaveSlot` on return, so **every hub trip restarts
    the 10 minutes**. Players who go back and forth more often than every 10 minutes get no
    autosaves. The earlier "only the first autosave" sessions had Animal Storage use after the first
    one (02:44, 10:16). A deactivation also writes the `player` save (`RequestSave`), not the zoo.
  - Launch option syntax: `-autosaveinterval 120` (the value follows the flag, like `-loadpark`).
    **Not picked up in game (2026-10-16 11:16, 1.0.5):** set in Steam (`localconfig.vdf`, app
    3219030), yet `save_arm` traced `save_interval -1` (nil). Either retail drops the command line
    or `GetCommandLineArgument` is a dev-only stub. `save_arg_has|none` + `save_arg<n>` (SaveTrace
    Init) show which. Same session, **proven**: `save_slots 3`; on park load the game runs
    `save_clear`, `UnsetAutosave`, then `ResetAutosaveTimer`, `save_arm`, `SetAutosave`; the guard
    patch reached the Move mode (`guard_move_patched`, via the ModeHelper sweep).
  - Debug builds trace the chain (`PZ2QoL.SaveTrace`, does nothing in release): `save_arm` +
    `save_interval<n>`, `save_cb` / `save_cb_error` / `save_cb_busy` (callback while the old
    coroutine is alive), `save_select_begin` / `save_select_end`, `save_api_set` / `_setnew` /
    `_unset` / `_reset` / `_request` (manual save), `save_slots<n>`, `save_enum_failed`,
    `save_clear`. Healthy cycle: `save_cb`, `save_select_begin`, `save_slots`, `save_api_set`,
    `save_select_end`, then `save_cb` again one interval later.

## Earlier lessons

- A freeze at boot came from destroying the probe view inside a UI ready callback. Do view work on
  the startup coroutine.
- If the browser harness passes but the game shows unstyled UI, check for missing `display:flex`.

## Crash: per-world API called outside a park (2026-10-15, 1.3.0 test build)

- Access violation (0xc0000005, Main thread, 6 s in, world `introsequence`) in
  `exhibits:GetAllAnimalIDs` called from Kin's scan on the start screen. `api.world.GetWorldAPIs()`
  hands back APIs there, `habitat:GetHabitats()` even answers, but other per-world calls crash
  **natively**, which `pcall` cannot catch. **proven** (crash dump `c8e76e3a…`, trace ended at
  `kin_attached`).
- Exit to the main menu does **not** shut the park's `HeatMapManager` down (proven, Y: 2026-10-18), so a
  fresh tick alone is not enough: Kin also stops at `StartScreenHUD.Activate` (`Kin:SetStartScreen`).
- Rule: only call park APIs while a park is really running. PZ2QoL Kin uses the world APIs of the
  park-only `HeatMapManager` instance (its `tWorldAPIs`) and only if its `Advance` ticked within
  the last second; otherwise it answers `nopark` and touches nothing.

- **Boot crash in a feature Init** (1.0.5, Y:, 2026-10-19 15:06): the first `PZ2QoL.BoxTrace` Init iterated `pairs(api.messaging)` and then `RegisterGlobalReceiver` for native-only message types (NavAgentConnectedRegionChanged, WaterVolumeUpdate, ...). The game died with no `init_ok`/`init_fail` line and no dump, so `pcall` did not help. A second build registered only AnimalBoxed/AnimalUnboxed/HabitatBoundaryUpdated receivers, from the first `HeatMapManager.Advance` tick (a worker thread, tid differs from boot). It crashed at park load right after `boxtrace_receivers_begin` (**proven**). So `api.messaging.RegisterGlobalReceiver` outside boot is fatal, at least off the main thread. Only `PZ2QoL.Errors`' DatabaseError receiver at boot is proven safe. Don't add receivers; poll instead, and don't enumerate `api.*` tables.
- **Access violation from an animal read on a gone animal** (**proven** from the dump, 1.0.5, Y: 2026-10-19 15:24, fTask W5, `PlanetZoo2.exe+0x45dc0f`, mod info `BoxTrace.lua _Scan`): `animals:IsAnimalBoxed(e)` on an entity id that no habitat lists any more (sold, moved, died) crashed the game, and `pcall` doesn't help. Only call `api.animals` reads on ids freshly listed by `habitat:GetAnimalsInHabitat` (or another live list) in the same tick, and never on ids kept from earlier ticks. The dump's mod-info Lua stack (`crashsum.py`) names the mod file and line.

## Script profiler (2026-10-19)

- **Debug builds only** (from 3.2.1): `Core.Boot` skips `PZ2QoL.Profiler` unless `Core.bTrace`, and the JS hides the dock button and ignores Ctrl+Shift+P unless `isLogEnabled()` (`hudlauncher.js`, `profiler.js`). Its JS `engine.on` hooks still install (they only time while it runs).

In-game frame-time breakdown by script (`pz2qol.profiler.lua`, `profiler.js`; details in
`lua-runtime.md` "Per-frame entry points"). Off until the player presses Start; Stop, closing the
panel, or no page ping for 15 s puts every function back.

| Area | Events |
|---|---|
| `prof` (Lua) | `caps` (once per boot: debug, sethook, getinfo, gc, diff), `start` (deep, sampler, window, hooked, frames: the frame signal hooked, overheadUs, timer, timerType), `start_failed` (err), `stop` (frames, wallAvg, luaAvg, unhooked), `stop_no_page`, `unhooked` (name, calls: a function called > 3 000 times a frame), `snapshot` (on, frames, fps, wallAvg, wallMax, luaAvg, luaMax, deep, hooked, unhooked, overheadUs, callsPerFrame, heapKB, envs, note), `groups` (self ms per frame by group), `row` (i, name, grp, self, tot, calls, avg, max, worst: ms per frame, calls per frame, slowest call, worst frame), `sample` (i, fn, pct, n), `event_failed` |
| `prof` (page) | `js_start`, `js_stop`, `js_summary` (wall, fps, lua, js, rest, jsFrames, jsWall), `js_row` (as `row`, the page's JS) |

- Marks: `prof_start`, `prof_stop`, `prof_failed`, `js_prof_open|start|stop|launch|hooks|hooks_failed`.
- **Reading it (agent):** ask the player for **Log snapshot** after a few seconds of play, then
  `grep " LOG " dbg/trace.log | grep " prof "`: the `snapshot` line gives the frame (wallAvg) and the
  Lua share (luaAvg); `row` lines are sorted by self time. A small luaAvg next to a large wallAvg means
  the frame goes to native work (simulation, pathing, rendering, GPU wait), which the profiler can't
  split further; use PresentMon / WPR (`cheats-and-debug.md`).
- Group names: `manager`, `component`, `ui` (`Components.UI.*`, `UI.*`, `Windows.*`), `mode`, `hub`,
  `objective`, `world` (environment phases, world and game scripts), `other`, `mod` (PZ2QoL Lua),
  `js-mod`, `js-game`. Rows "Phase Advance: <Environment>" are all managers of that phase together.
