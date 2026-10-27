# Game data contexts, events and enums (game 1.0.4)

The mod's JS copies are in `mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/game.js`. Check the game's
`js/project/data/Schemas/*Schema.js` for field names; each `Prop` has an id and a sample
`generator_value`.

## DataStore contexts

| Context | Contents |
|---|---|
| `['hubAnimalsData','animalMarketData','list']` | Market listings (paged by the game) |
| `['hubAnimalsData','animalStorageData','list']` | Animal Storage rows (not paged) |
| `['hubAnimalsData','animalStorageData']` → `selectedAnimalIDs` | Current storage selection |
| `['hubAnimalsData','animalStorageData','actions']` | `tradeAllowed`, `tradeDisallowedReason` for the selection |
| `['hubAnimalsData','animalHistoryData','list']` | Trade history |
| `['hubAnimalsData','species']` | Species ids for market filters |
| `['animalTradeListingData']` | Listing limits for the selected animal (below) |
| `['management','animals','animals','list']` | Zoo management Animals tab rows |

Storage list keys (`animal_12`) are **positions, not identities**. When an animal sells, or the
list is re-sorted or rebuilt, the same key can point at another animal. `selectedAnimalIDs` holds
these keys, and `AnimalStorage_AddToMarket` (→ `StorageUIStartAnimalAuction(key, price, hours)`)
lists whatever the key points at **when the game handles it**. Anything that runs over time must
remember animals by row `id` plus a content fingerprint, and look the key up again right before
each event. **proven**: 2026-10-15 Y: trace shows a run skipping "already on the market" rows it
never listed, right after sales. The harness swap test listed an unselected animal under the old
code. PZ2QoL: `findTarget()` in `lister.js`.

Zoo animal rows:
- Genes are at `geneticsTooltip.list.<Size|Longevity|Fertility|Immunity>.value` (0..1).
- `location` is a localisation literal, `[STRING_LITERAL:Value=|Savannah Habitat|]`; parse the
  text between the pipes. **proven** in harness, from game schema.
- Storage and market rows carry `auctionTimerSeconds`. The game's own test for "on the market" is
  **`auctionTimerSeconds > 0`** (`MarketAnimalListItem.isOnMarket`). The schema default is `-1`
  (never listed); `<= 0` with a price means an expired listing. PZ2QoL's `isOnMarket()` in
  `scores.js` uses the same test. **offline**

- **`maturity` on storage, market and history rows is `EAnimalMaturity`** (`ManagementDataTypes.js`):
  0 Infant, 1 Young_Adult, 2 Adult, 3 Elderly, 4 Young_Adult_Infertile (sic `Yound_`), 5 Adult_Infertile,
  6 Elderly_Infertile. So a row tells age stage and fertility in one value; there is no separate
  `isInfertile`/`age` number (market/history rows have an `age` loc string only). The storage info
  panel draws all seven (`MarketUtil.js` -> `getMaturityIconFromEnum`, `Icon_AgeDial_*Infertile`).
  The park's Animals list (Lua) maps "infertile **or** contracepted" to 4/5/6
  (`editors.park.animaldatabasetab.lua` `AgeCategory`); storage rows are filled natively, so whether
  4/5/6 really reach storage rows is **offline** (schema type + UI code), not yet seen in game.
- The Franchise market refuses elderly animals that are no longer fertile (developer report,
  2026-10-16; the server's reason text is unknown). In park, the game's own sell flow lists
  `bInfertileSell` (= `bInfertile`) as a sell preventer (`editors.animal.relocateanimalspopup.lua`
  `g_tSellPreventers`). PZ2QoL: storage "Adults" chip cycles to **Fertile adults** (maturity 1-3,
  `isFertileAdult`, `fertileAdults` filter in `scores.js`); the lister skips maturity 6
  (`isInfertileElderly`, skip kind `elderly`) and never sends it.
- **What blocks a sale** (1.0.5, **offline**). Park sell flow (`editors.animal.relocateanimalspopup.lua`
  `g_tSellPreventers`, read from `animals:GetRelocatePreventers(id)`, final word
  `animals:CanSellAnimal(id)`): `bDead`, `bInVetSurgery`, `bBoxed`, `bJuvenileSell`, `bInfertileSell`,
  `bInjured`, `bInfected`, `bPregnant`, `bEscaped`, `bCantBeSold`, `bPendingTransport`. Tooltips:
  `AnimalDatabaseTab.tButtonProblemTooltips` (`[AnimalList_Problem_<X>]`, `_Juvenile_Sell`,
  `_Infertile_Sell`). `bCashSeeded` (bought for cash) blocks **release to wild**, not selling.
  Storage (hub) has no Lua check: Trade (`AnimalStorageInfoPanel`, Franchise only) is enabled by
  native `actions.tradeAllowed` / `tradeDisallowedReason` for the **selection**; the exe holds the
  same `[AnimalList_Problem_*]` keys plus `[AnimalList_SelectionCannotTrade]`. Storage rows carry
  no reason field; what a row shows: `maturity` 0 (juvenile) and 4-6 (infertile), `isPregnant`,
  `auctionTimerSeconds > 0` (listed), `isMoving` (pending transport). Park-only states (dead,
  boxed, vet, injured, sick, escaped) don't apply in storage; `bCantBeSold` has no row field
  (**guess**: conservation/rescue animals, its icon is `Icon_Conservation`). Whether contracepted
  storage animals show as 4/5 is unknown (the park list maps contraception there; the park sell
  check only names `bInfertileSell`). PZ2QoL: `sellBlockers()`/`isSellable()` in `scores.js`,
  storage chip **Sellable / Not sellable** (filter `sellable: 'any'|'yes'|'no'`, `bars.js`).
- **Pregnant storage animals are never listed** (2026-10-18). The storage row field is
  `isPregnant` (bool; `AnimalMarketAndStorageSchema.js` storage list, **offline**). Whether the
  hub's native `tradeAllowed` refuses a pregnant animal is unknown; the park's sell flow does
  (`bPregnant`) and the developer reports the market won't take one. Until then the desk only
  cautioned ("the game may refuse") and Tick all took her. Now every PZ2QoL path blocks it:
  `listercore.js` `blockOf` → `'pregnant'` (desk state "Pregnant: not until she gives birth", not
  under Sellable, not tickable, left out of the job, `PREGNANT_TEXT`), `lister.js` `sellableKeys`
  (left out up front, "N pregnant left out"; single view: Sell disabled; `listOne` skips kind
  `pregnant`), and the Lua engine (`pz2qol.lister.lua` reads `isPregnant` on the row, skip kind
  `pregnant`, trace `lister_skip_pregnant`). Whether storage animals are ever pregnant in game is
  a **guess** (one sent to the trade centre while pregnant).
- **Market and Trade History row `id`s are screen slots**, not listing ids: the same ~12 ids are
  reused on every page. Never key anything persistent by them. PZ2QoL keys the price book by
  content (`listingKey()` in `pricing.js`: species, name, sex, maturity, shoal/exhibit, genes,
  price, currency). Anything that sends a market row id to the game must happen while that page is
  on screen. **reported** (Nexus bug #1151539, 3xz1), consistent with the schema (`id` is a
  generated string, no listing GUID). Market rows also carry `name`, `age`, `auctionSource`.
  Storage rows are not paged, but their `id` is the same `animal_<n>` string as the list key (the
  retail UI uses `selectedAnimalIDs` entries as list keys), so it is a position too, not an animal
  identity. The stable identity is the GUID from `api.planetHub.StorageGetIDAndAIDType(key)` →
  `(GUID, 2)`. **offline** (corrected 2026-10-17; the old "row ids are real animal ids" was wrong).
  **Doubt, in game 2026-10-17 (Y:):** with the engine selecting by the row key
  (`StorageUISelectItem(key)`), the page saw *another* key selected (`lister_page_sel_other`), while
  the old page lister, which selected by the row's `id` field (`AnimalStorage_ItemSelected`, row
  `id`) and listed by the key, worked. So the row `id` probably differs from the key in game, and
  the per-animal natives (`StorageUISelectItem`, `StorageGetIDAndAIDType`, as Kin uses it) take the
  id while `selectedAnimalIDs` and the listing call take the key.
  **Proven 2026-10-17 19:50 (Y:):** `lister_id_differs` fired: the row `id` field is not the list key.
  `StorageGetIDAndAIDType` takes the **key** (by id it found nothing: every animal unidentified,
  "Nothing to list"; by key the earlier runs got GUIDs). So: select with `StorageUISelectItem(row id)`,
  resolve GUIDs and list with the key (`nativeId()` in `pz2qol.lister.lua` is used for the select only).
  Whether Kin's `StorageGetIDAndAIDType(row id)` lookups find anything is open.
