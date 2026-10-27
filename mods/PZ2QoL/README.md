# Mike's QoL Toolbox for Planet Zoo 2 (version 3.2.1)

*Breeding, market, storage and park quality-of-life tools for Planet Zoo 2, formerly Genes & Gold
(and PZ2QoL before that). Installs as `Win64\ovldata\PZ2QoL`.*

**In short:** gene and breeder scores on every animal; quick filters for the Market, Animal
Storage and your zoo's Animals list; Kin, which shows inbreeding risks and close kin on every
animal screen with alerts, a planner and a Species board that plans and runs moves (Suggest
fixes, Breeding programme, Thin out, habitat assignments); a market price advisor and one-click
lister; Find a habitat for animals sent from storage; a more reliable autosave; and an error
banner for the server errors the game hides. Works in Franchise, Sandbox and Career.

What's in the toolbox:

| Area | Tools |
|---|---|
| **Scores** | Gene, breeder and value badges on every Market and Storage row |
| **Market** | Quick filters (Top genes, Breeders, Long-lived, Ending ≤1h, Cash, CC), Dim below a gene score, the juveniles each listing would give, Best buy and Best value per sex, Best to breed |
| **Animal Storage** | Filters (Pregnant, Alpha, Adults / Fertile adults / Juveniles, Sellable, Sell advice, Not listed, Has pair, Surplus, Gene ≥, Kin), the juveniles each stored animal would give, lister on/off, sort by score, summary line, Find a habitat |
| **Zoo Animals list** | Filter bar (habitat, sex, age, pregnant, alpha, contraception, unhappy, gene and fertility minimums, Kin) and sort by gene, breeder or welfare |
| **Kin (inbreeding)** | Risk badges in every animal screen, alerts, Kin planner, Find a mate, Compare Mates and Genealogy additions, fertility over a life |
| **Species board** | Plan moves by drag and drop, Suggest fixes, Breeding programme, Thin out, habitat assignments, Execute plan one move at a time, Auto mode per species |
| **Market lister** | Price book, price advisor with recommended prices, background price checks, Sell at recommended price, Market desk (list many at once) |
| **Park tools** | Launcher buttons on the tools column, reliable Autosave with Save now, pause sliders for automated runs, stuck aquarium animals let out of their boxes |
| **Safety net** | Error banner for silent server and script errors, stuck-spinner watchdog, crash guard for the game's Move screen |

The mod never changes what is sent to Frontier's servers. Everything it does in Franchise goes
through the game's own buttons and events and runs one action at a time. It starts only from your
click, except Auto mode (only for the species you turned it on for) and letting out stuck aquarium
animals (a setting, on by default), and, if you turn them on in Kin settings, Auto mode for a species
you set a habitat aside for, newborn names and boxing an overdue mother.

## Changelog

### Unreleased

**New features**

- **Juveniles on the Market.** Each listing's badge shows the juveniles it would give with your breeders,
  by the game's own gene model, and the best buy and best value of each sex are tagged across every
  page. A male is scored by all your females; his badge names his best match where it differs.
- **Juveniles in Animal Storage.** Your stored animals are scored the same way, so a stored breeder and
  a Market one compare on one scale.
- **Best to breed** (Market lister). One Market check of every breeding target, ranked by the CC a
  breeding female earns a year at the asking prices of the moment. The Market shows asks, not sales,
  and the card says so.
- **Storage notices.** One notice per species for what Animal Storage holds that would breed better
  than an animal in a habitat, or fill a missing partner, brought in with one approve (a listed
  animal comes off the market first). Also young animals waiting in storage, which never grow up
  there, and animals too old to trade, with Bring from storage.
- **What a habitat needs.** A notice when a habitat has no partner to go on breeding, when growing
  juveniles will need fresh blood, when a sire breeds well under the standard, and whether to keep or
  sell a good breeder a better one replaces. Its Market button opens on the sex wanted, with the
  listings whose juveniles fall short hidden.
- **Missed notices.** A notice that goes by itself waits behind a round button in the corner.
- **Sell advice** (Animal Storage). A chip for the animals the Breeding programme advises letting
  go, cycled by how each can leave: the market, release or Quick trade. **Sellable** cycles every
  stored animal the same three ways.
- **Clean up** (Auto mode panel). Empties the habitats you tick for selling, or the whole zoo: the
  adults go to the trade centre males first, a pregnant female after her birth and a young one once
  grown. Elderly and hands-off animals stay and are named. Auto mode breeds on in the other habitats
  and puts nothing into these, and once they are empty they are set aside for no species. The whole
  zoo stops breeding everywhere.
- **Breeding window: set up habitats.** It opens on the habitat on the game's info panel, or on a
  list of every habitat (empty ones too) to tick, then the species that go there, several at once.
  It searches every species the game knows.
- **"releasable"** in the zoo's Animals search lists only the animals that can go to the wild, so a
  habitat's or the zoo's can be ticked at once for release groups.
- **Education screen.** The topics each species lacks, and **Fill topics** sets spare props to them.
- **Overdue births** (off by default). A mother still pregnant at twice her species' pregnancy is
  boxed and let out in place, which makes her give birth.
- **Newborn names** (off by default). Each newborn gets a unique name from famous people, from the
  name groups you pick.
- **One settings page.** Every Kin setting on one page in sections, also from a **Settings** button
  on the park dock.
- **Error banner switch.** The mod's errors on screen can be turned off; every error is still kept.

**Changes**

- **Breeding programme.** A pair is worth its expected juveniles times the game's conception chance
  times the years both can still breed, and animals rank by the juveniles they give. A breeder whose
  juveniles fall well below the best pair's waits at the trade centre, keeping one of each sex per
  habitat set aside. Every habitat set aside gets a breeding pair while the breeders allow one.
- **Never inbreed.** Relatives of the other sex never share a habitat in any plan, and the game's
  most adults per sex is a hard limit. The "Related pairs together" tuning is gone.
- **The park's own rules.** Franchise and Career zoos keep the game's group and room rules in full.
  In a sandbox park with social groups off, a habitat breeds through one male; with overcrowding
  off, habitats have no room limit.
- **Juveniles grow up in a habitat.** Nothing moves a juvenile before it has grown up, and
  juveniles waiting at the trade centre always go back to a habitat.
- **Auto mode** runs a species as soon as relatives share a habitat or one of its young grows up,
  keeps the last breeder of a sex unless it would live beside a relative, and weighs a breeder
  parked at the trade centre again once its herd changes. It decides for its species: an animal you
  move stays where you put it for the rest of that run, and **Auto mode: hands off** keeps one for
  good.
- **Suggest fixes** counts the breeders with an unrelated partner, so it parts relatives in a
  crowded group too, and it never moves a juvenile.
- **Market lister.** It never lists an elderly animal or one within three years of elderly (the
  server refuses them, and a refused listing can take the game down). It lists at the price you
  saw, and a reason the game gives that never passes (no birth zoo) takes the run's If refused
  action at once.
- **Animal Storage.** The Adults chip holds one stage (all, fertile, juvenile), and a hidden row
  never stays ticked. The mod's toolbars and panels step aside for the game's tooltips, menus and
  windows.
- **Notices** from the boxes, quarantine and Auto mode follow your pop-up level; the answer to a
  notice's button always shows.
- **Kin settings** are kept in your player settings across sessions.

**Fixes**

- A habitat built in the last 30 seconds is asked about instead of taken as unsuitable for every
  species, so the board, the Breeding programme and Suggest fixes can use it at once.
- The counts behind Bring to the trade centre leave out stored animals listed on the market.

**Settings**

New Kin settings and their defaults:

| Setting | Section | Default |
|---|---|---|
| Habitat set aside turns Auto on | Auto mode | off |
| Breeders to storage before elderly | Auto mode | off |
| Bring waiting animals into a habitat | Auto mode | off |
| Contraception near a relative | Auto mode | off |
| Change juvenile names automatically (and its name groups) | Names | off |
| Box Animal on an overdue mother | Transport boxes | off |
| Warn four years before elderly | Alerts | off |
| Animals to bring out of storage | Alerts | on |
| The mod's errors on screen | Alerts | on |

### 3.2.1

