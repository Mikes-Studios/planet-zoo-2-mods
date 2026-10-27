-----------------------------------------------------------------------
--  PZ2QoL.BoxRelease  ("Let out stuck aquarium animals")
--
--  The game boxes aquarium animals by itself (native SOS code) and, unlike
--  land animals, never lets them out again: they sit in the box until the
--  player clicks Unbox, and their welfare drops meanwhile (proven on Y:
--  2026-10-19, docs/RESEARCH-aquarium-boxing.md). This module does that
--  click for the player, hands-free, Franchise included (developer's
--  decision 2026-10-19; on by default, a Kin setting turns it off).
--
--  What counts as stuck (all read in the same tick, from animals the
--  habitat lists right now; reading an animal kept from an earlier tick
--  can crash the game, debugging.md):
--    in an aquarium, or a deep swimmer in any habitat;
--    IsAnimalBoxed, IsAnimalUnboxableByPlayer;
--    not IsBoxingClaimed (no staff or move at work), no transport job,
--    not IsAnimalRequestingBoxed / IsAnimalRequestingUnboxed (the game is
--    still busy with it), not IsBoxWaitingForNavMeshRebuild, not escaped;
--    and it stayed like that for nWaitSeconds.
--  The release is the game's own Unbox button: ClaimBoxing, then
--  UnboxAnimal (components.ui.animalinfopopup.lua, HabitatUtils.
--  UnboxAllAnimalsInHabitat). One animal at a time, nGapSeconds apart,
--  on the main thread (not the worker-thread manager tick), driven by
--  two ticks: DarwinWorld.OnAdvanceWhileRunning (the park world, every
--  frame whatever the mode) and SelectMode.Advance (the park's main
--  mode; brings the scaled frame time). Until 2026-10-20 only
--  SelectMode drove it, and in game (Y:, 3.2.0) it let nothing out after
--  the player left a park and loaded one again in the same launch.
--  A new park is the HUD's PZ2QoL_ReleaseSet (sent on every park's
--  HUD), not a changed world-API table.
--  An animal boxed again soon after each of nMaxQuick releases is left
--  alone for nRestSeconds and the page shows a Needs-you alert.
--  All its times are game time (PZ2QoL.GameClock: the park calendar),
--  so a stuck animal waits as long in the park at 5x as at 1x and
--  nothing happens while paused. Real-time floors (nMinScanReal,
--  nMinGapReal) keep scans and releases spaced at top speed.
--
--  An overdue mother (the page's kinbirth.js: still pregnant at twice her
--  species' pregnancy) gives birth once she is boxed and unboxed in place,
--  as the player would: Rebox boxes her (Kin setting overdueBox, off by
--  default) and the scan lets her out like a stuck animal, once per
--  pregnancy, whatever the aquarium setting.
--
--  JS -> Lua  PZ2QoL_ReleaseSet(bOn), PZ2QoL_ReleaseOverdue(bOn),
--             PZ2QoL_Rebox(sId)   an overdue mother's entity id
--  Lua -> JS  PZ2QoL_ReleaseEvent(sKind, nId, sSpecies, nCount)
--             sKind "gaveup" only (a release itself shows nothing)
-----------------------------------------------------------------------
local global   = _G
local api      = global.api
local pcall    = global.pcall
local type     = global.type
local tostring = global.tostring
local pairs    = global.pairs
local ipairs   = global.ipairs
local math     = global.math
local table    = global.table
local next     = global.next
local tonumber = global.tonumber

local BoxRelease = module(...)

-- game seconds (seconds at 1x speed)
BoxRelease.bOn = true
BoxRelease.bOverdue = false
BoxRelease.nScanSeconds = 2
BoxRelease.nWaitSeconds = 20    -- stuck this long before the mod lets it out
BoxRelease.nGapSeconds = 2      -- between two releases
BoxRelease.nQuickSeconds = 120  -- boxed again within this after a release: "quick"
BoxRelease.nMaxQuick = 3        -- quick re-boxings before the mod gives up for a while
BoxRelease.nRestSeconds = 600
-- real seconds: the least time between two scans / two releases at any speed
BoxRelease.nMinScanReal = 0.5
BoxRelease.nMinGapReal = 0.5

BoxRelease.tStuck = {}     -- e -> first game time seen stuck (cleared when not)
BoxRelease.tHistory = {}   -- e -> { at = last release, quick = n, restUntil = t } (game time)
BoxRelease.tViews = {}
BoxRelease.tRebox = {}     -- e -> true: boxed by Rebox, for the scan to let out
BoxRelease.oClock = nil    -- PZ2QoL.GameClock (Init)
BoxRelease.sClockSource = nil
BoxRelease.nLastScan = -1e9
BoxRelease.nLastScanReal = -1e9
BoxRelease.nLastRelease = -1e9
BoxRelease.nLastReleaseReal = -1e9
BoxRelease.oAnimals = nil  -- the park's animals API at the last scan (diagnostics only)
BoxRelease.nApiChanges = 0 -- times it was a different table since the last Set
BoxRelease.tTicked = {}    -- tick source -> true once logged since the last Set
BoxRelease.bWorldActive = nil  -- DarwinWorld OnActivate/OnDeactivate (nil: not seen since the last Set)
BoxRelease.nSummaryReal = 30  -- real seconds between two scan summaries in the trace
BoxRelease.nLastSummary = -1e9

local function realNow()
	local bOk, n = pcall(function()
		return api.time.PerformanceTimeToMilliseconds(api.time.GetPerformanceTimer()) / 1000
	end)
	return bOk and n or 0
end

local function call(api_, sName, ...)
	if api_ == nil then
		return nil
	end
	local bOk, fn = pcall(function() return api_[sName] end)
	if not bOk or type(fn) ~= "function" then
		return nil
	end
	local tRes = table.pack(pcall(fn, api_, ...))
	if not tRes[1] then
		return nil
	end
	return table.unpack(tRes, 2, tRes.n)
end

BoxRelease._Mark = function(self, sName)
	if self.Core then
		pcall(self.Core.Mark, self.Core, sName)
	end
end

BoxRelease._Log = function(self, sEvent, tData)
	if self.Core then
		pcall(self.Core.Log, self.Core, "release", sEvent, tData)
	end
end

BoxRelease._Send = function(self, sKind, e, sSpecies, n)
	for oUI in pairs(self.tViews) do
		local bOk = pcall(oUI.TriggerEventAtNextAdvance, oUI, "PZ2QoL_ReleaseEvent", sKind, e, sSpecies or "", n or 0)
		if not bOk or oUI.view == nil then
			self.tViews[oUI] = nil
		end
	end
end

-- Is e (listed in habitat h this tick) boxed and left there by the game?
BoxRelease._IsStuck = function(self, animals, e, bAquarium)
	if call(animals, "IsAnimalBoxed", e) ~= true then
		return false
	end
	-- a mother Rebox boxed is let out whatever the aquarium setting
	if self.tRebox[e] ~= true and (not self.bOn or (not bAquarium and call(animals, "DoesAnimalDeepSwim", e) ~= true)) then
		return false
	end
	if call(animals, "IsBoxingClaimed", e) == true
		or call(animals, "IsAnimalRequestingBoxed", e) == true
		or call(animals, "IsAnimalRequestingUnboxed", e) == true
		or call(animals, "IsBoxWaitingForNavMeshRebuild", e) == true
		or call(animals, "IsEscaped", e) == true then
		return false
	end
	local tTransport = call(animals, "GetAnimalTransportData", e)
	if type(tTransport) == "table" and tTransport.bHasTransportJob == true then
		return false
	end
	return call(animals, "IsAnimalUnboxableByPlayer", e) == true
end

-- The game's own Unbox button: claim, then unbox.
BoxRelease._Release = function(self, animals, e, sSpecies, nNow)
	if call(animals, "ClaimBoxing", e) ~= true then
		self:_Log("claim_refused", { e = e, species = sSpecies })
		return false
	end
	local bOk = pcall(animals.UnboxAnimal, animals, e)
	if not bOk then
		pcall(animals.ReleaseBoxing, animals, e)
		self:_Log("unbox_failed", { e = e, species = sSpecies })
		return false
	end
	if self.tRebox[e] then
		self.tRebox[e] = nil
		self:_Log("overdue_unboxed", { e = e, species = sSpecies })
		return true
	end
	local tHist = self.tHistory[e] or { quick = 0 }
	self.tHistory[e] = tHist
	tHist.at = nNow
	self.nLastRelease = nNow
	self.nLastReleaseReal = realNow()
	self:_Mark("release_unboxed")
	-- no notice for a release (developer, 2026-10-19): only the trace logs it
	self:_Log("unboxed", { e = e, species = sSpecies, quick = tHist.quick })
	return true
end

BoxRelease._Scan = function(self, nNow)
	local bOk, tAPIs = pcall(function() return api.world.GetWorldAPIs() end)
	if not bOk or type(tAPIs) ~= "table" then
		return
	end
	local animals, habitat = tAPIs.animals, tAPIs.habitat
	if animals == nil or habitat == nil then
		return
	end
	if animals ~= self.oAnimals then
		-- not a reset: the park's state is cleared by Set (every park's HUD)
		if self.oAnimals ~= nil then
			self.nApiChanges = self.nApiChanges + 1
		end
		self.oAnimals = animals
	end
	local tHabitats = call(habitat, "GetHabitats")
	if type(tHabitats) ~= "table" then
		return
	end
	local tSeen = {}
	local tDue = nil
	local nAquariums, nAnimals, nStuck = 0, 0, 0
	for _, h in ipairs(tHabitats) do
		local bAquarium = call(habitat, "IsAquarium", h) == true
		if bAquarium then
			nAquariums = nAquariums + 1
		end
		local tAnimals = call(habitat, "GetAnimalsInHabitat", h)
		if type(tAnimals) == "table" then
			nAnimals = nAnimals + #tAnimals
			for _, e in ipairs(tAnimals) do
				if not tSeen[e] and self:_IsStuck(animals, e, bAquarium) then
					tSeen[e] = true
					nStuck = nStuck + 1
					local nFirst = self.tStuck[e]
					if nFirst == nil then
						nFirst = nNow
						self.tStuck[e] = nNow
						-- boxed again soon after our release
						local tHist = self.tHistory[e]
						if tHist and tHist.at and nNow - tHist.at < self.nQuickSeconds then
							tHist.quick = tHist.quick + 1
							if tHist.quick >= self.nMaxQuick then
								tHist.restUntil = nNow + self.nRestSeconds
								tHist.quick = 0
								local sSpecies = call(animals, "GetSpecies", e)
								self:_Mark("release_gave_up")
								self:_Log("gave_up", { e = e, species = sSpecies, rest = self.nRestSeconds })
								self:_Send("gaveup", e, sSpecies, self.nMaxQuick)
							end
						end
					end
					local tHist = self.tHistory[e]
					local bResting = tHist and tHist.restUntil and nNow < tHist.restUntil
					if not bResting and tDue == nil and nNow - nFirst >= self.nWaitSeconds then
						tDue = e
					end
				end
			end
		end
	end
	for e in pairs(self.tStuck) do
		if not tSeen[e] then
			self.tStuck[e] = nil
		end
	end
	-- trace: what a scan sees, after each Set and then while animals are stuck
	local nReal = realNow()
	if self.nLastSummary == nil or (nStuck > 0 and nReal - self.nLastSummary >= self.nSummaryReal) then
		self.nLastSummary = nReal
		self:_Log("scan", { habs = #tHabitats, aquariums = nAquariums, animals = nAnimals, stuck = nStuck,
			due = tDue ~= nil, apiChanges = self.nApiChanges, clock = self.oClock and self.oClock.sSource or "none" })
	end
	if tDue ~= nil and nNow - self.nLastRelease >= self.nGapSeconds
		and realNow() - self.nLastReleaseReal >= self.nMinGapReal then
		-- still listed and stuck this tick: release it now
		local sSpecies = call(animals, "GetSpecies", tDue)
		if self:_Release(animals, tDue, sSpecies, nNow) then
			self.tStuck[tDue] = nil
		end
	end
