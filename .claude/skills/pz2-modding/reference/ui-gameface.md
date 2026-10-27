# UI: Coherent Gameface

## Runtime

- Coherent Gameface (cohtml) runs the game UI. It is written in **Preact** with ES modules served
  from `coui://UIGameface/...`. **proven**
- Main views:
  - `Frontend.html`: the hub (Market, Animal Storage, Franchise).
  - `HUD.html`: the in-park HUD, including zoo management. **HUD.html is also active in the hub.**
  **proven**
  - **The Frontend page outlives the switch to the zoo and is drawn over the park** (**proven**,
    D: 2026-10-18): a fixed card the mod added on Animal Storage stayed on screen in the zoo after
    Send to Zoo, and Storage's header still measured as visible, so "hide when Storage is not
    visible" never fired. Mod overlays on the hub page must end themselves (PZ2QoL
    `storagefetch.js`: the curtain closes 8 s after the send at the latest).
  - Pitfall (harness): starting work (`engine.trigger` calls) synchronously from inside an
    `engine.on` handler, even via `setTimeout(fn, 0)` in that handler, lost those triggers in the
    browser harness; driving it from the page's own interval worked. Whether Gameface does the same
    is a **guess**.
- The JS↔native bridge is a global `engine`:
  - `engine.trigger(name, ...args)` sends an event to Lua/native listeners **and** to JS `engine.on`
    handlers;
  - `engine.on(name, fn)` listens.
  - The game also wraps these in `/js/common/core/Engine.js` (`triggerListener`, `addListener`).
  **proven**

## Injecting mod UI

1. Ship copies of the entry pages (`PZ2QoLFrontend.html`, `PZ2QoLHUD.html`). Each loads the game's
   own bundle and then `js/mods/<mod>/main.js`. **proven**
2. Redirect the view in Lua (see `lua-runtime.md`).
3. In `main.js`, install each feature with `step(name, fn)` so one failure doesn't stop the rest.
- Wrapping `engine.trigger` lets the mod intercept UI→game events, e.g. to filter select-all.
  **proven**
- **Game layers sit under fixed mod overlays.** The game renders modals, dropdowns and the hub's
  Zoopedia through `Layer` (`js/common/components/Layer.js`) into one `.LayerCollection` div under
  `<body>` (`position: absolute`, no z-index; `.hideAllLayers` hides it). A mod element with
  `position: fixed` and a z-index paints over all of it. Seen by a player (Nexus, 2026-10-20): the
  storage toolbar covered Animal Storage's species-search suggestions (`InputField` renders them as
  `.InputField_resultsMenu` in a Layer, only while editing with matches) and stayed over the Zoopedia
  opened from storage (a Layer with `.Layer_background.darken`). In the park HUD the Zoopedia is a
  plain `.ZoopediaModule_root` (`.hidden` when closed). PZ2QoL's `stepaside.js` lists these
  (`GAME_DROPDOWNS`, `GAME_WINDOWS`): the storage/market toolbars (`bars.js`), the lister panel and
  the zoo toolbar step aside while one of them covers them, and hide while a game popup is open
  (`ui.js` `isGamePopupOpen`, `.PopupActionsModule_root.show`). **offline** (UI source; harness `kin_storage.mjs`
  section 5)

## CSS rules for Gameface

- **Set `display:flex` explicitly.** Gameface's default differs from browsers, and the game sets
  `display:flex` about 2,300 times. Mod CSS sets it on all its descendants
  (`.PZ2QoL_card *` etc.). **proven**
- Not supported or avoided: CSS grid, `backdrop-filter`, `conic-gradient`. Box-shadow, transforms,
  transitions, keyframe animations and `filter` on icons all work. **proven**
- Size with `rem`, like the game does.
- The browser harness's compat CSS leaves mod elements as `block`, so a missing `display:flex`
  shows up in tests.

## DataStore and lists

- `/js/common/core/DataStore.js`: `getValue(ctx, key)` and `setValue(ctx, key, v)`. A context is
  an array path, e.g. `['hubAnimalsData','animalStorageData','list']`. **proven**
- `DataStoreCollection(ctx)` (`/js/common/data/DataStoreCollection.js`) backs lists:
  - `.source` is the array of item contexts;
  - `._source` holds the raw contexts;
  - `.dispose()` releases it.
- **Filtering a game list:** patch `DataStoreCollection.prototype.source`'s getter, scoped to one
  list context (PZ2QoL `listfilter.js` registry). Never filter globally. **proven**