- Fixed: a game crash in Animal Storage a moment after a Quick trade or Release to the wild. A
  background check of the mod's read the storage list while the game was still rebuilding it.
  It no longer runs in the released mod.
- Fixed: switching contraception on or off for some aquarium animals failed with "bad animal id"
  (the game gives some of them a long id the mod could not read back).
- Fixed: stuck aquarium animals were no longer let out after loading a second park in the same
  session. The wait now runs on game time: about 20 seconds of game time, faster at 5x, nothing
  while paused.
- Find a habitat and the Breeding programme no longer put aquarium animals in water of the wrong
  salinity (e.g. sharks in a freshwater tank).
- The mod's toolbars step aside when the game's search suggestions, popups, Zoopedia or other
  menus are open, so they no longer cover them.
- **Market desk: My listings.** A second view of the desk lists your live listings with how
  stale each one is (its price against the market and its time left) and can take listings off
  the market and list them again at a new price, or quick trade / quick release them, one at a
  time.

### 3.2.0

- **Market desk: Quick trade and Quick release for any animal.** In the desk's Quick trade or
  Quick release mode you can now tick any animal in storage, sellable ones included, without
  running Check storage first: sometimes you just want them gone. Each one is still checked as it
  goes; the game's no skips it. Animals on the market, being moved, Rehome-only or with no id from
  the game still can't be ticked.
- **Young are left alone.** The Breeding programme, the Breeding window and Auto mode never send
  a juvenile to the trade centre any more, and young waiting there go back to a habitat: their
  mother's, else their father's, else the one with the most room. Juveniles no longer take adults'
  places when the programme works out a habitat's room, so habitats with young can hold more
  adults. (Auto mode can still place a nearly grown youngster in another habitat so it doesn't
  grow up beside a parent.)
- **Bring all stored animals to the trade centre.** Under the Species board's "Bring <species>
  to the trade centre" button (the trade centre column) is a second button that does the same for
  every species at once: it opens Animal Storage, ticks every stored animal that isn't already in
  this zoo (adults first, up to the trade centre's room; animals on the market, on the move or in
  shoals stay), and sends them with the game's own Send to Zoo. Back in the zoo each one goes to
  the trade centre, one at a time.
- **Breeding programme keeps the group make-up**: adults that don't breed (on contraception,
  infertile or too old) used to stay in their habitat for ever and fill it past its make-up
  (e.g. a second, contracepted male in a 1:1 Eurasian lynx habitat). The programme now gives the
  make-up's places to breeders first, keeps a non-breeder only where a place is still free
  (contracepted ones before infertile or old ones), and sends the rest to the trade centre.
  Pregnant animals and animals marked hands off still stay. Auto mode follows it too.
- **Breeding window**: a third launcher button (under the Species board) opens the Breeding
  programme in a small window where the game shows its info panels (top right). It takes the info
  panel's place: the two are never on screen together. Pick a species (in your zoo, in Animal
  Storage, or search every species), then:
  - **Habitats**: **Pick habitats in the park** and click habitats in the world (a fence, a gate
    or any animal in it) to set them aside for the species; the habitats it lives in and the ones
    the game allows are one click away.
  - **Programme**: the Breeding programme's numbers and moves with the board's settings
    (make-up, Fewer moves to Best genetics, trade centre breeders), and **Run**, one move at a time.
    **More options** opens every setting: the optimiser (Classic or Deep, Deep's search and custom
    numbers, CPU use) and the rules it plans by (cost of a move, of joining a settled group, of
    splitting a bonded pair; related pairs, habitat room, make-up limit, family-line mix, spare
    adults, room when the game gives none; search length). Kept for every zoo, with Reset to
    defaults; the Species board and Auto mode plan with them too.
  - **Auto mode**: the species' full Auto mode panel.
  The Species board is unchanged; both share the same habitats, settings and Auto mode.

### 3.1.0

- **Auto mode per species** on the Species board: runs a species' Breeding programme by itself on
  a schedule in game time (every month, season, 2 seasons or year), optionally Thin out first,
  and moves the animals one at a time, each confirmed by the game (Franchise too). Species due
  together take turns in a queue; **Run now** puts one first. Every move is logged with **Undo**;
  animals you move or mark **hands off** are left alone. Notices are off unless you turn them on.
  Off for every species until you turn it on.
- **Stuck aquarium animals let out**: the game sometimes boxes aquarium animals (sharks, turtles)
  while they swim and never lets them out, so they sit boxed until you notice and their welfare
  drops. The mod now unboxes them about 30 seconds later, one at a time, exactly as the game's
  Unbox button does, quietly. If the game keeps boxing the same animal again, the mod leaves it
  for 10 minutes and tells you, with Locate. On by default; Kin settings > **Let out stuck
  aquarium animals** turns it off.
- **Breeding programme**: monogamous mates living together pair only with each other, as the
  game lets them, and separating them counts as the mourning it causes. Other species' current
  mates no longer count as a bond.
- **Market desk**: an animal the game won't list (e.g. no birth zoo) now takes the run's **If
  refused** quick action, like a listing the server refuses.

### 3.0.2

- Fixed: a game crash when exiting a park to the main menu. The inbreeding check could run in
  the second after the park closed; it now stops as soon as the main menu comes up.

### 3.0.1

- Fixed: a game crash during a Market desk run that quick-trades listings the server refuses.
  After each quick trade the desk now waits a second for Animal Storage to update before
  checking that the animal left.

### 3.0.0

**Market and Animal Storage**
- **Market desk**: list many animals at once. Filters (sex, age, fertility, rating, gene range,
  per-gene ranges, keep the best N males and females, Keep tag, Kin, price), Tick all, live state
  and result per animal, Stop and Retry. Always shows all of your storage.
- **Quick trade and Quick release from the desk**, behind a confirmation that names every animal
  and the total. Runs one animal at a time and stops on anything unexpected. Optionally quick-trades
  (or releases) listings the server refuses. **Check storage** finds out what the game allows for
  each animal. It never sells anything.
- Plain-language reasons when the game or server won't trade an animal (sick, injured, not born in
  a player zoo, pregnant...). Pregnant animals are never listed.
- Listings go through the game's own listing call, by animal id. Animals the game can't identify are
  flagged and never mixed up.
- Prices: colour morphs are priced against their own morph; appeal no longer affects prices.
- Fixed: every listing skipped with "the game didn't select it".

**Breeding programme**
- New optimiser: exact best pairs per habitat, a much wider search, a progress bar, and the same plan
  every time for the same zoo.
- **Deep optimiser** (Classic or Deep with Quick to Marathon presets, or Custom), with a CPU-use
  setting. Runs in the background with Stop and Continue, and is never worse than Classic.
- **Group make-up** per species (pairs, 1:2 to 1:5, harem, mixed), read from the game and
  adjustable. Thin out follows it.
- Pregnant animals are never moved by a plan. Contraception advice comes with a one-click
  Contraception button.
- Animals at the vet, in quarantine or in transit still count in their habitat and are never moved.
- Fixed: plans going over a species' group limit (e.g. 1 ♂ + 2 ♀ Sumatran tigers).

**Species board**
- The trade centre is pinned on the right. In Franchise it also lists your stored adults.
- **Bring <species> to the trade centre**: ticks that species in Animal Storage and sends it to
  the zoo with the game's own Send to Zoo (3 s countdown, Cancel).
- **Storage** and **Market** buttons for the species (also in Find a mate), and **Show in park**
  for habitats and exhibits.
- The pause between moves defaults to 0.5 s.
- Fixed: a pinned habitat showing as a number after a restart.

**Kin**
- One alert per habitat, **Mute <species>**, and optional growing-up alerts with Needs you /
  Heads-up levels.
- **Find a mate** includes your stored adults (Franchise). Compare Mates shows kin badges on them.
- A note for boxed animals with nowhere to go, with Locate and Find a habitat.
- Sick animals bound for the trade centre go to quarantine first.
- Species names appear in your game's language.
- Lighter on big flocks.
- Fixed: the kin card ran off the screen.

**General**
- Kin settings, pauses and Breeding programme choices are kept after the game closes (in the player
  save, in every zoo).

#### 3.0.0 in detail

