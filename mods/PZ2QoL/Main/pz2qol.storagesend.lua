-----------------------------------------------------------------------
--  PZ2QoL.StorageSend  ("Find a habitat")
--
--  Animal Storage's Send to Zoo (AnimalStorageHubMode.OnSendAnimalsToZoo
--  -> api.planetHub.StorageUISetAnimalsToBeSentToZoo(ids, false), then a
--  world transition back to the zoo) leaves the animals pending in the
--  park. The park's SelectMode then takes them
--  (park:GetAndClearPendingSendToZooEntityIDs) and opens the game's Move
--  screen for all of them at once: BaseUIMode.SetNewMode(
--  "AnimalMovementMode", { tSelectedAnimals = entity ids }), where one
--  click sends every animal to ONE destination.
--
--  When the player started it with the mod's "Find a habitat" button, this
--  module takes that one Move-screen request instead (the same state as the
--  player leaving the Move screen at once; only from SelectMode.Advance, in
--  the park's first select frames, so the player's own Move is never taken)
--  and hands the animals to the park page, which places them one at a time:
--    JS -> Lua  PZ2QoL_SendArm(nCount, sTarget)   (hub, before Send to Zoo)
--               sTarget "habitat" (Find a habitat) or "trade" (Bring to the
--               trade centre, PZ2QoL.StorageFetch: also the zoo of the click)
--    JS -> Lua  PZ2QoL_SendDisarm()               (the game's own button)
--    Lua -> JS  PZ2QoL_SendArrived(nSeq, ids, sTarget)   (park HUD)
--    JS -> Lua  PZ2QoL_SendAck(nSeq) / PZ2QoL_SendHello()
--    JS -> Lua  PZ2QoL_SendFacts(req, id, depth) -> PZ2QoL_SendFactsResult(req, json)
--               depth "status": without the habitats (polls, trade runs)
--    JS -> Lua  PZ2QoL_SendMove(req, id, habitat, nSeq) -> PZ2QoL_SendMoveResult(req, ok, detail)
--               habitat "trade:arrival": the Move screen's own trade-centre
--               sequence, only for the animals of arrival nSeq
--    JS -> Lua  PZ2QoL_SendOpenMove(req, ids) -> PZ2QoL_SendOpenMoveResult(req, ok, detail)
--               the game's own Move screen for those arrivals (on the next
--               SelectMode.Advance, where the game itself opens it)
--  A move is PZ2QoL.Kin's Move: the game's own Move sequence for ONE animal.
--  Fail soft: anything unexpected leaves the game's own Move screen alone.
-----------------------------------------------------------------------
local global   = _G
local api      = global.api
local pcall    = global.pcall
local xpcall   = global.xpcall
local error    = global.error
local tostring = global.tostring
local tonumber = global.tonumber
local type     = global.type
local pairs    = global.pairs
local ipairs   = global.ipairs
local string   = global.string
local table    = global.table
-- the retail game may ship without the debug library
local traceback = global.debug and global.debug.traceback or tostring
local Handover  = global.require("PZ2QoL.Handover")
local ParkReads = global.require("PZ2QoL.ParkReads")

local StorageSend = module(...)

StorageSend.nArmSeconds = 600   -- an arm older than this is ignored
StorageSend.nArmParkSeconds = 15 -- of park select frames before an unused arm goes
StorageSend.tArm = nil          -- { nCount, nTime, sTarget, sZoo, sZooMode, nParkSince, nParkLast }
StorageSend.tArrived = nil      -- { nSeq, sIds, tIds (set), bAcked, sTarget }
StorageSend.tOpenMove = nil     -- { sReq, tIDs, nTime, oUI }: the game's Move screen, next SelectMode tick
StorageSend.nOpenMoveSeconds = 5 -- the page stops waiting for the answer after 6 s
StorageSend.bInSelectAdvance = false
StorageSend.fnSetNewMode = nil  -- the game's own BaseUIMode.SetNewMode (unwrapped)
StorageSend.nSeq = 0
StorageSend.tViews = global.setmetatable({}, { __mode = "k" })
StorageSend.sLastUIMode = nil  -- the last BaseUIMode.SetNewMode name (Kin.AutoGate)