- **Rows are recycled** by the game's `Repeater`. Never restyle or attach state to row roots. Put
  badges inside an inner element (`.MarketAnimalListItem_listRoot`) and refresh them after updates.
  **proven**
- **Select-all safety:** while a filter hides rows, turn the game's select-all event into "clear,
  then tick each visible row" with the per-item checkbox event. Clear the selection whenever a
  filter changes. **proven**

## Layout facts

- **A scroll box inside a column-direction flex box needs `flex: 1 1 0; min-height: 0` on its
  column**, and the strip around it `min-height: 0; overflow: hidden`. With `flex-shrink: 0` (set
  for a sideways row of columns) the column grows with its cards and spills out instead of
  scrolling. Seen in game (developer, 2026-10-18): the Species board's pinned trade column flipped
  between scrolling and spilling over the footer every few seconds once stored adults were listed;
  the harness (Edge) didn't show it. Fix in `pz2qol_kinboard.css` (`.PZ2QoL_kbCol.pinned`); the in-game
  fix is **offline** until checked.

- **In-park HUD (1.0.4/1.0.5, harness 1920×1080, 1rem = 18px × the UI scale), offline:**
  - Top-left column `.NotificationsModule_buttons` (0,20, 50 wide): Help, Zoopedia, Research,
    Timeline, Objectives, Challenges, Inspector, then the alert buttons. It grows down with alerts
    to about y≈594.
  - Bottom-left tools column `.ToolsBar_root` (`js/project/modules/HUD/Components/ToolsBar.js`,
    0,645, 50×315, `bottom: 6.667rem`, grows upward): Paths, Barriers, Terrain, Foliage, Multi-select
    and Demolish. Its background panel `.ToolsBar_background` is #3C472E with radius 0 10px 10px 0.
    Buttons are 40px round, background #fff2dd, outline 2/2/4px #c7b5a3 at opacity 0.9, 26px icon
    with the brown filter, and pink #FFC5C5 on hover (the `.hover` class, set by the game's JS).
  - The column gets `.hidden` while a management screen is open, in camera or photo mode, with the
    UI hidden, during cinematics and in explorer mode. It is only dimmed when the build browser or
    an info panel is open.
  - Management shortcuts (Zoo management, Staff, Market & Storage) are tabs in the bottom TaskBar
    row, which is centred and sized by its text, so it is a poor anchor.
  - PZ2QoL's launcher (`hudlauncher.js`, `pz2qol_hud.css`) docks above `.ToolsBar_root` in its own
    element under `<body>`, never inside the game's preact column (the game recreates it). It
    hides with the column and drops buttons when the alert column leaves no room.
- The game's icons (`/img/icons/*.svg`) are not in the unpacked UI OVL, so they don't render in
  the harness. Names the game uses: `IconAnimals`, `save`, `Icon_SaveLoad`, `IconTime`.
- `::before` / `::after` in Gameface: unproven. Mod widgets use real elements instead.
- **Measuring an element just un-hidden** (`display: none` removed in the same tick, content
  replaced): the Kin card ran off the right edge in game, flipping left only when it was already
  showing (Nexus report, 2026-10-18). Likely Gameface returns the previous layout (0×0) for it:
  **guess**. Floating cards are placed with `placement.js besideAnchor()`, the CSS width
  (25rem) and a minimum height as floors for the measured size, left of anchors in the right half,
  and placed again after `setTimeout` 0 and 60 ms (`kinui.js place`).

- Management Animals panel root: `.ManagementAnimals_root`. Reserve toolbar space with
  `padding-top`. **proven** in harness.
- The management screen is chosen with `Management_SetManagementIndex(sectionId)`.
  `ManagementSectionID.Animals = 7` (`js/project/data/GameTypes.js`). **offline**