- **Animals away for a while still count.** An animal at the vet, in a quarantine or being carried counts in its own habitat on the Species board, in the Breeding programme and in Thin out (tagged "at the vet" etc.). It is never moved while it's away.
- **Market desk: clearer and more reliable.**
  - When the game won't trade an animal (infected, injured, infertile, pending transport, adoption terms...), the desk says why in plain words, keeps it unticked, and **Tick all** skips it. **Read storage again** checks again.
  - A refusal from Frontier's server without a reason is explained, with a later retry suggested.
  - The **Market desk** button now sits on the storage bar, under the Market lister switch.
- **Market desk: a Quick trade category and Check storage.**
  - Some animals can't go on the market (for example "Animal was not born in a player zoo"), but the game's **Quick trade** or **Quick release** takes them. The desk now shows them as their own category, **Quick trade**, with what the game offers and for how much ("Quick trade · $1,200", "Quick release · 85 CC"). They are never counted as sellable, never ticked by **Tick all** and never listed. Animals the game offers only **Rehome** for show "Rehome only".
  - **Show** has a fifth choice, **Quick trade**; the species list and the header count them.
  - The game says what an animal allows only once it is selected, so the desk learns it from every listing run and from the new **Check storage** button ("Check storage (N not checked, ≈ M min)"). Check storage selects each not-yet-checked animal of the species shown in Animal Storage, one at a time, and notes what the game allows. **It never sells, lists or sends anything**; Stop ends it at once, and the selection is cleared at the end. **Read storage again** forgets the categories and checks afresh.
  - Animals that came from a Frontier zoo (the storage list says so) show as **Quick trade (from the storage list)** before they are checked; each one is still checked before anything is sent.
