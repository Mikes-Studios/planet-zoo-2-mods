# Animals, lineage and inbreeding (game 1.0.4)

All **offline** (decompiled Lua under `src/Content0/`, unpacked UI) unless marked otherwise.
Used by the proposal `docs/PROPOSAL-inbreeding-qol.md`.

## How the game decides "inbred"

- The only check is Lua: `CompareMatesPopup.CompareParentsForInbreeding`
  (`editors.animal.comparematespopup.lua`). It flags a pair when one is a parent of the other or
  when they share a parent (full or half siblings). It does **not** flag grandparents,
  aunts/uncles or cousins.
- No native "are related" or kinship-coefficient call exists, in Lua or in the exe's API names.
  The only inbreeding strings in the exe are `InbreedingRisk`, `InbreedingImminent`,
  `PregnancyInbreeding` and `VM_InbreedingRisk`.
- The result is written only for the selected pair, to `['compareMates','offspring']` →
  `inbred`. The UI then shows `[AnimalExchange_Inbred]` (`OffspringDisplay.js`).
- Market listings return `{}` for parents, so they are never flagged.
- The genetic cost: fertility and immunity grades count the loci where an animal's two allele
  strands differ (`CompareMatesUIUtils.GetMinMaxGeneGrades`). Related parents share alleles,
  which lowers their offspring's fertility and immunity. The UI prediction is in code; that the
  native breeding uses the same rule is **inferred**.
- A **0% fertility** (or immunity) grade means both strands are identical at all 6 loci, which is
  what deep inbreeding produces. Such animals pass identical strands on, so their young score low
  too. The developer saw them survive Thin out (2026-10-16) because it only used the average gene
  score; `kincull.js` now sends them away from every habitat by default (`zeroFertility`,
  `fertilityGene()`). **offline** (grade rule from `ownGrades()` in `kincore.js`)

## Lineage APIs (`api.world.GetWorldAPIs()`)

- `animals:EntityIDToAnimalGUID(e)` / `AnimalGUIDToEntityID(guid)`: return 0 if absent.
- `animals:GetParents(guid)`: a table of parent GUIDs, with `""` for an unknown parent.
  Synchronous and local. Works in park and in the hub for storage animals (ID type 2).
  Whether it still answers for dead or traded animals is **open**.
- `exhibits:GetAnimalFamilyMemberUID(uid, 0|1)`: parent 1 or parent 2 of an exhibit animal.
- Collective species (shoals, colonies such as butterflies) breed as one group, so Kin leaves them
  out. The game's own checks take the species symbol (`sSpecies` of `GetUIAnimalListDataForIDs`):
  `animals:IsSpeciesABoid(sp)` (shoals) and `exhibits:IsColonySpecies(sp)` (returns colony,
  aquatic boid, air boid), as `ParkRatingManager` and `ExhibitAnimalInfoPopup` use them. In
  storage and market rows the flag is `isShoal`, which the exhibit popup also sets for colony
  animals. Kin sends `speciesFacts[sp].collective` (`pz2qol.kin.lua` `_SpeciesFacts`) and skips
  those species in `buildKinModel` and the Species board list; storage skips `isShoal` rows
  (`kinstorage.js`). **offline** (1.0.5 decompiled Lua; not yet seen in game).
- `franchise:RequestAnimalData` / `GetAnimalData`, `RequestFamilyTreeData` /
  `GetAnimalFamilyTreeData`, `GetAnimalChildren`: **asynchronous** (the reply arrives via
  `MsgType_LocalAnimalDatastoreUpdatedMessage`) and may need the server in Franchise. Don't use
  them for bulk scans.
- `animals:GetMateData(e)` returns `{bIsBeta, bIsMonogamous, tMateData={{nID,sName,nGender}}}`.
  `GetRelationship(a,b)` is the social bond, not kinship.
- **Compare Mates' "can't conceive" verdict** (`CompareMatesPopup._SetOffspringData`, **offline**, 1.0.5):
  `state = NEGATIVE` when either animal's `GetMatingWarnings(id, type).bMatingBlocked`, or the
  best-case conception chance is 0, or either `animals:GetMatingMonogamyIcon(self, other,
  otherIdType)` is `"IconLock"` (checked both ways; `"ring"` = they are mates). `inbred` is worked
  out separately, so the game itself keeps "related" and "can breed" apart. A contraception-only
  warning is `tWarningsArray[1] == "IconFailedConception"`.
- **A monogamous bond outlives the mate's presence** (`AnimalInfoPopUp._UpdateBondedMateData`,
  **offline**): `tMateData[1]` is still listed when the mate is dead (`IsInDeathState`), has left the
  zoo (no assigned habitat) or was moved (`not IsInHabitat` or another assigned habitat). The panel
  then shows a broken-bond timer, `GetCurrentMournTimeForUI(e)` → `sText, nMournTime`. So PZ2QoL's
  `mateIds` (`pz2qol.kin.lua`) can include absent or dead mates. Whether `IconLock` still applies
  while mourning, and whether it ends with the timer, is **open** (needs an in-game probe).
- **PZ2QoL uses this as "Bonded elsewhere"** (severity `held`, 2026-10-16; `docs/PLAN-pair-bonds.md`).
  - Lua's bond pass (`Kin._BondStep`, after every animal is read, `Kin.nBondPerFrame` calls per
    frame) runs for monogamous adults with a mate. Each one gets `GetMatingMonogamyIcon(e, mate, 0)`
    (the `ring` check) and `GetMatingMonogamyIcon(e, o, 0)` against every other adult of its species
    in its habitat with a compatible sex. It records `bond = { mate, ring, lock: [ids], mourn }` and
    the snapshot gets `bondsOk`. If the call is missing or every call fails, `bondsOk = false` and no
    bonds are recorded. Debug builds log the outcome as marks (`kin_bonds_ok|none|some_failed|unavailable`,
    `kin_bonds_locks|no_locks`) when it changes; `trace()` text never reaches `dbg/trace.log`.
  - The JS rule is `kincore.js` `bondHold`/`bondIntact`. A risk or close-kin pair is held only on
    a lock from either side **and** while the bonded mate is alive, in the model and in the same
    habitat. A mate at the vet or in transport is in no habitat list, so Lua also sends
    `bond.here`: `GetAssignedHabitatEntityID` is the same for both and `IsInDeathState(mate)` is
    false. That keeps the hold (but not when the mate is in the trade centre). Otherwise the pair
    stays a risk (fail-safe: a mourning animal is warned about).
  - `newRisks` gives "Bond ended" only when the bond really broke. A missing lock with the bond
    still whole gives no alert.
  - Plans clear the bond of moved animals and of their mates (`plannedSnapshot`), and a rebuilt
    model keeps `model.opts` (the switch `bondHolds`).
  - **Proven 2026-10-17 (Y:, Franchise zoo, build 1023906):** `GetMatingMonogamyIcon(e, other, 0)` exists
    in retail and returns `IconLock` for real pairs. Trace `kin_bonds_ok` + `kin_bonds_locks` on every
    scan, no failed calls.
  - The lock semantics (I1: only an animal with a mate locks; I2: a lock really means no
    conception) are **guess** until the in-game probe in the plan has been run.
- Decompiled 1.0.5 Lua and unpacked UI from an earlier session were left in a scratchpad
  (`%ProgramData%\ao-home\AppData\Local\Temp\claude\C--Github-Planet-Zoo-2-Mods\96a3309f-…\scratchpad\unpack\lua\Content0`);
  that is temporary, so unpack again if it's gone.
- `animals:GetGenes(e)` returns 12 alleles per stat (strand A = 1..6, B = 7..12).
  `GetGeneticGrades(e)` returns grades from 0 to 1.
- `animals:GetMatingWarnings(id, idType)` is for one animal only; it is not a pairwise
  inbreeding check.
- Compare Mates ID types: 0 entity, 1 listing, 2 GUID, 3 exhibit entity, 4 exhibit UID,
  5 exhibit listing, 6 exchange, 7 markets GUID.
- GUID type (string or number) is **open**; Compare Mates calls `tonumber` on some of them.

## Habitats and per-animal state

- `habitat:GetHabitats()`, `GetAnimalsInHabitat(h)` (entity IDs), and
  `GetSortedAnimalsPerSpeciesInHabitat(h, true)` → `{{sName, tIndividuals}}`
  (`helpers.notificationtasks.lua`, `components.ui.habitatgateinfopopup.lua`).
- `animals:GetAssignedHabitatEntityID(e)`, `IsInHabitat`, `GetGender`, `GetAgeStatus`,
  `IsUsingContraceptive` / `SetUsingContraceptive`, `IsInfertile`, `IsPregnant`, `GetName`,
  `GetSpecies`, `IsAlive`.
  `GetSpecies` gives the species id (e.g. `Warthog_Common`); its display name is the text symbol
  `Animal_<id>` (`[Animal_Warthog_Common]`), **offline** (see ui-gameface.md "Localisation").
- `animals:GetUIAnimalListDataForIDs(tIDs)`: the management list's bulk read (50 per frame). It has
  no lineage or habitat-ID fields.
- Moving an animal goes through `AnimalMovementMode` →
  `animals:AttemptRequestToTransportAnimalToTarget`.

## Bulk animal data

- `animals:GetUIAnimalListDataForIDs(tIDs)` returns `{[entity] = {sName, sSpecies, nGender (0 m, 1 f,
  2 unisex), nAgeGroup (== animals.Juvenile for young), bIsUsingContraceptive, bIsInfertile,
  bPregnant, bAlive, bAlpha, nLocationType, sLocation (habitat or exhibit name, same text as the
  Animals list's location), nLocateEntity, bBoxed, ...}}`. Exhibits have the same call on
  `exhibits` with UIDs from `exhibits:GetAllAnimalIDs()`. **offline** (field names from
  `editors.park.animaldatabasetab.lua`).
- Contraception: the Animals list and info panel both just call
  `animals:SetUsingContraceptive(entity, b)` (exhibits: `SetExhibitAnimalUsingContraceptiveUsingUID`).