- `StorageGetIDAndAIDType(key)` returns `(id, type)` with the `CompareMatesUIUtils` types: 0 entity id,
  1 listing id, **2 GUID** (most storage animals), 3 exhibit animal entity id, **4 exhibit animal GUID**,
  5 exhibit listing UID, 6 exchange id, 7 markets GUID. Requiring type 2 left some animals
  unidentified in game ("Nothing to list", 3 of 8 runs, Y: 2026-10-17 20:20). The engine now keys
  other types as `t<type>_<id>` (trace `lister_idtype_<n>`). Skips are traced by kind
  (`lister_skip_<kind>`). Same run: 36 listed with select-by-row-id; Lua's own selection reads worked
  (`lister_diag_flag_true`, `lister_diag_arr_key`).
  **Proven 2026-10-18 12:04–12:15 (Y:, Franchise, Animal Storage opened from the park, detailed log):**
  `StorageGetIDAndAIDType(key)` gave an id the engine accepts for only **4 of 63** rows, all **type 0**
  (entity ids such as 59087, 60430), and no type 2 at all. The other 59 failed on every one of 724
  lookups over 10 minutes, so it was not timing. The log doesn't show what they returned (nil, 0,
  non-numeric, or an error). The Market desk still let the player tick them: 39 ticked, 36 left out
  (`lister job_left_out why=noguid`), 3 listed. The morning sessions show the same pattern (`lister_idtype_0`,
  runs of 1–12, `js_lister_nothing_noid`). **guess**: type 0 rows are animals that still have a park
  entity (4 Kin moves came 10 s before storage opened).
  **What the engine does about it (2026-10-18, offline; `pz2qol.lister.lua` `idToken` / `identify` /
  `_Holds`, `docs/DESIGN-market-desk.md` "Animals without a usable id"):** the old `guidOf` dropped
  anything not printing as plain digits, so a whole float ≥ 2^63 (`tostring` → `9.2233720368548e+18`),
  a string GUID, or a type that isn't a number all counted as no id. Now: integers and whole floats
  < 2^24 exact; larger whole floats `%.0f` but **lossy** (only while unique in the list; note the
  cobra-tools' `lua.exe` prints `%.0f` of 2^63 as `9223372036854775800` (its CRT stops at 17 digits;
the game's may print it exactly: deterministic either way, so only compare tokens made in the same Lua)); id
  strings `[%w-_:]`; nil/0/""/fractions/userdata/tables never. A token two rows share is no id. Rows
  without one get a fingerprint token (`fp<n>`) if exactly one row has the same species, name,
  gender, maturity, `ratings`, `appeal`, `colormorphLabel` and genes (`genetics.<gene>.value`).
  The send re-checks by the same rule in the same tick (look-alike → skip `ambiguous`; an id token's
  row must still show the species/name/sex seen at Resolve, against ids that follow the position).
  What the 59 failing rows actually return is still **unknown**: the next detailed log shows it as
  `lister resolve_fail` lines (one per shape: `ok`, `idType`, `numType`, `id`, `nType`, `row`, `why`).
  Desk: such rows are blocked `noid` ("No id from the game"), not in List N; a smaller job says
  "Listing X of Y: Z couldn't be identified by the game".

### Genetics medal (the market's Rating column)

- Market, Trade History, Rewards and Storage rows all carry **`ratings`**, a `GeneticsRank` string
  (`js/project/data/GameTypes.js`): `'none' | 'bronze' | 'silver' | 'gold'`. Zoo management rows
  carry the same field. **offline** (schema `AnimalMarketAndStorageSchema.js`, `MarketUtil.js`).
- What the game draws from it: the list's **Rating** column (`MarketAnimalListItem`, an
  `AppealIndicator`; **shoals show a dash**), and the info panel's "Rating" block
  (`HabitatAndExhibitInfo`: `Icon_Genetics_<Medal>.svg`, label
  `[InfoPanel_Animal_GeneticsRank_<Medal|Unranked>]`, tooltip `[AnimalExchange_GeneticRating]`).
  The separate `appeal` field (a formatted number) is the Appeal column. The native sort has both
  `ExchangeSortFilterType_GeneticRating` and `ExchangeSortFilterType_Appeal`. **offline**