- **Market desk: Quick trade and Quick release from the desk.** The right panel has a switch: **List on market | Quick trade | Quick release**. It always opens on List.
  - In a quick mode the panel turns red and says what it does ("QUICK TRADE · sells for cash at once · can't be undone"). Every animal the game allows the action for can be ticked, market-listable ones included (not one on the market, being moved, or offered only Rehome). **Show: Quick trade** still lists just the ones the market won't take.
  - **Animals the server refused to list**: the run card offers "Quick trade the N refused", and Quick trade mode a "Tick the N refused by the server" button. Some animals (in testing, a batch of Sumatran tigers) are refused by Frontier's server every time, by the game's own Trade too, but can be quick-traded.
  - **When the server refuses a listing: Leave it / Quick trade / Release** (next to Duration; remembered in the player save; Leave it by default). With Quick trade or Release, an animal the server refuses during a List run is quick-traded (or released) in the same run, right after the refusal, if the game allows it then; the same checks as a quick run, and the run stops on anything unexpected. Only a server refusal counts, never a timeout or any other failure. An animal bought for cash is never released. Before Quick release's first confirmed run, only one animal per run is released. The panel and the List button say so before you click ("Refused ones: quick-traded at once (permanent)", "List 28 animals · refused → quick trade"); the run card counts them apart ("Listed 16 of 28; quick-traded 12 after refusal").
  - The button ("Quick trade 7 animals ($8,400)…") opens a confirmation: every animal that will go (12 names, then "and N more"), the ticked ones that will be skipped and why, the exact total, and "These animals leave your storage for good. This can't be undone." Press **Quick trade now** / **Release now** (or Enter, or the gamepad's A); Cancel or Esc sends nothing.
  - The run takes exactly the animals the confirmation showed, one at a time: each is selected, checked again (the game must allow it right now), sent with the same call the game's own Confirm makes, and counted as done only once it has left Animal Storage. A pause (at least 1 s) follows each one.
  - **A quick run STOPS on anything unexpected**, unlike listing, which skips and carries on: an animal still in storage 10 s after sending ("not confirmed: check storage"), an animal that can't be told apart from another, no fresh reading of the selection twice in a row, a page reload ("Stopped: page reloaded"), or a mod error. It also stops if the selection or the storage list changed just before sending, or the game stayed busy. Only "the game doesn't allow it now" skips that animal and goes on. Stop ends the run after the current animal.
  - While the game rebuilds Animal Storage after a quick trade, the animal can look half gone for about a second; the desk waits that out and counts it once it has really left.
  - **Quick release, first time: one animal.** Quick trade is proven in game and takes several at once. Until one quick release of a single animal has been confirmed gone, Quick release takes one animal at a time ("First quick release: one animal, to check it works"). This is remembered in the player save.
  - Debug builds also log the game's own Quick trade and Quick release buttons, without changing them.
- **Quarantine sick animals first** (Kin settings, on by default): an infected or injured animal the mod sends to the trade centre goes to a quarantine first, because the market won't take it. When it passes, a notice offers **Send to trade centre**.
- **Inbreeding alerts: one per habitat.** New related pairs in the same habitat, at once or while its alert is open, are counted in one alert ("3 inbreeding risks").
- **Settings are kept.** The Kin settings and the pause between moves now survive a restart.
  They are kept in the player save, like the optimiser choice, the same in every zoo. Before, they
  reset whenever the game closed. **Animals growing up** is now off by default, and **Pop up for**
  defaults to **Needs you**. Both are still in the same settings menu.
- **Prices ignore appeal.** An animal's appeal on the market is its species' appeal, lowered by
  how well the seller's zoo keeps it right now, so it says nothing about the animal itself. Within
  a medal the price advisor now goes by the genes again, as it did before appeal was added.
- **Breeding programme: a Deep optimiser.** The **Optimiser** button in the programme picks
  **Classic** (the search so far, a few seconds) or **Deep**. Deep runs many more searches
  ("starts") after the Classic plan, with exact repairs of two habitats at a time, so it is never
  worse than Classic. On test zoos of 70–100 breeders, Classic was on average 2.6 % short of the
  best known plan (up to 14 %); 30 s of Deep cut that to 0.6 %. On the two benchmark zoos where an
  exact solver proved the best plan and Classic missed it, Standard finds it.
  - Presets: Quick (4 starts), Standard (12), Thorough (32), Extreme (128, longer starts), Marathon
    (1,024, until done or Stop), or Custom (up to 4,096 starts, effort, repair, time limit, stop
    early). Every preset starts by itself when you open the programme with Deep chosen (a search running for another species is never stopped for it); **Run deep search** starts it again,
    which shows an estimate.
  - **CPU use** (Gentle, Light, Normal, Full) sets how much of the game's frame time the search
    takes, for Classic too.
  - Deep runs in the background: close the panel or the board and it carries on (the Breeding
    programme button shows its progress). **Stop** keeps the best plan so far and **Continue**
    picks it up again with the same result. A plan run (Execute) of that species stops it; a new
    park drops it. A birth doesn't spoil a result; a breeder moving marks it "the breeders
    changed".
  - Your choice is kept as your default in every zoo, Franchise included (the player save, like
    habitat assignments; nothing goes to Frontier).
- **Market desk: animals the game won't identify.** In some Franchise saves the game gives the
  listing engine no id for most storage animals, so a desk run of 39 ticked animals listed only 3
  without saying why. The engine now also accepts the other id shapes the game returns, and for an
  animal with no id at all it recognises it by what its row shows (species, name, sex, age, rating,
  appeal, colour morph, genes) when no other animal in storage looks the same. Rows it still
  can't identify show "No id from the game", can't be ticked and don't count in "List N"; a run
  that holds fewer animals than you ticked says so ("Listing 3 of 39: 36 couldn't be identified by
  the game"), and the summary repeats it. An animal is never listed when it can't be told apart
  from another one right before the listing is sent. The desk also stops asking the game about
  these animals every second.
- **Pregnant animals are never sold and never moved by a plan.** The market won't take a pregnant
  animal until she gives birth, so the Market desk shows her as "Pregnant: not until she gives
  birth" (not under Sellable, never ticked by Tick all, never listed), the price panel's Sell
  leaves her out (and says so), and the listing engine itself refuses one. On the Species board
  the Breeding programme, Suggest fixes and Thin out never move a pregnant animal: she stays in
  her habitat, still counts in her group, and the programme can bring partners to her. If you
  drag her yourself the board allows it (the game does) and warns you; a pregnant move that came
  from a plan is skipped when the plan runs.
- **Breeding programme: contraception advice for pregnant females.** Under each habitat the
  programme now says when a pregnant female should get contraception once she has given birth,
  and why: no male in her habitat now or after the plan (a young male who grows up within 2 years
  counts), only related males, genes at least 10 points below the other breeding females there
  (e.g. "weakest genes in the group (52 vs median 71)"), or more females than the males can breed
  under the group make-up and she is the weakest. A **Contraception** button sets it with one
  click (the game's own toggle, that animal only). Nothing is set by itself.
- **Species board: the trade-centre column also lists your stored adults** (Franchise). Under the
  animals in your zoo's trade centre, a read-only **In Animal Storage (adults)** group shows the
  adults of that species in your Animal Storage, with their relatives in your zoo named on the
  card (hover one to light them up; no inbreeding badge, since a stored animal can't breed), and the column head says e.g. "3 here · +5 in
  storage". Why the board showed fewer animals than Animal Storage: the park only sees the
  stored animals that still exist in the park itself; the rest are records in the hub. The
  game shows the park only the stored adults, so stored young are not listed. They can't be
  dragged (a move needs an animal in the park); each card has a **Storage** button that opens
  Animal Storage on that species. The first 6 show, then "N more". Read when you open the board,
  pick a species or press Rescan.
- **The Market desk always shows all of your storage.** When Animal Storage was filtered (to one
  species, or by a search), the desk's species list showed only what that filter let through. Now
  the desk clears the storage screen's filters while it is open (the same as the screen's own
  Reset filters button) and puts them back when you close it, or when a listing run still going
  ends. It starts on the species the screen was filtered to (or the one the Species board's
  Storage button picked), with every other species on the left. If the game does not answer, the
  desk shows what it can and says that storage is filtered.
- **Find a mate looks in your Animal Storage too** (Franchise). The Kin planner's **Find a mate**
  now also lists the adults in your own Animal Storage (not the market), the same ones the game's
  Compare Mates offers, ranked with your zoo's animals (unrelated and best young first; on a tie
  the zoo animal comes first) and tagged **storage** (and **listed** when on the market). Relatives
  are spotted through the family records as for zoo animals. A **Storage too** switch hides them.
  Compare Mates in the park now puts kin badges on those stored rows as well. Read-only. Idea: a
  Nexus comment.
- **Smarter Kin alerts: growing up.** A note when a young animal will grow up into a problem,
  with a level that says whether you need to act: **Needs you** (red, stays a minute) when the
  group will go over the game's limit, when a young male (or female) will be pushed out of its
  group at maturity, or when it could inbreed with a relative once grown; **Heads-up** when the
  group will be exactly full, or a youngster not on contraception joins a full group. A contracepted
  youngster with room in its group gets no pop-up, only a line in the log. You also hear when an
  animal that just grew up is pushed out of its group. Births never pop up. The existing alerts
  now carry the same levels (inbreeding risk: Needs you; close kin: Heads-up). Settings: **Animals
  growing up** and **Pop up for: Needs you | Heads-up too**. Nothing is done for you. Idea: a
  Nexus comment.
- **Storage and Market for a species, in one click.** The Species board's header has **Storage**
  and **Market** buttons for the species you are looking at, plus how many adults of it are in
  your Animal Storage ("2♂ 3♀ adults in storage", read live from the game when you open the board,
  pick a species or press Rescan). **Storage** opens the hub's Animal Storage showing only that
  species (a **"<species> only ✕"** chip in the storage toolbar; click it or Clear to see every
  animal again); **Market** opens the Market filtered to that species, the way the game's own
  Zoopedia button does. The game keeps that market filter until you change it, as it does after
  the Zoopedia button. The same two buttons are in the Kin planner's **Find a mate**. The board or
  planner closes when the hub opens; the buttons are greyed out, with the reason, when the game
  would not open the hub (no trade centre, a move plan or Find a habitat running). Animals in your
  zoo's trade centre are already on the board, in its pinned Trade centre column. Idea: a Nexus
  comment.
- **Bring a species from storage to the trade centre.** Stored animals listed at the bottom of the
  Species board's Trade centre column can't be dragged: the game keeps them in your Animal Storage,
  not in this zoo. The column now has a **Bring <species> to the trade centre** button. One click
  opens Animal Storage, shows only that species and ticks every one of them (adults first, as many
  as there is room for; animals on the market or already on the way are left alone), all behind a
  "Bringing your <species> to the trade centre" screen so you don't watch the list being worked
  on. After a 3-second countdown with **Cancel**, it presses the game's own **Send to Zoo** once. Back in the
  zoo each animal goes to the trade centre, one at a time with your pause. From there you can drag
  them on the board and the Breeding programme counts them. Anything the game won't take gets an
  **Open the game's Move screen** button. In Franchise the trade centre's capacity is your whole
  account's storage, so the board says "storage, all zoos 90/250". Idea: the developer.
- **Faster plans: the pause between moves now defaults to 0.5 s** (was 1.5 s) and can go as low
  as 0.5 s. Each move still waits for the game to confirm it first. A pause you set yourself is
  kept.
- **Fixed: a pinned habitat showing as a number after a restart.** Saved habitat assignments are
  now found again by the habitat's name, its animals and the game's habitat id; ones whose habitat
  is gone are hidden and cleaned up.
- **Fixed: the kin card running off the right edge of the screen** (e.g. hovering the inbreeding
  status on the Social welfare tab). It now opens on the side with room and always stays on screen.
- **Mute a species' alerts** (per zoo): a **Mute <species>** button on every new-risk alert and a
  **Mute alerts** switch on the Species board. Badges stay; muted species are listed in the
  planner's settings (click to unmute) and dimmed at the end of the board's species list. Idea:
  a Nexus comment (100 flamingos, low risk, constant alerts).
- **Show in park** for habitats and exhibits: in the Kin planner's habitat view and on every
  habitat column of the Species board, one click moves the camera there and opens its info panel.
- **Kin is lighter on big flocks.** Scans that change nothing are no longer redrawn, family-tree
  results are kept between scans, each related pair is worked out once, and the planner's matrix
  and the Species board no longer rebuild what has not changed.
- **Colour-morph prices.** An Albino (or any colour morph) is priced against listings of the same
  morph, and normal animals are no longer priced up by morph listings. The lister shows the morph
  and the morphs on sale. No extra market check is made.
- **Boxed animals with nowhere to go:** a Needs-you note after 10 seconds (adjustable), with Locate
  and a one-click Find a habitat.
- **Species names in your game's language.** The Species board, Kin planner, habitat cards, Find
  a habitat, the Market lister and the Market desk now show species names the way the game does
  (e.g. "Warzenschwein" in a German game, "Common Warthog" in English) instead of internal names
  ("Warthog Common"). Turn it off in the Kin planner's Settings ("Species names in the game's
  language") to see the internal names in every language; like the other Kin settings, it resets
  when the game starts. Thanks to salula1986 for the idea.
- **Species board: the trade centre is pinned on the right.** It no longer scrolls away with the
  habitats: its animals are always in view, so you can drag them into any habitat (or a habitat's
  animals into it) and see at once who is related to whom. The board is a little wider so the
  habitats keep their room.
- **Market desk** (a button in the Market lister panel's header): list many animals at once. Pick a
  species, filter, tick what to sell (or Tick all shown), check the prices, and press **List**.
  Filters: sex, age stages, fertility, rating, a **gene range** (e.g. 0-50 to sell the weakest and
  keep the rest), and under **More filters**: what "genes" means (average, breeding score or one
  gene), a range per gene, **keep the best N males and N females** of each species (shows the
  rest), pregnant, the storage tag, Kin, price and name. Sort by genes (best or worst first),
  price or name. Tick all leaves animals tagged Keep alone. It shows every animal's state (sellable, on the market with time left, or why
  not) and each result as it happens, with Stop and Retry.
- **Fixed: every listing skipped with "the game didn't select it".** The engine now reads the
  selection the way the game draws it (each row's own flag).
- **Listing no longer works the storage screen.** The mod now lists through the game's own listing
  call, finding each animal by its id inside Animal Storage, so the storage list refreshing while
  many animals are on the market can't make it lose or mix up animals. Still one animal at a time,
  each confirmed by the game, with your pause between listings. (Older game-side files fall back to
  the old way automatically.)
- **Breeding programme: group make-up.** Each species is planned with its make-up: pairs (1 ♂ :
  1 ♀), one male with several females (1:2 to 1:5), a harem (one male with any number), the
  reverse, or mixed groups. It comes from the game (the species' social groups and mating
  system); the **Make-up** arrows in the programme let you choose your own per species (kept for
  this zoo). Habitats are filled towards it from the trade centre and from other habitats' surplus,
  extra males (or females) move on, and a male and a female can be brought together to start a
  new group in an empty habitat. Each habitat card shows its target ("Make-up 2 ♂ 6 ♀ · 1 open").
  Thin out follows the same make-up, so it no longer sends away a second male a 1:3 group needs.
- **Breeding programme: a real optimiser.** The best pairs inside a habitat are now worked out
  exactly, and the search places a whole sex at once around the other, tries many group
  layouts, and checks every layout outright for small species. It runs in the background with a
  progress bar, so the game never stalls, and the same zoo always gives the same plan.

### 2.1.0

- **Habitat assignments are kept in every zoo, Franchise included.** They are stored on this PC
  in the game's player profile (Steam Cloud carries it to your other PCs), one set per zoo, and
  nothing is added to online or park saves. Assignments from Sandbox/Career park saves move over
  once.
- **Shoals and colonies** (fish shoals, insect and other colony species) are left out of Kin: no
  more inbreeding warnings for them.

### 2.0.0

- **Franchise first.** The Species board's plans and Find a habitat now work in Franchise zoos
  with no extra switch: your click is the opt-in. The Market lister is on by default. Runs
  (listings, plans, placements) skip a step that fails and carry on; only **Stop** ends them.
  Everything still goes one action at a time, each confirmed by the game.
- **Park launcher:** two round buttons on top of the game's tools column (bottom left): the
  Species board in one click, and Autosave.
- **More reliable Autosave:** the game restarts its 10-minute autosave timer after every trip to
  the hub, so players who go back and forth often got none. The mod keeps its own clock of park
  time that survives hub trips and asks the game for its normal autosave: Off (game default) /
  2 / 3 / 5 / 10 minutes, plus **Save now**. The setting resets each time the game starts.
- **Pause sliders:** pause between listings (1–10 s) and between moves (1–10 s).
- **Fertile adults** storage filter (the Adults chip cycles to it): hides infertile animals such
  as elderly ones past breeding age. The lister skips infertile elderly animals, which the market
  refuses.
- **Smarter prices:** Gold and Silver animals are priced against listings of their own medal;
  when none is listed, the price is extrapolated from the other medals. Appeal is taken into
  account within a medal.
- **Find a habitat** (Animal Storage): sends the selected animals to the zoo and places each one
  in a habitat that suits it, one at a time, instead of one destination for all.
- **Trade centre animals** now appear on the Species board and in the Breeding programme.
- **Habitat assignments** are kept in Sandbox/Career park saves (in Franchise, until the game
  closes; see 2.1.0).
- **Crash guard:** the game's own Move screen could crash when its selected animal had gone
  (stale selection); the mod now catches that and the game shows "Move failed" instead.

## Features

**Score badges** on every market and storage row:
- `G`: **gene score**, the average of size, longevity, fertility and immunity (0–100). Exhibit
  animals use longevity and fertility only; shoals have none.
- `B`: **breeder score**: fertility 40%, longevity 30%, immunity 30%.
- `V` (market only): **value**, gene score per 1,000 cash or per 100 CC. ★ marks the best value on
  the page.
- Colour by gene score: green ≥ 80, blue ≥ 60, amber ≥ 40, red below.

**Market quick filters.** These use the game's own filters, so they cover every page:
- Top genes, Breeders, Long-lived, Ending ≤1h, Cash, CC, Reset.
- **Dim < N** fades listings on the current page below a gene score.

**Storage filters.** Client side; storage isn't paged, so they cover everything:
- Pregnant, Alpha.
- **Adults** (click to cycle): all adults, then fertile adults only, then juveniles only, then off.
- **Sellable** (click to cycle): animals the market would take, then the ones it won't, then off.
  Not sellable means juvenile, infertile (including elderly past breeding age), pregnant, already
  listed or being moved. The chip's tooltip counts each reason. The game still checks every animal
  when you list it, so a rare case (e.g. an animal the game marks "can't be sold") can still be
  refused.
- **Not listed**: hides animals already listed on the market. They also stop counting for
  Has pair and Surplus.
- **Has pair**: species with at least one breeding-age male and female.
- **Surplus (keep N)**: everything beyond your best N per species and sex. These are trade or
  release candidates.
- **Gene ≥ N** and **Sort** by gene or breeder score.
- **"<species> only ✕"** (above the summary): set by the **Storage** button on the Species board
  or in Find a mate; shows one species until you click it or Clear. It is not saved.
- A summary line: counts, sexes, pregnant, species, breeding pairs, average gene score.
- Safety: changing a filter clears the selection, and "select all" only selects the rows you can
  see, so a bulk trade or release never includes hidden animals.

**Error banner** at the top of the screen. It shows:
- **Franchise server errors**, with names and hints, e.g. "Server error: NotEnoughCC: Not enough
  Conservation Credits". The game only reacts to "server unreachable"; the market and storage
  screens drop every other error, which is what leaves a spinner going forever.
- Lua script errors and errors reported by game code.
- UI script errors and failed UI requests.
- **Stuck spinners**: anything still loading after 20 s, with the last server error if there was one.

Click **Details** for the last 50 entries. Kin settings > **The mod's errors on screen** turns the
banner off; every error is still kept.

**Market lister** (Franchise only; **on by default**; turn it off with the **Lister** chip in the
storage toolbar; listing only starts when you click **Sell**):
- **Price book.** The mod remembers every Conservation Credits listing you have seen on the Market,
  and every row in your Trade History. It records species, sex, age group, gene score, genetics medal and price.
  It only reads what is already on screen and never requests data. Entries expire after 12 hours.
  Each listing is identified by what it shows (species, name, sex, age, genes, price), because the
  game reuses the same row ids on every market page. 1.2.1 starts a fresh book for this reason.
- **Advisor panel** for the selected storage animal:
  - current market prices **by sex**, plus juveniles and your own trades (count, median, range,
    median gene score);
  - the five closest listings by gene score;
  - a **recommended price**.
- **How the price is worked out:**
  - It uses comparable listings in order of preference: same sex and age group, then same sex, then
    any sex. CC listings only.
  - The **genetics medal** (Gold, Silver, Bronze or Unranked: the game's Rating column) comes
    first: listings with the same medal, sex and age group, then the next medal up or down scaled
    by the price ratio seen between those medals, and only then the gene-score fit below; the
    panel names the medal it used and shows the species' prices by medal.
  - **Colour morphs** (the game's "Colour morph" line, e.g. Albino) come before that: a normal
    animal is compared only with normal listings, so a few expensive morphs no longer lift its
    price; a morph is priced from listings of the same morph (3 or more), else of any morph, else
    from normal listings times the price gap seen between morphs and normal animals (this species,
    then all species, else a guessed ×2 with low confidence). The panel shows the morph and the
    morphs on sale. The game shows no hidden (carried) morphs, so those can't be tracked.
  - Price is fitted against gene score with a fit that a few odd listings can't skew, then set 3%
    below the fit so it sells.
  - It's blended with the game's own suggested price when there are fewer than 6 comparables.
  - Your **price offset** is applied next (see below).
  - It's rounded and clamped to the game's min/max.
  - Confidence is shown: high, medium, low, or "no market data" (game price only).
- **Price vs recommended** (`−` / `+` in the lister header) is one global offset in 5% steps, from
  −50% to +50%. Go under to sell faster or over to earn more. It applies to every recommended
  price: the panel, multi-select totals, and every listing the lister makes. The panel also shows
  the price before the offset. Click the value to reset it to ±0%. The setting is remembered.
- **Check market prices** loads that species' current Market listings (Conservation Credits)
  **in the background**, so the screen stays on Animal Storage. It reads **every page** (up to the
  20 the Market shows), one page at a time with a short pause, like paging through the Market
  yourself. The prices go into the price book, and a line under the button says how many were
  found on how many pages. It sends the same request the Market tab sends when you filter it.
- **Refresh prices (N species)** appears under Sell when several animals are selected (e.g. after
  select all). One click checks the species one after another, most-selected first, each with all
  its pages, at least 3 s apart. **Stop checking** ends it after the current species. Listing is
  disabled while a check runs.
- **Sell at recommended price** lists the selected animal at the shown price, or all ticked
  animals, through the game's own listing call (the same one its Trade → Confirm makes). The mod's
  game-side engine does it inside Animal Storage, one animal at a time. For each animal it:
  1. waits until the game has no other server request running;
  2. finds the animal by its id (so the storage list refreshing can't swap it for another);
  3. selects it and waits for the game to say it can be traded and to give its price limits;
  4. checks once more that the row is still that animal, then lists it at the recommended price
     (inside the game's limits; the game's own price when there is no market data) for the longest
     duration the game allows;
  5. waits for the game to show it on the market.

  Then it pauses (your pace, 3 s by default; the same after a server problem) before the next. A
  refused or timed-out animal is skipped and the run carries on; only **Stop** ends it. Errors from
  the game's other background requests are ignored. When it finishes, the panel counts what was
  listed and why the rest was not. It never runs on a timer or in the background. With older
  game-side files the old way runs instead (selecting each row and pressing the game's buttons).
- **Market desk** (a button in the Market lister panel's header): the same listing for many animals at once,
  in its own window over Animal Storage. Species on the left with how many can be sold; the
  species' animals in the middle with their recommended price and state (sellable, on the market
  with time left, juvenile, being moved...), filters (sex, age, fertility, rating, a gene range;
  More filters: per-gene ranges, keep the best N per sex, pregnant, storage tag, Kin, price, name),
  **Tick all shown** (never the animals tagged Keep);
  on the right the run: how many, the total asked, duration (longest or the game's default), the
  price offset and pause, **List N animals**, progress, Stop, and **Retry** for the ones that did not
  go through.

**Zoo management, Animals list** (in parks): a filter bar over the game's Animals panel.
- **Habitat** picker, **sex** and **age** (segmented), **Pregnant**, **Alpha**, **Contra**
  (on contraception), **Unhappy** (low welfare).
- **Gene ≥ N** and **Fertility ≥ N** minimums.
- **Sort** by gene score, breeder score or welfare.
- **Kin** filter and the **Planner**, **Board** and **Heat** buttons (see Kin below), and **Clear**.
- Select all only selects the animals you can see.
- Type **releasable** in the species search to list only the animals that can go to the wild, so a
  habitat's or the zoo's can be ticked at once for release groups.

**Find a habitat** (Animal Storage): a button under the game's own **Send to Zoo**. One click sends
the selection to the zoo with the game's Send to Zoo, then, back in the park, places each animal
in a habitat that suits it (the game's own habitat rules, reachable by keepers), one move at a
time, instead of the game's single destination for all of them. Works with select all and the
storage filters, Franchise included.

**Park launcher:** round buttons on top of the game's tools column (bottom left, above Paths,
Barriers, Terrain): **Settings** (every Kin setting), **Autosave**, which shows when the next save is
due, the **Species board** and the **Breeding programme** (the Breeding window), each in one click.

**Autosave:** the game restarts its 10-minute autosave timer after every trip to the hub, so
players who go back and forth often get none. The mod keeps its own clock of park time that
survives hub trips and asks the game for its normal autosave: Off (game default) / 2 / 3 / 5 /
10 minutes, plus **Save now**. The setting resets each time the game starts.

**Pause sliders:** the pause between Market lister listings (1–10 s) and between moves
(0.5–10 s). Every step still waits for the game to confirm it.

**Crash guard:** the game's own Move screen could crash when the animal it had selected was gone
(a stale selection); the mod catches that and the game shows "Move failed" instead.

**Kin: inbreeding at a glance** (in parks; new in 1.3). The game only shows relatedness one
animal or one pair at a time, so in a big zoo it is hard to tell who is related to whom. Kin reads
every animal's lineage (the game's own parent records) and shows, wherever you manage animals,
which male and female in the same habitat are related and would inbreed. Collective species
(shoals of fish, butterfly and other colonies) breed as one group and are left out.
- **Five colours, everywhere:**
  - **red, Inbreeding risk**: the game itself counts the pair as inbred (one is the other's parent,
    or they share a parent), both are adults and neither is on contraception;
  - **amber, Close kin**: grandparents, aunts/uncles and cousins. The game does not warn about
    these, but their young lose fertility and immunity just the same;
  - **gold, Later**: related, but one of them is still young;
  - **blue, Bonded elsewhere**: related, but the game will not let them breed because one of them
    is bonded to another mate (monogamous species, such as flamingos). This is the game's own
    rule, the same lock its Compare Mates screen shows. The card names the mate. If the bond ends
    (the mate dies, moves or leaves), the pair becomes a risk again and you get an alert. It also
    works for species added later, because Kin asks the game rather than using a species list;
  - **grey, Covered**: related, but they cannot breed: contraception, infertility, old age, or one
    of them will be too old by the time the young one grows up. The card says which.
- **Fertility over a life:** cards, the planner and the Species board say where each animal is:
  too young ("breeds in about 2 years"), not mature yet, fertile ("fertile for about 9 years
  more", or "for life" for species that never age out), its **last fertile years** (a "2y
  fertile" tag), **too old to breed**, or infertile, from the game's own age group (elderly) and
  the species' fertility ages. Too old animals are never counted as breeders; Suggest fixes counts
  a breeder in its last fertile years as half, Find a mate lists animals that can breed first,
  and the Breeding programme weighs each pair by how long it can still breed.
- **Zoo management, Animals list:** a DNA badge on every animal that has a relative to breed with
  in its habitat. Hover it to see who and how ("Zuri ♀, half-sister, 12.5% kinship, mates now"),
  why ("they share their mother Ama"), and the young they would have (fertility, immunity, size
  and longevity ranges from the game's own gene model). Click it for one-click actions:
  **Contraception** for one animal (the game's own toggle) and **Locate**.
- **Toolbar:** **Kin** filter (cycle: inbreeding risks only, or every related pair; combine it
  with the habitat picker), **Sort: Kin** (relatives next to each other, worst first), an
  "inbreeding risks" count, and **Planner** (Kin planner), **Board** (Species board) and **Heat**
  (the game's own breeding heat map) one click away.
- **Habitats list:** a badge per habitat with its related pairs.
- **Habitat info panel, Animals tab:** a line under each species' male/female counts
  ("2 inbreeding risks · 1 close kin") and a badge on each animal row.
- **Animal info panel:** a Kin line on the Overview card, and on the Studbook and Social lists a
  badge on each relative that lives in the same habitat and could breed with this animal.
- **Kin planner** (from the toolbar, any kin card or an alert): one screen for the whole zoo.
  - **Zoo overview:** every related pair, worst first, grouped by habitat.
  - **Habitat view:** **Show in park** under the name moves the camera to the habitat or exhibit
    and opens its info panel, to check and move animals there (the planner shrinks to a bar).
    For each species, a matrix of males × females. Each square shows the relation
    ("sister", "cousin"), the kinship % and the expected quality of their young (0–100, from the
    game's gene model), coloured by risk; current mates are marked. Click a square for the
    explanation, the expected young's genes and one-click actions; click a name for **Find a
    mate**: every possible partner in the zoo, unrelated first, best expected young first, with
    where they live, and **Storage** / **Market** buttons that open the hub for that species. In a
    Franchise zoo it also lists the adults in your own Animal Storage (**Storage too** switch),
    tagged **storage**.
  - **Settings:** every Kin setting on one page in sections, also opened from the dock's
    **Settings** button: alerts on/off, alerts for close kin too, **animals growing up** (off by
    default), **pop up for** (Needs you only, the default, or Heads-up too), the muted species (click one to
    unmute it), show covered pairs, **pair bonds count
    as protection** (on by default; off shows every bonded related pair as a risk, as before), and
    how distant a relative still counts as close kin (1/8, 1/16 or 1/32 kinship), and **species
    names in the game's language** (on by default; off shows the internal names, e.g. "Warthog
    Common", everywhere in the mod). Plus Rescan and the heat map.
- **Compare Mates** (in parks and in the hub): every candidate related to the animal you picked
  gets a badge ("Half-sister"), and the offspring box says how the pair is related, including
  cousins the game does not warn about. An optional **Unrelated first** toggle groups the safe
  mates at the top.
- **Genealogy:** each relative shows where it lives now ("Savannah Habitat" / "Not in the zoo")
  and, if it shares a habitat with the animal, the pair's badge.
- **Animal Storage (hub):** stored animals related to other stored animals get a "Related N"
  badge, a **Kin** filter chip shows only those, and the info panel warns before **Send to Zoo**
  when the animals you selected include a related pair ("Tau ♂ and Zuri ♀ are full siblings —
  they would inbreed if housed together"). It never blocks or changes the send.
- **Species board** (toolbar, or **Plan moves** on any kin card): pick a species and see all
  its habitats side by side as columns of animal cards, plus the suitable habitats it isn't in
  yet, the trade centre, and animals elsewhere. Each habitat column has **Show**, which moves the
  camera to that habitat and opens its info panel (the board closes). Hover an animal to light up
  its relatives across the board. Drag animals (or select them and click a column) to **stage moves into a plan**: the
  plan shows its effect before anything happens ("fixes 3 inbreeding risks, creates 0"), and
  **Suggest fixes** proposes the fewest moves that clear a species' risks while keeping animals
  able to breed: it counts the breeders with a fertile, unrelated partner (no contraception, not
  infertile), never takes a habitat's last breeding pair, never moves a juvenile, and avoids groups
  of only males or only females.
  The header shows the species' adults in your Animal Storage and has **Storage** and **Market**
  buttons that open the hub filtered to the species (the board closes). In a Franchise zoo the
  trade-centre column also lists those stored adults (read-only, with kin badges; stored young
  are not shown to the park), below the animals that are in the trade centre itself. The Market filter is the
  game's own and stays set afterwards, as after the game's Zoopedia button.
- **Breeding programme** (Species board, next to Suggest fixes): plans the best layout of a
  species' breeders for **genetics**: expected young (the game's gene formula) × the chance of
  conception (the game's own probability) × the years both can still breed. Animals rank by the
  juveniles they give, and every habitat set aside gets a breeding pair while the breeders allow one.
  Franchise and Career zoos keep the game's group and room rules in full; in a sandbox park with
  social groups off a habitat breeds through one male, and with overcrowding off it has no room
  limit. It follows the species' **group make-up** (pairs; one
  male with 2 to 5 females; a harem: one breeding male per habitat; the reverse; mixed groups),
  taken from the game's social groups and mating system, or your own choice with the **Make-up**
  arrows (kept per species for this zoo). It fills each habitat towards that make-up from the trade
  centre and from other habitats' surplus, moves extra males or females on, can start a new group
  (a male and a female together) in an empty habitat, and respects the habitats' room (the
  species' social maximum and the space the game requires), your habitat assignments and existing
  bonds. It never puts relatives together, and sends animals without a place in a group to the
  trade centre. The optimiser pairs animals exactly within each habitat, checks every layout for
  small species, and runs a guided search (with a progress bar, in the background) for big ones;
  the same zoo always gives the same plan. The preview shows breeding pairs, related pairs,
  expected young and chance of young before → after, and each habitat's target group ("Make-up
  2 ♂ 6 ♀ · 1 open"); a slider trades **fewer moves** against **best genetics** (Best genetics, the default, counts no cost for moving at all; moves that gain nothing are still left out; your last choice is kept for next time).
  **Use this plan** loads it into the normal plan (Execute, one move at a time). Breeders waiting
  at the **trade centre** (bought, or sent there) are part of it: the programme brings them into a
  group where they breed best ("1 from the trade centre"); **Use the trade centre (N waiting)**
  switches that off.
  **Optimiser**: Classic (a few seconds) or Deep (many starts after the Classic plan, in the
  background, with Stop and Continue; presets Quick to Marathon, or your own numbers, and CPU
  use). Kept as your default in every zoo.
- **Thin out** (Species board): picks who to send to the trade centre (to sell, trade or release).
  Each habitat keeps a target number of adults (its room for the species x **Core only** (just the
  breeding core: 1 male, 2 females) / Strict 55% / Lean 70% / Balanced 85% / Full 100%); over-full
  habitats give up their least valuable animals first: too old or infertile, males beyond the
  group make-up (a harem keeps one; 1:3 keeps one per three females), those in their last fertile
  years, those living with relatives, then the weakest genes.
  The best fertile male and females of every habitat, pregnant females and the species' best genes
  stay.
  To clear poor genes out of the gene pool, these go from **every** habitat, full or not, and the
  breeding core does not protect them:
  - **0% fertility genes** (on by default): any animal with a 0% fertility gene.
  - **Poor genes**: Off / **Weakest** (gene score under 35, or 0% immunity) / **Below average**
    (below the species average) / **Best only** (only the best quarter of each sex stays). A
    habitat can lose its only male this way; the Breeding programme can bring a better one in.
  - **Too old or infertile**: also from habitats with room. **Young too**: the gene rules also
    pick young animals.
  Only pregnant females, animals on the move, those you keep and, if every breeder of a sex has
  poor genes, the best of them stay. Your choices are remembered until you close the game. Click
  any animal in the preview to keep it or send it; **Send N to the trade centre** puts the moves in
  the plan, and Execute runs them one at a time.
- **Recompute** (in the Breeding programme and Thin out): both follow the animals as they change
  (the board re-reads them every few seconds), but the game's room, group sizes and fertile ages
  are asked once, when you open them. Recompute asks again and works the preview out afresh; your
  choices in it stay. On the board itself, **Rescan** does the same.
- **Habitat assignments:** in the Species board, **☆ Assign to <species>** on a habitat's column sets
  it aside for that species. Assignments are kept on this PC in the game's player profile (Steam
  Cloud carries it to your other PCs), one set per zoo, Franchise zoos included, so they come back
  when you open the zoo again. Nothing is added to online saves. Sandbox and Career parks are known
  by their name: renaming one starts its assignments afresh. Each assignment is found again by its
  habitat's name and the animals living there (the game numbers its habitats afresh every time a
  zoo loads), so rename a habitat while the zoo is open and its assignment follows; a habitat that
  is gone drops its assignment after a few loads. Suggest fixes then moves the species only into its
  assigned habitats and never puts another species there; the column also flags other species
  living in it. **Execute plan** then moves the animals through the
  game's own Move (a keeper boxes and carries each one), **one at a time**, waiting for the game to
  confirm each move; a move the game refuses is skipped and the run carries on until it is done or
  you press **Stop**. Destinations are checked with the game's own rules (habitat type, reachable
  by keepers). Plans run the same way in Franchise zoos: the **Execute** click is the opt-in.
  Each animal's **⋯** menu also has **Send to Trade Centre** (one move), and the trade centre is a
  column you can drag animals onto.
- **Alerts:** when a pair becomes an inbreeding risk (a youngster grows up next to its sibling, an
  animal moves in with its father, contraception is lifted) a note appears at the top of the
  screen within about 20 seconds, with **Show** and **Contraception** buttons. The game's own
  warning only comes once they have mated. On loading a park you get one summary if there are
  risks already. Alerts can be turned off (or extended to close kin) in the planner.
  **Growing up:** a youngster about to grow up (within about half a game year) gets a note only
  when it matters: **Needs you** when the group will go over the game's limit, when it will be
  pushed out of its group at maturity (contraception does not help there), or when it could
  inbreed with a relative; **Heads-up** when the group will be exactly full or a fertile
  youngster joins a full group. Otherwise it goes to the log silently. It also tells you when an
  animal that just grew up was pushed out of its group. Inbreeding-risk alerts are **Needs you**,
  close-kin alerts **Heads-up**; **Pop up for** chooses whether heads-ups pop up too.
  **Mute a species** (e.g. a big flamingo flock) with the alert's **Mute <species>** button or the
  Species board's **Mute alerts** switch: no more alerts about it in this zoo, while its badges,
  the planner and the board still show every pair. Muted species are listed (click to unmute) in
  the planner's settings and sit dimmed at the end of the board's species list.
- **Boxed with nowhere to go:** when an animal has waited in its transport box for 10 seconds with
  no destination (outside any habitat, no keeper on the way), a **Needs you** note names it, with
  **Locate** and **Find a habitat** (one click sends it to the best habitat, the same choice as
  Find a habitat from storage). The game itself only warns after a long time. In the planner's
  settings: on/off, after 5 s, 10 s, 30 s or 1 min, and whether animals waiting at the trade
  centre count (off by default).
- **Read-only and safe:** Kin only reads. The only things it changes are the ones you click, one
  animal per click, through the same calls the game's own buttons make (contraception, camera).
  Auto mode (below) is the exception, only for the species you turned it on for, and so are the
  Kin settings that say they act by themselves (newborn names, boxing an overdue mother), all off by
  default.
- **Stuck aquarium animals** (on by default): the game sometimes boxes an aquarium animal while it
  swims and never unboxes it. After 20 seconds of game time (4 real seconds at 5x; nothing while
  paused) the mod unboxes it, one animal at a time, with the same calls as the game's Unbox button
  (only animals no keeper, move or game action is working on). No notice for that; if the game
  boxes the same animal again three times right after, the mod leaves it for 10 minutes of game
  time and shows a **Needs you** note with **Locate**. Kin settings >
  **Let out stuck aquarium animals** turns it off. **Box Animal on an overdue mother** (off by
  default) boxes and lets out a mother still pregnant at twice her species' pregnancy, which makes
  her give birth.

### Auto mode (per species, off by default)

Auto mode runs a species' **Breeding programme** for you on a schedule and moves the animals into
its groups, so a species can look after itself without you. It is **off** for every species until
you turn it on for that species, in that zoo. Off, the board works exactly as before; only the
**Auto mode** button is new.

- **Turning it on:** on the Species board, pick the species and press **Auto mode** (next to Thin
  out). Its panel takes the middle of the board, like the Breeding programme. Press **Turn on**.
- **Settings, per species:**
  - **How often**, in game time: every month, season (the default), 2 seasons or year of the
    park's calendar (12 months a year, 3 a season). It waits while the game is paused and comes
    sooner at 2x and 5x; the panel shows the next run and about how long that is at the current
    speed.
  - **Breeding programme:** the same choices as the programme panel. **Make-up** (pairs, 1:2 to
    1:5, harem, mixed... the same choice as the programme's arrows), **Fewest moves ... Best
    genetics** (starts at your programme slider's position), and whether breeders waiting at the
    trade centre may join a group.
  - **Thin out** (on by default): first send what is over each habitat's room to the trade centre,
    the old and infertile first (fill level: Core only, Strict, Lean, Balanced, Full).
- **Kin settings** (Auto mode, all off by default): **Habitat set aside turns Auto on**, **Sell
  breeders before elderly**, **Bring waiting animals into a habitat** (pregnant females and animals
  too old to trade; young always go back to a habitat) and **Contraception near a relative**.
- **Each run:** Thin out (if on), then the Breeding programme on the zoo as Thin out leaves it.
  Then the moves, one at a time like Execute, each confirmed by the game and skipped if the game
  refuses it. A run with nothing to do just waits for the next one. **Run now** runs it at once.
- **Hands-free everywhere, Franchise included:** turning Auto mode on for a species is your
  go-ahead; nothing waits for a click. When several species are due together they take turns in
  a queue, one run at a time, so nothing is skipped. **Run now** puts a species first in line.
- **Notices:** off by default, so it works quietly. Turn on **Show a notice when Auto mode moves
  animals** in the panel (for all zoos) to get a short notice after each run that moved
  animals.
- **It never:** sells, releases, buys or lists animals (the trade centre is where it sends them;
  you sell or release them as before); moves a pregnant female (except out of the trade centre into
  a habitat, with **Bring waiting animals into a habitat**), a young animal (except back to a habitat
  from the trade centre), animals on the move, or animals you marked **Auto mode: hands off** (an
  animal card's menu); brings back an animal it sent to the trade centre, unless its herd changes
  (a birth, an arrival, a young one grown up) and gives it a place.
- **You stay in charge:**
  - An animal **you** move during a run is left where you put it for the rest of that run;
    otherwise Auto mode decides for its species. **Auto mode: hands off** keeps an animal where it
    is.
  - While you work on that species on the board (a staged plan with its animals, its Breeding
    programme or Thin out, a drag, a Move now), Auto mode waits.
  - If it would move an animal back where it just came from twice, it stops for that species and
    says so (**Hand it back** in the panel).
  - Several refused moves pause the species for 10 minutes; a move refused three times is no
    longer tried and is listed in the panel.
- **The panel** also shows the animals left alone and the last runs, each move with its reason
  and **Undo** (one move or the whole run).
- **Kept** with your habitat assignments in your player profile on this PC (settings, pins and the
  last log entries, about 12 KB per zoo at most), written only once you turn it on for a species.
  It needs that profile: until the zoo's data has been read, Auto mode can't be turned on and
  doesn't run.

## Install / uninstall

The mod is a folder in the game's data directory:

```
<Planet Zoo 2>\Win64\ovldata\PZ2QoL\
    Manifest.xml
    Main.ovl          Lua
    UI\PZ2QoLUI.ovl   UI overlay (HTML/JS/CSS)
```

- **Build:** `python tools/build_pz2qol.py --cobra-tools <cobra-tools checkout> --python <python with cobra-tools deps>`
- **Build and install:** add `--install "<Planet Zoo 2 folder>"`.
- **Update:** copy the new `Win64` folder over the old one (Replace).
- **Uninstall:** delete `Win64\ovldata\PZ2QoL`. No game files are modified. The only thing the
  mod writes is its own small `PZ2QoL` entry in your player profile (`Saves\player`: habitat
  assignments and, in zoos where you turned it on, Auto mode's settings and log; at most 64 KB);
  the game keeps but never reads it. No mod data goes into
  park or online saves.

The game will show its standard one-time "modifications detected" notice.

## How it works

- `Database.PZ2QoLLuaDatabase` is picked up by the game's own per-content-pack hook. It wraps
  `require` so game modules are patched when they first load.
- **UI injection** uses the game's UI overlay system (the same `api.ui2.LoadOverlay` /
  `MapResources` that Content0 uses):
  1. A hidden probe page first proves the overlay serves files.
  2. The hub's FrontEnd view then loads `PZ2QoLFrontend.html`, which is the game's own
     `Frontend.js` plus `js/mods/pz2qol/main.js`.
  3. If anything fails, the vanilla page loads and server errors fall back to the game's dialog.
- **Storage filtering** patches `DataStoreCollection.source` for the storage list context only.
- **Badges** are added to row DOM after each preact update.
- **Kin** (`Main/pz2qol.kin.lua` + `js/mods/pz2qol/kin*.js`): the Lua side reads each animal's
  parents (`animals:GetParents`), habitat, sex, age, contraception, mates and alleles, a few dozen
  animals per frame, and sends a JSON snapshot to the page in chunks. The page (`kincore.js`)
  works out relations (the game's own rule plus grandparents, aunts/uncles and cousins), the
  coefficient of kinship and the expected young (the game's own gene formula). Badges are VNodes
  added to the game's own row renders, so they survive list recycling.

## Status

- **Verified offline:**
  - unit tests for scoring, filters and pricing
    (`node --test tests/scores.test.mjs tests/pricing.test.mjs`)
  - a Lua behaviour test against a mock game API (`tests/lua/test_pz2qol.lua`)
  - build round-trips both OVLs
  - the UI runs in a browser harness with the game's real UI code (`node tests/uiharness/run.mjs`;
    `tests/uiharness/probe_imports.mjs` checks every module loads)
  - The harness runs the lister end to end against a fake native layer. It checks: on by default in game (the harness starts it off);
    the listed price equals the shown recommendation; the game's default duration is used; the
    animal is the sole selection when listed; 7 ticked animals list at most 5; listings are at
    least 3 s apart; a server rejection on the 3rd stops the run at 2/5 with the banner shown.
- **Not yet verified in the game.** Steam is in offline mode and Denuvo needs one online launch of
  the current build. Once that's done, check in this order:
  1. the overlay loads (look for the score badges)
  2. presets filter the market
  3. storage filters
  4. the error banner, e.g. trigger NotEnoughCC by buying a CC listing you can't afford