- **Exhibit animal UIDs can be GUIDs, not numbers** (a 3.2.0 player's Franchise log: `bad animal id x01a1583f-37da-76dd-b9aa-ea664ebd5888`). The Kin page id is `"x" .. idString(uid)`, so `tonumber` can't turn it back. The scan keeps each exhibit animal's UID on its record (`Kin.tStatic[key].uid`; an ancestor's in `Kin.tExhibitUid`) exactly as `GetAllAnimalIDs` gave it, and `Kin._EntityOf` passes that value back to the game (`pz2qol.kin.lua`). **proven** (that the GUID form exists); the round trip is **offline**.
- Locate: `CameraModeManager:RequestMode("Orbit", {targetEntityID = nLocateEntity, bLocate = true})`
  then `InfoPopUpComponent:CreateAndOpenInfoPopUpForEntity` (the Animals list's own locate).
- **Locating a habitat or an exhibit** (**offline**, 1.0.5): `GuestUIUtils.FocusCameraOnEntity(transform,
  InfoPopUpComponent, CameraModeManager, entity)` (`helpers.guestuiutils.lua`) walks
  `transform:GetParent` up to the first entity with `HasInfoPopUpComponent`, then the same Orbit +
  info panel. The Habitats list passes `GetUIHabitatListData()[nId].nLocateEntity`, where the list
  is **keyed by the habitat entity id** (its rename handler calls `api.ui2.SetEntityName(nId)`;
  `editors.park.animaldatabasetab.lua` ~2220-2291, aquariums the same list with `bIsAquarium`); the
  Exhibits list passes the exhibit entity (~2611). PZ2QoL `Kin.LocatePlace` (`PZ2QoL_KinLocatePlace(place,
  sample)`) copies it: habitat → list entry by key, by `sName` == `GetEntityName(h)`, the habitat
  entity itself, then a resident's `nLocateEntity`; `xe:<n>` → the exhibit entity; `xh:<name>` →
  `GetAnimalParentExhibit(ExhibitAnimalUIDToEntityID(uid))` of a sample animal. Trace
  `kin_place_list|name|entity|animal|exhibit|fail`. Not yet seen in game.
- The game's offspring gene prediction (`GetMinMaxGeneGrades`): genes are letters, strand A = 1..6,
  B = 7..12; the young get one strand from each parent (4 equal combinations). Fertility and
  immunity = loci where the two strands differ (0..6); size and longevity = count of 'A'/'B'
  alleles in both strands (0..12). Kin's `predictOffspring` mirrors it.

## UI surfaces and keys

- No row in any list (zoo Animals, Habitats tab, habitat panel, storage, market) has a parent,
  lineage or relatedness field.
- Zoo Animals list row `id` = `"animal_<entityID>"`, or `"exhibit_animal_<uid>"`
  (`AnimalID` in `editors.park.animaldatabasetab.lua`).
- Habitat panel: `...tab_habitatAnimals.speciesList[<species>]` has the male/female counts plus
  `animalsList`. Each row's `id` = `tostring(entityID)`, and it has `warningIcon` /
  `warningsContext` slots (`AnimalStatusItem`).
- Info panel Studbook tab: `tab_animalStudbook` → `familyTreeParentsInfo` /
  `familyTreeSiblingsInfo` / `familyTreeChildrenInfo`, with items `{id, name, gender, inZoo,
  absentLabel, isMate, ...}`.
- Genealogy popup `['genealogy']`: `parents|siblings|mates|offsprings/dataProvider` (GUIDs) give
  one generation each way. It has no location or alive flags. Events: `Genealogy_UI_Select(id)`,
  `_Back`, `_Close`, `_ToggleOffspring`, `_ResetOffspring`. Lua opens it with
  `PopupAction_ShowGeneaologyPopup(bool)` (the game's spelling).
- Compare Mates `['compareMates']`: the `mothers|fathers/<animal_<id>_<idType>>` candidate rows
  carry a `warningIcon` but none of their icons is about kinship. Events:
  `CompareMates_UI_SelectMother/SelectFather(id)` and `_ContraceptionToggled`.
- Heatmap: `InbreedingRisk` (`[HeatMap_Breeding]`, Animals category, sub-index 1) is drawn by the
  engine (`VM_InbreedingRisk`). Select it with `Heatmaps_Select('InbreedingRisk')`. Per-animal
  values can't be read. A Notifications-database entry opens it; that entry's name is **open**.
- `geneticsTooltip` on zoo rows is defined in the schema but no game component renders it.
- Contraception from the UI: `ManagementAnimals_ContraceptionToggled(id, bool)` and
  `InfoPanel_Animal_Contraceptive(bool)`.
- **"releasable" in the Animals tab's species search** (2026-10-25, `pz2qol.releasable.lua`,
  **offline**): typing `releasable` or `release` lists only the animals that can go to the wild,
  so a habitat's or the zoo's can be ticked at once and sent to the trade centre for release
  groups. Eligible: the game's own check (`animals:CanReleaseAnimal`, exhibits
  `CanReleaseAnimalUID`), or a juvenile held back by its age alone (finalising a release group
  matures it; `GetRelocatePreventers` against `RelocateAnimalsPopup.g_tReleasePreventers`). It
  patches `Editors.Park.AnimalDatabaseTab`'s search and reads only; marks `releasable_*`.

## Popups and storage (found while building Kin)

- Genealogy opens via `InfoPanel_UI_Select('genealogy')` (the info panel's animal) or the
  management footer id `'genealogy'`, which only works with exactly one non-exhibit animal
  selected. Its row DS `id` is the GUID (a **number** in JS) or `'unknown'`; the row's DOM root `id`
  is the GUID. GUIDs above 2^53 lose digits as JS numbers: Lua sends them as strings, and the page
  matches numbers as a fallback. **offline**
- Compare Mates lists adults only, sorted by `sortField` (written by Lua `_SortMates`); a row's key
  equals its `id`, `animal_<id>_<type>`. `ParentListItem_leftChildren` is 200 px with overflow
  hidden; `AnimalListButton_root` is `position: relative`; `OffspringDisplay_root` has a fixed
  height of 26.8rem. **offline**
- Storage row roots are `position: absolute` (set inline by the Repeater). The storage info panel
  shows Cancel instead of Send to Zoo when a selected row has `isMoving`. **offline**
- Game popups add `.PopupActionsModule_root.show`; fixed mod overlays (toolbars, toasts) should
  hide while it is there. **proven** in the harness.

## Moving animals (Species board)

- **Trade-centre animals are not in `animalsDataHelpers:GetAllAnimalEntities(AnimalListType_Habitat)`**
  (offline, 2026-10-16). The game reads them separately with
  `AnimalListType_HabitatInTradeCenterWithEntities` (`helpers.notificationtasks.lua`
  CheckNoStaffForDelivery). Kin's scan read only the Habitat list, so newly bought animals never
  reached the Species board or the breeding programme. `Kin._StartPark` now adds the second list
  too (Lua test: animal 7, `lt == "trade"`). In-game check pending.
- **Park "trade centre" ≠ hub Animal Storage** (offline 1.0.5, 2026-10-18; developer saw ~8 of a
  species in Storage, 3 on the Species board). The game calls every storage row "In trade centre"
  (`AnimalMarketAndStorageSchema.js` `getAnimalLocationString`: `[AnimalExchange_InTradeCentre]`
  unless `isMoving`), and the trade centre's panel has no animal list, only a capacity and an
  "open storage" button (`FacilityInfoPopUp.CreateOverviewTabTradeCentre`, `_OpenAnimalStorage`).
  In the park only the stored animals **with entities** are scannable (the enum's own name);
  the rest are GUID records: Compare Mates adds them as GUIDs (type 2) from
  `api.planetHub.GetAdultsOfSpeciesInStorageSplitByGender` (Franchise only, adults only).
  Which stored animals keep an entity (sent there this session? awaiting delivery?) is a **guess**.
  So the board's trade column shows a subset; storage-only animals need the planetHub call.
  Since 2026-10-18 the board's pinned trade column lists them too (Franchise): `kinboardcore.js`
  `storedCards` / `boardColumns({ stored })` fill `trade.stored` (skips an animal whose guid or id
  the park scan has; relatives from `withStored`'s merged pedigree against the species' park
  animals of a compatible sex; counts and risk untouched), `kinboard.js` `storedGroup` renders them
  read-only ("N here · +M in storage", first 6 then "N more", Storage shortcut, hover relatives,
  a plain relation line; no inbreeding badge or stripe: stored animals can't breed, developer 2026-10-18).
  Asked once per species per board opening, and on Rescan. Stored young are never listed: the
  park only gets adults. **Find a habitat can't apply** from the park: it arms the hub's own Send
  to Zoo on storage rows (`storagesend.js` on the Frontend page), and `Kin.Move` needs an entity.
  Since 2026-10-18 the stored block has **Bring <species> to the trade centre** (`storagefetch.js`,
  see "From storage to the trade centre" below), which does exactly that hub step from one click.
  In-game check pending: does "N here · +M" add up to the storage screen's adults?

- **There is no batch move in the game (offline, 2026-10-16).** Every multi-select move is a Lua
  loop of single-animal calls:
  - The Management Animals Move button (`editors.park.animaldatabasetab.lua:701`) opens
    `AnimalMovementMode` with `tSelectedAnimals`.
  - `HabitatAnimalDestinationSelected` (:736) then runs `CanTransportToEntity(false, dest)` once.
    It claims boxing for every animal that doesn't need staff; if any is already claimed it moves
    none. Then it loops `AttemptRequestToTransportAnimalToTarget(e, dest, nType)`, stops at the
    first failure, and keeps the claims on success.
  - Bulk trade-centre send, Sell and Release (`RelocateAnimalsPopup`) are loops too.
  - The exe's animals API has no list-taking transport.
  - The only list hand-over is the hub's `planetHub.StorageUISetAnimalsToBeSentToZoo(tIDs, bReturn)`
    (`AnimalStorage_SendToZoo`), a queue that `SelectMode` reads in the park via
    `park:GetAndClearPendingSendToZooEntityIDs()`.
  - So a mod's "group move" is the same loop in Lua (one event from JS, one destination). Opening
    the game's movement mode remotely is not recommended: it is mouse-driven, yields, and is where
    the 1158 crash happens. Batching doesn't reduce server traffic (**guess**).

All **offline** (decompiled `editors.animal.animalmovementeditmode.lua`,
`editors.animal.relocateanimalspopup.lua`, `components.ui.animalinfopopup.lua`); Lua mock tested.
- **Valid destinations** (`AnimalMovementEditMode.UpdateValidDestinations`): every
  `habitat:GetAllCompleteHabitats()` entry where `editors:IsValidTutorialPlacement(h, false)` and
  `animals:IsValidHabitatForAnimalsGUID(h, {guids})` hold, except an aquarium whose gate is above the
  water (`habitat:IsAquarium`, `IsAquariumGateBelowWaterLevel`). Quarantines
  (`facilities:GetQuarantines()`) and exhibits (`exhibits:IsExhibitValidDestination`) are separate.
  On hover the mode also checks `staff:CanStaffDeliverAnimalToFacility(entity, h)` (reachability).
- **The move** (`HabitatAnimalDestinationSelected`): `bCan, nType = animals:CanTransportToEntity(false, h)`;
  for animals with `DoesTransportRequireStaff(e, h) == false` claim the box (`IsBoxingClaimed` /
  `ClaimBoxing`); then `AttemptRequestToTransportAnimalToTarget(e, h, nType)` (returns a bool) for
  each animal; release the claims (`ReleaseBoxing`) when the transport is refused.
- **Trade centre: use `animals:AttemptToSendToTradeCentre(e)`** (proven 1.0.4): what the info
  panel, radial menu, habitat gate and facility panel call, after `animals:CanSendAnimalToTradeCentre(e)`
  and capacity `park:GetNumberOfAnimalsInTradeCentre() < park:GetTradeCentreMaxCapacity()`. The game
  picks the centre and books the keeper. **Pitfall (proven):** `AttemptRequestToTransportAnimalToTarget(e,
  tc, nType)` (as in `RelocateAnimalsPopup._AttemptSendToTradeCentre`) returns true for a habitat animal
  but nothing happens: no transport job, the animal stays. Used in `pz2qol.kin.lua` `Kin.Move`.
- **The Animals list's own bulk Send to Trade Centre is all-or-nothing** (1.0.5, **offline**,
  `editors.park.animaldatabasetab.lua` `GetAnimalRelocationStats` / `CanExchange`): one ticked animal
  failing `CanSendAnimalToTradeCentre` (already in the trade centre, boxed, in the vet, escaped,
  dead) sets `nCanSendToTradeCentre = 0` and greys the footer button (`exchangeButtonEnabled`) for
  the whole selection, so Select all never works once any animal waits in the trade centre. The
  button then opens `RelocateAnimalsPopup` (`g_sModeSendToTradeCentre`, `Fanfare_SetDataExchange`),
  whose send is the no-op transport above. That is why players send one animal at a time.
- **Out of the trade centre** (`FacilityInfoPopUp` trade centre tab, **offline**): Move opens the
  same `AnimalMovementMode` as for habitat animals (so `AttemptRequestToTransportAnimalToTarget`
  works from there); **Return to habitat** is `animals:RequestTransportToAssignedHabitat(e)` (the
  animal keeps its assigned habitat while it waits). Location: `animals:GetCurrentLocationType(e)`
  vs `animals.CurrentLocationType_TradeCentre`. `Kin.Move` uses Return when the target is the
  animal's own habitat, else the usual Move. The breeding programme counts trade-centre breeders
  (`lt == 'trade'`) as breeders without a group (`useTradeCentre`, default on).
- **Busy animals:** `animals:GetAnimalTransportData(e).bHasTransportJob`, `IsBoxAnimating`,
  `IsBoxingClaimed` (the info panel disables Move on these); `api.planetHub.IsPlayerAnimalMovementEnabled()`.
- `animals:GetUIAnimalListDataForIDs` location types: `animals.CurrentLocationType_Habitat`,
  `_TradeCentre`, `_VetSurgery`, `_Quarantine`, `_FreeRoaming` (escaped), `_BeingCarried`.
- Game mode in a park: `franchise:GetPlanetHubType() == franchise.PlanetHubType_FranchiseOnline`.
- `api.ui2.GetEntityName(entity)` gives a habitat's or facility's name.
- PZ2QoL Kin runs **one** move per `PZ2QoL_KinMove` exactly this way; a staged plan is sent one move
  at a time, each confirmed by the next scan (`bHasTransportJob`) before the next, and in a
  Franchise (or unknown-mode) zoo only with the player's opt-in (`allowPlansOnline`, off by default).
- Park name: `park:GetParkName()` (world API `park`). PZ2QoL keys habitat assignments by it inside
  each zoo's data, and the player store keys offline parks by it (Franchise zoos by their GUIDs;
  see lua-runtime.md "the player save").
- **Habitat entity ids are not kept across loads** (**proven** by the developer, 2026-10-16, game
  1.0.5: saved assignments landed on the wrong habitat or on ids that no longer exist, shown as
  ghost columns on the Species board). Never save an entity id (habitat or animal) for use after a
  reload. Stable across loads: animal GUIDs (lineage keys), habitat names (until renamed).
- A habitat also has a separate **habitat id**: `habitat:GetHabitatIDFromEntityID(e)` /
  `GetEntityIDFromHabitatID(n)` (**offline**; boundary panels keep it as `nLeftHabitatID`, used by
  `HabitatGateInfoPopUp` and the boundary edit mode). Whether it survives a load is a **guess**.
  PZ2QoL sends it as `hid` (snapshot `habs`: every habitat, empty ones too; destinations) and uses
  it only as a tie-break. Trace: `js_assign_hid_same` / `js_assign_hid_diff` after a reload tell.
- PZ2QoL saved assignments: `{ species, name, hid, guids (≤ 8 residents), seen }`, matched to
  today's habitats by `kinboardcore.js resolveAssignments` (residents, then name, hid as tie-break;
  the entity id counts only within the load the player clicked in) and re-keyed to today's ids
  once the zoo's data is read; unmatched entries are hidden and dropped after 3 loads. A load
  counts as a miss only when the snapshot carries the full habitat list `habs`
  (`kinboardcore.js fullHabitatList`): without it empty habitats are missing from the model and
  would age out (data loss).