end

-- The hub's start screen is up (Kin.SetStartScreen, from pz2qol.hub.lua):
-- the park may be unloading, and per-world calls on an unloaded park crash
-- natively (debugging.md). Touch nothing then.
BoxRelease._StartScreenUp = function(self)
	local Kin = global.package and global.package.loaded and global.package.loaded["pz2qol.kin"]
	return type(Kin) == "table" and Kin.bStartScreen == true
end

-- Every frame from each source: "world" (DarwinWorld) and "select"
-- (SelectMode, with the frame's scaled delta for the clock). Both may run
-- in one frame; the clock and the scan are gated by time, not calls.
BoxRelease.Tick = function(self, nDelta, sSrc)
	if not (self.bOn or next(self.tRebox) ~= nil) or self.oClock == nil or self:_StartScreenUp() then
		return
	end
	if sSrc == "world" and self.bWorldActive == false then
		return  -- between the park's OnDeactivate and its unload
	end
	if sSrc ~= nil and not self.tTicked[sSrc] then
		self.tTicked[sSrc] = true
		self:_Log("tick", { src = sSrc })
	end
	local nNow = self.oClock:Advance(nDelta)
	if self.oClock.sSource ~= self.sClockSource then
		-- the trace shows which clock runs (calendar expected)
		self.sClockSource = self.oClock.sSource
		self:_Log("clock", { source = self.sClockSource })
	end
	if nNow - self.nLastScan < self.nScanSeconds then
		return
	end
	local nReal = realNow()
	if nReal - self.nLastScanReal < self.nMinScanReal then
		return
	end
	self.nLastScan = nNow
	self.nLastScanReal = nReal
	self:_Scan(nNow)
end

BoxRelease._PatchSelectMode = function(self, SelectMode)
	local fnAdvance = SelectMode.Advance
	if type(fnAdvance) ~= "function" then
		self:_Mark("release_no_tick")
		return
	end
	SelectMode.Advance = function(oMode, ...)
		local tRes = table.pack(fnAdvance(oMode, ...))
		self:_SafeTick((...), "select")
		return table.unpack(tRes, 1, tRes.n)
	end
	self:_Mark("release_patched")
end

-- The park world's per-frame script call (World.AdvanceWhileRunning ->
-- self:OnAdvanceWhileRunning), whatever mode the player is in.
BoxRelease._PatchWorld = function(self, DarwinWorld)
	local fnRun = DarwinWorld.OnAdvanceWhileRunning
	if type(fnRun) ~= "function" then
		self:_Mark("release_no_world_tick")
		return
	end
	DarwinWorld.OnAdvanceWhileRunning = function(oWorld, ...)
		local tRes = table.pack(fnRun(oWorld, ...))
		-- its delta may be unscaled: the clock gets no frame time from here
		self:_SafeTick(nil, "world")
		return table.unpack(tRes, 1, tRes.n)
	end
	local fnActivate, fnDeactivate = DarwinWorld.OnActivate, DarwinWorld.OnDeactivate
	if type(fnActivate) == "function" then
		DarwinWorld.OnActivate = function(...)
			local tRes = table.pack(fnActivate(...))
			self.bWorldActive = true
			return table.unpack(tRes, 1, tRes.n)
		end
	end
	if type(fnDeactivate) == "function" then
		DarwinWorld.OnDeactivate = function(...)
			self.bWorldActive = false
			return fnDeactivate(...)
		end
	end
	self:_Mark("release_world_patched")