- Who fills it: the native market/storage datastore managers (no Lua writes `ratings`). Natively it
  is the animal's "appeal state": exe has `animals:GetAppealStateForTradingUI` next to
  `GetAppealStateForInfoPopUpUI` (the park info panel's `geneticsRank`/`medal`). The game presents
  it as a **genetics** rating ("the overall quality of all genes ... compared to the general
  population"); the thresholds are native. It does **not** follow appeal: within a species every
  medal shows the same appeal (see `animals-and-breeding.md`, Breeding-programme facts). **proven**
  (market rows, 2026-10-18).
- **`appeal` is a loc string, not a number.** Schema generator: `separatedInt(n)` =
  `"[SEPERATED_INT_VALUE:Value={n}]"` (500..20000, sic "SEPERATED"); the list draws it with
  `translate()`. The exe also has `"[AnimalList_AppealValue:Value=("`, so the native may send that
  token instead. Storage, market and history rows all carry it; shoals too (`ShoalInfo` shows it).
  Appeal is per species (exe: `GetSpeciesAppealForUI`, `nSpeciesAverageAppeal`), lowered by the
  animal's current welfare and time on view, so within a species it describes the seller's zoo, not
  the animal. **offline** (schema, `MarketAnimalListItem`, exe strings); real in-game
  string format **unverified**.
- PZ2QoL: `readAnimal().medal` (`game.js`); `medalOf()` (pricing.js, undefined for shoals and
  unknown values). The medal is recorded on price-book listings but **not** in `listingKey()` (v2
  keys kept; `mergeListings` keeps a known medal if a later read has none). **Appeal is not read
  or used for pricing** (removed 2026-10-18, developer: it is the seller's welfare, not the animal;
  it had replaced the gene adjustment on 153 of 162 priced animals). The lister's Lua row
  fingerprint still compares the `appeal` field, only to recognise the same row. Pricing
  (`comparables`, `recommendPrice`):
  1. 3+ listings of the same medal: same sex+age group → same age group any sex → species.
  2. Else the narrowest group with 3+ medal listings: same medal plus the nearest other medals,
     prices scaled by `medalRatio()`: observed directly (2+ of each medal, sex+age group →
     species), else chained step by step (each step: groups → median over all species →
     `DEFAULT_MEDAL_VALUE` **guess**: Unranked 0.8, Bronze 1, Silver 1.6, Gold 3). Confidence
     at most medium, at most low when a ratio was guessed; the reason says "No Gold listed among
     adult males; 4 Silver at median 400 CC ×1.88 (guessed ratio)".
  3. Gene score within the comparables: a price fit on gene score, else about 1% per gene point
     from their median (at most 40%).
  4. The game's min/max always win; the reason says when they capped the price.
  Old gene-score tiers only when no listing of the species has a medal. In the harness the
  schema generator gives random medals.

### Colour morph on market rows (1.0.5, **offline**, 2026-10-18)

- Market, Trade History, Rewards and Storage rows carry **`colormorphLabel`** (string; schema
  `AnimalMarketAndStorageSchema.js` ~944/995/1035/1091, generator: 5 random words), read by
  `MarketUtil.js` and drawn by `HabitatAndExhibitInfo` as the "[InfoPanel_Animal_Colourmorph]" line
  with `translateSubLabel` (so it may be a loc token). Rows also have `hasColormorph` in filter
  contexts; the market filter modal has a colour-morph checkbox (`AnimalMarketFilterModal.js:167`,
  `hasColormorphFilter`; the toggle sends filter id `FilterColormorph`; PZ2QoL does **not** query it). In the
  park: `GetColourMorphInt/String`, `GetAnimalColourVariationName` (`animalinfopopup.lua`
  ~2235-2239). What the label holds for a normal animal ('' or a word) is a **guess**: trace
  `js_price_morph_token` / `js_price_morph_text` (first label seen) will tell.
- PZ2QoL: `readAnimal().colormorph`, price-book `colormorph` (not in `listingKey`; `mergeListings`
  keeps a known label), `pricing.js morphOf/normalMorphLabel/morphPremium` (a species' dominant
  label counts as normal; `_variation_colourmorph<N>` tokens are morphs), `comparables` morph
  modes `same|anyMorph|scaled` (default premium ×2 guessed → confidence low).

## Listing limits (`animalTradeListingData`)

- `tradePriceDefault`, `tradePriceMin`, `tradePriceMax`.
- `tradeDurationDefault`, `tradeDurationMin`, `tradeDurationMax`: **integer hours**.
  - The game's slider uses step 1. In game the default is **6 h** and the maximum **12 h**.
  - PZ2QoL lists at the maximum. **offline** (UI code), in-game values reported by the user.

## UI → game events (`engine.trigger`)

| Event | Args | Effect |
|---|---|---|
| `AnimalStorage_ItemSelected` | id | `StorageUISelectItem`: **focuses one animal** (like clicking a row) |
| `AnimalStorage_ItemCheckboxToggled` | id, bool | multi-select tick |
| `AnimalStorage_SelectAllToggled` | bool | select all / clear |
| `AnimalStorage_AddToMarket` | key, price, hours | list the selected animal |
| `AnimalStorage_Compare` | id | opens Compare Mates |
| `AnimalStorage_SendToZoo` | array of selected row keys | `StorageUISetAnimalsToBeSentToZoo(ids, false)`, then `ShowWorldTransition(true)`: the zoo loads at once. **One event for the whole selection** (the info panel's Send to Zoo, enabled by `actions.sendToZooAllowed`). Whether it is a Franchise server request is **unknown** (native). **offline** |
| `AnimalStorage_ReturnToZoo` | array of keys | same call with `true` (the round "return to habitat" button, `actions.returnToAllowed` / `returnToTooltip`): in the park each animal gets `RequestTransportToAssignedHabitat`. **offline** |
| `AnimalStorage_QuickTrade_Cash` / `AnimalStorage_QuickTrade_Credits` / `AnimalStorage_Rehome` (not `_QuickTrade_Rehome`) | array of keys | `StorageUIQuickTradeAnimals` / `StorageUIReleaseAnimalsToWild` / `StorageUIRehomeAnimals`. Sent on the panel's Confirm; see "Quick trade, quick release, rehome" below. **offline** |
| `AnimalStorage_Cancel` | `"Trade"` | `StorageUICancelAnimalAuction()`: **no arguments, acts on the selection**. `"Move"` does nothing in Lua. **offline**; PZ2QoL's engine calls it directly (mode `unlist`, below) |
| `SetAnimalMarketScreen` | 0 market / 1 storage | switch hub tab. **Debug player only:** `AnimalMarketModule` registers it only when `isCoherentPlayer()`, so in game it does nothing. **proven** (it broke PZ2QoL's old "Check market prices"; the harness runs detached, where it works) |
| `AnimalMarketAndStorage_Open_<gameEventID>` | – | what the tab bar sends to Lua to switch the hub mode (market ↔ storage). Sending it without changing the JS tab desyncs the screen. **offline** |
| `Management_SetManagementIndex` | ManagementSectionID | open a management screen (Animals = 7) |
| `Management_SelectAllCheckboxToggled` | `'selectAllAnimals'`, bool | zoo select all |
| `Management_ItemCheckboxToggled` | id, bool | zoo multi-select tick |
| `World_ShowHUD` / `World_ShowHUB` / `World_ShowFrontend` | – | the game's own debug actions; useful in the harness |

Storage-mode Lua handlers: `startscreen.globe.animalstoragehubmode.lua` (`OnItemSelected`,
`OnItemCheckboxToggled`, `OnSelectAllToggled`, ...). Animal Storage always creates a
`CompareMatesPopup`, so finding it on a Lua stack only means "in storage".

## Franchise server errors

- They arrive as `MsgType_DatabaseErrorMessage`, a list of `{nError, nRequestType}`. **proven**
- Request types seen in game (2026-10-15, no names resolve, see `lua-runtime.md`):
  - **42 = the storage listing request** (`AnimalStorage_AddToMarket` → `StorageUIStartAnimalAuction`).
    Errors arrive 0.25–0.6 s after the request, as fast as a success.
  - 28 fails with code 5 every few minutes on its own (background traffic, harmless).
  - 24 failed once with code 13.
- Codes seen for request 42:
  - **255**: refuses a listing now and then (about 1 in 10 during runs). The game survives it.
  - **5: the game crashes.** It hit its own fatal error (0xFDEAD, fTask thread, no mod code on the
    stack) 0.24 s and 0.5 s after the answer, both times (19:42 and 19:50). This is the game's
    own handling of the reply (vanilla), but the lister triggered it. Both times a 255 had come
    within the previous 5 s of the same run, and one request was sent 0.5 s after that 255.
    **proven** (2 of 2). The cause of code 5 is unknown (a rate limit or a refused state?).
- Since PZ2QoL looks the enum names up on the open storage mode's `tWorldAPIs.franchise`
  (2026-10-15 20:13), names resolve. Request 42 has since been refused with `Unknown` and with
  `NotAllowed`, and neither crashed. Which numbers these are is still unknown; the debug trace now
  spells out the raw code after the name (`srv_code`).
- **Code ↔ name, proven from `srv_code` (second PC, 2026-10-15 23:12–23:26):** `Unknown` = **255**
  (6 of 6, request 42), `NotAllowed` = **5** (3 of 3, request 28). So the "code 5" before the two
  19:42/19:50 crashes was `NotAllowed`. `NotAllowed` on request 42 has since come back 20+ times
  with pauses between requests, and none of them crashed. The crash therefore needs more than
  code 5. Both crashes followed a 255 by seconds, and one came after a request sent 0.5 s after
  that 255. Rapid requests after a refusal are the likely trigger.
- Other unnamed pairs seen in the same session, while no mod request was running (vanilla
  background or player actions): 255 on request 49 (16×), 255 on 44 (6×), 5 on 47 (7×), 4 on 32
  and 28. None crashed at the time.
- 2026-10-16 (second PC, a Franchise park): request **31** is refused with code 5 (`NotAllowed`)
  in bursts of 2–4, with or without Kin moves (13 times, once 3 s before a crash). Request **28**
  is refused with `NotAllowed` 0.6–2 s after Kin moves (7 in one minute of a Kin plan, 1.0.5), so
  28 may be the server-side record of an animal move. **guess**: neither name is known.
- Rule for automation (changed 2026-10-16 by the developer): any server error, unnamed codes and
  "fatal" ones like NotEnoughCC included, **skips that animal and the run carries on**. Only the
  player's Stop ends a run. Still pause after every request, even a refused one: the player's
  pace, 1–10 s (default 3 s), the same after an error (the market lister's fixed 8 s after an
  error was removed by the developer on 2026-10-16; "Find a habitat" still pauses 8 s). And still wait until
  `franchise:IsDatabaseOperationInProgress()` is false before sending the next
  (`lister.js`, `pace.js`).
- `franchise:IsDatabaseOperationInProgress()` returns `(bBusy, nRequestType)`. The game's own
  franchise screens poll it before sending requests. Reach it from Animal Storage as
  `oStorageMode.tWorldAPIs.franchise`. **offline**: used by the game; PZ2QoL's use is not yet
  proven in game.
- `DatabaseError_*` codes: Ok, Unknown, DidNotGetResponse, CouldNotParseResponse,
  InternalServerError, MaintainanceMode (sic), NotAllowed, NotAuthorised, NotEnoughCC,
  NotImplemented, PlayerBanned, ProfanityFilter, UnprocessableContent. **offline**: order and
  numeric values unconfirmed.
- The game only reacts to DidNotGetResponse and NotAuthorised. Everything else is dropped unless the
  hub mode handles it, which leaves spinners running forever. **proven**
- The PZ2QoL lister (1.2.1):
  - Stops on: NotAuthorised, Maintenance, PlayerBanned, NotEnoughCC, CouldNotParseResponse,
    InternalServerError, and any unnamed `code N`.
  - On DidNotGetResponse or no answer, waits for a late confirmation, then skips.
  - Ignores errors for other request types.
  - Skips other named rejections; stops after 3 in a row.

## Listing a storage animal: the API under the UI (1.0.5, **offline**, 2026-10-17)

- The storage screen's Trade → Confirm sends `AnimalStorage_AddToMarket(selectedAnimalIDs[0], price,
  hours)` (single selection only, `AnimalStorageInfoPanel.js:393-406`); the hub mode registers it only
  between its TransitionIn and TransitionOut, and the handler is a one-line pass-through
  (`animalstoragehubmode.lua:240-243`): `api.planetHub.StorageUIStartAnimalAuction(key, nPrice,
  nDurationInHours)`. Integer CC price (no currency argument), integer hours. **No Lua check before
  or after** (no busy check, no validation, no refresh).
- Can-trade (`animalStorageData.actions.tradeAllowed` / `tradeDisallowedReason`) and the limits
  (`animalTradeListingData.tradePrice*` / `tradeDuration*`) are written by the native **for the
  selected animal only**; no Lua computes them. Select natively with
  `StorageUIClearSelectedItems()` + `StorageUISelectItem(key)` (local, no server call). Whether the
  native lists the key it is given or the selection is unknown: keep them the same.
- **No success message.** On success the native gives the row `auctionTimerSeconds > 0` and
  `auctionPrice` and clears the selection (the UI's "posted" state waits for that);
  `['hubAnimalsData','network'].connectingAction` goes true then false. Failures: request type 42 in
  `MsgType_DatabaseErrorMessage` (above).
- Busy signals: `franchise:IsDatabaseOperationInProgress()`, `franchise:RequestsInProgress()`, DataStore
  `network.connectingAction` / `network.loadingItems` (while true the list is replaced by a spinner).
- The storage list keeps changing: the native rewrites every listed row's `auctionTimerSeconds`
  about once a second and rebuilds the list (reassigning `animal_<n>` keys) on sales, expiries and
  polls; no Lua drives it. The keys only mean something while Animal Storage is the active hub mode
  (the Rewards mode drives the same native list with `StorageCategory_Rewards`).
- Other storage-wide reads: `GetAdultsOfSpeciesInStorageSplitByGender(sSpecies)` (adult GUIDs, works
  from a park), `animals:GetMarketAnimal{Species,Gender,IsJuvenile,Genes,GeneticGrades}(guid, 2)`.
  Exe-only server endpoints: `/game/market/animal/`, `/game/animal/quick-trade`, `/animal/valuations`.
- **Reading the selection from Lua** (1.0.5, **proven** Y: 2026-10-17): `GetDataStoreElement(
  animalStorageData, "selectedAnimalIDs")` (and the context-as-table fallback) never gave the
  selected key back to Lua while `StorageUISelectItem(key)` visibly selected the row: 5 of 5 animals
  timed out waiting for it. Read the row's own **`selected`** bool instead (`list.<key>.selected`,
  schema prop on every storage row, written by the native to draw the highlight); the array only
  as a fallback. What the array actually holds is still unknown (trace `lister_sel_array_empty` /
  `_ok`). JS reads `selectedAnimalIDs` fine.
- **The row flag failed too** (1.0.5, **proven** Y: 2026-10-17, second run): every animal still
  `lister_unsel_selection`, and no `lister_sel_array_*` mark ever fired, so `list.<key>.selected`
  never read `true` from Lua either, while the screen flickered (the native selection very likely
  happened). Lua's DataStore reads of the selection can't be trusted; whether Lua sees
  `tradeAllowed` / `animalTradeListingData` is unknown. Proven from Lua: `GetDataStoreContextAsTable`
  on the list, `StorageGetIDAndAIDType`, the busy checks. Proven from the page (old `lister.js`):
  `selectedAnimalIDs`, `actions.tradeAllowed`, the `animalTradeListingData` limits.
- **So the page reads for Lua** (PZ2QoL since 2026-10-17, **offline**): while the engine clears,
  selects and sends, it sends the page `PZ2QoL_ListerWatch(req, key)` (a new `req` after the clear
  and again after the select; `("", "")` stops). The page (`listerlua.js`) reads its DataStore every
  100 ms and answers `PZ2QoL_ListerSeen(req, text)`, plain text because the mod's Lua has no JSON
  decoder: `v1|<key>|<selected keys, comma-separated, or ?>|<allowed 1/0/->|<priceMin,priceMax,
  priceDefault,hoursMin,hoursMax,hoursDefault, - for none>|<reason, the rest>` (`listercore.js`
  `readSeen` / `encodeSeen`, Lua `parseSeen`; since 2026-10-18 the page sends **v2**, percent-encoded
  with the quick-action fields, see "Quick trade, quick release, rehome" below; Lua reads both). A report counts only for the current `req` and key
  and while ≤ 0.6 s old; then it is the authority for the selection, tradeAllowed and the limits.
  Lua's own reads are only the fallback when no fresh report exists. Read-only: nothing new goes to
  the game or the server. Trace marks to settle it: `lister_page_seen`, `lister_diag_flag_*`,
  `lister_diag_arr_*`, `lister_diag_allowed_*`, `lister_diag_limits_*` (Lua's own reads at the moment
  the page first shows everything, once per run), `lister_page_sel_key/_other/_empty/_unread`,
  `lister_page_none` (the page's view when an animal times out), `js_lister_watch` / `js_lister_seen`.
- No call returns the trade limits without selecting (exe strings: no storage limit getter), so a
  listing without a selection would send an unchecked price, which the game's UI never does.
- Storage rows carry `storageTag`, the player's tag (`EAnimalStorageTag`: 0 none, 1 Sell, 2 Release,
  3 Move, 4 Keep; `StorageUISetUserStorageTagOnSelectedItems(n)`). **offline** (GameTypes.js)
- PZ2QoL uses this in the **Market desk** engine (`Main/pz2qol.lister.lua`, `docs/DESIGN-market-desk.md`):
  per animal by GUID, it resolves the current key, selects natively, waits for the limits (from the
  page's reports, above), and re-checks key → GUID in the same Lua tick as
  `StorageUIStartAnimalAuction`. In-game check pending (trace `lister_*`).

### Quick trade, quick release, rehome (1.0.5, **offline**, 2026-10-18)

- **Per selection only**, like Trade: the native fills `['hubAnimalsData','animalStorageData','actions']`
  for the current selection (`AnimalMarketAndStorageSchema.js:600-614`): `quickTradeAllowed`,
  `quickTradeDisallowedReason`, `quickTradeValue` (string), `quickReleaseAllowed`,
  `quickReleaseDisallowedReason`, `quickReleaseValue` (string), `rehomeAllowed`. Numeric prices:
  `animalTradeListingData.quickTradePrice` / `quickReleasePrice` (`AnimalTradeListingSchema.js`); whether
  they match the selected animal's value text is unknown (Phase 0a logs both).
- When `rehomeAllowed` is true the info panel shows Rehome and **neither quick button** (nor Trade)
  (`AnimalStorageInfoPanel.js:321`).
- The quick buttons only change UI state; **Confirm** sends `AnimalStorage_QuickTrade_Cash(selectedAnimalIDs)` /
  `_Credits(...)` (`onQuickTradeOrRelease`, `:363-387`). The hub mode's `OnQuickTradeAnimals` /
  `OnReleaseAnimalsToWild` pass the array straight to `api.planetHub.StorageUIQuickTradeAnimals` /
  `StorageUIReleaseAnimalsToWild` (`animalstoragehubmode.lua:225-238`). The listeners are registered in
  TransitionIn from `self.OnQuickTradeAnimals`, so a require-time patch of the module table is what
  the game calls. The exact shape of `_tIDs` in game (0- or 1-based, key or row id) is **unknown**.
- Exe endpoint: `/game/animal/quick-trade`. Permanent: the animal leaves storage for good.
- **PZ2QoL (2026-10-18, Phases 0 and 1 of `docs/PLAN-desk-quick-release.md`; nothing permanent sent):**
  - Phase 0b: `pz2qol.lister.lua` `_WrapQuick` wraps both hub-mode handlers to **log only**, then calls
    the game's own with exactly the same arguments and returns its results (errors not swallowed).
    Log `lister probe_call` (type, `#`, key range and types, network), `probe_id` (each value's type
    and text, the row it names by key or id, its GUID), `probe_after` (request type right after),
    `probe_busy` / `probe_idle`, `probe_server_error` (any database error within 10 s, with its request
    type), `probe_gone` (ms until the row left the storage list, by fingerprint count), `probe_end`.
    Marks `lister_probe_quicktrade` / `_release` / `_gone` / `_stay` / `_server_error` / `_fail` / `_row_none`.
  - Phase 0a (every listing or check run): `lister quick` per animal (flags, value texts, numeric
    prices, reasons, the row's `source`, the `filters.isReleaseable` state), `lister select_net` (the
    network signals before / right after / during each select: `c<conn>l<loading>d<db>[:type]`, marks
    `lister_select_net_busy` / `_quiet`), `lister_server_error_type_<0..63|other>` for every server
    error during a run, `lister_cat_market|quick|rehome|blocked|unknown`, `lister_quick_only_trade`.
  - The page report is **v2** (`listercore.js` `encodeSeen`, Lua `parseSeen` reads v1 and v2): every text
    field percent-encoded, plus the quick flags, reasons, value texts, rehome, the two numeric prices,
    `connectingAction,loadingItems`, `isReleaseable` and the row's `source`.
  - Each run result carries the animal's **verdict** (trade, quickTrade, quickRelease, rehome, reasons
    as problem tokens, values, prices, src page/lua). Job mode `check` (`v1 <pace> check`) selects each
    animal and records it, **never reaches send**, pauses 150 ms between selects (min), runs offline
    too, and clears the selection at the end (and once more 0.5 s later). Hello caps say `check: true`.
    Phase 2's `quicktrade` / `release` modes are below ("Quick trade / Quick release from the desk").

### The storage list under the game's own filters (1.0.5, 2026-10-18)

- The storage screen's filters (species, text search, gender, the filter modal's toggles and
  ranges) are **native**: `AnimalStorage_FilterSpecies(array)` → `StorageUISetSpeciesFilter`,
  `FilterInputText` → `StorageUISetFilterText` + `StorageUIRequestData`, the modal's Confirm →
  `StorageUIApplyFilters` + `StorageUIRequestData`, "Reset all filters" (`AnimalStorage_ResetAllFilters`)
  → `StorageUIResetFiltersToDefault` + `StorageUIClearFilterText` + `StorageUIRequestData`
  (`animalstoragehubmode.lua`). The native then **rewrites `animalStorageData.list` with only the rows
  that pass**: the page has no unfiltered copy, and the JS screen does no filtering of its own.
  **offline** (decompiled Lua and `AnimalMarketStorage.js`); the developer's report "the desk shows
  only the species storage is scoped to" (2026-10-18) matches it. **proven** only as that symptom.