- **`localStorage` is not kept across game restarts** (strong evidence): the game's own UI never
  uses it, and no storage file exists anywhere in the profile or install after using it. Treat it
  as session memory (fine for toolbar collapse state, `PZ2QoL.collapsed.<key>`). Anything the
  player expects to keep goes through the Lua file store: `js/mods/pz2qol/userstore.js`
  (`getUserData`/`updateUserData`, status `loading|file|memory`), Lua `Kin.StoreLoad/StoreSave`
  in `pz2qol.kin.lua` (events `PZ2QoL_StoreLoad` -> `PZ2QoL_StoreData` chunks,
  `PZ2QoL_StoreSave` -> `PZ2QoL_StoreSaved`). Changes made before the file is read are replayed
  on top of it, so updates must be idempotent (set on/off, not toggle).
  The Lua side keeps this data on the device in the game's player save, one entry per zoo,
  Franchise included (see lua-runtime.md "the player save"; the api.debug file calls are retail
  stubs). Status `file` means "kept on this device"; `memory` comes with a reason
  (`userDataReason()`: `wait` (zoo or player profile not known yet; a `PZ2QoL_StoreReset` follows,
  and changes made meanwhile are replayed), `noplayer`, `nopark`, `failed`, `nolua`). The Species
  board shows its "last until you close the game" notice only for reasons other than `wait`.
  Keys in use: `kinAssign` (habitat assignments), `kinRatio` (make-up per species), `kinMute`
  (`{ <species>: true }`, species whose kin alerts are muted in this zoo; `kinmute.js`).
  `PZ2QoL_StoreReset` (Lua to JS) makes the page read the store again when a park starts or ends
  or the zoo's store becomes known. The store is the truth once read: data the page held before
  (another zoo's, the localStorage mirror) is not merged in, only this view's pending changes.

## The game's windows over the mod's widgets

- The mod's widgets live under `<body>` with a z-index, so they paint over the game's tooltips, search menus
  and windows unless they step aside. `stepaside.js` hides a widget (`PZ2QoL_yield`: hidden, clicks pass
  through, its place kept) while one covers it: `GAME_TOOLTIPS`, `GAME_DROPDOWNS` (a search box's suggestions,
  the species filter), `GAME_WINDOWS` (the Zoopedia, a darkened modal Layer). It probes points across the
  widget, so a window elsewhere on screen leaves it alone. Only elements that exist while they show: the HUD
  keeps full-screen tooltip frames on the page, and matching those would hide a widget for good.

## Localisation (species names)

- `/js/common/core/Localisation.js`: `translate(str)` wants a **bracketed** symbol
  (`'[Animal_Warthog_Common]'`); `doesTextSymbolExist(id)` takes the id **without** brackets. Both
  call `_impl`, which is set once the engine is ready, so they throw a TypeError before that: wrap
  them in try/catch and retry later. In the detached Coherent player (the harness) an unbracketed
  or unknown key comes back as `!key!`. **offline**
- A species' display name is the symbol `Animal_<id>`, where `<id>` is what Lua `GetSpecies` gives
  and what Kin snapshots carry (`Lion`, `Warthog_Common`); the market schema's `SPECIES_NAMES` are
  `[Animal_Leopard_African]`… and storage rows' `species` is already bracketed. **offline**
  (suggested by a player, salula1986 on Nexus; not yet checked in a non-English game).
- PZ2QoL: `speciesnames.js` `speciesName(raw)` (game name, else the internal name with spaces;
  caches successes only, reports a failure once, silently), pure logic in `speciesnamecore.js`
  (node-tested; node tests can't import game modules). Kin setting `gameSpeciesNames` (default on,
  kept in the player's settings like every Kin setting; switch in the Kin planner's Settings) turns it off
  everywhere: Species board, Kin planner, kin cards, Find a habitat, Market lister and desk.
  Sorts, matching (`lister.js` `speciesUid`) and `data-species` keep the ids.
- The harness has no loc files (`.locxml` 404, dictionary empty), so names fall back to the ids;
  `_setSpeciesLocaliserForTests({ exists, translate })` plugs in a fake (`kin_speciesnames.mjs`).
- **Reading the text outside the game** (**proven** 2026-10-19, 1.0.5): `ovl_tool_cmd.py extract
  Content0\Localised\English\UnitedStates\Loc.ovl -o <dir>` writes one UTF-8 `.txt` per key, file name =
  the key in lower case (42,962 files). Species: `animal_<id>.txt` (+ `_plural`),
  `zoopedia_scientificname_<id>`, `zoopedia_description_<id>`, `zoopedia_funfacts_<id>_1..5`; groups
  `zoopedia_cohabitation_<group>` (some groups have none); `terraintag_<tag>`, `biome_<name>`,
  `continent_<name>`.

## Preact runtime: hooking game components (used by Kin)

- The game ships its **own fork of Preact 8**, not Preact 10 (`/js/common/lib/preact.js`, import by URL):
  VNodes are `{nodeName, attributes, children, key}`; no hooks, no Fragment; `options.afterUpdate`
  fires on updates only, never on mount. **offline**
- Event props go through a fixed table (`onClick`, `onMouseDown/Up/Over/Out/Enter/Leave/Move`, ...),
  attached with `addEventListener` on the element. **offline**
- A component's `id` prop becomes the DOM `id`. Children get Preact context
  `{dataStoreContext: props.context}`, so anything rendered inside a DataStore row knows its row. **offline**
- **Decorated components** (`DataStoreComponent.decorate`, `Focusable.decorate[Ex]`) wrap an
  anonymous inner class; the wrapper's `render(props)` is `h(Inner, {...props})`, so
  `W.prototype.render.call({props:{},state:{},context:{}}, {}, {}, {}).nodeName` is the inner class.
  Patch the inner class's `prototype.render` once: call the original, then append a mod VNode to a
  known child (`kinhooks.js`: `unwrap`, `patchRender`, `findVNode`, `appendVNode`). The game renders
  the mod's node itself, so it **survives row recycling**. Never push onto a VNode's `children`
  (childless VNodes share one constant array); assign a new array. **proven** in the harness (Kin
  badges on zoo, habitat-panel and Habitats rows).
- **Foreign DOM between Preact-managed siblings is removed** on the parent's next render (raw DOM
  appended after all managed children survives). Prefer VNode injection.