- **Visiting a Franchise wildlife reserve reloads the zoo** (**proven**, trace on Y 2026-10-16
  21:12–21:29, game 1.0.5): zoo → reserve → zoo is a park end + park start each way. The reserve
  gets its own player-store key (`assign_store_franchise` + `assign_store_empty`), and the zoo
  comes back with new habitat entity ids, so with a build that keys by entity id alone every
  round trip leaves ghost habitats. The JS kin park model is dropped on `PZ2QoL_StoreReset`
  (`kin.js`, trace `js_kin_park_reset`) so a page that outlives the park never matches saved
  assignments against the previous load's ids.

## From storage to a habitat ("Find a habitat", 2026-10-16, **offline**)

- Storage's Send to Zoo does not place animals. `StorageUISetAnimalsToBeSentToZoo(ids, false)` plus a
  world transition; back in the park `SelectMode`'s Advance takes them with
  `park:GetAndClearPendingSendToZooEntityIDs()` → `(tEntityIDs, bReturnToHabitat)` and calls
  `BaseUIMode.SetNewMode("AnimalMovementMode", {tSelectedAnimals = tEntityIDs})` (exhibit animals:
  `GetAndClearPendingSendToZooExhibitAnimalGUIDs`, `bIsExhibit = true`). With `bReturnToHabitat` it
  calls `RequestTransportToAssignedHabitat` for each instead (after `CanStaffDeliverAnimalToFacility`).
  The market's Send to Zoo is `MarketUISetAnimalToBeSentToZoo(id)`, the same path.
  (`editors.select.selectmode.lua`, `startscreen.globe.animalstoragehubmode.lua`)
- The Move screen gives **one destination to the whole selection**: valid habitats need
  `IsValidHabitatForAnimalsGUID(h, allGuids)`, so a mixed-species selection usually has no habitat
  at all. Right-click (`EndPlacement`) leaves the animals where the game put them.
- `VerifyHabitatAnimal(e)`: alive and not escaped, or escaped **and boxed** (arrivals may be boxed).
- **Boxed animals** (**offline**, 1.0.5): the game's only warning is the native notification
  `AnimalBoxedOutsideOfHabitatForProlongedTime` (`helpers.notificationalerts.lua` ~50-54), after a
  long time. Readable: `animals:IsAnimalBoxed(e)`, `bBoxed` in `GetUIAnimalListDataForIDs`
  (`animaldatabasetab.lua` ~1203), `GetAnimalTransportData(e).bHasTransportJob`,
  `GetCurrentLocationType`. PZ2QoL sends `boxed` in the Kin snapshot (only when true) and
  `kinboxed.js` / `kinboxedcore.js` alert (Needs you) when an animal is boxed, has no transport
  job, is in no habitat and its `lt` is not habitat/vet/quarantine/transit (trade only with the
  setting) for `boxedAfterS` (default 10 s); buttons Locate and Find a habitat (one `PZ2QoL_SendMove`
  via `storagesend.js askFacts` + `pickHabitat`). Which `lt` a boxed animal waiting for a
  destination has is a **guess** (FreeRoaming likely); trace `js_kin_boxed_<lt>` tells.
