# Testing

Run all of these before installing a build.

| Test | Command | Covers |
|---|---|---|
| Unit (JS logic) | `node --test tests/scores.test.mjs tests/pricing.test.mjs tests/zoo.test.mjs` | Gene and breeder scores, storage and zoo filters, pricing |
| Unit (habitat planner) | `node --test tests/habplanner.test.mjs` | Mixed Habitat Planner rules (`apps/habitat-planner/public/core.js`), synthetic species |
| Lua behaviour | `<cobra-tools>/modules/formats/utils/luadec/lua.exe tests/lua/test_pz2qol.lua mods/PZ2QoL/Main/` (and `tests/lua/test_storagesend.lua`, `tests/lua/test_lister.lua`, `tests/lua/test_boxtrace.lua`, `tests/lua/test_boxrelease.lua`: stuck-aquarium release and `GameClock` on a mock calendar at 1x/5x/paused) | Require hook, view redirects (FrontEnd, HUD), error receiver, overlay unload order, ModeHelper sweep and the Move-screen guard (section 13), autosave breadcrumbs (section 14), the player store of habitat assignments (end of section 11: offline/Franchise zoo keys, wait/noplayer, chunks, 64 KB cap, debounced save, old park-save import; section 16: probe cleanup; mocks the game's MainPlayer GetData/SetData), Auto mode's gate `PZ2QoL_AutoGate` (section 17, in a function because the main chunk is at Lua's 200-local limit and a `do` block's locals still count), against a mock `api` |
| Script profiler | `node --test tests/profiler.test.mjs`; `lua.exe tests/lua/test_profiler.lua mods/PZ2QoL/Main/`; harness `kin_profiler.mjs` | JS: rolling-window maths, merge/sort/filter, format, frame summary, strip, stack labels, `engine.on/off` wrapping (`profhooks.js`, no game imports so node can load it). Lua: `ProfCore` per-frame maths and window roll, JSON; the profiler against a mock game (cached phase lists emptied and rebuilt, manager/component/PZ2QoL rows, self time, error pass-through and depth repair, hot unhook, late managers, snapshot log lines, reset, page-ping stop, restore on Stop, Deep, no-timer start refused, sampler via `debug.sethook`). Harness: panel opens from the dock, Start options, tiles/strip/table from a fake report, sort, group filter, sampler tab, snapshot, compact, close stops |
| Lua syntax | `luac.exe -p <file>` (same folder) | Syntax only |
| Module load | `cd tests/uiharness && node probe_imports.mjs` | Every UI module imports in a real browser (`node --check` misses errors in these ES modules) |
| Browser harness | `node tests/uiharness/run.mjs [--no-vanilla] [--jobs N]` | See below |
| Page modules | `cd tests/page && npm install && npm test` (PZ2_LUA: the luadec `lua.exe`, runs the `tests/page/*.lua`; PZ2H_GAME: the unpacked game UI, checks the imports against it; each is skipped while unset) | The pages' modules in Node with a fake game (`pageloader.js`, `fakepage.js`, `tests/page/stubs`): Auto mode runs, the breeding rules on random zoos (`rules.test.js`, fast-check), the board, the Breeding window, the lister, storage, alerts |

## Fast vs full runs (2026-10-18)

- **Unit, all files:** `node --test tests/*.test.mjs` (325 tests, ~29 s; was ~120-155 s). Node runs the
  files in parallel, so the slowest file sets the time. The default run of
  `kinprogrammedeep.test.mjs` uses smaller zoos and fewer seeds (20-animal zoos, seeds 3/6/9/12 for
  the never-below sweep, only the 20-animal benchmark optimum, starts 2 where a test only checks
  behaviour); same tests and asserts. **Full:** `PZ2_LONG_TESTS=1 node --test tests/*.test.mjs`
  (~90 s on an idle PC, ~150 s beside a harness run: all 10 seeds, the 40-animal zoos, the 40-animal 1:3 proven optimum, seed 4 since 2026-10-19). A change to the optimiser's objective
  invalidates the proven optima in `kinprogrammedeep.test.mjs`: prove them again (HiGHS MILP,
  `docs/RESEARCH-breeding-optimisation.md` §4), don't paste in what Deep finds. Run the full set
  after changing the optimiser (`kinprogramme.js`). PowerShell: `$env:PZ2_LONG_TESTS='1'; node --test …`.
  The next-slowest files (`prefs`, `userstore`, `kinprogramme`, ~13 s each) wait on real debounce
  timers; they run beside the deep file and don't add to the total.
- **Harness:** `run.mjs` runs the kin/desk scenarios in **4 lanes** by default (`--jobs N`, or
  `PZ2H_JOBS`). Scenarios with the same file-name prefix (`desk_*`, `board*`, `programme*`, …) form a
  group that runs in file order on its own **fresh** HUD/Frontend pages, exactly as `--only <prefix>`
  would; the built-in Frontend scenarios (vanilla, market, lister) run beside the lanes. Groups go
  longest first by the timings in the last `report.json` under `--out` (a fixed heavy-first list when
  there is none). Full run ~154 s (was ~614 s sequential), `--kin-only` ~151 s (was ~430 s).
  `--jobs 1` is the old order: all HUD parts on one shared page, then all Frontend parts on one page.
  6 lanes made `kin_board` / `kin_board_crowded` flaky (wheel scroll, "not on screen").
- The report ends with `=== timings ===` per step (also `timings` and `lanes` in `report.json`).
- Harness speed hooks in the lister scenario (only where the run checks outcomes, not gaps): after
  the batch (which still checks the 3 s default pace and the wait while the game is busy) the
  "fatal" runs use pace 1 s and a 2 s fake busy (`__fake.failBusyMs`); after the big-selection
  height check the remaining runs use pace 1 s (`pace.js setPace`), so the later lister screenshots
  show the "faster than default" pace warning; 3 s is restored at the end.
- Pitfall: scenarios export their own `name` (`'market desk'`), so group by the file name
  (`mod.file`), not `mod.name`. A scenario that passes alone but fails in a lane shared with other
  groups relies on a fresh page (seen: `kin_hud` hover, `desk_market_log` with no log lines). The
  reverse: `kin_storagesend` (HUD) times out in `waitForFunction` with `--jobs 1` (after the other
  HUD scenarios on the shared page) but passes in a lane. `kin_mates` fails either way (dummy data).
- Critical path now: the built-in lister scenario (~125 s: the 7-listing batch at 3 s pace is ~34 s)
  and the `storagefetch` group (~90 s of real countdowns).

- Player-wide settings (2026-10-18): `node --test tests/prefs.test.mjs` (`prefs.js` against a fake
  engine: read on first use and once per page, empty store, 400 ms debounce with one save per burst,
  ASCII escapes, changes and removals made before the read replayed on top, `onPrefs` order and
  unsubscribe, noplayer, the 6 s timeout via `t.mock.timers` and a late answer, `PZ2QoL_Hello`
  retry, a refused save, the localStorage mirror, no `engine`). Lua: `test_pz2qol.lua` section 11
  prefs do-block (round trip, 4 000 cap, bad text, broken entry/root, Assign trim/removal and
  Cleanup leave Prefs intact, the Kin `PZ2QoL_PrefsLoad/PrefsSave` answers, no store, failing
  player calls). `userstore.test.mjs` covers the shared `storecore.js` through `userstore.js`.

## Browser harness (`tests/uiharness/run.mjs`)

- Serves the **real unpacked game UI** plus the mod files (`server.mjs`) and runs them in Edge via
  playwright-core.
- Its page shims fake `engine` and seed DataStore dummy data. Compat CSS approximates Gameface.
- Scenarios:
  - Frontend: market and storage toolbars, badges, collapse.
  - Lister, against a fake native layer:
    - off by default;
    - price equals the shown recommendation;
    - 12 h duration;
    - sole selection while listing;
    - a skip on the 3rd animal and a fatal stop;
    - a 9-animal run that must finish (to catch the "stalls at the 6th" report);
    - a big selection stays compact.
  - HUD: opens management Animals (`Management_SetManagementIndex`, 7), then checks the habitat
    picker, that select-all only ticks visible rows, Clear, and toolbar height.
- Screenshots go to the scratchpad `harness/out`. **Look at them**: layout bugs pass the
  assertions surprisingly often.
- Scenario helpers: `dock.mjs` `dockButton(page, label)` finds a launcher button by its label (a
  button added to the dock moves none of the others); `kin_fixture.mjs` `settleStoredAsks(page,
  species)` waits out a storage ask another module sent before a scenario's fake Lua side
  answers (a Franchise snapshot lets the Market's fresh-blood check ask at once), then empties
  the stored cache.
- It prints `OK` or `FAIL` with `HARNESS ERRORS`.
- **Pitfall:** the harness runs detached, so `Engine.isCoherentPlayer()` is **true**. The game's
  debug-player-only listeners, such as `SetAnimalMarketScreen`, work here but **not in game**.
  Never let mod code depend on them, only harness navigation.
- The lister scenario also fakes the Lua side of the background market check
  (`PZ2QoL_MarketPeek` → `PZ2QoL_MarketPeekState` loading/ready → `PZ2QoL_MarketPeekRelease`). It checks
  that the screen stays on storage, that 3 prices are recorded, and the −10% price offset.
- Fertile adults (lister scenario): the fake storage normalises generated `maturity` 6 to 2 (the
  generator picks any `EAnimalMaturity`, and the lister skips 6 on purpose); a separate run of 2
  with one elderly infertile animal must send 1 and report "1 elderly and no longer fertile"; the
  Adults chip clicked twice (Fertile adults) must show only maturity 1-3 and keep the bar ≤ 90 px;
  a third click (Juveniles) shows only maturity 0, a fourth turns it off.
- Sellable (lister scenario): the Sellable chip must show exactly the rows with no blocker
  (maturity not 0/4-6, not pregnant, not listed, not moving), Not sellable exactly the rest, and
  the bar stays ≤ 90 px (two rows: Juveniles lives in the Adults cycle to make room). Unit tests:
  `tests/storagefilters.test.mjs`.
- Medals in the lister scenario: the target storage row is pinned to `ratings: 'silver'`, adult
  (`window.__fake.pinned`, re-applied on selection because the debug panel randomises rows), and
  the seeded listings carry `medal`; it checks the Silver pill, a "N Silver adult …" reason and the
  By medal chips. Peek pages set `ratings` gold/silver/bronze per row.
- Medal extrapolation (no listings of the animal's medal, guessed or learned
  ratios, min/max caps, confidence caps; appeal never changes the price) are covered by
  `tests/pricing.test.mjs` only; the harness target always has 3+ same-medal listings.

## In game

- Use a `--debug-trace` build and check `dbg/trace.log` (see `debugging.md`).
- The second PC runs the game from the shared `Y:` drive, so check it the same way there.

## Kin tests

- `node --test tests/kin.test.mjs`: the kin engine (relations, kinship coefficients, the game's own
  inbreeding rule, severities, offspring gene prediction, alerts diff, clusters, a big-zoo timing).
- `tests/lua/test_pz2qol.lua` section 10: the Lua collector against a mocked park (habitats,
  lineage, absent ancestors, exhibits, chunking, frame hook, actions, hub storage).
- Harness: every `tests/uiharness/kin_*.mjs` (except `kin_fixture.mjs`) exports
  `{ hud?(page, ctx), frontend?(page, ctx) }` and is run after the built-in scenarios.
  `kin_fixture.mjs` plants related families on the dummy zoo rows and applies a snapshot.
- `run.mjs --kin-only` skips the non-Kin scenarios; `--out <dir>` keeps parallel runs from
  overwriting each other's `report.json` and screenshots. Scenario facts are kept even when a
  scenario throws (`ctx.facts`).
- `node --test tests/kinbonds.test.mjs`: pair bonds ("Bonded elsewhere"). It covers:
  - every case of the hold rule;
  - a golden check that no bond data, the switch off, or `bondsOk: false` give exactly the old
    model;
  - board simulation (a moved mate gives a new risk, and fixes never break a bond);
  - the alerts ("Bond ended", none on a failed pass or a switch change);
  - the zoo-list filters.

  The Lua side is in `test_pz2qol.lua` section 10 ("pair bonds", in a `do … end` block: the
  main chunk is at Lua's 200-local limit). The harness scenario `kin_bonds.mjs` checks the
  matrix, the pair card, the legend and the switch, then restores the fixture.
- Pitfall (2026-10-16): `kin_mates.mjs` reads `keys.mothers[4]`, but the dummy Compare Mates data
  can have only 4 mother rows, so it fails with "reading 'key'" whatever the mod code does.
  With only 3 (seen 2026-10-18) the HUD part times out in `boundingBox` and the Frontend part
  reports "hub Lulu: undefined, want Cousin"; same cause.
- Kin speed (2026-10-18, Nexus "UI lags"): `kin.test.mjs` "speed:" tests prove a reused
  `Pedigree` (`buildKinModel(raw, { ped })`, caches taken over when the parentage string is equal)
  and one male-first `relation()` per pair give exactly the old pairs (a 100-flamingo,
  6-generation flock; Node: ~8 ms cold); `kinboard.test.mjs` the same for `simulatePlan` and
  `boardColumns({ after })`; `kinplanner.test.mjs` `matrixSig` (the planner keeps its matrix DOM
  while the signature is unchanged); Lua section 10 age rounding + `same`.
- `node --test tests/kinplanner.test.mjs`: the Kin planner's pure helpers (`kinplannercore.js`:
  sidebar order, overview groups, matrix squares, mate sections, open options and selection repair).
- `kin_planner.mjs` (harness): overview, matrix, a risk square, the mate list, one-click actions
  (exactly one event per click), Locate/heat map shrinking, settings, open options, empty states,
  Esc. Its layout check clips every element by its `overflow: hidden` ancestors and requires the
  result inside 1920×1080, no overlap between header items or columns, no text wider than its
  button, and matrix headers aligned with the squares.
- Pitfall: Playwright's `click()` scrolls `overflow: hidden` ancestors to bring the target into view.
  Synced header strips must follow the native `scroll` event, or they drift.
- `kin_board.mjs` (harness): the Species board. It extends the fixture (a second lion habitat, an
  empty suitable one, an unsuitable one, the trade centre, a lion in transit, a shared species,
  `mode`, `lt`) and fakes Lua in the page: `PZ2QoL_KinDestinations` → `…Result`, and
  `PZ2QoL_KinMove` → `…Result`, then a snapshot with the animal `moving` (one id is refused).
  It checks rail order, columns, hover relatives, drag-to-plan with its effect, a refused drop,
  select + "Move N here", Suggest fixes (0 risks left), the Franchise block and its switch, a run
  that sends one move at a time ≥1.5 s apart, in order, and stops at the refusal, Move now from a
  card menu, layout (including content spilling out of visible-overflow boxes), and Esc.
- Pitfall: `page.waitForFunction(async () => …)` returns a Promise, which counts as true at once.
  Use a synchronous predicate (expose the module on `window` first).
- Pitfall: the planner and the board share kit classes (`.PZ2QoL_kpMainTitle`…) and a closed panel
  stays in the DOM, so scope selectors to the panel root (`.PZ2QoL_kp …`, `.PZ2QoL_kb …`).
- `probe_imports.mjs` imports every file in `js/mods/pz2qol/` and fails on any error.
- In the detached harness the info panel is laid out partly off-screen; check info-panel
  injections through the DOM, not only screenshots.
- Pitfall: fake Lua handlers (`engine.on('PZ2QoL_KinDestinations', …)`) registered by one scenario stay on
  the shared HUD page, and `kinmoves.js` takes the first answer. Gate fakes with an `active` flag
  and switch it off at the end, or reset `engine.events[name] = []` before installing your own
  (`kin_programme.mjs`). `kin_programme.mjs` checks the breeding programme: preview numbers
  (related pairs → 0), the moves slider (3/4/5/7 moves), Use this plan, Execute, the no-answer
  warning. Since 2026-10-17 the optimiser runs in slices (`planProgrammeAsync`): wait for
  `.PZ2QoL_kbProg:not(.busy) .PZ2QoL_kbStats` after every click; it also checks the **Make-up**
  arrows (auto 1:* → 1:1 → auto, the `kinRatio` player-store entry set and removed, the same moves
  back on auto) and the per-habitat `Make-up N ♂ N ♀` lines.
- `node --test tests/kinprogramme.test.mjs`: the optimiser. Besides the scenarios (harem, 1:3 fill
  from the trade centre and from surplus, extra males, a new group from the trade centre) it checks
  `maxWeightPairs` against brute force (300 random matrices), the exhaustive answer against every
  layout scored from scratch with `scoreLayout`, the search alone (`exactLimit: 0`) against the
  exhaustive optimum on 160 random small zoos, determinism, and `planProgrammeAsync` (same plan,
  progress, cancel). ~7 s.
- The Market lister is on by default in game since 2026-10-16. Its panel covers the storage list,
  so `run.mjs` starts every page with the lister off in the player's prefs (`listerOff`: `listerEnabled:
  false` in the prefs mirror `PZ2QoL.prefs.v1`, read while no Lua answers) and the lister scenario turns it
  on. Without that, the market, kin storage, mates, storagesend and HUD
  scenarios time out.
- `kin_launcher.mjs` (harness): the park launcher above `.ToolsBar_root` (placed and aligned, clear
  of the alert column, autosave badge, autosave card sends `PZ2QoL_AutosaveSet` and
  `PZ2QoL_AutosaveNow`, Esc closes it, one click opens the Species board and a second closes it,
  hidden with the tools column). It closes management first (`Management_SetManagementIndex(0)`,
  None). Three buttons since the Breeding window (Autosave, Species board, Breeding programme).
- `kin_breedwin.mjs` (harness) + `tests/breedwin.test.mjs` (unit, `breedwincore.js`): the Breeding
  window. Reuses `kin_programme.mjs`'s gazelles and Lua fakes (`seedProgramme`, exported). Fakes the
  game's info panel by calling the `InfoPanel_SetContext` listeners directly plus `InfoPanel_Show`,
  and answers `InfoPanel_UI_Close` with `InfoPanel_Hide` as Lua does. Checks: opens on the shown
  gazelle and closes the game's panel, sits in the info panel's place (right 0, 8.33rem top,
  26.11rem wide, 7.22rem bottom), habitats lists, pick by habitat panel / animal panel / guest
  (refused), Esc stops picking, ×, Programme numbers and Run (one move at a time, owner `window`),
  Auto tab (no board Close button, nothing spills), species picker and search, and that a game
  info panel closes the window. More options: every section, no choice spills, a tuning is kept
  in prefs `progTune` and counted on the toggle, Deep with its presets and 5 custom steppers, the
  deep line on the plan, Reset. `tests/kinprogtune.test.mjs`: the tuning table, normalize/apply,
  the cache key, Auto mode's options.
- `tests/autosave.test.mjs`: autosave summary and countdown helpers. Lua test sections 13–15:
  ModeHelper sweep and the Move guard, SaveTrace, Autosave clock.
- `kin_board.mjs` checks the board's `Pause between moves` slider and that a refused move is
  skipped while the run carries on; the lister scenario in `run.mjs` checks the
  `Pause between listings` slider, and that "fatal" and unnamed server errors skip the animal.
- Market desk (2026-10-17): `node --test tests/listercore.test.mjs` (blocks, filters, counts, the
  engine's job text, result tallies, retry list); Lua `tests/lua/test_lister.lua` (the listing
  engine against a mocked `api.planetHub`, DataStore and franchise); harness `desk_market.mjs`
  (frontend: a fake Lua engine in the page; the desk from the price panel's button (or the panel registry when the lister is off), GUID-keyed rows, the
  job text, progress, a refusal and Retry, Stop, the fallback pill, no `AnimalStorage_AddToMarket`
  while the engine answers). `run.mjs` loads `desk_*.mjs` like `kin_*.mjs`, and `--only <part of
  the name>` (with `--kin-only`) runs just those scenarios. The name is the file name without
  `kin_` and `.mjs` (`--only board` runs kin_board and kin_board_crowded); a name that matches
  nothing runs nothing and still prints OK. The Species board keeps its sideways scroll between
  scenarios: one that scrolls the strip must scroll it back (kin_board 8b). Harness pitfall: storage row keys come
  from a `DataStoreCollection` (`_source`), not `Object.keys(DS.getValue(list))`.
- Desk on scoped storage (2026-10-18): `desk_market.mjs` step 7 fakes the game's species filter
  the way the native does it (the other species' rows leave the list: `DS.copyContext` to a
  side context + `DS.deleteContext`, `filters.filteredSpecies` set, `animalsInStorage` the whole
  count) and a fake `PZ2QoL_DeskFilters` that puts them back. It checks the rail lists every
  species, starts on (and scrolls to) the scoped one, one clear and one restore, the note when Lua
  does not answer, and that the mod's own `species` filter clears nothing. `test_lister.lua` has
  the Lua side; `listercore.test.mjs` `storageScope` / `nativeFiltersOn`. Pitfall: a new
  `DataStoreCollection`'s `_source` is empty until a tick later; for a count use
  `DS.__getChildrenOfContext(list).length`.
- Desk Quick trade and Check storage (2026-10-18, `docs/PLAN-desk-quick-release.md` Phases 0-1):
  `listercore.test.mjs` (`categoryOf` incl. rehome → blocked, the rows' blocks and segment counts,
  quick never sellable or ticked or in a job, the value texts, the page report v2 round trip with
  `|`, `,`, `%`, UTF-8 and a long nested loc token, v1 still decoded, the check job / estimate /
  summary); `test_lister.lua` section 20 (v1 and v2 `parseSeen`, `check` mode never calls
  `StorageUIStartAnimalAuction` / the quick natives, verdicts per animal from the page or Lua, the
  150 ms check pace, Stop mid-check, the selection cleared after, offline allowed, a second start
  refused, the send-step guard, Phase 0a's `quick` / `select_net` / `source` / error-type lines, and
  the Phase 0b wrappers: the game's handler gets exactly the same self, table and extra args and its
  results come back, its own error is not swallowed, a failing probe still calls it, errors within
  10 s and the row leaving the list are logged). The mock `StorageMode` now has
  `OnQuickTradeAnimals` / `OnReleaseAnimalsToWild` before the patch is applied, and a page frame
  can send v2 (`tPage.fnText`). Harness `desk_quick.mjs` (runs after `desk_market_log.mjs`, same
  `desk` group): a fake engine answering `check` jobs with verdicts; the button text and estimate,
  the job, Stop, the second job holding only the rest, the rows ("Quick trade · $1,200", "Rehome
  only"), rail/header counts, the five Show segments, Tick all, the v2 report read from the real
  DataStore, Read storage again, an engine without `check`, and that no listing or quick event fires.
  Harness pitfall: the harness `translate` wraps plain text in `!…!`, so translate only loc tokens
  (`[...]`).
- Desk Quick trade / Quick release (Phase 2, 2026-10-18; `test_lister.lua` section 21 L: the game's own pattern after a
  quick trade, the old row still listed with no id for ~1 s, then one row fewer, counted gone, also for release; gone once then
  back is not confirmed): `listercore.test.mjs` (Frontier Zoo pre-classification,
  `quickEligible`, the sheet's go/skip lists, exact vs ≈ totals, the first-run limit, 12 names + "and N more", the frozen
  quick job, run summary, `acceptedMode`, the page id in v2); `test_lister.lua` section 21 (one `{ [1] = key }` per animal
  after the flag and `_Holds`; release's own native and flag; not-allowed / rehome skips; Lua's reads, stale reports or a v1
  page never send and two such animals stop the run; a report older than the send step (a mid-step reload) sends nothing;
  `_IsSelected` false, `_Holds` false, `_Busy` (wait then skip), a changed data print (settle again, new price); the list
  decides incl. a stray database error (wait shortened to 3 s), the 10 s timeout and an ambiguous fingerprint stop; a
  fingerprint-token animal confirmed by its look; a second start refused and the job never grows; Stop after the current
  animal; Hello or a report from another page stops it, the same page's Hello does not; a mod error stops; offline / no native
  refused). The mock's quick natives drop the row 0.33 s later (`quickOutcome` / `quickDelay` / `quickError`). Mutation-checked:
  removing the page-only selection, the fresh-report-at-send, the 2-miss stop or `_Holds` each fails a test. Harness
  `desk_quicktrade.mjs` (after `desk_quick.mjs`): the pre-classified row and note, the red panel and header, only quick rows
  tick, no limit for Quick trade and the first-run limit for Quick release, the sheet, Cancel / Esc / a double click / the
  gamepad's A as it opens send nothing, Confirm is dead while a run is active, Confirm sends the frozen job, the done / stopped / "Stopped: page
  reloaded." cards, Quick release, the mode not remembered. Pitfall: a finished check card from the previous scenario is still
  on screen; wait for the fake engine's own job, not for `.PZ2QoL_mdRun.check.done`. Gamepad in the harness:
  `Input.__simulateButtonInput('UI_Select', pressed, released)` reaches `onShouldBlockInput`.
- Refused listings (2026-10-18): `test_lister.lua` section 22 (job options; refused → quick trade right after, with the pace;
  refused → release with CashSeeded never released (flag and reason); `refusedmax=1`; no quick action after an untradeable
  skip, a timeout or DidNotGetResponse; Leave it; a stay-in-storage stop; not allowed now stays refused; no page id refused);
  `listercore.test.mjs` (the job header, the note, the summary, `refusedGuids`, quick eligibility of market animals); harness
  `desk_refused.mjs` (the option and pref, the up-front note and List label, the job header, the run card, release's
  `refusedmax=1` and acceptance; it fakes the market check itself) and `desk_quicktrade.mjs` ("Quick trade the 2 refused").
- My listings / reprice (2026-10-19, `docs/DESIGN-reprice.md`): `node --test tests/reprice.test.mjs`
  (`repricecore.js`: the clock (ledger / inferred / assumed), own listings never compared, stale /
  not yet stale (time weight) / healthy keep / underpriced / no data / expiring, the 85 % floor of
  the suggestion, the strategies and floor, overrides and the preview, the job texts, the run's
  counts / stranded / summary, the ledger, sort / filter / counts). Lua `test_lister.lua` section 23
  (mode `unlist`: caps, refusals without the native / page id / online, three taken off with a
  Cancel each and no arguments, not listed skipped, no page report never sent, another selection at
  the send, the native doing nothing (timeout, the run goes on), a server error shortening the wait,
  sold meanwhile (`gone`), Stop while waiting, a reshuffled key; the mock Cancel acts on
  `tNative.tSelection[1]`). Harness `desk_reprice.mjs` (fake engine with `unlist` jobs; seeds 4
  listings and 10 comparables; tab badge, verdicts, the working drawer, own price, Tick stale,
  Undercut 5 %, preview totals, the sheet (Esc, Confirm), both jobs in order with the new prices,
  the last-run line, a Stop after the first take-off, List the 1 again, layout). Pitfall: dummy
  storage rows carry a random `colormorphLabel`, which prices them as colour morphs (×2): set it
  to '' on seeded rows.
  Quick trade / release of listings: `reprice.test.mjs` (`quickPreview` over `quickSheet`, the
  first-run limit, a quick run's counts / stranded / summary); Lua section 23 K (a quick job stops
  at a listed animal; after the take-off the same animal is traded); harness `desk_reprice.mjs`
  step 7 (the action switch, the money, the New price column, the red sheet, take-off then quick
  job, a stop leaving one with "Quick trade the 1 again"; the fake listing run sends verdicts with
  quick prices). Screenshots `mrp_7_quick`, `mrp_8_quick_sheet`, `mrp_9_quick_left`.
- "Find a habitat": `node --test tests/storagesend.test.mjs` (`storagesendcore.js`: ranking, skip
  reasons, the one-at-a-time run with fake game and clock: pauses, 8 s after a refusal online, busy
  wait, Stop); Lua `tests/lua/test_storagesend.lua` (same `lua.exe` command; arm/take/disarm/expiry/
  only a Move request from `SelectMode.Advance` taken, Franchise on the click alone, facts JSON, one Kin
  move); harness `kin_storagesend.mjs` (frontend: the button under Send to Zoo, Franchise without a switch,
  arm then exactly one game Send to Zoo; HUD: fake Lua, a 5-animal run, Stop, a Franchise run). The dummy hub data reads as Franchise: set
  `window.__PZ2QOL_TEST_FRANCHISE` explicitly. Localised strings (`stringLiteral`) show raw in the harness.
- `kin_cull.mjs` (harness): Thin out on 5 lemur habitats × 12 animals (polygyny, social max 8). Checks the
  preview counts, that the too-old and extra males leave and the best male stays, that the fill level
  changes the count (Core only > Strict > Lean > Balanced > Full), click-to-toggle keep/leave, a 0%
  fertility gene leaving a habitat with room (and its switch, `[data-opt="zeroFertility"]`), the
  poor-gene levels (`[data-genes]`), the "too old" switch (`[data-opt="oldAlways"]`), and that
  "Send N" plus Execute sends `trade:<id>` moves one at a time. Fixture pitfall: gene strings built
  by rotating one strand give identical strands (0% fertility) for half the animals; the fixture
  varies k loci instead. Unit tests: `tests/kincull.test.mjs`.
- Species names (`speciesnames.js`): `node --test tests/speciesnames.test.mjs` (`speciesnamecore.js`:
  ids, internal names, brackets for translate only, fallbacks for missing/empty/`!x!`/throwing,
  one onFail, switch off never asks, success-only cache). Harness `kin_speciesnames.mjs` (HUD): a
  fake localiser (Löwe, a long Zebra name, a CJK Ostrich name) via
  `_setSpeciesLocaliserForTests`; board title, rail and shared-habitat chip, planner tabs,
  `data-species` still the id, layout with long/CJK names, the planner's switch off gives the
  internal names; restores the game localiser and the setting. `kin_planner.mjs` checks the
  settings switches by label (other features add switches).
- Bring to the trade centre (2026-10-18): `node --test tests/storagefetch.test.mjs`
  (`storagefetchcore.js`: names and the exclude list, `pickRows` skips / adults first / room cap /
  unknown room, `sameKeys`, button reasons and note, `parseCounts` trade-centre fields, arrival
  checks, `runTradeArrivals` with a fake clock: already there costs nothing, pace, refusal and
  online error pause, busy wait, full, Stop, `tradeSummary` leftovers); Lua `tests/lua/test_storagesend.lua`
  section 4 (FetchStart refusals and ok, one hub opening, fresh once, ack, expiry; trade arm taken
  with its target and re-sent on hello, another zoo / Franchise unknown key not taken;
  `trade:arrival` calls AttemptToSendToTradeCentre without CanSend only for this run's ids; the
  Move screen on the next SelectMode tick, once, expiry); harness `kin_storagefetch.mjs` (HUD: the
  board button, count/room note, one FetchStart with the exclude list, board closes, full disabled;
  the trade run card, moves with `trade:arrival` + seq, summary, one SendOpenMove; Frontend: fresh
  countdown then one arm + one send with the ticked keys, moving/listed rows never ticked, a
  not-fresh request waits for Send, a changed selection and Cancel send nothing).
- Bring all (2026-10-19): `tests/storagefetch.test.mjs` "Bring all" (`ALL_SPECIES` `'*'`: every
  species picked, the whole park excluded, room cap, the note); Lua `test_storagesend.lua` 4a (`'*'`
  passes `FetchStart`, a >4000-character exclude list kept); harness `kin_storagefetch.mjs` 1b (the
  outlined button under the species one, `FetchStart('*')` with every park GUID, disabled when full)
  and hub step 6 (`FetchPending('*')`: no species chip, every non-moving, unlisted, not-in-zoo row
  sent once). Harness pitfalls: the dummy zoo GUIDs are words (`excludeList` drops them), and the
  hub's fake tick handler must know every row, not just the scenario's species.
  `kin_hud.mjs` caps the zoo toolbar at 120 px, so new toolbar chips must keep it to two lines.
- Trade shortcuts (2026-10-18): `node --test tests/tradejump.test.mjs` (`tradejumpcore.js`:
  `normSpecies`, block reasons in order, `parseCounts`, `countsText`, `pendingStep`);
  `tests/storagefilters.test.mjs` (the `species` storage filter); Lua `tests/lua/test_tradejump.lua`
  (same `lua.exe` command: market/storage screens and filters, one transition, refusals,
  `nohud` reset, hello/ack/expiry, counts JSON, 40-species cap); harness `kin_tradejump.mjs` (HUD:
  fake Lua, the board's count line and buttons, one TradeOpen per click and the board closing,
  disabled states with a visible reason, a Lua refusal, the `nohud` fallback, the planner's Find a
  mate row; Frontend: the filter handed over on hello, only Lion rows, the chip, one ack, the chip
  clearing it, a repeated filter only re-acked, bar ≤ 90 px). Fake Lua handlers are gated by
  `window.__tj.active` / `window.__tjf.active`.
- Stored adults in Find a mate (2026-10-18): `kin.test.mjs` (`normalizeStored` maturity 4/5/6, stored
  candidates ranked with the zoo, a stored half-sister through the pedigree lands in `game`, no stored
  list = exactly today's candidates); Lua `test_pz2qol.lua` section 11 do-block (mocked
  `api.planetHub.GetAdultsOfSpeciesInStorageSplitByGender` / `GetMarketAnimalCompareMatesData`:
  offline refused, Franchise sexes/parents/genes/anc, chunks, cap, none, throwing, missing); harness
  `kin_stored.mjs` (HUD: fake `PZ2QoL_KinStored` gated by `window.__kst.active`, counts line, storage
  and listed tags, the half-sister in the related section, the "Storage too" switch, one request per
  species, error and offline states, layout; Compare Mates type-2 rows get a Half-sister badge).
- Stored adults on the Species board (2026-10-18): `kinboard.test.mjs` "board columns: stored adults
  in the trade column …" (skips a stored record with an in-park guid or id, other species out,
  counts/risk/animals equal to the run without `stored`, badges risk/covered/none, worst first,
  cache, error/empty → `[]`); harness `kin_board_stored.mjs` (`--only board_stored`; fake
  `PZ2QoL_KinStored` and `PZ2QoL_TradeOpen` gated by `window.__kbs.active`, events reset first):
  1 in-park + 4 stored cards, "1 here · +4 in storage", adults-only note, Sasha's risk badge and
  father lighting up on hover, no drag ghost or plan from a stored card, no select, one ask per
  open (a park scan asks nothing, Rescan asks again), 10 adults → 6 cards + "4 more" and the
  column body scrolls, offline note and no ask, Storage → one TradeOpen and the board closes,
  layout. `--only board` now runs it too.
- Growing-up notices: `node --test tests/kinlife.test.mjs` (`kinlife.js`: levels, growthOf, group
  limit, maturation, future pair, full group, missing data, birth vs arrival, settle, once per animal,
  grew up then pushed out, ageRate); Lua do-block after the stored one (mocked `GetAgeProps`,
  `GetAnimalDeathAge`, `GetAge`, `GetSocialityData`, `HasEnemiesInHabitat`, `GetRejectionReason`,
  enums; and all missing); harness `kin_lifealerts.mjs` (one Needs you toast naming the limit, a
  contracepted cub with room only in `getLifeLog()`, Needs-you-only hides a heads-up, the settings
  controls). `kin_planner.mjs` reads the close-kin thresholds as `.PZ2QoL_kpSegItem:not([data-toast-level])`.
- Pitfall: in Git Bash pass `--out` as a Windows path (`cygpath -w`): the user folder name holds
  quote characters, so MSYS does not convert `/c/Users/...` and node writes to `C:\c\Users\...`.
- Detailed debug log (2026-10-18): `node --test tests/debuglog.test.mjs` (`debuglog.js`: value and
  line format, lead keys, quoting, non-ASCII as `?`, cuts, redacted keys, the 2000-line ring, lines
  held until Lua says on, batches <= 100, the 400/s rate limit and its `log dropped` line, `off` is a
  no-op, never throws on hostile data or a throwing sender, price decisions once per outcome); Lua
  `tests/lua/test_log.lua` (same `lua.exe` command: `Core.FormatLogData`, `Core:LogText` through a
  fake `package.loadlib` standing in for the `lg_*` DLLs, release no-op, missing `lg_end` turns it
  off with `log_channel_missing`, a missing byte DLL drops one character, loadlib raising, the
  checkpoint names); `test_lister.lua` section 18 (one animal end to end by run + guid: job,
  animal, step, resolve, select, price, send, server_error, result; a skip's kind; a NotAllowed with
  code/name/request; an ignored background error; end counts; stop and pace). Harness:
  `run.mjs`'s `openFrontend` turns the log on (`PZ2QoL_LogState 'on'`) and collects `PZ2QoL_Log` in
  `window.__dlog`; the lister scenario checks the market check's `peek` lines and the old path's
  sequence for the sold animal (sell_click → list_request → list_path engine=false → legacy_start →
  animal → select → selected → pricing decision → send → answer → result listed → legacy_end) and the
  batch's refused skip and summary; `desk_market_log.mjs` (runs after `desk_market.mjs`, `--only
  market` runs both) checks the desk's open / rail / rail_counts / prices / filters / ticks / list
  lines, the engine path (caps, job decisions, engine_start/started/state/result, the refusal), one
  GUID followed from its price decision to its listed result, the filter clear/restore asks, the
  line format, and the Ctrl+Shift+L panel (inside the view, header without overlaps, Area filter,
  Close; screenshots `md_log_panel*.png`). The tracer DLL itself was checked once by hand: a 32-bit
  build of `tools/trace/pz2_trace.c` with cobra-tools' 32-bit `lua.exe` (`package.loadlib(...,
  "mark")`, 2000 lines, non-ASCII, empty and 2000-character lines).
- Animals without a usable id (2026-10-18): Lua `test_lister.lua` section 19 (`Lister.IdToken`: float
  ≥ 2^63 → `%.0f` lossy, strings, nil, userdata, table, zero, fractions, a raised call; Resolve with
  a mock whose `aidFn` returns those shapes: lossy and string ids listed, nil/userdata look-alikes
  failed, colliding floats → no id, then a unique fingerprint (`fp<n>`) or nothing; a fingerprint
  listed; a look-alike before selecting and between select and send → `ambiguous`, never sent; list
  reshuffled before the run → found under the new keys, during the settle → `changed`; an id that
  follows the position → not listed; one `resolve_fail` line per shape and no repeat for the same
  answer). The mock's rows now carry `name`, `species`, `gender` per animal (default name "Animal",
  no species: no fingerprints in the older sections). `listercore.test.mjs` "noid: …" (block `noid`
  only for answered failures, not tickable, not in the job, Not sellable, `partialJobText`, summary
  note). Harness `desk_market.mjs` step 4b (the fake engine's `failKeys`: the row blocked "No id from
  the game" with `NOID_TEXT` as title, not ticked by Tick all, List N without it, not asked again
  within 3 s, a ticked one failing at the click → notice "Listing X of Y: 1 couldn't be identified
  by the game", job without both, summary repeats it; screenshots `md_4b_noid`, `md_4c_partial`).
  Pitfall found: a failed key kept its old cached GUID (the next timer read showed it listable
  again): a failure must drop the cache entry. And "Read storage again" during the timer's read was
  lost (`readRows` returned early): a forced read now runs right after.
- Pregnant animals (2026-10-18): `listercore.test.mjs` "pregnant: never sellable, never ticked,
  never in a job, with a reason" (block `pregnant`, Sellable / Not sellable, rail counts, Tick all,
  `encodeJob`, keep-best, `PREGNANT_TEXT`, summary, never retried) and the Keep-tag tick case;
  `storagefilters.test.mjs` (Sellable chip never shows a pregnant row); Lua `test_lister.lua`
  section 5b (the engine skips `pregnant`, never selects or sends her, `lister_skip_pregnant`);
  `kinprogramme.test.mjs` "pregnant: …" (she stays, her father moves instead, exhaustive and
  search, 60 random small zoos incl. slices; never moved over the room) and "contraception: …"
  (no mate / plan brings one / contracepted male / contracepted female, only related mates, a young
  male maturing within the horizon or with unknown maturity, her son, weakest genes vs median
  with margin / too few peers / no gene data, surplus under 1:1 but not a harem, the result's
  `contraception`); `kincull.test.mjs` (never sent, not even by the player's choice);
  `kinboard.test.mjs` (Suggest fixes never picks her; `setMove` `byPlayer`; `planProblems` warning
  vs problem). Harness: `desk_market.mjs` step 1d (one pregnant row: blocked state and title, not
  ticked by Tick all or a click, gone under Show Sellable, there under Not sellable, not in the
  job; screenshot `md_2p_sellable_only`); the lister scenario in `run.mjs` (two selected, one
  pregnant: "Sell 1", 1 sent, "1 pregnant left out", single view Sell disabled with the reason;
  the Sellable chip with a forced pregnant row). The fake storage sets every row `isPregnant`
  false at setup and on each selection (the dummy rows are random; the old path now leaves
  pregnant ones out). `kin_programme_preg.mjs` (`--only programme`; fake Lua gated by
  `window.__kpp.active`): quaggas (a species no fixture uses: the fixture's zebras joined the
  groups), Nia and Penda tagged "pregnant · stays" and never moved, Penda's "no male here" advice,
  one `PZ2QoL_KinContracept` per click and none while waiting, the advice gone after the scan,
  Use this plan without them, `runPlan` skipping a plan's pregnant move and running a `byPlayer` one.
- Auto mode (`docs/DESIGN-autopilot.md` section 16): `node --test tests/engines_equivalence.test.mjs`
  (the board's engines answer as recorded on 40 seeded zoos; golden in
  `tests/fixtures/engines_golden.json`, recorded by `tests/helpers/record_engines_golden.mjs`
  after a deliberate change to what an engine answers: never re-record it to make a failure go
  away), `tests/kinauto.test.mjs` (a run, locks, Thin out first, cooldown, growing up,
  the last breeder, runs settling on 50 seeded zoos, the ledger), `tests/kinauto_runtime.test.mjs`
  (fake engine: nothing on Auto sends nothing, an offline run, the schedule, Franchise waits for
  the click), `tests/kinauto_soak.test.mjs` (50 park years, 3 settings x 3 seeds, about 2 minutes;
  `SOAK_SEEDS=13` runs one zoo, `SOAK_DEBUG=1` prints each zoo's numbers, `SOAK_TRADE` the trade
  centre's places, 40 by default). Seeded zoos: `tests/helpers/zoogen.mjs`.
- `kin_autopilot.mjs` (harness): the board with nothing on Auto (the "Auto mode" button, no Auto
  tags, rail marks or menu items), the panel opened and closed (button, Close, Esc, the other two
  panels), Turn on in a Franchise zoo (`kinAuto` saved, nothing sent), every setting saved and read
  back, hands off from the card menu (tag and panel list), a 1280x720 window, Turn off. Checks on
  each screenshot that the panel fills the middle, its sections are columns, nothing overflows or
  overlaps, and the pause slider stays in view. `kin_launcher.mjs` expects 3 buttons (with the Breeding window).
- The runtime test's fake game leaves timers of the mod's own modules running, so the file ends
  with `after(() => process.exit())`; without it `node --test` never finishes the file.
- Pitfall: the harness seeds `Math.random` for the game's dummy data, so **a mod module that draws
  a random number at load** shifts every dummy name and number after it, and every screenshot
  differs from an older run. Draw lazily.
- Off-mode screenshot comparison (design section 12 step 5): export the old UI with
  `git archive <commit> mods/PZ2QoL/UI`, run `run.mjs --overlay <old>/mods/PZ2QoL/UI/UIGameface
  --kin-only --out A`, and the new UI from a copy of `tests/uiharness` without the new scenarios
  (`--out B`; a new scenario earlier in file order changes the page state for the rest). Then diff
  pixels per file, not hashes. Run-to-run noise that is not the mod: the bottom bar's
  `!COST_NO_SYM` value (and the bar shifting with its width), random dummy texts in hub rows, and
  the game's own popup/backdrop behind mod panels after `kin_mates` fails mid-way (Compare Mates
  left open or not). With the zoo-wide Autopilot off the only mod difference was the third,
  greyed launcher button (2026-10-16; Auto mode adds only the board's Auto button).
- Pitfall: a worktree-isolated Claude session refuses shell commands whose text contains "git"
  anywhere, including the scratchpad path (`C--Github-...`). Keep helper scripts under the
  worktree's ignored `build/` folder and run them by relative path.

- **Git Bash pitfall (2026-10-19):** `node run.mjs --out /c/Users/...` resolves to `C:\c\Users\...`
  (Node's `path.resolve` doesn't know MSYS paths). Pass `--out C:/Users/...`.
- `kin_launcher.mjs` accepts 3 or 4 dock buttons since the profiler button (it is dropped first when
  the alert column leaves no room).