- A mod Preact component that subscribes to the mod's own store and calls `setState` keeps injected
  badges live (`kinhooks.js` `KinSlot`).
- Row hover can change a game row's layout (e.g. the Animals list), which moves an injected badge
  out from under the pointer; a "hide on mouseout" must check the pointer is really outside.
  **proven** in the harness.
- `DS.setValue` / `createContext` **throw in the real game** (they assert the Coherent debug player);
  they only work in the harness. Mod data must come from Lua. **offline**
- `InfoPanelModule` (HUD) shows **one** info panel at a time; its context arrives with
  `InfoPanel_SetContext` (`ctx[2]` = entity) and it opens/closes on `InfoPanel_Show` / `InfoPanel_Hide`.
  **proven** in the harness.
  - Its place (1.0.5 CSS, **offline**): `.InfoPanel_root` is `position: absolute`, flush right,
    `top: 8.3333rem; bottom: 7.2222rem; width: 26.1111rem` (bottom grows with the build browser:
    `browserHeight-N`); top-left radius 0.5556rem; header `InfoPanelTopBar` is a white
    `InfoPanelHeader_*.png` pattern tinted with `filter: var(--land-tint)` (a `coh-color-matrix`,
    Gameface only: in the Edge harness it stays white).
  - Kinds in `ctx[1]`: a habitat's own panel is `habitatGateInfoPanel` (`ctx[2]` = habitat id, the
    Kin model's habitat key); animal panels name an animal kind (`/animal/i`). **harness**; that a
    click on a habitat's fence opens the gate panel too is a **guess**.
  - Closing it from JS: `engine.trigger('InfoPanel_UI_Close')` (what its close button sends,
    `InfoPanelComms.sendInfoPanelCloseEvent`); Lua then hides it. `isInfoPanelOpen()` in
    `InfoPanelComms.js` tracks Show/Hide. **offline**
  - PZ2QoL's Breeding window (`breedwin.js`) takes this place: opening it sends `InfoPanel_UI_Close`;
    an `InfoPanel_Show` the player caused closes the window; in "Pick in the park" mode it reads the
    clicked habitat (or an animal's habitat) from `InfoPanel_SetContext` and closes the game's
    panel again (every 200 ms tick while it shows, for 2.5 s), all from the page's own timer.
- **Zoopedia species list** (**guess**, not checked in game): DataStore `['Zoopedia','Animals']`
  is a list (`Animal_<id>` keys; `id`, `name`, `isShoal`, `isExhibitAnimal`, `isLocked`,
  `isDlcLocked`, `ZoopediaSchema.js`). The Breeding window reads it as the "every species" list for
  its search; whether Lua fills it before the Zoopedia is first opened is unknown (trace
  `bw_catalogue` / `bw_catalogue_empty`).
- The HUD heat map panel opens on the JS event `ShowHeatmap(categoryIndex, subIndex)` (what Lua's
  `HUDUI:ShowHeatmap` sends); `-1, -1` closes it. Indexes are into `categories` of
  `js/project/modules/Heatmaps/HeatmapsData.js` (`items[]`); InbreedingRisk is Animals/1.
  Don't send `Heatmaps_Select` alone. **offline**
- `.PZ2QoL_x *` "display:flex" catch-all rules have the same specificity as single-class rules, so a
  later file's catch-all overrides an earlier file's `flex-direction: column`; restate it.
  This also hits blocks one panel renders inside another: Auto mode's panel inside the Species
  board came out as rows (`pz2qol_kinboard.css` loads after `pz2qol_autopilot.css`), so the latter
  prefixes its rules with `.PZ2QoL_kb` (`.PZ2QoL_kb .PZ2QoL_apSection …`).
- The Species board's column heads have a fixed height (`.PZ2QoL_kbColHead`, 9.2rem): a column
  head can't take an extra row without a taller head.
- `kinpanel.js makeScroll(cls)` adds `cls` as given, without the `PZ2QoL_` prefix: the box is
  `.PZ2QoL_kpScroll.<cls>`, so CSS must target that (a `.PZ2QoL_<cls>` rule never matches).

## Scrolling and big mod panels

- **The game UI never scrolls natively.** Its CSS has no `overflow: auto/scroll`. `ScrollPane`
  (`js/common/components/ScrollPane.js`) keeps the content in an `overflow: hidden` box, sets
  `scrollTop`/`scrollLeft` itself, handles `wheel` (sign of `deltaY` × `scrollSpeed` em) and draws its
  own `ScrollBar`. Mod scroll areas do the same: `kinpanel.js` `makeScroll` (wheel, draggable
  thumbs, Shift+wheel sideways), shared by the Kin planner and the Species board. **offline**; works
  in the harness.
- **Big mod panels share one kit** (`kinpanel.js`): scroll areas, buttons, switches, count pills,
  `placePanel` (min(96rem, 92vw) × 84vh, centred) and a registry (`registerPanel`, `panelApi`,
  `closeOtherPanels`) so panels open each other without import cycles and only one is on screen.
  A later stylesheet's `.X *` catch-all overrides the kit's single-class rules (direction,
  `display: none` on scroll thumbs), so `pz2qol_kinboard.css` restates them with two-class selectors.
- **Pointer drag** (Species board): mousedown on the card, then document `mousemove`/`mouseup`, a
  6 px threshold, a `position: fixed; pointer-events: none` ghost, and drop targets found by
  hit-testing the columns' rects (no HTML5 drag and drop, no `elementFromPoint`). Call
  `preventDefault()` on the mousedown and set `user-select: none`: in a browser a text selection
  left by one drag makes the next mousedown start a native text drag, and no more `mousemove`
  arrives. Clear the "this click belongs to the drag" flag in a `setTimeout(0)` after mouseup, since
  no click fires when the drag ends on another element. Hold re-renders while a drag or a menu is
  open. **harness**
- **Frozen table headers** without `position: sticky`: put the column heads and row heads in their own
  `overflow: hidden` strips and copy the body's `scrollLeft`/`scrollTop` to them (the Kin planner's
  relatedness matrix). Also copy on the body's native `scroll` event: a click or focus can scroll an
  `overflow: hidden` box by itself (Playwright's click does). **harness**
- The game's icons (`/img/icons/*.svg`) are not in the unpacked UI, so harness screenshots show them
  blank. Check icon names by grepping the game's JS (`Icon_Close`, `Icon_Heart`, `Icon_Heatmap`,
  `IconSettings`, `Icon_CircleWithArrows`, `IconExhibit` exist). Never let a layout depend on an icon:
  draw small marks (close cross, check mark, chevron, selection ring) with CSS borders.