- **Animals boxed inside their own habitat are boxed by native SOS code** (**offline**, 1.0.5,
  `docs/RESEARCH-aquarium-boxing.md`). No game Lua boxes an animal by itself; `BoxAnimal` is only
  called from player buttons. Exe strings show `AnimalSOSComponentManager`, which boxes an animal
  when `NavAgentInHabitatComponentManager::CanGetToResultArrived()` fails ("Current Situation:
  %s"), when a species is in an aquarium it doesn't use, on `SOSAnimalsForNavRebuild` (Lua calls
  it at load when `navigationworld:LoadedOldMesh()`, `worlds.darwinworld.lua` ~642), and at spawn
  with no dwelling point. Each SOS has an `i_unbox` flag, and the automatic unbox fails "on animal
  which is not on accessible land", so the animal can stay boxed with
  `DoesAnimalWantToBeLetOutOfBox` true ("Boxed for too long") until the player unboxes it. The
  Unbox button is `ClaimBoxing(e)` then `UnboxAnimal(e)` (guard: `IsAnimalUnboxableByPlayer`,
  `IsBoxWaitingForNavMeshRebuild`). `animals:SOS(e)` is a retail API (debug "SOS from here").
  The reachability check and the SOS decision are out of a mod's reach; releasing the animal
  isn't. Aquarium species use 3D underwater nav worlds, and juveniles often a smaller one than
  adults (`animals.fdb` `Navigation_Navmesh`; e.g. Sand tiger R-0.5 → R-2.5). Whether that makes
  an animal fail the check when it grows up is a **guess**.
  Debug builds trace it: `pz2qol.boxtrace.lua` (area `box`: park/hab/start/change/still/end/age/msg;
  a position trail with metres below the surface, above the floor and to the nearest lake side
  before each boxing). Test: `tests/lua/test_boxtrace.lua`.
  **Proven** on Y: (2026-10-19): aquarium turtles were boxed mid-water (7 m deep, 1-2 m off the
  floor), not at the surface. A game-made boxing shows `claimed`+`animating` for 2-4 s, then
  `claimed=false, unboxable=true`, with no `reqUnbox` ever; `wantsOut` turns true after ~2-3 min.
  Land and shore animals get `reqUnbox` and come out after 2-6 s. Park load unboxes saved-boxed
  aquarium animals. Details: `docs/RESEARCH-aquarium-boxing.md`.
  **The fix** (`pz2qol.boxrelease.lua`, `boxrelease.js`, Kin setting `releaseBoxed`, default on): from
  `SelectMode.Advance` (main mode, not the worker-thread manager tick), every 2 s, aquarium animals
  and deep swimmers that are boxed, unboxable, unclaimed, have no job, are not requested
  boxed or unboxed, and are not waiting on the navmesh, for 20 s get `ClaimBoxing` + `UnboxAnimal`,
  one at a time, 2 s apart. After 3 quick re-boxings (within 120 s of a release) the mod rests for
  600 s and shows a Needs-you alert; a release itself shows nothing (developer 2026-10-19). Tests:
  `tests/lua/test_boxrelease.lua`. **Proven** working in game on Y: (developer, 2026-10-19; then
  on real time: 30 s wait, 3 s scans).
  **All those times are game time** since 2026-10-20 (developer: real time was far too slow at
  5x): `PZ2QoL.GameClock` (`pz2qol.gameclock.lua`, see `game-data-and-events.md` "Park calendar
  and game time"). At 5x a stuck animal is out ~4-5 real s after boxing; paused, nothing runs.
  Real-time floors keep 0.5 s between scans and between releases. The trace's `release` `clock`
  LOG line names the clock source (`calendar` expected; game-time version **offline** only).
  **Overdue mothers** (2026-10-25, Kin setting `overdueBox`, off by default, **offline**): a mother
  still pregnant at twice her species' pregnancy gives birth once she is boxed and let out in
  place. `kinbirth.js` asks for it once per pregnancy (`PZ2QoL_Rebox`); `BoxRelease.Rebox` boxes
  her the way the player would (`IsAnimalBoxableByPlayer`, `ClaimBoxing`, `BoxAnimal`) and the
  release scan lets her out whatever `releaseBoxed` says. Tests: `tests/lua/test_boxrelease.lua`.
  **Stopped after a park reload** (**proven**, Y: 2026-10-20, 3.2.0 debug trace): in the first park
  of a launch it released ~20 animals; after the player left the park and loaded one again
  (`x_park_end` → `x_hud_init`) it released nothing for 40 min although turtles sat boxed,
  unclaimed and unboxable for 50-104 s (BoxTrace saw them). No `release error`, no second
  `release_patched`. Cause not pinned (no per-tick trace then): Select not the current mode, a
  fresh world-API table per call (the old code reset its waits whenever `animals` was another
  table), or a lost patch. Fix (offline, 2026-10-20): ticks from `Worlds.DarwinWorld.
  OnAdvanceWhileRunning` too (park world, every frame, any mode); a new park is the HUD's
  `PZ2QoL_ReleaseSet`, not a changed table; stands down while `Kin.bStartScreen` and, for the world
  tick, between DarwinWorld `OnDeactivate` and the next `OnActivate` (the pause menu pauses the
  world, `windows.mainhud.lua` `OnPauseMenu_Open`, so game time stops during the exit save). Trace: `release
  tick src=world|select` (first tick after each Set) and `release scan habs aquariums animals stuck
  due apiChanges clock` (after each Set, then every 30 s while any are stuck).
- **Storage arrivals are already in the trade centre** (**proven** on D:, 2026-10-18, game 1.0.5,
  Franchise): after the hub's Send to Zoo, every arrival the mod took from the Move-screen request
  read `GetCurrentLocationType == CurrentLocationType_TradeCentre` at once (trace: 10 ×
  `fetch_arrival_lt_trade`, 0 move requests), and the board showed them in the trade centre. So
  leaving the Move screen (or taking its request) leaves them waiting there, movable like any
  trade-centre animal. Hub → zoo after Send to Zoo took ~0.5 s (`js_fetch_hub_sent` 15:35:30.59 →
  `send_taken` 15:35:31.05). Pitfall when reading the alerts: `helpers.notificationalerts.lua` entries are `fAddressedAlert`
  tests (when the alert counts as dealt with), not when it fires, so
  `AnimalBoxedOutsideOfHabitatForProlongedTime`'s `IsAnimalBoxed and IsInTradeCentre` says nothing
  about where arrivals wait. PZ2QoL traces it on arrival (`fetch_arrival_lt_<lt>`). Kin.Move accepts
  boxed escaped animals as the Move screen does.

## From storage to the trade centre (2026-10-18, **offline** 1.0.5)

- **Franchise: the trade centre's capacity is the whole account's storage** (**proven** by the
  developer, 2026-10-18, game 1.0.5): a zoo's trade centre panel showed 90/250 = every stored animal
  across all zoos. The panel reads `park:GetNumberOfAnimalsInTradeCentre()` /
  `GetTradeCentreMaxCapacity()` (`FacilityInfoPopUp.CreateOverviewTabTradeCentre`), so in Franchise
  these two are the shared storage pool, not one zoo's room. Stored animals count there, yet only
  those sent to this zoo have entities the park can move (the rest are GUID records). PZ2QoL labels
  the number "storage, all zoos" in Franchise. Whether a stored animal sent to the zoo changes the
  count is **open**.

- **No park-side call moves a stored animal into the zoo.** Every `api.planetHub.*` call in the
  decompiled Lua and every exe Lua-name string with Storage / SendToZoo / TradeCentre was checked:
  the park can only read storage (`GetAdultsOfSpeciesInStorageSplitByGender`). The park has no
  storage or trading screen (the `AnimalTrading` UI mode is dead; the trade centre's "Open storage"
  is a world transition to the hub). So it always takes the hub's Send to Zoo.
- `facilities:CreateAnimalInTradeCentreFromGUID(guid, token)` exists, but the game uses it only for
  an exhibit animal moved to a habitat (`AnimalMovementEditMode.HabitatAnimalDestinationSelected`
  ~939). Calling it for storage records is not a normal game request: don't.
- **The Move screen offers the trade centre** for any selection (storage arrivals too):
  `UpdateValidDestinations` adds each `facilities:GetTradeCentres()` entry when
  `GetTradeCentreMaxCapacity() >= GetNumberOfAnimalsInTradeCentre() + #selection` (the whole
  selection at once; exhibit animals use `GetExhibitTradeCentreMaxCapacity` /
  `GetNumberOfAnimalsInExhibitTradeCentre`). Picking it calls `animals:AttemptToSendToTradeCentre(e)`
  per animal (~917-933) **without** `CanSendAnimalToTradeCentre` first (only `VerifyAnimals`: alive,
  not escaped unless boxed). The info panel / management "Send to trade centre" is stricter:
  `RelocateAnimalsPopup` `g_tSendToTradeCentrePreventers` = dead, already in trade centre, escaped,
  in vet, **boxed** (`relocateanimalspopup.lua` :34), and `Kin.Move("trade:…")` checks
  `CanSendAnimalToTradeCentre` like them. So a boxed arrival may need the Move screen's own sequence.
- So "storage → trade centre" = the hub's Send to Zoo for the selection (one game action), then in
  the park, per arrival not yet in the trade centre, the Move screen's trade-centre sequence (or the
  game's Move screen itself). Whether the hub's Send to Zoo checks trade-centre room (native
  `sendToZooAllowed`) and whether storage rows include this zoo's trade-centre animals: **open**.
  Plan: `docs/PLAN-storage-to-trade-centre.md`.
- PZ2QoL `PZ2QoL.StorageSend` wraps `Editors.Shared.BaseUIMode.SetNewMode` (SelectMode calls it as a
  module field, so the wrap is seen): only when armed by the mod's button, the first
  `AnimalMovementMode` request with ≤ N entity ids (not exhibits, no return screen) is not opened and
  the ids go to the HUD page, which moves them one at a time with `Kin.Move` (best habitat: own,
  a parent's, its species' biggest group, then any allowed and reachable; least crowded first).
  In a Franchise (or unknown) zoo only with the player's switch (off by default); otherwise the
  vanilla Move screen opens. Not yet seen in game: trace `send_taken`, `send_move_ok`.

## Stored adults as mates (Compare Mates in the park, 2026-10-18, **offline** 1.0.5)

- `CompareMatesPopup._SetParentsData`: next to `animals:GetAllAdultsOfSpeciesSplitByGender(sp)` the
  game adds `api.planetHub.GetAdultsOfSpeciesInStorageSplitByGender(sp)` → `{[1] = male GUIDs,
  [2] = female GUIDs}` **only when** `franchise:GetPlanetHubType() == PlanetHubType_FranchiseOnline`,
  as id type 2 (GUID). It is called synchronously in the popup, so a local read is likely; that it
  never contacts the server is a **guess**.
- Per row: `animals:GetMarketAnimalCompareMatesData(guid, 2)` → `sName`, `tGenes` (grades `nSize,
  nLongevity, nFertility, nImmunity` 0..1), `nGender`, `nMaturity` (`EAnimalMaturity`, 4/5/6 =
  infertile), `nAppeal`, `sRating`, `bForSale`, `sIconName`. Parents: `animals:GetParents(guid)`
  (`CompareMatesUIUtils.GetParents`), alleles `GetMarketAnimalGenes(guid, 2)`. Contraception is
  always false for type 2 (`CompareMatesUIUtils.IsUsingContraceptive`).
- PZ2QoL: `Kin.StoredAdults` (`PZ2QoL_KinStored` → chunked `PZ2QoL_KinStoredChunk`, ≤ 150 per
  species, `tStored` cache cleared at park end; trace `kin_stored_ok|none|unavailable|failed|offline`).
  The page keeps them out of `model.animals` (`kincore.js` `normalizeStored`, `withStored`: a view with
  a merged pedigree) so board, programme, Thin out, badges and alerts are unchanged; the Kin
  planner's Find a mate lists them ("Storage too", Franchise only) and Compare Mates rows of type 2
  in the park get kin badges (`kinmates.js` `storedView`). Not yet seen in game.

## Growing up (Kin alerts levels, 2026-10-18, **offline** 1.0.5)

- **Adult age** (`AnimalInfoPopUp._UpdateStudbookData`): `GetAnimalDeathAge(e) * GetAgeProps(e).nAdult`,
  in the same years as `GetAge(e)` (the studbook timeline's "adult" mark). That the juvenile stage
  ends exactly there is a **guess**; that `GetUIAnimalListDataForIDs().nAge` equals `GetAge` is a
  **guess** too (PZ2QoL sends `adultIn = adultAge - GetAge(e)`, falling back to `nAge`).
- **Group limit**: `GetSocialRequirements(sp)` → `{nMin, nMax}` against
  `habitat:GetNumberOfAdultsOfGivenSpecies(h, sp)`, shown only with the sandbox setting
  `EnableSocialGroups` (`_GetPopulationToleranceUpdateData`). PZ2QoL assumes it is on and counts
  adults from its own scan.
- **Outsiders**: `HasEnemiesInHabitat(e)` (with `EnableSocialGroups`) then `GetRejectionReason(e)` vs
  `RejectionReason_Overpopulation|Maturation|GenderRatio`; for maturation the tooltip depends on
  `GetSocialityData(e).nMaturationType` vs `MaturationType_RejectMales` (matrilineal),
  `_RejectFemales` (patrilineal), `_RejectAll` (solitary), `_RejectNone`.
- **The game has no maturity or birth alerts**: its only population notifications are
  `IsHabitatTooCrowded` / `IsExhibitOverpopulated` (`helpers.notificationalerts.lua`,
  `helpers.notificationtasks.lua`).
- PZ2QoL: the snapshot adds `adultAge`/`adultIn` (juveniles), `out` = `pop|mat|sex|yes` (adults in
  habitats), `speciesFacts[sp].social` / `.maturation` (trace `kin_social_*`, `kin_adultage_*`,
  `kin_maturation_*`); `kinlife.js` turns them into levelled notices (Needs you / Heads-up / note;
  `kinalerts.js`). Notification only. Not yet seen in game.

## Breeding-programme facts (2026-10-15, all **offline**: decompiled Lua, UI, exe strings)

- **The medal (none/bronze/silver/gold) is a genetics rating that the native code calls the "appeal
  state"; it does not raise appeal.** The info panel's `geneticsRank` =
  `animals:GetAppealStateForInfoPopUpUI(e)` (variants: `GetAppealStateForTradingUI`,
  `GetAppealStateFromGUID`, `GetAppealStateFromGUIDFamilyTree`,
  `exhibits:GetAnimalUIDAppealStateForInfoPopUp`); the park list data
  (`GetUIAnimalListDataForIDs` / `GetUIAnimalListData`) carries it as **`sAppeal`** (the Animals
  list's Rating column, `geneticRatings = {none=1, bronze=2, silver=3, gold=4}` in
  `editors.park.animaldatabasetab.lua`) next to `nAppeal`. **offline** 1.0.5.
  - The game's own text (Loc, 1.0.5): "The genetic rating indicates the overall quality of all genes
    of this animal compared to the general population" (`AnimalExchange_GeneticRating`); Gold =
    "Outstanding genetics", Silver "Above average", Bronze "Average", Unranked "Below average"
    (`InfoPanel_Animal_GeneticsRank_*_Desc`). Appeal comes from species, welfare (low welfare up to
    -50%), marketing and guest views (`HelpNode_AnimalAppeal_*`, `InfoPanel_Animal_Appeal_Tooltip`);
    genes are not listed.
  - Market data agrees (**proven**, 116 rows, Y: trace 2026-10-18): within a species appeal is the
    same for every medal (grey wolf Unranked, Bronze and Gold all ~4,000; lower only from
    welfare/views), while the medal follows the mean gene score: Unranked up to 65, Bronze 67-71,
    Silver 73, Gold 73-85 (PZ2QoL `geneScore`, rounded).
  - So Gold is bred for through the genes (one strand per gene from each parent), which the
    breeding programme's mean-genes objective already does. The thresholds are native; whether
    they are the same for every species and how the genes are weighted: **open** (the 73 overlap
    above may be rounding, weighting or a juvenile).
  - Whether appeal restarts low when an animal arrives in a new zoo ("on display for a while before
    reaching maximum appeal"): **guess** yes.
  - The market's `ratings` is the same value (see `game-data-and-events.md`, Genetics medal).
- **Appeal can't be bred for** (developer agreed 2026-10-18): it is a species value lowered by the
  animal's current welfare and time on view, so a listing's appeal says how the animal is kept now,
  not what it is. Breed (and buy, within a species) on genes. A "breed for Gold" goal was tried and
  dropped the same day: the medal follows the mean genes the programme already maximises.
- Gene grades: `GetGeneticGrades(e)` -> `{nSize, nLongevity, nFertility, nImmunity}` 0..1;
  fertility and immunity are out of 6 loci, size and longevity out of 12 (Compare Mates divides
  by these). `geneticDiversity` is a Release-to-Wild group metric only.
- Conception chance: `animals:CalculateProbabilityOfBreedingEvent(welfareMother, welfareFather,
  fertMother*6, fertFather*6, GetAnimalSpeciesFertility(sp), GetMatingResearchBonus(sp))` -> 0..1,
  a pure function (best case welfare 1).
- Social: `GetSocialRequirements(sp)` -> `{nMin, nMax}` adults; `GetSocialityData(e)` -> members
  `{nID, nGender, nAlpha, nType}` + `nMaturationType` (`MaturationType_RejectMales|RejectFemales|
  RejectAll|RejectNone`); outsiders: `GetIntegrationProgress(e)`, `GetRejectionReason(e)`
  (`RejectionReason_Overpopulation|Maturation|GenderRatio`). `GetMateData(e).bIsBeta` (betas
  don't mate), `.bIsMonogamous`; `GetMatingMonogamyIcon(a, b, 0)` -> "ring" (mates), "IconLock"
  (bonded elsewhere). Exe-only, signatures unknown: `GetMonogamyRule`, `GetAlphaRule`,
  `DoesSpeciesFormPacks`; enums `Monogamy|Polygyny|Polyandre|Polygyandry`,
  `AlphaMale|AlphaFemale|AlphaPair|AlphaNone`. Zoopedia datastore (JS, after it is populated):
  `['Zoopedia','Animals','Animal_<id>','Social'|'Habitat']` with group counts, matingSystem and
  `maxMale` / `maxFemale`.
- Space: required `animals:GetSpaceRequirementsInHabitatForSpecies(h, sp)` -> `{nLandArea,
  nWaterArea, nClimbArea, nDeepSwimArea, nFlyArea}` (for the current population); available
  `habitat:GetHabitatSpeciesOverallNavAreaData(h, sp)` -> `bCalculating, {...}` (wait while
  calculating). No Lua call gives a per-animal figure, but the data does: see "Habitat planning
  data" below. `habitat:GetHabitatSpeciesSuitability(h, sp)` has `Space`,
  `SocialGroup`...; `habitat:IsHabitatTooCrowded(h)`.
- **Moving has no stress stat.** Costs of a move are outsider integration (or rejection) when
  joining a group, and mourning when a bonded mate is left (`GetCurrentMournTimeForUI(e)`).
  Pregnancy does not block a move (see "Pregnant animals" below).
- Breeding timing: `GetSpeciesBreedingSeasons(sp)` (array by season), `GetSpeciesFertilityBounds(sp)`
  -> `nMaturityAge, nInfertilityAge` years (>900 = never), `GetMatingWarnings(e, 0)` ->
  `{tLabelsArray, bMatingBlocked, bInfertile}` (Interbirth is a per-animal flag only).
  `IsInfertile` is probably also true under contraception: sterile = infertile and not contracepted.
- **Fertility over a life** (2026-10-16, **offline**): `IsInfertile(e)` (and `bIsInfertile` in the
  list data) is true for juveniles and for adults not yet at the maturity age as well as for old
  animals, so "infertile" alone does not mean "too old". `GetAgeStatus(e)` only has `Juvenile` /
  `Adult`; the **elderly** stage is `GetAgeQuarterForUI(e)` = 3 (0 child, 1 youngAdult, 2 adult,
  3 elderly: `AnimalUtils.GetHabitatAnimalAgeCategoryForUI`, `tAgeCategories`). Lifespan:
  `GetSpeciesLongevity(sp)` -> `min, max` years. The game's own release screen rates fertile time
  left as `1 - (age - maturity) / (infertility - maturity)` (infertility > 900 -> longevity max;
  `RelocateAnimalsPopup._GetHabitatAnimalReleaseRatings`). PZ2QoL: `fertilityOf()` in `kincore.js`
  (states juvenile / young / fertile / ending / old / sterile, years left), snapshot fields `ageQ`
  and `speciesFacts` (`pz2qol.kin.lua` `_SpeciesFacts`, cached per species).
- Mixing: `animals:DoAllSpeciesCohabit({[sp]=n})`; skip exhibit species (`exhibits:IsExhibitSpecies`)
  and boids (`animals:IsSpeciesABoid`).

## Habitat planning data (2026-10-19, **offline** 1.0.5; study `docs/RESEARCH-habitat-planner.md`)

- **Cohabitation** (`animals.fdb`, `shoalfish.fdb`): species share a habitat when they share any
  `COHABITATION_<Group>` tag in `Animal_Tags` (21 groups, checked pair by pair), or when
  `Social_TrophicOverrides(AnimalType, AnimalEncountered, Relationship)` has a row (335 rows, all
  `Cohabitation`, one-way predator → prey, no reverse rows). There is no deny list. 623 of 5,565
  pairs are compatible (85 habitat + 21 shoal species). 30 habitat species have no tag (solitary:
  Galapagos tortoise, hippo, big cats, bears, crocodilians). That this union is the game's rule is
  a **guess**; the game's own check is `animals:DoAllSpeciesCohabit({[sp]=n})`, which takes no habitat.
- **Predators:** `Social_TrophicMatrix(TrophicType Predator|Prey|Invulnerable, Adult/Juvenile/
  FormationTrophicLevel)`; shoals `Interaction_TrophicLevels`. The rule combining them is native.
  `shoalfish.Interaction_InterspeciesCompatibility` has 0 rows. The predation and interspecies
  fight alerts (`HabitatPredationAlert`, `HabitatFightingInterspeciesAlert`) fire after the event.
- **Space:** `Requirements_HabitatSpace` gives min + per-additional for land, aquatic, climb, deep
  swim, flight, plus shelter per animal (Hawksbill turtle deep swim 100 + 25, zebra land 460 + 140).
  Need = `Min + Per × (n − 1)` is a **guess**. Whether species' needs add up in a shared habitat is
  open. Shoals: `shoalfish.Requirements_Space(MinDeepWater, AdditionalDeepWater)`, `Requirements_ShoalSize`.
- **Hard filters:** `Requirements_ValidEnclosureTypes(Habitat, ClimbProof, Roofed, Aquarium)`
  (16 aquarium-only species, none allows both); `Requirements_Salinity` (check it separately: the
  overrides pair saltwater species with freshwater fish), game check `animals:IsSalinitySuitable(sp,
  park:GetSalinity(h))` (`park.Salinity_Freshwater|Brackish|Saltwater`). **The Move screen does not
  refuse wrong water**: `animalmovementeditmode` keeps the aquarium valid and only sets the warning
  `[RelocatingToBadSalinity_Description]`, so `IsValidHabitatForAnimalsGUID` passes sharks into a
  freshwater tank (Nexus report 2026-10-20, Find a habitat). PZ2QoL's `Kin._HabitatOk` checks
  salinity itself (species via `animals:GetSpeciesFromGUID`) and refuses it. **offline**. Environment: `Requirements_Environment` (temperature, plant cover;
  `animals:GetTemperatureRequirements(sp)`, `habitat:GetTemperatureRange(h)`), `Requirements_Terrain`,
  `Requirements_Biomes`. Barriers: `c0zoopedia.fdb` `BarrierRequirements` (no Lua call).
- **Unlocks:** `Requirements_Accreditation(CareerTier, OnlineFranchiseTier)`,
  `Animal_Definition.ContentPack`; at runtime Zoopedia `isLocked` / `isDlcLocked`,
  `animals:OwnRequiredDLCForSpecies(sp)`, `park:GetCurrentAccreditationTier()`. What `isLocked`
  means in Franchise is open.
- **The game's own answers:**
  - Zoopedia `['Zoopedia','Animals','Animal_<id>','CompatibleSpecies','species_<x>']` →
    `{id, label, isFloursihingRelationship (sic), isLocked, thumbnail}` lists the compatible species
    without a habitat.
  - `zoopediaui2:SetAnimalNumbers(n)` + `UpdateDataStore_RequirementUnits()` refill
    `...'Habitat'.Requirements[]` for N planned adults (`editors.animal.zoopediauimode.lua`).
  - The habitat **pinning modal** (`['pinnedAnimals']`, `habitatgateinfopopup.lua` ~3624) plans one
    species against one real habitat: `isCompatible`, `plannedPopulation`, `recommendedPopulation`,
    `requirements[]`. `SetHabitatSpeciesPinnedStatus` writes habitat state.
  - Habitat areas: `habitat:GetHabitatSpeciesTerrainData(h)` → `bCalculating, {nLandArea,
    nClimbArea, nFlyArea, nWaterArea, nWaterDepth, nPerimeterArea}`.
  - Species list: `api.database.GetPreparedStatementInstance("Animals","GetReadyAnimals")`
    (`ShoalFish`/`GetShoalSpecies`).
- **Terrain tags are hierarchical, but `Requirements_Terrain.ParentTagName` is always null**: the
  parents are in `Requirements_Terrain_DEF(TerrainName, ParentName)` (`Sand_Fine` -> `Sand`,
  `Grass_Short` -> `Grass`, `Wetland_Sediment` -> `Soil`). Roll children up through the DEF table or
  minimum shares get double counted. **offline**
- **Used by** the Mixed Habitat Planner web app (`apps/habitat-planner/`, 2026-10-19; README there):
  `tools/fetch_data.py --game <PZ2 folder>` unpacks `Content0\Main.ovl` (`--type .fdb`) and the English
  `Loc.ovl` with cobra-tools (~50 s) and `tools/extract.py` writes `public/data/species.json` (git-ignored:
  Frontier's data); `public/core.js` holds the rules (tests: `tests/habplanner.test.mjs`, synthetic
  fixture); `npm start` serves it on `http://localhost:5178`.

## Pregnant animals (2026-10-18, game 1.0.5)

- **The game lets a pregnant animal be moved** (**offline**): `RelocateAnimalsPopup`
  `g_tMovePreventers = {bContainsDead, bEscaped}` and `g_tSendToTradeCentrePreventers` (dead, in
  the trade centre, escaped, at the vet, boxed) have no pregnancy entry; `AnimalMovementEditMode`
  has no pregnancy check. Selling and release do list `bPregnant` (`g_tSellPreventers`,
  `g_tReleasePreventers`). Whether moving her harms the pregnancy is unknown (**guess**: no).
- **Contraception can be set during a pregnancy** (**offline**): the info panel sends
  `canHaveContraceptives = true` for every animal (`AnimalInfoPopUp` ~3475) and
  `_ToggleHasContraceptives` just calls `SetUsingContraceptive(e, not IsUsingContraceptive(e))`;
  the Animals list (`AnimalDatabaseTab.ContraceptAnimal`) and Compare Mates do the same, none
  checks `IsPregnant`. Whether it touches the current pregnancy is native: **guess** that it only
  stops the next conception (PZ2QoL words its advice "after birth").
- Pregnancy fields: park `bPregnant` (`GetUIAnimalListDataForIDs`) → Kin snapshot `preg`
  (`pz2qol.kin.lua`); info panel also `IsExpectingOffspring(e)`; storage rows `isPregnant`.
- **PZ2QoL** (developer, 2026-10-18: pregnant animals can't be sold and must give birth first):
  - plans never move one: `kinboardcore.js` `isPinned(a)` (= `a.preg`); the breeding programme
    pins pregnant breeders to their place (`kinprogramme.js` `ctx.pinned`: only target home,
    `canGo` home only, `evaluate` refuses a change, never a mover in `reassign` / `reassignScarce`
    or ruin-and-recreate), so she still counts in her group and can anchor it; `suggestPlan`
    never picks her; Thin out never sends her, not even by the player's click (`kincull.js`).
  - the player may still move her by hand: a drag or "Move N here" sets `byPlayer` on the plan
    move (`setMove(..., { byPlayer })`) and shows a warning; `kinmoves.js runPlan` skips a pregnant
    move without `byPlayer` ("skipped: pregnant", trace `js_kin_plan_skip_pregnant`).
  - contraception advice (`kinprogramme.js` `contraceptionAdvice`, `CONTRA_ADVICE`; in the
    programme result as `contraception`, shown under each habitat with a one-click
    Contraception button, `setContraception(id, true)`, one at a time): for each pregnant female
    in a habitat, not contracepted, first match: (1) no male (unisex: partner) there now or after
    the plan that breeds now or matures within 2 years (unknown maturity counts as a mate);
    (2) every such mate is related to her (game rule or close kin); (3) her gene score (mean of
    her gene grades ×100) is ≥ 10 below the median of the other breeding females there after the
    plan (≥ 2 of them with gene data); (4) more breeding females there than its fertile males can
    take under the make-up (`partnersPer(rule).male`, 1:1, 1:3…) and she has the lowest gene
    score (≥ 1 other with data). No gene data for her: no gene advice. Never applied by itself.

## Group make-up: males per female (2026-10-17)

- **The park's own rules** (2026-10-25, `Kin._AnimalRules`): the scan sends `rules` from the park
  settings (`Helpers.ParkSettingsData` `EnableSocialGroups` / `EnableOvercrowding` through
  `IScenarioManager:GetScenarioSetting`), both true unless the park switched them off. With social
  groups on (every Franchise zoo) the game's group rules bind as below. Off (a sandbox park), no
  group rule binds: `sandboxRule` makes it one breeding male per habitat with any number of
  females, so every juvenile's father is known; leader species and monogamous pairs keep their own
  make-up. With overcrowding off (`overcrowdingOn`), a habitat holds any number of adults (the
  programme, Thin out and the growing-up alerts).
- **The game's own composition data** (**offline**, decompiled 1.0.5 Lua): the world API
  `wildterritory` (in zoo parks too: `AnimalMovementEditMode` holds it) has
  `GetTerritorySocialGroupsForSpecies(sSpecies)` → array of `{ nSocialGroupType, sNameSymbol, nMale,
  nFemale }` (`editors.wildterritory.releasegroupstoragemode.lua`, `events.eventactioncreatereleasegroup.lua`).
  Type values are fields on that API: `SocialGroupType_MixedGroup|MixedGroupLarge|BreedingPartners|
  MaleBachelor|FemaleBachelor|MaleSolitary|FemaleSolitary`; `sNameSymbol` is the same name. These are
  the wild release groups; that they match zoo habitat groups is a **guess**. **Proven (Y:,
  Franchise zoo, 2026-10-17 15:48):** the call answers in a zoo park (`kin_groups_found`), but for
  the species the developer opened no group had both sexes (a solitary species: male alone /
  female alone is the likely shape). The board then said the mating rule was unknown, **but that
  was not shown**: until 2026-10-17 evening the note appeared for every make-up of source `none`,
  which included a rule read as Polygyandry (`mixed`), and `matingRaw` was sent even for a rule
  that matched. No log on the PC holds the value (trace marks are fixed names; the game writes no
  log; the mod stores no species facts). The raw value is still unseen.
- **The mating rule's values** (**offline**): `GetMonogamyRule` is exe-only (no game Lua calls it);
  enum fields on the animals API, bare names (exe strings, beside `AlphaMale|AlphaFemale|AlphaPair|
  AlphaNone`): `Monogamy`, `Polygyny`, `Polyandre` (sic), `Polygyandry`. Numbers unknown.
  `animals.fdb` holds the source data (Python `sqlite3` reads it):
  - `Social_MatingRules (AnimalType, MaleHasSingleMate, FemaleHasSingleMate, OnlyLeaderMaleCanMate,
    OnlyLeaderFemaleCanMate, MourningSeasons)`. That the rule is built from the two SingleMate flags
    (1/1 Monogamy, 0/1 Polygyny, 1/0 Polyandre, 0/0 Polygyandry) is a **guess** that fits the names
    and the Meerkat (1/0, the only polyandrous species).
  - `Lifecycle_FertilityData.MatingType` (the Zoopedia's `[Zoopedia_MatingType_%s]`): Monogamous 21,
    Polygynous 32, Polyandrous 1, **Promiscuous 31** of 85 habitat species. Promiscuous species are
    all 0/0 (Polygyandry), e.g. tigers, bears, snow leopard, red/giant panda, lynx, sharks, rays,
    komodo; 12 of them are `Solitary`. Many Polygynous species are 0/0 too (giraffes, elephants,
    deer, rhino): their harem comes from `OnlyLeaderMaleCanMate` (23+ species), not the rule.
  - `Social_Sociality.MaturationType`: Gregarious 0, Matrilineal 1, Patrilineal 2, Solitary 3
    (`Social_Sociality_DEF`). `ENUM_Gender`: Male 0, Female 1, Flock 2.
  - `Requirements_GroupComposition (MinPopulation, MaxPopulation, MaxBachelorMale/Female,
    MaxMixedMale/Female)`: the game's per-sex limits (likely the Zoopedia's max per sex), e.g. tiger
    1/1 (max 2), lynx 1/2, lion 1/29, meerkat 20/20. No Lua call returns them (`kin_sexmax_none`).
  - `GetAlphaRule` (`AlphaMale|AlphaFemale|AlphaPair|AlphaNone`) may be the OnlyLeader flags or
    `Social_LeadershipRules` (who leads, by gender); the two disagree (elephants: both lead, only
    the male leader mates), so it is not used.
- **Right make-up** (PZ2QoL, 2026-10-17): Polygyandry (`mixed`) is a known rule, source `mating`,
  mixed groups (each female her best unrelated male); room per habitat from `GetSocialRequirements`
  `nMax` (tiger 2, so in effect one pair). A solitary species (all groups one sex: `rule.solitary`)
  keeps its mating rule's make-up (monogamy 1:1, polygyny 1:*). Only no readable rule and no
  two-sex group gives source `none` and the note (`kinprogramme.js unknownMakeupText`, which
  names the raw rule and the groups). Unisex species: make-up does not matter (both sides).
- **Trace** (`Kin._MatingSystem`): `kin_mating_monogamy|polygyny|polyandry|mixed`, `kin_mating_bonds`
  (read from a bonded mate), `kin_mating_none` (no rule), or `kin_mating_unknown` then
  `kin_mating_raw` + `chr_*` digits (`Core:MarkNumber`; `kin_mating_raw_<type>` for a non-number),
  then for each of Monogamy, Polygyny, Polyandre, Polyandry, Polygyandry `kin_mating_enum` + digits
  or `kin_mating_enum_missing`. `matingRaw` is sent only for a rule not understood; text rules
  match `polygyandr|polygynandr|promiscu` (mixed), `polyandr`, `polygyn`, `monogam`.
- **"Max per sex" exists but no Lua call is known**: the Zoopedia habitat panel and the habitat
  pinning modal show `maxMale` / `maxFemale` (`[AnimalPinning_MaxPerSex]`; Zoopedia `Habitat` context,
  pinning `recommendedPopulation` with `countMale|countFemale|countMixed`), filled by the exe (no game
  Lua sets them). The exe also has `GetSpeciesSocialityData`, `GetMatingRules`, `GetAnimalMatingData`,
  `GetSocialBehaviourData` (signatures unknown), and the strings `InfoPanel_Animal_Tooltip_SocialGroup_
  TooManyMales|TooManyFemales` and `Zoopedia_MaleFemaleRatio_`, so the game has its own per-sex limit.
  PZ2QoL probes `GetSocialRequirements(sp)` and `GetSpeciesSocialityData(sp)` (**guess** signature) for
  number fields named max+male/female (one level deep): trace `kin_sexmax_found` / `kin_sexmax_none`.
  **Proven 2026-10-17 (Y:): `kin_sexmax_none`** — neither table carries such a field.
- PZ2QoL (`pz2qol.kin.lua` `Kin.SpeciesInfo` → `info.groups = [{kind, m, f}]`, `info.sexMax = {male,
  female}`; `kinprogramme.js` `groupRule`): the make-up is the player's choice per species (`kinRatio`
  in the player store, per zoo; `RATIO_CHOICES` 1:1…1:5, 1:*, 2:1, 3:1, *:1, mixed), else the game's
  max per sex (also kept as caps), else the game's social groups (mixed, mixedLarge, pair first; only
  if it agrees with the mating system), else the mating system (monogamy 1:1, polygyny 1:*, polyandry
  *:1, Polygyandry mixed), else mixed (source `none`). Thin out (`kincull.js` `maleRoom`) keeps the same number of breeding males.

## Breeding programme optimiser (2026-10-17, `kinprogramme.js`)

- **Player tuning** (2026-10-19, `kinprogtune.js`, harness + node only): every rule in
  `PROGRAMME_DEFAULTS` the player may change (move / outsider / bond-break cost, room and make-up
  penalties, line bonus, `spareOut`, `defaultCapacity`, Classic search budget,
  `exactLimit`), a few named choices each, set in the Breeding window's **More options** and kept
  player-wide in prefs `progTune` (`{ key: choiceId }`, defaults left out). `applyTuning` is applied
  last in the board's `programmeOptions`, the window's, and `kinautocore.programmeOptionsFor`
  (4th arg); a non-empty `tuningKey` is appended to the board's `programmeKey`, so deep results
  are kept per tuning. Empty pref = the plans as before.

- **The objective** (2026-10-25): the header of `kinprogramme.js` states it. A pair's value is its
  expected young by the game's own gene formula, times the game's conception chance, times the
  years both can still breed; relatives of the other sex together and going over the game's most
  adults per sex break a hard rule (no tuning allows them). After the search, `pairEveryHabitat`
  gives every habitat set aside for the species a breeding pair while the breeders allow one
  (option `pairEvery`, on; the optimality tests turn it off to test the search alone).
- Objective per habitat (the earlier form, kept for the method): the best pairs under the make-up (exact b-matching, `maxWeightPairs`:
  Hungarian method on copies of the animals with several partners; "any" partners = each animal of
  the other sex takes its best), minus related pairs (2 each), adults over the room (1 each),
  breeders over the make-up (1 each: 1:k allows `max(1, ceil(females / k))` males), plus 0.01 per
  family line; minus move costs, outsider and bond-break costs. Scores are cached per (place,
  members) with xor-hash keys; a step re-scores only the habitats it changes.
- **Monogamous bonds in the optimiser** (2026-10-19, `makeContext` `monoMate`/`monoExt`,
  `groupPairs(ctx, list, p)`): a bond counts only when it is monogamous (the bond pass recorded it
  on either animal, or `info.mating === 'monogamy'`). Mates living together pair only with each
  other (a related couple still takes both out of the matching, and keeps its related penalty); a
  breeder whose monogamous mate lives there but does not breed (old, contracepted, moving) pairs with
  no one. This follows the game's `IconLock` rule (proven), so plans no longer count pairs the game
  won't allow. `bondBreakCost` (0.15, flat) is charged only for monogamous bonds; mates listed for
  other species cost nothing to part. Scaling it by mourning length waits for a way to read
  `MourningSeasons` in game (no Lua call known). Tests: `kinprogramme.test.mjs` "bonds: …".
  Those benchmark optima belong to the earlier objective: `kinprogrammedeep.test.mjs` holds Deep
  to at least Classic on those zoos until they are proven again with HiGHS. They were proven with
  HiGHS (the MILP gets `y + x_i + x_j ≤ 2` for every pair of a bonded animal with someone else, and
  no pairs for a breeder at its non-breeding mate's place; it matched the exhaustive plan on 144
  small zoos): 20 monogamy seed 1 = 3.002778, 40 1:3 seed 4 = 9.963160 (seed 1, 7.003958, has only
  polygynous mates now and Classic reaches it), 40 monogamy seed 1 = 7.612535.
- **Mourning by species** (**offline**, `animals.fdb` `Social_MatingRules`, 1.0.5): `MourningSeasons`
  is 0 for every species without single mates on both sides. Of the 1/1 (monogamous) species, 15 have
  4 seasons, the Asian small-clawed otter 8, the siamang 12, and the Malayan tapir and long-eared owl
  0. Meerkats and spotted hyenas (1/0) have 0.
- Search: every layout when there are ≤ `exactLimit` (20 000); else local search (move, swap, a
  male and a female together), **reassign** (one sex placed at once given the other: an assignment
  of the plentiful sex to the habitats' room and partner slots, and of the scarce sex to group-head
  slots), then rounds of 80 % kicks (move 1–2 scarce-sex animals, often a group head, then reassign
  both sexes) and 20 % ruin-and-recreate, settled by local search, accepted by simulated annealing
  (T 0.03 → 0.001); last a polish and the removal of every unneeded move. Deterministic (seeded by
  species and breeder ids). `planProgrammeAsync` runs it in ~24 ms slices with progress (the board
  uses 3 M evaluations / 6 s of search time; plain `planProgramme` 600 k / 1.5 s). The board caches
  results per setting and per `programmeSig` (the species' animals and assignments), not per kin
  model: a scan every 6 s would otherwise restart a long search forever. Unisex animals sit on both
  sides of the matching; two of them make one couple (`groupPairs`).
- Benchmarks (Node, random zoos, scratchpad): old greedy hill climb vs new, both scored with the
  new objective: the new one wins or ties in all but 4 of 160 zoos at the old budget, and with the
  final settings is within 0.00 / 0.09 / 0.13 % (mean) of 3 M-evaluation reference runs at 40 / 70 /
  100 breeders (~0.2 / 0.6 / 0.9 s); the whole-sex reassign was the step that mattered (polyandry
  and harem species, where choosing group heads is the hard part). Small zoos: the search alone hits
  the exhaustive optimum in 160 of 160 random cases (`tests/kinprogramme.test.mjs`).
- **Against proven optima (2026-10-18, exact MILP with HiGHS WASM, `docs/RESEARCH-breeding-optimisation.md`)**
  the "0.1 %" above was optimistic. Those reference runs were the same search and stall in the same
  places. With the board budget, the true gap is 0.7 / 0.8 / 1.7 % mean (max 3.7 %) at 20 / 40 / 70
  breeders, and the search was optimal in 9 of 29 proven zoos. At 100 breeders the best known
  layouts beat it by about 2 % (1:1 up to 13.7 %). Harem is nearly solved; **1:1 and 1:3 lose
  most**. The annealing stops after `min(6000, 300+40n)` rounds, so more `maxEvaluations` buys
  nothing. Other seeds reach the best known layout where one seed stays stuck, so multi-start is the
  cheap fix. The MILP (y continuous: a bipartite b-matching is TU) proves the optimum up to ~40–70
  breeders in 5 min, but its LP bound is weak (2–22 %), because a relaxed `z ≥ x+x−1` ignores
  co-location. **offline** (synthetic zoos, Node).


- **Deep engine (2026-10-18, `kinprogramme.js` `solveDeep`, `kinprogdeep.js`; plan
  `docs/PLAN-deep-optimiser.md`)**:
  - **Start 0** is the Classic plan. The panel passes its moves as `warm` only for the same
    `programmeKey` and problem sig; otherwise Deep runs `solveLayout` itself on the board budget
    `classic`. So Deep is never below Classic.
  - **Starts 1…K** run in rounds of 4. Each start rebuilds part (odd starts) or all (even starts) of
    the best layout of the rounds before it, then runs `effort` × Classic's rounds of
    kick / ruin / exact repair under annealing. A round depends only on its base, so
    **Stop + Continue (`resume = {round, base}`) gives the uninterrupted plan** (tested, including a
    stop partway through a round). It could also run in parallel later.
  - **Exact repair**: `light` = 2 habitats, ≤ 2 000 layouts; `strong` = 3 and 20 000.
    - At equal time light beats off and strong: on 24 zoos (30 s each) the mean / max gap was light
      0.63 / 2.4 %, off 0.75 / 4.5 %, strong 1.34 / 7.0 %, Classic 2.56 / 13.7 %.
    - Over 10-minute runs light still won 3 of 4. Every preset uses light.
  - **Wall time per start** (Node, light): 0.8 s at 40 breeders, 3 s at 70, 6–10 s at 100. Gameface
    is unmeasured: trace `kin prog_deep_done` (detailed log) gives `msPerStart` per run.
  - **Problem sig** (`programmeProblemSig`): breeders, pinning, fixed adults, capacity integers,
    rule, ages and the conception table. It contains no juveniles and no raw habitat data. It keys
    the deep cache and marks a result stale.
  - **Job lifecycle**: one job per page. It survives closing the panel or the board. A Classic auto
    start never takes over a running job. Execute of the job's species stops it.
    `PZ2QoL_StoreReset` drops it and every result.
  - Marks: `js_kin_prog_deep_*`, `js_kin_prog_opt_<engine>_<preset>`, and `js_wasm_yes|no` /
    `js_worker_yes|no` (UI capabilities, for a faster engine later). **offline**: Node + browser
    harness `kin_programme_deep`, not yet seen in game.

- **Room and make-up are hard limits** (2026-10-18). This was a developer report: Sumatran tigers got
  1 ♂ + 2 ♀.
  - **The data**: the game's data has MaxPopulation 2 and MaxMixedMale/Female 1/1, but the mod reads
    the rule as Polygyandry (`mixed`) and gets `kin_sexmax_none`.
  - **The cause**: an over-capacity penalty of 1 roughly equalled one pair's value. Once Best
    genetics had no move cost, a third adult could win.
  - **The fix, part 1**: `overCapacityPenalty` and `structurePenalty` are now 2. That is above any
    pair (≤ 1) plus the line bonus.
  - **The fix, part 2**: `groupRule` caps each sex at `social.max − 1` when the game gives no
    per-sex limit, so a group of 2 is 1 ♂ + 1 ♀.
  - **Side effect**: Classic alone (with `exactLimit: 0`) misses 1 of 160 small test zoos. Deep finds
    it, and in game such zoos are scored exhaustively.
  - **Detailed log**: `kin prog_classic_done` / `prog_deep_done` record the make-up, the caps and
    each group (`hab:Nm Nf/cap+staying`).

## Quarantine before the trade centre (2026-10-18, **offline**; not yet seen in game)

- **Why it's needed**: the game's Send to Trade Centre doesn't check health (`relocateanimalspopup.lua:34`), so an infected or seriously injured animal reaches storage and the market refuses it (`AnimalList_Problem_Infected` / `SeriouslyInjured`).
- **What a quarantine does**: it finds the illness, and the game sends the animal to the vet by itself. `facilities:IsAnimalReadyToLeaveQuarantine(q, e)` says when it has passed. The quarantine panel's own trade button then sends it on (`facilityinfopopup.lua:412`, `:606-616`).
- **The API**: `animals:RequestTransportToQuarantine(e)`, checked first with `CouldRequestTransportToQuarantine(e)` (`animalinfopopup.lua:4454`, `:1075-1119`). Health: `animals:IsAnimalInfected(e)` / `IsAnimalInjured(e)`.
- **PZ2QoL**:
  - **Lua**: `Kin.Move` takes `tradeq:<tc>`. A sick animal goes to quarantine and the answer is `quarantine`; a healthy one goes to the trade centre. The snapshot adds `sick` and, for animals in quarantine, `qReady`. Marks `kin_move_quarantine` and `_failed`. `sickOf` / `quarantinePassed` use a local `try`, because the file's `call` is defined later (a forward reference would be a nil global).
  - **JS**: `kinmoves.js` `moveAnimal` sends `tradeq:` when the Kin setting `quarantineSick` is on (default on, under Trade centre in the Kin settings). `kinquarantine.js` shows "Passed quarantine" (Needs you) with a **Send to trade centre** click (`moveAnimal(..., { direct: true })`). That keeps the Franchise rule: one click, one action.
- **Open questions (in-game test)**: whether `IsAnimalInfected`/`IsAnimalInjured` match the market's problem keys, how long a quarantine takes, and whether serious injuries are found too.
- **Sick animals already in storage**: the Market desk row says to use Return to zoo, then send the animal to the trade centre from the Species board. That isn't automated yet.

## Away but assigned (2026-10-18, **offline**; developer report: many animals go to the vet)

- **The problem:** `habitat:GetAnimalsInHabitat` lists only the animals physically there. An animal at the vet, in a quarantine or being carried dropped out of its habitat on the board, in the Breeding programme and in Thin out, so plans shifted every scan.
- **The fix in the scan** (`Kin._AddParkAnimal`): when the location is `vet`, `quarantine` or `transit`, `animals:GetAssignedHabitatEntityID(e)` (a habitat of this zoo) gives `hab`, and the record gets `away = <kind>`. `lt` keeps the real location.
- **What uses it:**
  - `kinprogramme.js`: the animal is a pinned breeder in its assigned habitat.
  - `kincull.js`: it's kept ("away for now").
  - `kinboard.js`: its card shows "at the vet", "quarantine" or "in transit".
  - `canMove` is unchanged, so it's never moved while away.
- **Tests:** Lua (a vet animal gets `hab` + `away`) and kinprogramme (never moved, still pairs).

## Colourmorphs (game 1.0.5, 2026-10-17)

- **Mutation chances are client data** (**offline**): `Content0\Main.ovl` → `animals.fdb` (SQLite) tables
  `Visual_ColourmorphData (AnimalType, MorphIndex, ColourMorphProbability DEFAULT 0.025)` and
  `Visual_ColourVariationData (AnimalType, Colourmorph, Male/FemaleVariationCount, MorphType)` (label).
  Exhibits: `c0exhibits.fdb` `ExhibitAnimalColourMorphData`; shoals: `shoalfish.fdb` `Visual_ColourmorphData`.
  E.g. `Aardvark|0|0.025|Albino`, `Wolf_Grey` 0.3 / 0.0714 / 0.4615. 54 of 85 habitat species have morphs.
- Values look like sequential conditional rolls (target ÷ (1 − earlier targets)): **guess**.
- `MorphIndex` is a fixed shader slot: 0 Albino, 1 Erythristic, 2 Leucistic, 3 Melanistic, 4 Xanthic,
  5 Piebald; `MorphType` is only the label. Each slot needs its own `p<Slot>BaseColourAndMaskTexture`
  (piebald: `pAnimal_PiebaldMasksTexture`) in the species' `.fgm`; Aardvark fills only albino. **offline**
- Loc keys `<species>_variation_colourmorph<N>` in `Content0\Localised\English\UnitedStates\Loc.ovl`.
- **No carrier data anywhere** (**offline**, 2026-10-18): no Lua call, row field or UI shows a
  hidden (recessive, carried) morph; only the expressed morph (`colormorphLabel` on rows,
  `GetColourMorph*` in park). A "carries Albino" note is not possible.
- Zoopedia/UI only get label, description, image, isLocked; no chance reaches Lua or JS. Exe has
  Franchise server fields `chanceOfAlbino`.. `chanceOfAxanthic` (meaning unknown, maybe server-side odds).
- Every pack's `Databases.<Pack>` config is merged (`game.basegame.lua` `MergeContentPacks`,
  `api.database.MergeChildDatabase`, extra `tCollections` of prepared statements), so a mod could add
  morph rows or its own queries, as PZ1 DLCs did. Untested in game.

## Auto mode per species (PZ2QoL, 2026-10-18, **offline**: tested in Node and the harness, not in game)

- Design and status: `docs/DESIGN-autopilot.md` section 16 (it replaces the zoo-wide Autopilot of
  2026-10-16, never released). Turned on per species on the Species board; with no species on it,
  nothing of it runs (no listeners, no timers, nothing written). It runs by itself in every
  park, Franchise too (developer, 2026-10-19: the one exception to click-started Franchise
  automation); species due together take turns in a queue, one run at a time. With the Kin
  setting `autoOnAssign` (Habitat set aside turns Auto on, off by default) a species with a habitat
  set aside and no Auto mode settings yet gets Auto mode on (`kinauto.js autoForAssigned`, on every
  park scan); one the player turned off stays off.
- A run is Thin out (`kincull.js cullPlan`) **then** the Breeding programme (`planProgrammeAsync`)
  on the zoo Thin out leaves, then the moves through `kinmoves.js runPlan`. **Order matters
  (offline, Node):** the programme counts adults that don't breed (old, infertile, contraception)
  as fixed room (`ctx.fixed`), so in a full habitat it sends *breeders* to the trade centre rather
  than the old. Thin out sends the old first.
- **The programme never pairs close kin** (`relatedPair`: the game's rule, or kinship of at least
  the close-kin threshold), and sends breeders with no place in a group to the trade centre ("no
  place in a breeding group"). Run over and over in a closed population (no new animals), that
  empties a species. A 50-park-year soak died out in 35 years. Auto mode keeps the last breeding
  male or female of a species unless it would live beside a relative of the other sex (never
  inbreed comes first), and says when breeders have no unrelated partner; new blood has to come
  from the market (the player).
- **The programme's best layout shifts as the zoo changes** (births, ageing). Re-run every
  quarter park year with Best genetics (move cost 0), it moved animals back where they came from
  (80 times in 50 years in one soak). An animal Auto mode moved stays put for a park year
  (`AUTO_LIMITS.cooldownYears`), unless it lives beside a relative of the other sex. A breeder
  parked at the trade centre is weighed again once its herd changes (a birth, an arrival, a young
  one grown up: `freeParked`). The soak allows a few moves back for both (at most 5 reversals and
  3 animals moved three times in a year per 50 years), never enough to stop a species.
- A juvenile only grows up in a habitat, so no plan moves one before it is grown. Auto mode runs a
  species as soon as one of its young grows up (`noteHerdChanges`), and the programme parts it
  from a parent of the other sex then.
- **Youth is left alone** (developer, 2026-10-19): no plan sends a juvenile to the trade centre
  (`programmeSteps` drops such a move; `finishAutoRun` holds one the projection planned, "young:
  stays until grown up"). Cost in the soak: inbred births 2.4-4.8 %, because a young one with no
  place elsewhere grows up beside its parents (`kinauto_soak.test.mjs` allows 6 %). Young waiting at the trade centre
  go back to a habitat (option `youngBack`, `youngBackMoves`): the mother's habitat after the plan,
  else the father's, else its own assigned one, else the allowed habitat with the most room.
- **Juveniles don't take adults' room** (developer, 2026-10-19). `GetSpaceRequirementsInHabitatForSpecies`
  covers the whole population (**guess**: juveniles included), so `estimateSpacePerAdult(info,
  youngByHabitat(all))` divides it by adults + young living there; Thin out uses the same.
  The adults' room then rises (fixtures: 10 -> 12, 7 -> 8); `engines_golden.json` re-recorded.
- **Pitfall (2026-10-19, seen on Y:):** young that Bring all brought into the trade centre stayed
  there although the Breeding window ran its programme. Its Deep plan is reused while
  `programmeProblemSig` is unchanged, and that leaves juveniles out (births must not restart a
  search), so no "young: back" moves appeared; a stale Deep plan was run as it was. Now the sig
  adds the young waiting at the trade centre, and `withFreshYoung` puts the fresh plan's young
  moves into any kept plan (board and window).
- `planProgramme` option `pinIds` (Auto mode only): breeders that count where they are but never
  move, like a pregnant one (`ctx.pinned`). Unset, the plan is unchanged.
- Its data is keyed by animal GUID and habitat name + habitat id (`kinautoledger.js`, `kinAuto` v2),
  never by entity id (entity ids change on every load, see above).
- **Pitfall (userstore.js, offline):** a write made while `userDataStatus()` is not `'file'`
  (a park loading, the hub, no profile) is queued and replayed into whatever zoo the store reads
  next, and the old zoo's data stays in memory until then. Per-zoo state must only be read and
  written while the status is `'file'` and under the same `userDataEpoch()` it was read in
  (`kinauto.js` `storeReady` / `checkZoo`); otherwise one zoo's data lands in another.
- Franchise vs offline for an action without a click: the scan's `mode` alone fails open
  (`Kin._GameMode` says offline whenever the hub type is not the Franchise constant, also when the
  constant is missing). Auto mode runs the same in both; the mode only shows in its state.

## Breeding rules and their settings (2026-10-25)

What the programme, Auto mode and the Species board keep to; `tests/rules.test.js` (in
`tests/page`) checks them on random zoos.

- **Never inbreed:** no plan leaves an adult beside a relative of the other sex. Kin setting
  `autoContraception` (Contraception near a relative, off by default): contraception covers the
  time from a young one's maturity to its move, for every species on Auto; off, only the move
  parts them, and the guards Auto mode set come off once the zoo is read (`kinauto.js guardKin`).
- **A pregnant or young animal never goes to the trade centre:** `Kin.Move` reads the game's
  relocate preventers (`bPregnant`, `bJuvenile`) at the moment of the send. Young waiting at the
  trade centre always go back to a habitat. Kin setting `autoHouseWaiting` (Bring waiting animals
  into a habitat, off by default): a pregnant female or an adult past selling (within three years
  of elderly) waiting there goes into a habitat with room, within the game's most per sex and
  beside no relative of the other sex (`adultBackMoves`); off, Auto mode holds those moves and
  they wait.
- **Selling before elderly:** Kin setting `autoEarlySale` (Breeders to storage before elderly, off
  by default): an Auto species' adult within four years of elderly goes to the trade centre with
  sell advice, in a species that turns elderly at 40 or later (`kinageing.js sellsBeforeElderly`).
  The player sells it; Auto mode never sells.
  Within the server's three years it is never sent at all (see "Trading near elderly").
- **Clean up** (Auto mode panel) empties the habitats the player ticks, or the whole zoo
  (`kinautocore.js cleanupRun`, the ledger's `clean`). The whole zoo turns Auto mode off for every
  species. Habitats leave it on: its breeding plans see none of their animals and put none in
  (`withoutHabitats`), and once they are empty they are set aside for no species, so Auto mode
  leaves them empty. A Clean up started, stopped or changed cancels every plan made before it
  (`kinauto.js planLive`).
- **Animals rank by the young they give** (`youngQuality`); an animal with a 0 % fertility gene
  never breeds. A breeder whose young would score well below the best pair's waits at the trade
  centre, except as many of each sex as the species has habitats set aside.

## Breeding programme: non-breeders and the make-up (2026-10-19, offline)

- Non-breeding adults (contraception, infertile, old) used to count only as room and never moved, so they could hold make-up places for ever (developer: a contracepted second male in a 1:1 Eurasian lynx habitat).
- `kinprogramme.js` option `spareOut` (default on): those adults are left out of the solver's fixed room. Afterwards `keepSpares` keeps per habitat and sex only the make-up places (`groupTarget(rule, room)`) that the placed breeders and other staying adults leave free: contracepted first, then own genes. The rest become moves to the trade centre (`spare: true`, reason "over the group make-up ...").
- Exceptions: pregnant, away, pinned (`pinIds`, Auto mode hands off) animals, and mixed make-ups.
- The engine benchmarks and the golden record run with `spareOut: false`. Tests: `tests/kinprogramme.test.mjs` "make-up: ..." cases.

## Trading near elderly (proven, Franchise, 2026-10-24)

- The Franchise market refuses every elderly animal, fertile or not (`NotAllowed`). Listing a fertile elderly
  shark crashed the game on its render thread right after that answer: the mod never lists one (`scores.js
  isElderly`, `pz2qol.lister.lua` skips maturity 3 and 6).
- Close to elderly the server refuses too, while the row still says adult and the game still shows the buttons:
  a listing 0.8 years short (the same crash), a sale 1.9 and releases 2.0 and 2.7 years short, while a release
  3.1 years short goes through (giraffes, elderly at 32). The mod lists, sells and releases none within three
  years of the species' elderly age (`isNearlyElderly`, `MARKET_ELDERLY_MARGIN_YEARS`, from the row's age). A
  release far short of that can pay 0 CC.
- Each species' elderly age (and its group limits, leader rules and pregnancy length) comes from the game's
  `animals.fdb`: `speciesrules.js`, written by `tools/gen_species_rules.py --cobra-tools <dir>` (run it again
  after a game update).
- A listing the game won't make (`tradeAllowed` false) sends nothing, and most of its reasons pass (an
  infection, an injury, a transport). The lister takes the run's "If refused" quick action for it only when a
  reason never passes (`Lister.tLastingProblems`: `NoBirthZoo`, a Frontier zoo's animal); any other skips it,
  since a quick action is permanent. Add a reason there only once the game has shown it never clears.