- No other call enumerates storage (exe strings: the only `Storage*` getters are
  `StorageGetIDAndAIDType`, `StorageUIGetItemSpecies`, `StorageUIGetSortFilterSettings`,
  `StorageUIGetSelectedReleaseGroupRewardSpecies`; `GetAdultsOfSpeciesInStorageSplitByGender` gives
  adult GUIDs of one species only). And the listing engine can only select and list rows that are in
  the list. So a cached copy of earlier rows could be shown but never listed.
- What the filters are: `animalStorageData.filters` (`filterInputText`, `filteredSpecies` (UIDs),
  `filteredSpeciesType/Tags/Salinity/Biomes/Ecosystems/Continents/ConservationStatus`, the flags
  `isHabitat/isExhibit/isShoal/isMale/isFemale/isUnisex/hasColormorph/isReleaseable`, range
  `*MinValue/*MaxValue`) and `animalStorageData.animalsInStorage` (the whole count; list shorter =
  filtered). The filter modal and the search box bind to `filters`, so the native fills it
  (**offline**); what `animalsInStorage` counts (shoals?) is a **guess**.
- The settings round-trip: `StorageUIGetSortFilterSettings()` → table, `StorageUISetSortFilterSettings(t)`
  (TransitionIn's `_LoadSortFilterSettings` follows it with `StorageUIRequestData` only, no
  `ApplyFilters`); TransitionOut saves them to the player profile (`tPlayer:SetFilters(mode, "Storage", t)`).
  **offline**. Whether `StorageUIRequestData` reaches the server for storage: **guess** no (the game
  calls it on every sort-header click and every keystroke of the search).