- Pseudo-elements (`::after`) and inset `box-shadow` are unconfirmed in Gameface; the mod uses real
  child elements with borders for anything that must show. **guess**
- `title` tooltips are probably not drawn by Gameface; put what matters in visible text or an
  expandable row. **guess**

## HUD hub flags and events (1.0.5, **offline**)

- DataStore `['park'].hasBuildingForAnimalStorage` (bound by `HUDModule`; the TaskBar's Market &
  Storage tab is disabled and shows `IconTradeCentre` without it) and `['ui','HUD'].hubDisabled`.
  `HUDModule.canOpenHUB()` also needs the heat map panel not to be open.
- `HUD_OpenHubAnimalMarket` (no args): what the tab sends (after closing the build browser);
  Lua `MainHUD.OnOpenAnimalMarket` opens the hub on the Market. `Zoopedia_FilterMarketToSpecies(sAnimal_X)`
  only stores a pending filter nothing reads in 1.0.5.
- PZ2QoL trade shortcuts (`tradejump.js`) read both flags to grey out their buttons with a visible
  reason, and fall back to `HUD_OpenHubAnimalMarket` when Lua can't reach the MainHUD. The storage
  toolbar's one-species chip sits above the stats (`.PZ2QoL_statsCol`), not among the filter chips:
  one more chip there wrapped the bar to a third row (108 px; harness).