local function trace(sMsg)
	pcall(function() api.debug.Trace("[PZ2QoL] send: " .. sMsg) end)
end

local function mark(sName)
	local Core = global.package.loaded["pz2qol.core"]
	if Core then
		pcall(Core.Mark, Core, sName)
	end
end

local function now()
	local bOk, n = pcall(function()
		return api.time.PerformanceTimeToMilliseconds(api.time.GetPerformanceTimer()) / 1000
	end)
	return bOk and n or 0
end

local function kin()
	return global.package.loaded["pz2qol.kin"]
end

local function call(o, sName, ...)
	if o == nil then
		return nil
	end
	local fn = nil
	pcall(function() fn = o[sName] end)
	if type(fn) ~= "function" then
		return nil
	end
	local tRes = table.pack(pcall(fn, o, ...))
	if not tRes[1] then
		return nil
	end
	return table.unpack(tRes, 2, tRes.n)
end

local function idString(n)
	local Kin = kin()
	if Kin and Kin.IdString then
		return Kin.IdString(n)
	end
	return tostring(n)
end

local function known(v)
	return v ~= nil and v ~= 0 and v ~= "" and v ~= "0"
end

local function log(sEvent, tData)
	local Core = global.package.loaded["pz2qol.core"]
	if Core and Core.Log then
		pcall(Core.Log, Core, "send", sEvent, tData)
	end
end

local function entityName(e)
	local bOk, s = pcall(function() return api.ui2.GetEntityName(e) end)
	if bOk and type(s) == "string" and s ~= "" then
		return s
	end
	return nil
end

-- The modded park HUD, when loaded and ready.
StorageSend._ParkUI = function(self)
	local Hub = global.package.loaded["pz2qol.hub"]
	if Hub == nil or not Hub.bHUDIsModded or Hub.oHUDUI == nil then
		return nil
	end
	local oUI = Hub.oHUDUI
	local bOk, bReady = pcall(oUI.IsReady, oUI)
	if bOk and bReady then
		return oUI
	end
	return nil
end

-----------------------------------------------------------------------
-- Taking the game's Move screen request
-----------------------------------------------------------------------
StorageSend._GameMode = function(self)
	local Kin = kin()
	local sMode = "unknown"
	pcall(function()
		sMode = Kin:_GameMode(api.world.GetWorldAPIs())
	end)
	return sMode
end