end

BoxRelease._SafeTick = function(self, nDelta, sSrc)
	local bOk, sErr = pcall(self.Tick, self, nDelta, sSrc)
	if not bOk and not self.bTickErrorLogged then
		self.bTickErrorLogged = true
		self:_Log("error", { err = tostring(sErr), src = sSrc })
	end
end

-- From the HUD page: on every park's HUD and on a settings change. Each
-- park starts over here (entity ids mean other animals in another park).
BoxRelease.Set = function(self, bOn)
	self.bOn = bOn ~= false
	self.tStuck = {}
	self.tRebox = {}
	self.tHistory = {}
	self.tTicked = {}
	self.bWorldActive = nil
	self.nApiChanges = 0
	self.nLastSummary = nil
	self.bTickErrorLogged = false
	self:_Mark(self.bOn and "release_on" or "release_off")
	self:_Log("set", { on = self.bOn })
end

BoxRelease.SetOverdue = function(self, bOn)
	self.bOverdue = bOn == true
	self:_Log("overdue_set", { on = self.bOverdue })
end

-- Box Animal on a habitat animal (the info panel's button), for the scan
-- to let out in place. -> true, or false + why
BoxRelease.Rebox = function(self, sId)
	if not self.bOverdue then
		return false, "switched off"
	end
	if self:_StartScreenUp() then
		return false, "no park"
	end
	local e = tonumber(sId)
	local bOk, tAPIs = pcall(function() return api.world.GetWorldAPIs() end)
	local animals = bOk and type(tAPIs) == "table" and tAPIs.animals or nil
	if e == nil or animals == nil then
		return false, "no habitat animal " .. tostring(sId)
	end
	if call(animals, "IsAnimalBoxableByPlayer", e) ~= true then
		return false, "the game doesn't allow boxing it now"
	end
	if call(animals, "ClaimBoxing", e) ~= true then
		return false, "box is busy (claim refused)"
	end
	local bBoxed = pcall(animals.BoxAnimal, animals, e)
	if not bBoxed then
		pcall(animals.ReleaseBoxing, animals, e)
		return false, "box failed"
	end
	self.tRebox[e] = true
	return true
end

BoxRelease.Attach = function(self, oUI)
	if oUI == nil or self.tViews[oUI] then
		return
	end
	self.tViews[oUI] = true
	pcall(function()
		oUI:AddEventListener("PZ2QoL_ReleaseSet", 1, function(_, bOn)
			pcall(self.Set, self, bOn)
		end, self)
		oUI:AddEventListener("PZ2QoL_ReleaseOverdue", 1, function(_, bOn)
			pcall(self.SetOverdue, self, bOn)
		end, self)
		oUI:AddEventListener("PZ2QoL_Rebox", 1, function(_, sId)
			local bOk, bBoxed, sWhy = pcall(self.Rebox, self, sId)
			self:_Mark((bOk and bBoxed) and "release_overdue_boxed" or "release_overdue_not_boxed")
			self:_Log("overdue_rebox", { e = tostring(sId), boxed = bOk and bBoxed == true, why = bOk and sWhy or tostring(bBoxed) })
		end, self)
	end)
end

BoxRelease.Init = function(self, Core)
	self.Core = Core
	local bOk, GameClock = pcall(global.require, "PZ2QoL.GameClock")
	if bOk and type(GameClock) == "table" and type(GameClock.New) == "function" then
		self.oClock = GameClock.New()
	else
		self:_Mark("release_no_clock")
	end
	Core:AddModulePatch("Editors.Select.SelectMode", function(t) self:_PatchSelectMode(t) end)
	Core:AddModulePatch("Worlds.DarwinWorld", function(t) self:_PatchWorld(t) end)
end