- PZ2QoL: the **Market desk** clears them while it is open (`PZ2QoL_DeskFilters(req, "clear")` →
  keep the settings, then the game's own Reset all filters sequence; `"restore"` → Set the kept
  settings + RequestData; after a run if one is going; on TransitionOut before the game saves them),
  answering `PZ2QoL_DeskFiltersState(req, json {ok, cleared, detail})`. The page turns the storage
  screen's ticks into GUIDs first (a rebuilt list gives keys to other animals). Without an answer it
  shows the narrowed list with a note. The mod's own storage filters (`listfilter.js`, e.g. the
  Species board's `species`) only patch the collection's `source` getter, so the desk, which reads
  `_source`, never sees them. Trace `lister_desk_*`, `js_desk_scope_cleared|kept`. In-game check
  pending. `Main/pz2qol.lister.lua` `DeskFilters`, `marketdesk.js` `seeAllStorage`,
  `listercore.js` `storageScope` / `nativeFiltersOn`.

## Taking a listing off the market (1.0.5, **offline**, 2026-10-19)

- No "change price" exists: a new price means cancel, then list again. The storage info panel shows
  Cancel when the selected row is on the market (`auctionTimerSeconds > 0`); it sends
  `AnimalStorage_Cancel("Trade")` and the hub mode's `OnCancel` calls
  `api.planetHub.StorageUICancelAnimalAuction()` **with no arguments: it acts on the selection**
  (`animalstoragehubmode.lua` OnCancel; `AnimalStorageInfoPanel.js` `onSelectCancelMoveOrTrade`,
  whose debug-player path then sets the row's `auctionTimerSeconds` to −1). Unknown: its server
  request type and answer, how long the row takes to show it, whether the animal can be listed
  again at once, and whether it costs anything.
- What a storage row says about a listing: `auctionTimerSeconds` (time **left**) and
  `auctionPrice`. Nothing says when it was listed or for how long: PZ2QoL keeps a session ledger
  of the listings its engine confirmed (`repricerun.js`, `PZ2QoL.listingLedger.v1`), else infers
  12 h from more than 6 h left, else assumes 12 h.
- The player's own listings also appear as market rows (price book); compare listings only after
  removing them (`repricecore.js` `marketPools`, both CC forms of `listingKey`).
- PZ2QoL: the desk's **My listings** view (`docs/DESIGN-reprice.md`). Engine job mode `unlist`
  (`pz2qol.lister.lua`): resolve by GUID (must be listed, else skip `notlisted`), clear + select
  natively, a **fresh page report** of exactly that selection (required: Lua's selection reads
  never worked in game), in one tick busy / report / `_Holds` / still listed, then the call;
  confirmed by the row reading not listed twice (first look after 1 s, 30 s timeout; a database
  error only shortens the wait to 5 s); `gone` if it left storage (sold). Run tied to the page
  (`R<page>_<n>`), refused offline. Hello caps `unlist`. Then the normal listing job at the new
  prices. Trace `lister_unlist_*`, `lister_unlisted`. In-game check pending.
- **No quick action on a listed animal** (1.0.5, **offline**): for a selected row on the market the
  info panel shows only Cancel (`AnimalStorageInfoPanel.js` `onGetActionsContent`: the Quick trade /
  Quick release buttons are in the other branch). PZ2QoL's quick job stops at a listed animal
  (skip `listed`), so My listings takes listings off first, then runs the quick job
  (`docs/DESIGN-reprice.md`). The engine keeps its last selected animal 60 s (`tLastSel`) so the
  quick run's data check accepts the same animal's unchanged data right after its take-off.

## Market data (native `AnimalMarketUIDatastoreManager`)

- The hub's market list is filled by native `api.planetHub.MarketUI*` calls, not by the JS page.
  It has one display slot: `MarketUISetDisplayType(AnimalMarketDisplay_None | _Market | _TradeHistory)`.
  The Market hub mode sets `_Market` on TransitionIn and `_None` on TransitionOut. Storage leaves it
  at `_None`. **offline** (decompiled `startscreen.globe.animalmarkethubmode.lua`)
- Filter and request: `MarketUIResetFiltersToDefault`, `MarketUIClearFilterText`,
  `MarketUISetSpeciesFilter({speciesUID})`, `MarketUISetFilterValue(MarketFilterType_Currency, 0)`
  (0 = CC, 1 = cash, 2 = any), `MarketUIApplyFilters`, then `MarketUIRequestData`.
  `MarketUIHasPendingDataRequests()` exists (exe strings). Settings round-trip with
  `MarketUIGetSortFilterSettings` / `MarketUISetSortFilterSettings`. **offline**
- PZ2QoL's background "Check market prices" (`Main/pz2qol.marketpeek.lua`) does this from inside
  Animal Storage (driven by the storage mode's `Advance`), then restores the settings and `_None`.
  The native fills `animalMarketData.list` while the storage mode is active, and the screen
  doesn't change. **proven** (Y: trace 2026-10-15: `js_peek_start → peek_start → peek_ready →
  peek_end → js_peek_done`). Single-page version proven; paging and multi-species are below.
- Paging: `['hubAnimalsData','animalMarketData']` → `pageIndex` (0-based) and `pages`; the page's
  Paginator shows at most 20. `AnimalMarket_ChangePaginator(n)` → Lua `MarketUISetPage(n)` only, with
  no `RequestData` after it. "Next" on the last page sends `RefreshMarketListings` (`MarketUIRequestData`).
  **offline**
- PZ2QoL paging (since 1.2.1): after page 0 is read, the page sends `PZ2QoL_MarketPeekPage(n)` and
  Lua calls `MarketUISetPage(n)` only while the peek is "ready". Pages 1..19, one at a time, waiting
  on `MarketUIHasPendingDataRequests` again. The page then waits until `pageIndex == n` **and** the
  rows' content has changed (row ids are slots), records, and pauses 400 ms. If `pages` is
  unreadable, it continues until a page comes back unchanged. `_Finish` calls `SetPage(0)` before
  restoring the filters. Trace: `peek_page` / `js_peek_page`. **proven** (Y: 2026-10-15 17:04: a
  6-page check, each `SetPage` answered in about 0.55 s, and the DataStore `pageIndex` and rows
  update while storage stays on screen).
- Multi-species ("Refresh prices (N species)", under Sell in the multi-select view): one click checks the selected species in turn, most
  selected first, at least 3.2 s apart (the Lua cooldown is 3 s), with Stop after the current
  species. Listing is blocked while it runs. Trace: `js_peek_all_start` / `js_peek_all_end`.
  First in-game run failed on a stale Lua answer (see `lua-runtime.md`, TriggerEventAtNextAdvance);
  fixed, with the fix **offline**.

## Kin (relatedness) events

| Direction | Event | Args | Effect |
|---|---|---|---|
| JS to Lua | `PZ2QoL_KinScan` | reason | park scan; answered by chunks or `PZ2QoL_KinState` |
| JS to Lua | `PZ2QoL_KinStorage` | storage row ids, comma separated | lineage of stored animals (hub) |
| JS to Lua | `PZ2QoL_KinContracept` | id ('123' or 'x<uid>'), bool | `animals:SetUsingContraceptive` (the management list's own call) |
| JS to Lua | `PZ2QoL_KinLocate` | id | camera `RequestMode("Orbit", {targetEntityID, bLocate})` + info panel |
| JS to Lua | `PZ2QoL_KinLocatePlace` | place id (habitat entity, `xe:<exhibit>`, `xh:<name>`), sample animal id | "Show in park": the game's FocusCameraOnEntity on the habitat/exhibit; answers `located_place` or `failed` |
| JS to Lua | `PZ2QoL_KinHeatmap` | bool | heat map manager InbreedingRisk on / off (fallback; JS uses `ShowHeatmap`) |
| JS to Lua | `PZ2QoL_KinForget` | - | forget what was sent (page reloaded) |
| Lua to JS | `PZ2QoL_KinChunk` | seq, i, n, text | one piece of the JSON snapshot |
| Lua to JS | `PZ2QoL_KinState` | state, detail | `same`, `busy`, `nopark`, `nostorage`, `contracept`, `located`, `located_place`, `failed`, `error` |

Game events Kin listens to (rescan soon after): `ManagementAnimals_ContraceptionToggled(rowId, bool)`
(the Animals list's contraception button; rowId `animal_<entity>`), `InfoPanel_Animal_Contraceptive`,
`CompareMates_UI_ContraceptionToggled`, `Heatmaps_Select(id)` (which heat map is shown).

Species board events:

| Direction | Event | Args | Effect |
|---|---|---|---|
| JS to Lua | `PZ2QoL_KinDestinations` | reqId, animal ids (comma separated) | the habitats the game allows for those animals' species |
| Lua to JS | `PZ2QoL_KinDestinationsResult` | reqId, JSON `{bySpecies:{sp:{habId:{ok,reason}}}, habitats, tradeCentre}` | |
| JS to Lua | `PZ2QoL_KinMove` | reqId, animal id, habitat id or `trade:<id>` | ONE move, the game's own sequence |
| Lua to JS | `PZ2QoL_KinMoveResult` | reqId, ok, detail | |
| JS to Lua | `PZ2QoL_KinSpecies` | reqId, species, habitat ids (comma separated) | breeding-programme facts: social range, fertility ages, mating system, conception table, habitat space |
| Lua to JS | `PZ2QoL_KinSpeciesResult` | reqId, JSON | |
| JS to Lua | `PZ2QoL_StoreLoad` | reqId | read this zoo's data (kept in the player save, every zoo) |
| Lua to JS | `PZ2QoL_StoreData` | reqId, ok, part, parts, text | the data in ~12 KB chunks; ok=false: no store yet, text = reason (wait, noplayer, nopark) |
| JS to Lua | `PZ2QoL_StoreSave` | reqId, ASCII JSON object | replaces this zoo's data (max 60 KB; 64 KB over all zoos); the player save is written ~4 s later |
| Lua to JS | `PZ2QoL_StoreSaved` | reqId, ok | |
| Lua to JS | `PZ2QoL_StoreReset` | | a park started or ended, or the zoo's store became known (or unavailable): read the store again |

"Find a habitat" events (`pz2qol.storagesend.lua`, `storagesend.js`; see `animals-and-breeding.md`
"From storage to a habitat"):

| Direction | Event | Args | Effect |
|---|---|---|---|
| JS to Lua (hub) | `PZ2QoL_SendArm` | count, onlineOk | the next Move screen request (≤ count animals, within 10 min) is the mod's |
| JS to Lua (hub) | `PZ2QoL_SendDisarm` | – | sent when the game's own Send to Zoo / Return is pressed |
| Lua to JS (park) | `PZ2QoL_SendArrived` | seq, ids (comma separated), onlineOk | re-sent on `PZ2QoL_SendHello` until `PZ2QoL_SendAck(seq)` |
| JS to Lua | `PZ2QoL_SendFacts` → `PZ2QoL_SendFactsResult` | reqId, id → reqId, JSON | one animal: species, lt, moving, assigned, busy, mode, parentHabs, habitats `[{id,name,ok,reason,reach,crowded,total,same}]` |
| JS to Lua | `PZ2QoL_SendMove` → `PZ2QoL_SendMoveResult` | reqId, id, habitat, seq → reqId, ok, detail | ONE move through `Kin.Move`; habitat `trade:arrival` = the Move screen's own trade-centre sequence (no `CanSendAnimalToTradeCentre`), only for ids of trade arrival `seq`, else the strict `trade:auto` |
| JS to Lua | `PZ2QoL_SendOpenMove` → `PZ2QoL_SendOpenMoveResult` | reqId, ids → reqId, ok, detail | the game's own Move screen for those arrivals (alive, no transport job), opened by the original `SetNewMode` on the next `SelectMode.Advance`; detail `expired` (30 s), `none`, `nopark`, `nomode`, `failed` |

`PZ2QoL_SendArm` takes a 3rd arg `target` (`habitat` default, `trade`) and `PZ2QoL_SendArrived` a 4th
(the same target, also on re-sends). A `trade` arm is taken only in the zoo of the click
(`Kin._ZooKey` vs `StorageFetch.tLastClick`; Franchise with either key unknown → not taken; offline
accepts unknown); trace `send_zoo_mismatch|unknown`, `fetch_taken`, `fetch_arrival_lt_<lt>`,
`fetch_move_ok|failed`, `fetch_open_move_*`.

"Bring to the trade centre" events (`pz2qol.storagefetch.lua`, `storagefetch.js`; see
`animals-and-breeding.md` "From storage to the trade centre"):

| Direction | Event | Args | Effect |
|---|---|---|---|
| JS to Lua (park) | `PZ2QoL_FetchStart` → `PZ2QoL_FetchStartResult` | reqId, species (`*` = every species, "Bring all"), exclude (`g:<guid>`, `n:<sex>:<clean name>`, csv, capped at 16000 characters on whole items) → reqId, ok, detail, room | checks park / trade centre / room, keeps the request and the zoo key, opens Animal Storage (`TradeJump._OpenHub`); detail `notradecentre`, `full`, `badspecies`, `nopark`, `nobuilding`, `nohub`, `nohud` |
| JS to Lua (hub) | `PZ2QoL_FetchHello` | – | Storage shown / page loaded |
| Lua to JS (hub) | `PZ2QoL_FetchPending` | seq, species, room (-1 unknown), exclude, fresh | `fresh` only on the first delivery; later ones need the card's Send click; 10 min expiry |
| JS to Lua (hub) | `PZ2QoL_FetchAck` | seq | sent or cancelled: dropped |

`PZ2QoL_TradeCounts`' JSON also carries `tc` (has a trade centre), `tcNow`, `tcMax`.

Auto mode events (`Kin.AutoGate`, `pz2qol.kin.lua`; asked only while a species is on Auto; reads only, the snapshot is unchanged):

| Direction | Event | Args | Effect |
|---|---|---|---|
| JS to Lua | `PZ2QoL_AutoGate` → `PZ2QoL_AutoGateResult` | reqId → reqId, JSON | always answered (every game call in `pcall`). JSON: `park` (bool, a park world ticked within 1 s), `move` (`api.planetHub.IsPlayerAnimalMovementEnabled()`; omitted if missing or it errors), `uiMode` (last `BaseUIMode.SetNewMode` name, recorded by StorageSend's wrapper; `''` if none seen; not reset between parks), `dbBusy` (`franchise:IsDatabaseOperationInProgress()`; omitted if unknown or no park), `tcMax` / `tcCount` (`park:GetTradeCentreMaxCapacity()` / `GetNumberOfAnimalsInTradeCentre()`; omitted if unknown), `gameMode` (`franchise` / `offline` / `unknown`), `year` / `month` / `monthProp` (`park:GetTimeOfMonth()`, the real date; omitted if invalid or unknown), `monthSec` (`park:GetMonthDurationInSeconds()`), `t` (whole seconds of the performance timer). Mark `auto_gate`. **offline** (Lua test 17) |

Snapshot extras: `animals[].lt` (location kind), `animals[].moving` (`bHasTransportJob`), `mode`
(`franchise` / `offline` / `unknown`), `tradeCentre {id, name}`.

Find a mate (stored adults, Franchise; `Kin.StoredAdults`, `kinmoves.js requestStoredAdults`):

| Direction | Event | Args | Effect |
|---|---|---|---|
| JS to Lua (park) | `PZ2QoL_KinStored` | reqId, species | the player's stored adults of the species (read-only) |
| Lua to JS | `PZ2QoL_KinStoredChunk` | reqId, i, n, text | ~12 KB pieces of `{species, animals: [{id 's<guid>', guid, name, species, sex, maturity, forSale, rating, par, genes, grades}], anc, capped}` or `{species, error}` (error: `nopark`, `notfranchise`, `nostorage`, `failed`) |

Growing-up snapshot extras (2026-10-18): `animals[].adultAge` and `.adultIn` (juveniles, years),
`animals[].out` (`pop|mat|sex|yes`, adults in habitats), `speciesFacts[sp].social {min, max}` and
`.maturation` (`males|females|all|none`); each absent when the game does not answer.

## Opening the hub from the park (1.0.5, **offline**)

- The taskbar's Market & Storage tab (`HUDModule.js` `doOpenMarket`) sends `HUD_OpenHubAnimalMarket`
  → `MainHUD.OnOpenAnimalMarket` (`windows.mainhud.lua`): `backgroundWorldDataManager:
  SetInitialHubScreen(FrontEndUI.HUB_ANIMAL_MARKET)` then `self:OnWorldTransition_OpenHUB()`.
  `OnWorldTransition_OpenHUB` = `SetAnimalMarketAndStorageEnabled(facilities:
  ParkHasBuildingForAnimalStorage())`, `api.planetHub.PrepareToEnterPlanetHub()`,
  `OnHeatmapSelect("None")`, `oWorldTransitionScreen:ShowWorldTransition(true)`.
- The trade centre's "Open storage" (`components.ui.facilityinfopopup.lua` `_OpenAnimalStorage`) and
  the exhibit panel's market / request buttons (`components.ui.exhibitinfopopup.lua`) do the same
  with a sub-screen: `SetInitialHubScreen(HUB_ANIMAL_MARKET, ANIMAL_MARKET_SCREEN_STORAGE | _MARKET)`
  (+ `SetAnimalMarketFilter` / `SetAnimalStorageFilter(flag, value)`), then `mainHUD:OnWorldTransition_OpenHUB()`.
- Reaching them from any Lua (`events.eventactionopenanimaltrading.lua`):
  `api.game.GetEnvironment():RequireInterface("Interfaces.IBackgroundWorldDataManager")` and
  `api.world.GetScript(api.world.GetActive()):GetHUD()` (the MainHUD; `worlds.darwinworld.lua`).
- Constants (`ui.controllers.frontendui.lua`): `HUB_ANIMAL_MARKET = 2`; `ANIMAL_MARKET_SCREEN_MARKET = 0`,
  `_STORAGE = 1`, `_RELEASE_GROUPS = 2`, `_HISTORY = 3`, `_REWARDS = 4`. The hub applies them in
  `StartScreenHUD.OnWorldTransition_TransitionEnding` → `uiHUD:SetHubScreen(2, sub, true)`.
- **BWDM** (`GameMain/managers.backgroundworlddatamanager.lua`) only stores values:
  `SetInitialHubScreen(n, sub)`, `SetAnimalMarketFilter(flag, v)`, `SetAnimalMarketSpeciesFilter(tNames)`,
  `SetAnimalStorageFilter(flag, v)`.
- **Market species filter across the transition:** `AnimalMarketHubMode.TransitionIn` reads
  `GetAnimalMarketSpeciesFilter()`; when set it calls `MarketUISetSpeciesFilterFromNames(t)` +
  `MarketUIApplyFilters()`, clears it, and skips `_LoadSortFilterSettings` (so the filter becomes
  the market's current one and stays). The hub's Zoopedia button passes names without `Animal_`
  (`{"Lion"}`, `startscreen.shared.startscreenhud.lua`). Whether the park's `animals:GetSpecies`
  string is accepted as such a name: **guess** (same id format).
- **Animal Storage has no pending species filter**: `AnimalStorageHubMode.TransitionIn` only reads
  `GetAnimalStorageFilter()` (flag/value); the native storage species filter takes UIDs
  (`StorageUISetSpeciesFilter`). PZ2QoL filters storage client side instead (below).
- The in-park Zoopedia's market button (`Zoopedia_FilterMarketToSpecies` → `MainHUD.sPendingSpeciesFilter`)
  feeds a dead trading mode; no in-park trading screen exists in 1.0.5. `SetAnimalMarketScreen` is
  debug-player only (see above).
- HUD flags (DataStore): `['park'].hasBuildingForAnimalStorage` (the taskbar tab is disabled
  without it), `['ui','HUD'].hubDisabled`; an open heat map panel also blocks the tab (`canOpenHUB`).
- `api.planetHub.GetAdultsOfSpeciesInStorageSplitByGender(sSpecies)` → `{ [1] = male GUIDs,
  [2] = female GUIDs }`, adults only, synchronous. Vanilla calls it only from the park's Compare
  Mates in FranchiseOnline (`editors.animal.comparematespopup.lua` `_SetParentsData`). Offline
  result: unknown.

Trade shortcuts events (`pz2qol.tradejump.lua`, `tradejump.js`):

| Direction | Event | Args | Effect |
|---|---|---|---|
| JS to Lua (park) | `PZ2QoL_TradeOpen` → `PZ2QoL_TradeOpenResult` | reqId, `market`/`storage`, species → reqId, ok, detail | the game's own hub opening (above); detail `nobuilding`, `nopark`, `nohub`, `nohud` (page falls back to `HUD_OpenHubAnimalMarket`), `badspecies`, `badkind` |
| JS to Lua (park) | `PZ2QoL_TradeCounts` → `PZ2QoL_TradeCountsResult` | reqId, species csv (≤ 40) → reqId, JSON `{ok, mode, bySpecies:{sp:{m,f}}}` | adults in Animal Storage |
| JS to Lua (hub) | `PZ2QoL_TradeHello` | – | the hub page loaded / Storage came on screen |
| Lua to JS (hub) | `PZ2QoL_TradeFilter` | seq, `storage`, species | re-sent on each hello (≤ 10 min) until `PZ2QoL_TradeAck(seq)`; the page sets its `species` storage filter |

## Why the game won't trade an animal (2026-10-18; **offline**: exe strings and English loc; trace on Y: proven)

- **The reason is nested loc tokens.** A storage row's `tradeAllowed = false` comes with `tradeDisallowedReason`:
  `[AnimalExchange_Conditions_Concatenate:first=[...Concatenate:first=[AnimalList_SelectionCannotTrade]:second=[AnimalExchange_Conditions_NewLine]]:second=[AnimalList_Problem_<Key>]]`.
  - The header reads "Cannot send to trading as the following issues apply to one or more of your selection:".
  - There is one `AnimalList_Problem_<Key>` per problem.
- **Problem keys:**
  - `Juvenile_Sell`, `CantBeSold` ("must stay in zoo for this scenario"), `Pregnant`, `SeriouslyInjured`, `Infertile_Sell`, `BlockedByScenario`, `HasCondition` (restrictive adoption terms), `Infected`, `PendingTransport`.
  - `NoBirthZoo` ("Animal was not born in a player zoo") greys out **Trade and Quick release** (**proven**: seen by the developer in game, 2026-10-18; this line used to say "release only", which was wrong). It does **not** block Quick trade (proven, Phase 0a, Y: 2026-10-18; table at the end of this file).
  - `CashSeeded` (bought for cash) blocks release to the wild (**offline**).
- **It's vanilla:** the game's own Trade button is disabled by the same flag (`AnimalStorageInfoPanel.js:331`). The lister skips such animals before sending anything to the server.
- **PZ2QoL:**
  - `listercore.js` `reasonText` / `tradeProblemKeys` show just the problems, translated.
  - Lua marks `lister_untradeable_<Key>` and logs `problems=` (the log value cap of 160 chars cut the reason before the key).
- **Seen on Y: 2026-10-18:** 10 of 38 were blocked. Six were park animals sent to the trade centre minutes before; four were White-tailed sea eagles. The keys per animal are unknown until the next trace.
- **Server code 255** (`DatabaseError_Unknown`) on request 42 (listing):
  - It's tied to the animal. The same wild dog was refused at two prices.
  - It's vanilla: a listing the game's own Trade button sent got the same refusal.
  - It isn't price, a listing cap or pace.
  - It is most likely right after the animal moved to storage; NotAllowed on request 31 appeared just before (**guess**: a stale server record).
  - The desk says so and offers a later retry.

## Quick trade / Quick release from the desk (PZ2QoL Phase 2, 2026-10-18; **offline**, in-game acceptance pending)

- `pz2qol.lister.lua` job modes `quicktrade` / `release` (`v1 <pace> quicktrade`, lines `<guid> <key> - default`; pace ≥ 1 s,
  the listing pace untouched; online Franchise and the native required). Per animal: server idle → resolve (only "on the
  market" and "moving" skip by row; the action's own flag decides the rest) → clear → select → a **fresh v2 page report only**
  (Lua's own reads never count; `_IsSelected` returns nil without one) → the flag (`tQuick.bTrade` / `bRelease`) true and not
  `rehomeAllowed`, else skip `notallowed` / `rehome` → send step: `_Busy` (wait ≤ 10 s, then skip), a page report that arrived
  **after the send step began**, `_IsSelected` (page) and `_Holds` in the same tick, the data print (quick values included)
  unchanged (else settle again, ≤ 3) → `api.planetHub.StorageUIQuickTradeAnimals({ key })` / `StorageUIReleaseAnimalsToWild({ key })`
  (exactly what the hub handler passes on) → the storage list decides: GUID gone (fingerprint gone for a `fp` token; a GUID
  gone while its look stays counts as ambiguous) = done; still there at 10 s (`nQuickTimeout`; a database error shortens it to
  3 s) = `unconfirmed` and the run **stops**; ambiguous = stops. The list is "unreadable" (look again) while `loadingItems` or
  when it shrank by more than one row. Log `lister quick_gone ms=` every time.
- Other stops: two animals in a row without a fresh page report (`nopage`); a page reload (the report's 17th v2 field is the
  page id, `listerlua.js PAGE`; a report or a `PZ2QoL_ListerHello` from another page id ends the run with
  "Stopped: page reloaded.", and the new page is shown that state once); a mod error. The player's Stop waits for a sent
  animal's result. A second Start is refused (the job is frozen).
- Page (`marketdesk.js`): the mode switch, red panel, the sheet with a **Confirm button** (the developer found a 2 s hold too
  much, 2026-10-18; also Enter and gamepad `UI_Select` through `Input.onShouldBlockInput`, which also keeps `UI_Cancel` from the
  game while the sheet is open; input ignored for 300 ms after it opens), the live acceptance in prefs
  `quickAccepted: { release }` (one animal per run until a one-animal run was confirmed gone); Quick trade is proven in game
  and has no limit (`listercore.js QUICK_PROVEN`). Rows whose
  `source` is `[AnimalExchange_Source_Description:Value=|Frontier Zoo|]` are Quick trade before any check (`pre`), labelled
  "from the storage list"; `readAnimal().source`.
- Trace marks `lister_quick_*` (send, gone, traded, released, unconfirmed, ambiguous, timeout, nopage, stop, stop_nopage,
  reloaded, notallowed, changed, server_error, start), `js_desk_quick_*`.
- Safety review (2026-10-18), now enforced: in a quick run **every** skip but "not allowed now" (`notallowed`, `rehome`; and
  `nopage`, which stops on the second in a row) **stops** the run: a changed selection or key, an ambiguous or gone animal,
  a busy game, data that never changed. "Gone" needs the row count exactly one below the count at the send, and a GUID
  animal whose look (fingerprint) is unknown is never gone by its id alone (else "unreadable" until the 10 s stop). The
  selected data must differ from what showed right after the clear, unless that was empty (no quick flags); the delay is
  logged (`lister quick_flags ms=`). A quick Start without a page id in its request (`R<page>_<n>`) is refused. The sheet
  ignores input for 300 ms after it opens. A start with no answer in 5 s is "not answered yet" (`pending`), and the
  next state for that request id reconciles it (`lister engine_started_late`).

- **Quick trade from the desk proven** (Y: 2026-10-18, 3 runs, rows 91→90→89→88; trace runs 2, 4, 5). At the **first look,
  250 ms after the call**, every time: the old row is **still in the list** (same count, its fingerprint still there) but its
  key no longer gives the GUID (`StorageGetIDAndAIDType` gave id type 0: `lister_idtype_0`); about 1 s later the list is rebuilt
  with one row fewer and renumbered keys. The engine's first rule read that as "ambiguous" and stopped (the animals had gone).
  Now `_QuickState` calls it "leaving", and every state but "there" and "gone" is **waited out** until the 10 s deadline;
  gone = GUID absent + its look gone + rows == rowsAtSend − 1, **read twice in a row**; still not gone at the deadline stops
  the run (logged `lister quick_transient state=` once, `quick_gone transient=`).

- **Quick modes offer every animal the game allows** (developer, 2026-10-18): `listercore.js quickEligible` takes the verdict's
  own flag (`quickTrade` / `quickRelease`), market-listable animals included; not listed, moving or Rehome-only. Server-refused
  animals of a listing run (`refusedGuids`) can be ticked for Quick trade in one click (run card, quick panel).
- **Refused listings quick-traded in the same run** (developer, 2026-10-18; the same tigers fail to list in vanilla too, error
  255 on request 42, 12 of 28 in one Fetch batch, all flagged tradeable): job header `v1 <pace> list onrefused=quicktrade|release
  [refusedmax=N]` (`listercore.js encodeJob`, desk pref `deskRefused`). `Lister._Refused`: on a refusal (kind `refused` only:
  a named rejection, or Unknown / an unnamed code after the grace; never DidNotGetResponse or a timeout) the listing's result is
  kept (`listRefused`), a pause, then the same animal goes through the quick steps (`tCur.sQuick`, `bAfterRefusal`; `Lister._Q`
  gives the current animal's quick mode) with every guard; result `traded` / `released` with `afterRefused`. Not allowed now
  (incl. CashSeeded for a release, checked by flag and by reason) leaves it `refused`; anything unexpected stops the run.
  Quick start needs the page id; a page reload stops the run. `refusedmax=1` before Quick release's acceptance; a run with
  exactly one confirmed release after refusal accepts Quick release. Re-selecting the same animal: equal data before the
  select is fine when the last selection was this animal (`tCur.sPrevGuid`). Log `lister refused_then_quick`, mark
  `lister_refused_then_quick`, `lister_onrefused_start`.
- **Gap (proven Y: 2026-10-19, run 2, 3.0.x):** `onrefused` only covers a *server* refusal. An animal the game blocks before
  sending (`bAllowed` false, e.g. NoBirthZoo) goes `_Skip(tRun, "untradeable")` (`pz2qol.lister.lua` ~2295) and never reaches
  `_Refused`, so it is skipped although Quick trade was chosen and its `qt` flag was true: 8 Hawksbill turtles,
  `skip_untradeable:8`, "not born in a player zoo"; one of them quick-traded by hand right after went fine (`probe_gone` 273 ms).
  **Fixed 2026-10-19 (offline, `test_lister.lua` section 22):** when the run has `onrefused` and the page report says that
  quick action is allowed now (`tQuick[sFlag]`, under `refusedmax`), the untradeable branch calls `_Refused(tRun, "Not listed:
  <reason>")`, so it takes the same quick steps and counts in "… after refusal". Otherwise it is skipped as before.

## Quick trade / Quick release: proven on Y: 2026-10-18 (Phase 0 of docs/PLAN-desk-quick-release.md)

- **What the game's handlers get** (`AnimalStorageHubMode.OnQuickTradeAnimals` / `OnReleaseAnimalsToWild`):
  - `(self, tIDs)`, where `tIDs` is a plain Lua table `{ [1] = "animal_11" }`: number key 1, a string value that is the storage row key;
  - one row per call when one animal is selected.
- **What happens on the network:** nothing visible. `connectingAction` and `IsDatabaseOperationInProgress` stayed idle before and after, and there was no database error. The row left the storage list **~0.31–0.34 s** later (quick trade: a White-tailed sea eagle, NoBirthZoo; release: a Sumatran tiger).
- **Selecting an animal** in storage sends no request: 50 of 50 selects showed no network activity. Per-animal checks are free.
- **Prices:** for the selected animal, `animalTradeListingData.quickTradePrice` / `quickReleasePrice` equal the numbers in `quickTradeValue` (`[COST:Value={n}]`) / `quickReleaseValue` (`[INT_VALUE:Value={n}]`), 50 of 50.
- **Which rules block which actions** (50 animals):

  | Rule | Market | Quick trade | Quick release |
  |---|---|---|---|
  | NoBirthZoo | blocked | **allowed** | allowed, unless CashSeeded |
  | Infected, SeriouslyInjured | blocked | blocked | blocked |
  | Infertile_Sell (that animal also had `rehomeAllowed`) | blocked | blocked | blocked (Infertile) |

- **Telling NoBirthZoo apart from the row alone:** the row's `source` = `[AnimalExchange_Source_Description:Value=|Frontier Zoo|]` matched NoBirthZoo exactly (4 of 4, and none of the 46 from the player's zoo). It's a good classification, but each animal is still checked when selected. **Not complete** (Y: 2026-10-19): 8 Hawksbill turtles with the player's own zoo as `source` (`|Save the Euro|`, the same as the 12 listable animals in that run) were NoBirthZoo too (quick release: HasCondition + CashSeeded), so `isFrontierZoo` misses them; a `source` that is not Frontier Zoo does not mean listable. `isReleaseable` was false for all 50, so it's useless for this.

### Server refusals are not sickness (Y:, 2026-10-18, run of 28)

- **What happened:** 12 of 28 listings were refused with error 255 (Unknown) on request 42.
- **Who:** all 12 were Sumatran tigers from one Fetch batch (13 arrived together; 1 listed). Deer and giraffes from other Fetch batches listed fine.
- **What the client saw:** every refused animal had `tradeAllowed = true` and no problem key, and their data matched the listed tiger. Nothing on the client predicts the refusal.
- **What it is not:** sick, injured or pregnant animals fail before the send. The game sets `tradeAllowed = false` with a problem key, and the desk shows the reason.
- **The cause is unknown and server-side.** Open hypotheses: a per-species or per-batch server limit, or the batch not yet synced after Fetch. To check, list one refused tiger by hand in the vanilla storage screen.

## Park calendar and game time (1.0.5, 2026-10-19)

- **Calendar** (**offline**, decompiled Lua): 4 seasons a year (`WeatherUtils.nTotalSeasons = 4`;
  names depend on the biome, e.g. Wet/Dry), 12 months a year, 3 per season (`nMonth = nSeason * 3 + 1`,
  seasonal history saved when `nMonth % 3 == 0`). The exe's date format also has a Day; days per
  month are not in the Lua. `ParkUIUtils.GetMonthsAndYearsString` (`/ 8`) is unused legacy.
- **The HUD's season bar shows the season index (0–3), not progress through the season**
  (`windows.mainhud.lua:1623` `seasonProgress = TimeOfMonth:Season()`, four fixed arrow positions).
- **Reading the date** (park world API, `api.world.GetWorldAPIs().park`): `GetTimeOfMonth()` (real)
  and `GetApparentTimeOfMonth()` (what the HUD/weather/lighting use; the player's time slider can
  override it: schedule on the real one). Both return a `TimeOfMonth` with `:Year() :Month()
  :Season()` (0-based) `:Day() :Prop()` (through the month, 0..1) `:SeasonProp()` `:DifferenceTo(o)`
  (months, float) `:SeasonDifferenceTo(o) :Valid()`; `CreateTimeOfMonth(prop, month, year)` builds one.
  No "total seasons elapsed" call: use `Year()*4 + Season() + SeasonProp()` or a saved anchor.
- **Month length** is engine-defined: `park:GetMonthDurationInSeconds()` (only readable at run
  time; no Lua constant). A season is 3 months, a year 12. Value at 1x: **open** (measure).
- **Clock:** a separate 24-hour clock, `park:GetTimeOfDay()` / `GetApparentTimeOfDay()` ->
  `nHour, nMinute, nDayProp, nDawnDuskProp`; seasons only shift the phase hours
  (`database.c0climatedata.lua`). `Lighting.DayNightCycle.RealTimeLength` (1800) is a debug
  tweakable unused in parks. Marketing's `c_nTicksPerSeason = 300` counts ticks, not seconds.
- **Engine messages:** `api.messaging.MsgType_ParkTimeRegularMessage` (`nMonth, nYear, nSeason,
  nMonthTick, nSeasonTick, nTicksPerMonth, nTicksPerSeason, bIsEndOfMonthTick, ...`),
  `MsgType_ParkTimeStartOfSeasonMessage`, `MsgType_ParkTimeStartOfPeriodMessage`.
- **Speeds:** pause, 1x, 2x, 5x (`windows.mainhud.lua:48` `c_nTimeScales = {1, 2, 5}`,
  `api.time.SetTimeScaler`, `api.time.Pause("World")`). That the calendar stops while paused and
  scales with speed is a **guess** (engine side). `ScenarioManager:GetParkPlayedTime()` is real time.
- **Frame deltas** (**offline**): `SelectMode.Advance(self, _nDeltaTime, _nUnscaledDeltaTime)`
  (`editors.select.selectmode.lua`) gets the scaled and the unscaled frame time;
  `api.time.GetDeltaTime()` / `GetDeltaTimeUnscaled()` read the same anywhere (MainHUD uses them).
  That the scaled one is 0 while paused is a **guess**.
- **`PZ2QoL.GameClock`** (`pz2qol.gameclock.lua`, 2026-10-20): the mod's Lua game clock, seconds
  at 1x. Source: the calendar (`GetTimeOfMonth` months x `GetMonthDurationInSeconds`, as Auto
  mode), else the scaled frame delta its owner passes in (also when the calendar stands still
  for 60 s of frame time), else real time. Reads the calendar every 0.25 s real; steps back or
  faster than 10x count as a jump (load, other park), not time. Lua numbers are 32-bit floats in
  game, so months count from the first year read (`(Year-base)*12 + Month + Prop`; `Year()` may be
  a calendar year like 2026, where `Year*12` alone would leave ~0.002-month steps). Used by
  BoxRelease; `tests/lua/test_boxrelease.lua` section 0.
- **Animal ages are not calendar time:** `animals:GetAge(e)` is in years, scaled by the per-park
  `park:GetInGameAnimalTimeModifier()` (an in-game option); 1 age year = 1 calendar year only at
  modifier 1. Due dates (`GetDueDate`) come back as `TimeOfMonth`.