-- true when this request is the animals the player sent with "Find a
-- habitat" and they are now the mod's to place.
StorageSend._TryTake = function(self, tParams)
	local tArm = self.tArm
	-- the first Move screen request after a send is the one for those
	-- animals; an arm is never used twice
	self.tArm = nil
	if tArm == nil or now() - tArm.nTime > self.nArmSeconds then
		return false
	end
	if type(tParams) ~= "table" or tParams.bIsExhibit or tParams.tReturnUIMode ~= nil or tParams.nReturnManagementScreen ~= nil then
		mark("send_not_ours")
		return false
	end
	local tIDs = tParams.tSelectedAnimals
	if type(tIDs) ~= "table" or #tIDs == 0 or #tIDs > tArm.nCount then
		mark("send_count_mismatch")
		return false
	end
	local tOut = {}
	for _, e in ipairs(tIDs) do
		if type(e) ~= "number" then
			mark("send_not_entities")
			return false
		end
		tOut[#tOut + 1] = idString(e)
	end
	local sMode = self:_GameMode()
	local sTarget = tArm.sTarget == "trade" and "trade" or "habitat"
	if sTarget == "trade" and not self:_SameZoo(tArm, sMode) then
		return false
	end
	local Kin = kin()
	if sTarget == "habitat" and Kin and Kin:ZoosDiffer(tArm.sZoo, Kin:WorldZooKey()) then
		mark("send_zoo_mismatch")
		return false
	end
	local oUI = self:_ParkUI()
	if oUI == nil or kin() == nil then
		mark("send_no_page")
		return false
	end
	self.nSeq = self.nSeq + 1
	local tSet = {}
	for _, s in ipairs(tOut) do
		tSet[s] = true
	end
	self.tArrived = { nSeq = self.nSeq, sIds = table.concat(tOut, ","), tIds = tSet, bAcked = false, sTarget = sTarget }
	self:_Deliver(oUI)
	mark("send_taken")
	if sTarget == "trade" then
		mark("fetch_taken")
	end
	log("taken", { n = #tOut, target = sTarget, seq = self.nSeq })
	trace("took " .. #tOut .. " animals from the Move screen (" .. sTarget .. ")")
	return true
end

-- "trade": only in the zoo the player clicked in. A Franchise (or unknown
-- mode) zoo needs both keys; an offline park may not know its key yet.
StorageSend._SameZoo = function(self, tArm, sMode)
	local Kin = kin()
	local sNow = Kin and Kin:WorldZooKey()
	local sThen = tArm.sZoo
	if sNow ~= nil and sThen ~= nil then
		if sNow ~= sThen then
			mark("send_zoo_mismatch")
			log("zoo", { same = false })
			return false
		end
		return true
	end
	if sMode == "offline" and tArm.sZooMode == "offline" then
		return true
	end
	mark("send_zoo_unknown")
	log("zoo", { unknown = true, now = sNow ~= nil, click = sThen ~= nil, mode = sMode })
	return false
end

StorageSend._Deliver = function(self, oUI)
	local t = self.tArrived
	if t == nil or t.bAcked then
		return
	end
	oUI = oUI or self:_ParkUI()
	if oUI ~= nil then
		pcall(oUI.TriggerEventAtNextAdvance, oUI, "PZ2QoL_SendArrived", t.nSeq, t.sIds, t.sTarget or "habitat")
	end
end

StorageSend._PatchBaseUIMode = function(self, BaseUIMode)
	local fnSetNewMode = BaseUIMode.SetNewMode
	if type(fnSetNewMode) ~= "function" then
		trace("BaseUIMode has no SetNewMode; Find a habitat off")
		mark("send_patch_missing")
		return
	end
	self.fnSetNewMode = fnSetNewMode
	BaseUIMode.SetNewMode = function(sMode, tParams, ...)
		-- the game opens the Move screen for animals from storage only from
		-- SelectMode.Advance; any other Move request is the player's own
		if sMode == "AnimalMovementMode" and self.tArm ~= nil then
			if not self.bInSelectAdvance then
				mark("send_move_not_from_storage")
			else
				local bOk, bTaken = pcall(self._TryTake, self, tParams)
				if bOk and bTaken then
					return
				end
				if not bOk then
					trace("take failed: " .. tostring(bTaken))
				end
			end
		end
		-- the mode that really opens, for Auto mode's gate (Kin.AutoGate); only read
		self.sLastUIMode = sMode
		return fnSetNewMode(sMode, tParams, ...)
	end
	mark("send_patched")
end

-----------------------------------------------------------------------
-- One animal: what the page needs to pick a habitat
-----------------------------------------------------------------------
local function locationKind(animals, e)
	local n = call(animals, "GetCurrentLocationType", e)
	if n == nil then
		return "other"
	end
	local tKinds = {
		{ "CurrentLocationType_Habitat", "habitat" }, { "CurrentLocationType_TradeCentre", "trade" },
		{ "CurrentLocationType_VetSurgery", "vet" }, { "CurrentLocationType_Quarantine", "quarantine" },
		{ "CurrentLocationType_FreeRoaming", "escaped" }, { "CurrentLocationType_BeingCarried", "transit" },
	}
	for _, k in ipairs(tKinds) do
		local bOk, v = pcall(function() return animals[k[1]] end)
		if bOk and v ~= nil and v == n then
			return k[2]
		end
	end
	return "other"
end

-- sDepth "status": where it is and whether it moves, without the habitat
-- survey (150 to 500 game calls), for the runs' polls and the trade run.
StorageSend.Facts = function(self, oUI, sReq, sId, sDepth)
	local Kin = kin()
	local function answer(t)
		pcall(oUI.TriggerEventAtNextAdvance, oUI, "PZ2QoL_SendFactsResult", sReq, Kin and Kin.Encode(t) or "null")
	end
	local tAPIs = Kin and Kin:_ParkWorld() or nil
	if tAPIs == nil or tAPIs.animals == nil then
		return answer({ id = tostring(sId), error = "nopark" })
	end
	local animals = tAPIs.animals
	local e = tonumber(sId)
	local tOut = { id = tostring(sId), mode = Kin:_GameMode(tAPIs) }
	local sSpecies = e and call(animals, "GetSpecies", e)
	local guid = e and call(animals, "EntityIDToAnimalGUID", e)
	if sSpecies == nil or not known(guid) then
		tOut.gone = true
		return answer(tOut)
	end
	tOut.species = sSpecies
	tOut.name = call(animals, "GetName", e) or ""
	tOut.alive = call(animals, "IsAlive", e) ~= false
	tOut.lt = locationKind(animals, e)
	tOut.moving = ParkReads.HasTransportJob(animals, e)
	local nAssigned = call(animals, "GetAssignedHabitatEntityID", e)
	tOut.assigned = known(nAssigned) and idString(nAssigned) or ""
	-- the trade centre (Bring to the trade centre)
	tOut.boxed = call(animals, "IsAnimalBoxed", e) == true
	tOut.claimed = call(animals, "IsBoxingClaimed", e) == true
	local tTC = nil
	pcall(function() tTC = Kin:_TradeCentre(tAPIs) end)
	tOut.tc = type(tTC) == "table" and tostring(tTC.id) or ""
	tOut.tcMax, tOut.tcNow = ParkReads.TradeCentreRoom(tAPIs.park)
	self:_NoteArrival(sId, tOut.lt)
	-- the game is still waiting on a Franchise server request
	local bBusy = call(tAPIs.franchise, "IsDatabaseOperationInProgress")
	tOut.busy = bBusy == true
	if sDepth == "status" then
		return answer(tOut)
	end
	-- where its parents live (a juvenile belongs with its mother)
	local tParentHabs = Kin.Array()
	local tParentSeen = {}
	local tParents = call(animals, "GetParents", guid)
	if type(tParents) == "table" then
		for _, pg in pairs(tParents) do
			if known(pg) then
				local pe = call(animals, "AnimalGUIDToEntityID", pg)
				if known(pe) and call(animals, "IsAlive", pe) ~= false then
					local ph = call(animals, "GetAssignedHabitatEntityID", pe)
					if known(ph) and not tParentSeen[idString(ph)] then
						tParentSeen[idString(ph)] = true
						tParentHabs[#tParentHabs + 1] = idString(ph)
					end
				end
			end
		end
	end
	tOut.parentHabs = tParentHabs
	-- every finished habitat: may it go there (the Move screen's own checks),
	-- can a keeper reach it, and who lives there
	local habitat = tAPIs.habitat
	local tHabitats = call(habitat, "GetAllCompleteHabitats")
	if type(tHabitats) ~= "table" then
		tHabitats = call(habitat, "GetHabitats") or {}
	end
	local tList = Kin.Array()
	local tSeen = {}
	for _, h in pairs(tHabitats) do
		local sH = idString(h)
		if not tSeen[sH] then
			tSeen[sH] = true
			local bOk, sReason = Kin:_HabitatOk(tAPIs, h, { guid })
			local tHab = { id = sH, name = entityName(h) or ("Habitat " .. sH), ok = bOk == true, reason = sReason }
			if bOk then
				tHab.reach = call(tAPIs.staff, "CanStaffDeliverAnimalToFacility", e, h) ~= false
				tHab.crowded = call(habitat, "IsHabitatTooCrowded", h) == true
				local tMembers = call(habitat, "GetAnimalsInHabitat", h)
				local nTotal, nSame = 0, 0
				if type(tMembers) == "table" then
					for _, m in ipairs(tMembers) do
						nTotal = nTotal + 1
						if call(animals, "GetSpecies", m) == sSpecies then
							nSame = nSame + 1
						end
					end
				end
				tHab.total = nTotal
				tHab.same = nSame
			end
			tList[#tList + 1] = tHab
		end
	end
	tOut.habitats = tList
	answer(tOut)
end

-- Where each arrival of a "trade" run was when the page first asked
-- (open: where do storage arrivals wait?). Once per animal.
StorageSend._NoteArrival = function(self, sId, sLt)
	local t = self.tArrived
	local sKey = tostring(sId)
	if t == nil or t.sTarget ~= "trade" or t.tIds == nil or not t.tIds[sKey] then
		return
	end
	t.tNoted = t.tNoted or {}
	if t.tNoted[sKey] then
		return
	end
	t.tNoted[sKey] = true
	local sKind = tostring(sLt or "other")
	if not string.find(sKind, "^[%w_]+$") then
		sKind = "other"
	end
	mark("fetch_arrival_lt_" .. sKind)
	log("arrival", { id = sKey, lt = sKind })
end

-- One of the animals the mod took from the Move screen for a "trade" run
-- (that run, when nSeq is given)?
StorageSend._IsArrival = function(self, sId, nSeq)
	local t = self.tArrived
	return t ~= nil and t.sTarget == "trade" and t.tIds ~= nil and t.tIds[tostring(sId)] == true
		and (nSeq == nil or nSeq == "" or tonumber(nSeq) == t.nSeq)
end

-- ONE arrival to the trade centre the way the game's Move screen does it
-- when the player picks the trade centre (AnimalMovementEditMode.
-- HabitatAnimalDestinationSelected, 1.0.5): VerifyHabitatAnimal (alive; not
-- escaped unless boxed), not already moving (nor mid box animation, when the
-- info panel greys its Move out), room, then AttemptToSendToTradeCentre. Unlike the
-- info panel's Send to Trade Centre there is no CanSendAnimalToTradeCentre
-- check (that one refuses boxed animals, and arrivals may be boxed).
-- -> bMoved, sDetail
StorageSend._ArrivalToTrade = function(self, sId)
	local Kin = kin()
	local tAPIs = Kin and Kin:_ParkWorld() or nil
	if tAPIs == nil or tAPIs.animals == nil then
		return false, "No park is loaded."
	end
	local animals = tAPIs.animals
	local e = tonumber(sId)
	if e == nil then
		return false, "Unknown animal."
	end
	if call(animals, "IsAlive", e) == false then
		return false, "This animal is no longer alive."
	end
	if call(animals, "IsEscaped", e) == true and call(animals, "IsAnimalBoxed", e) ~= true then
		return false, "This animal has escaped."
	end
	if ParkReads.IsBeingMoved(animals, e) then
		return false, "This animal is already being moved."
	end
	local tTC = nil
	pcall(function() tTC = Kin:_TradeCentre(tAPIs) end)
	if tTC == nil then
		return false, "There is no trade centre in this zoo."
	end
	local nMax, nNow, bFull = ParkReads.TradeCentreRoom(tAPIs.park)
	if bFull then
		return false, "The trade centre is full (" .. nNow .. " of " .. nMax .. ")."
	end
	if call(animals, "AttemptToSendToTradeCentre", e) ~= true then
		return false, "The game refused to send it to the trade centre."
	end
	return true, ""
end

-- ONE move: PZ2QoL.Kin's Move (the game's own Move sequence for one animal).
StorageSend.Move = function(self, oUI, sReq, sId, sHab, nSeq)
	local function answer(bOk, sDetail)
		mark(bOk and "send_move_ok" or "send_move_failed")
		pcall(oUI.TriggerEventAtNextAdvance, oUI, "PZ2QoL_SendMoveResult", sReq, bOk == true, sDetail or "")
	end
	local Kin = kin()
	if Kin == nil then
		return answer(false, "The mod's move code is not loaded.")
	end
	sHab = tostring(sHab or "")
	if sHab == "trade:arrival" then
		if self:_IsArrival(sId, nSeq) then
			local bOk, bMoved, sDetail = pcall(self._ArrivalToTrade, self, tostring(sId))
			if not bOk then
				bMoved, sDetail = false, "The move failed: " .. tostring(bMoved)
			end
			mark(bMoved and "fetch_move_ok" or "fetch_move_failed")
			log("arrival_move", { id = tostring(sId), ok = bMoved == true, detail = sDetail })
			return answer(bMoved == true, sDetail)
		end
		-- not (or no longer) one of this run's arrivals: the strict path
		sHab = "trade:auto"
	end
	if tonumber(sHab) == nil and string.sub(sHab, 1, 6) ~= "trade:" then
		return answer(false, "Unknown habitat.")
	end
	local bAnswered = false
	local tProxy = {
		TriggerEventAtNextAdvance = function(_, _, _, bOk, sDetail)
			bAnswered = true
			answer(bOk == true, sDetail)
		end,
	}
	local bOk, sErr = pcall(Kin.Move, Kin, tProxy, sReq, tostring(sId), tostring(sHab))
	if not bAnswered then
		answer(false, bOk and "No answer from the move." or ("The move failed: " .. tostring(sErr)))
	end
end

-----------------------------------------------------------------------
-- The game's own Move screen for arrivals the run could not place
-----------------------------------------------------------------------
StorageSend.OpenMove = function(self, oUI, sReq, sIds)
	local function answer(bOk, sDetail)
		pcall(oUI.TriggerEventAtNextAdvance, oUI, "PZ2QoL_SendOpenMoveResult", sReq, bOk == true, sDetail or "")
	end
	local Kin = kin()
	local tAPIs = Kin and Kin:_ParkWorld() or nil
	if tAPIs == nil or tAPIs.animals == nil then
		return answer(false, "nopark")
	end
	if self.fnSetNewMode == nil then
		return answer(false, "nomode")
	end
	local animals = tAPIs.animals
	local t = self.tArrived
	local tIDs = {}
	for sId in string.gmatch(tostring(sIds or ""), "[^,]+") do
		local e = tonumber(sId)
		-- only animals the mod took from the Move screen, alive and not
		-- already moving (the Move screen's VerifyAnimals would fail)
		if e ~= nil and t ~= nil and t.tIds ~= nil and t.tIds[sId] then
			if call(animals, "IsAlive", e) ~= false and not ParkReads.HasTransportJob(animals, e) then
				tIDs[#tIDs + 1] = e
			end
		end
	end
	if #tIDs == 0 then
		return answer(false, "none")
	end
	self.tOpenMove = { sReq = sReq, tIDs = tIDs, nTime = now(), oUI = oUI }
	mark("fetch_open_move_asked")
end

-- From SelectMode.Advance: the same per-frame place where the game opens
-- its Move screen for animals sent from storage (selectmode.lua 1.0.5).
StorageSend._OpenMoveTick = function(self)
	local t = self.tOpenMove
	if t == nil then
		return
	end
	self.tOpenMove = nil
	local function answer(bOk, sDetail)
		mark(bOk and "fetch_open_move_ok" or "fetch_open_move_failed")
		pcall(t.oUI.TriggerEventAtNextAdvance, t.oUI, "PZ2QoL_SendOpenMoveResult", t.sReq, bOk == true, sDetail or "")
	end
	if now() - t.nTime > self.nOpenMoveSeconds then
		return answer(false, "expired")
	end
	-- the game's own SetNewMode (not the wrap: these must not be taken again)
	local bOk, sErr = pcall(self.fnSetNewMode, "AnimalMovementMode", { tSelectedAnimals = t.tIDs })
	if not bOk then
		trace("open move failed: " .. tostring(sErr))
	end
	answer(bOk, bOk and "" or "failed")
end

StorageSend._PatchSelectMode = function(self, SelectMode)
	local fnAdvance = SelectMode.Advance
	if type(fnAdvance) ~= "function" then
		mark("fetch_select_patch_missing")
		return
	end
	SelectMode.Advance = function(oMode, ...)
		pcall(self._ArmTick, self)
		self.bInSelectAdvance = true
		local tRes = table.pack(xpcall(fnAdvance, traceback, oMode, ...))
		self.bInSelectAdvance = false
		if not tRes[1] then
			-- the game's own frames ride in the text, so its error report still shows where it failed
			error(tRes[2], 0)
		end
		if self.tOpenMove ~= nil then
			local bOk, sErr = pcall(self._OpenMoveTick, self)
			if not bOk then
				self.tOpenMove = nil
				trace("open move tick failed: " .. tostring(sErr))
			end
		end
		return table.unpack(tRes, 2, tRes.n)
	end
end

-- The game takes the animals sent from storage on the park's first select
-- frames; an arm still unused after nArmParkSeconds of them was never for
-- this arrival, and must not take a later Move of the player's.
StorageSend._ArmTick = function(self)
	local tArm = self.tArm
	if tArm == nil then
		return
	end
	local nNow = now()
	-- a gap in the frames is the world transition (or a hub trip): count afresh
	if tArm.nParkLast == nil or nNow - tArm.nParkLast > 2 then
		tArm.nParkSince = nNow
	end
	tArm.nParkLast = nNow
	if nNow - tArm.nParkSince > self.nArmParkSeconds then
		self.tArm = nil
		mark("send_arm_unused")
		log("arm_unused", { target = tArm.sTarget })
	end
end

-----------------------------------------------------------------------
-- Wiring
-----------------------------------------------------------------------
-- The hub page's arm, just before it presses the game's Send to Zoo.
StorageSend.Arm = function(self, nCount, sTarget)
	local n = tonumber(nCount)
	if n == nil or n <= 0 then
		return
	end
	local tArm = { nCount = n, nTime = now(), sTarget = sTarget == "trade" and "trade" or "habitat" }
	if tArm.sTarget == "trade" then
		-- the zoo the player clicked "Bring to the trade centre" in
		local Fetch = (self.Core and self.Core.StorageFetch) or global.package.loaded["pz2qol.storagefetch"]
		local tClick = Fetch and Fetch.tLastClick or nil
		if type(tClick) == "table" then
			tArm.sZoo, tArm.sZooMode = tClick.sZoo, tClick.sMode
		end
	else
		-- the zoo this hub's Send to Zoo goes to
		local Kin = kin()
		tArm.sZoo = Kin and Kin:WorldZooKey()
	end
	self.tArm = tArm
	mark("send_armed")
	log("armed", { n = n, target = tArm.sTarget, zoo = tArm.sZoo ~= nil })
end

StorageSend.Attach = function(self, oUI)
	if oUI == nil or self.tViews[oUI] then
		return
	end
	self.tViews[oUI] = true
	local bOk, sErr = Handover.Listen(oUI, self, trace, {
		{ "PZ2QoL_SendArm", 2, function(nCount, sTarget) self:Arm(nCount, sTarget) end },
		{ "PZ2QoL_SendDisarm", 0, function() self.tArm = nil end },
		{ "PZ2QoL_SendHello", 0, function() self:_Deliver(oUI) end },
		{ "PZ2QoL_SendAck", 1, function(nSeq)
			if self.tArrived ~= nil and tonumber(nSeq) == self.tArrived.nSeq then
				self.tArrived.bAcked = true
			end
		end },
		{ "PZ2QoL_SendFacts", 3, function(sReq, sId, sDepth) self:Facts(oUI, sReq, sId, sDepth) end },
		{ "PZ2QoL_SendMove", 4, function(sReq, sId, sHab, nSeq) self:Move(oUI, sReq, sId, sHab, nSeq) end },
		{ "PZ2QoL_SendOpenMove", 2, function(sReq, sIds) self:OpenMove(oUI, sReq, sIds) end },
	})
	if not bOk then
		trace("listeners failed: " .. tostring(sErr))
	end
	mark(bOk and "send_attached" or "send_attach_failed")
end

StorageSend.Init = function(self, Core)
	self.Core = Core
	-- found by Kin through Core (package.loaded keys proved unreliable)
	Core.StorageSend = self
	Core:AddModulePatch("Editors.Shared.BaseUIMode", function(t) self:_PatchBaseUIMode(t) end)
	Core:AddModulePatch("Editors.Select.SelectMode", function(t) self:_PatchSelectMode(t) end)
end