## No WebAssembly, no Web Workers (**proven** 2026-10-18, D:, 1.0.5)

- On the hub page, `typeof WebAssembly` and `typeof Worker` are both missing, so `kinprogdeep.js` logs `ui_caps wasm=false worker=false`.
- `navigator.hardwareConcurrency` is not given.
- So mod JS runs on the UI thread only, and long work must be sliced (as `planProgrammeAsync` is). Multi-core work needs a native helper (`lua-runtime.md`, "Loaders and a native return channel").

- **Settings must not live in localStorage** (**proven**: the developer's Kin settings reset on every restart, 2026-10-18). Keep player-wide settings in `prefs.js` (the player save) and per-zoo data in `userstore.js`. `marketdesk.js` filters, `kinmates.js` sort, `bars.js` collapsed bars and `lister.js` enabled/offset are still session-only.
- **Kin settings are one table** (`kinsettings.js`, pure): each entry holds a setting's key, default and, for a switch in the Kin planner's Settings, its section, sub-section, label, tip, choices (a pick-one row), note and `needs` (the setting it depends on: greyed out and inert while that one is off). `kin.js` takes `DEFAULT_KIN_SETTINGS` from it; `kinplanner.js renderPopover` draws the popover from it in table order (the muted species close the Trade centre section). A new setting is one entry. Pick-one rows carry `data-setting="<key>"` and their items `data-value`, which the harness selects by. An entry with no section has no switch (`enabled`, `allowPlansOnline`).

- **Gamepad buttons on a mod panel** (2026-10-18, **offline**; harness proven): `import { onShouldBlockInput } from '/js/common/core/Input.js'`
  and add a listener `e => ...`: every UI input (`e.inputName` `UI_Select` = A, `UI_Cancel` = B/back; `e.button.isPressed()` /
  `isReleased()`) passes it before the focus system and the game; returning `true` blocks it. The Market desk's quick sheet
  uses it for A = Confirm and to keep the game's own back-out from closing the screen (`marketdesk.js sheetInput`).

## Timing JS on the page (script profiler, 2026-10-19, **offline**; harness proven)

- **Native → JS events don't go through a JS dispatcher in game.** In attached mode `cohtml.js`'s
  `engine.on` registers with the native side (`engine.AddOrRemoveOnHandler`) and the engine calls the
  callback itself; `engine._trigger` only serves the detached player (the harness). So the only way to
  time handlers is to wrap `engine.on` before they are registered, and then `engine.off(name, fn)`
  must be mapped to the wrapper (`profhooks.js` keeps a `WeakMap` fn → name → wrappers), or
  `DataStore.releaseListener` (→ `Engine.removeListener` → `engine.off`) would leave the wrapper behind.
- **The game UI's data binding is DataStore listeners:** `getPropertyListener` /
  `getContextChildrenListener` register `engine.on('DSCallID<n>', callback)` (`DataStore.js`), so
  wrapping `engine.on` early also times the binding callbacks of every component mounted later (one
  row: "DataStore change callbacks"). The C++ side (`GetDataStore` bound object) is invisible.
- **Preact re-renders can't be hooked from outside:** the game's Preact 8 fork defers `rerender` with
  `Promise.resolve().then` inside the module (`/js/common/lib/preact.js`), and ES module bindings are
  read-only. Their cost only shows as the page frame interval.
- `window.setTimeout` / `setInterval` / `requestAnimationFrame` can be replaced (callers look them up at
  call time). PZ2QoL wraps intervals always and timeouts/animation frames only while profiling.
- Callback labels come from `new Error().stack` at registration (V8 format in the harness: `at fn
  (url:line:col)`); whether Gameface gives a stack there is a **guess** (falls back to the function's
  name). Harness rAF ran at ~160 fps (headless Edge), so JS rows age out of a 120-frame window in under
  a second there.
- PZ2QoL's profiler panel (`profiler.js`, `pz2qol_profiler.css`, `.PZ2QoL_pf`): a fixed panel on the
  right (54rem, top 5.5rem, bottom 8rem) so the park stays visible; opened from the park dock's fourth
  button (`IconTime`, dropped first when the dock has no room) or Ctrl+Shift+P on any mod page.
