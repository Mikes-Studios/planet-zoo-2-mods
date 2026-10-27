-- Lua 5.3 check of PZ2QoL.Kin's park scan caches over stub game APIs (run: lua5.3 tests/kin_rules.lua from mods/PZ2QoL)
_G.api = {}
local tParkReads = {}
function module() return tParkReads end
dofile("Main/pz2qol.parkreads.lua")
package.loaded["PZ2QoL.ParkReads"] = tParkReads
function module()
	_G.__kin = {}
	return _G.__kin
end
dofile(arg[1] or "Main/pz2qol.kin.lua")
local Kin = _G.__kin

local function check(sWhat, vGot, vWant)
	if vGot ~= vWant then error(sWhat .. ": got " .. tostring(vGot) .. ", want " .. tostring(vWant)) end
	print("ok " .. sWhat)
end

-- one habitat animal, adult by its age group, through the scan's per-animal step
local function scanOne(animals, tStatic)
	local fnStatic, fnName = Kin._Static, Kin._HabitatName
	Kin._Static = function() return tStatic end
	Kin._HabitatName = function() end
	local tJob = { tHabOf = { [42] = 7 }, nJuvenile = 0, tAdults = {}, tBonded = {}, tAnimals = {}, tPresent = {}, tHabitatNames = {} }
	Kin:_AddParkAnimal(tJob, animals, 42, { nAgeGroup = 1, sName = "Calf" })
	Kin._Static, Kin._HabitatName = fnStatic, fnName
	return tJob.tAnimals[1].juv
end

-- the game's juvenile block: no answer first, then still held, then lifted
do
	local tAnswers = { "error", "held", "lifted" }
	local nCall = 0
	local animals = {
		GetRelocatePreventers = function()
			nCall = nCall + 1
			local sAnswer = tAnswers[nCall]
			if sAnswer == "error" then error("no answer") end
			return { bJuvenile = sAnswer == "held" }
		end,
	}
	local tStatic = { sGuid = "", tPar = {} }
	check("no answer: still a juvenile", scanOne(animals, tStatic), true)
	check("no answer is not remembered as grown", tStatic.bGrown, nil)
	check("block held: still a juvenile", scanOne(animals, tStatic), true)
	check("block lifted: grown", scanOne(animals, tStatic), false)
	check("lifted is remembered", tStatic.bGrown, true)
end

-- a park animal's parents: no answer first, then the real one
do
	local nCall = 0
	local animals = {
		EntityIDToAnimalGUID = function() return 5001 end,
		GetParents = function()
			nCall = nCall + 1
			if nCall == 1 then error("no answer") end
			return { 6001, 6002 }
		end,
	}
	Kin.tStatic = {}
	check("unanswered parents are empty for now", #Kin:_Static(animals, 42).tPar, 0)
	local tPar = Kin:_Static(animals, 42).tPar
	check("asked again: both parents", #tPar, 2)
	check("parents kept as guid text", tPar[1], "6001")
	Kin:_Static(animals, 42)
	check("a real answer is kept", nCall, 2)
end

-- a move while the game restricts animal moves: refused unless the game lets this animal through
do
	local bEnabled, bLetThrough, nMoves = false, false, 0
	_G.api.planetHub = {
		ScenarioMovementType_Habitat = 1,
		IsPlayerAnimalMovementEnabled = function() return bEnabled end,
		IsMovementForAnimalAllowed = function() return bLetThrough end,
	}
	local animals = {
		EntityIDToAnimalGUID = function() return 5001 end,
		GetAssignedHabitatEntityID = function() return 7 end,
		CanTransportToEntity = function() return true, 0 end,
		AttemptRequestToTransportAnimalToTarget = function() nMoves = nMoves + 1 return true end,
	}
	local fnWorld, fnHabitatOk = Kin._ParkWorld, Kin._HabitatOk
	Kin._ParkWorld = function() return { animals = animals } end
	Kin._HabitatOk = function() return true end
	local tAnswer = {}
	local oUI = { TriggerEventAtNextAdvance = function(_, _, _, bOk, sDetail) tAnswer = { bOk = bOk, sDetail = sDetail } end }
	Kin:Move(oUI, "r1", "42", "8")
	check("restricted: refused", tAnswer.bOk, false)
	check("restricted: says why", string.find(tAnswer.sDetail, "switched off", 1, true) ~= nil, true)
	check("restricted: nothing moved", nMoves, 0)
	bLetThrough = true
	Kin:Move(oUI, "r2", "42", "8")
	check("let through by the game: moved", nMoves, 1)
	bEnabled, bLetThrough = true, false
	Kin:Move(oUI, "r3", "42", "8")
	check("moves on: moved", nMoves, 2)
	Kin._ParkWorld, Kin._HabitatOk = fnWorld, fnHabitatOk
	_G.api.planetHub = nil
end

-- the trade centre label: a valid centre before an invalid one
do
	local tAPIs = { facilities = { GetTradeCentres = function(_) return { false, true } end } }
	check("the valid trade centre is named", Kin:_TradeCentre(tAPIs).id, "2")
	tAPIs.facilities.GetTradeCentres = function(_) return { [3] = false } end
	check("no valid one: the first", Kin:_TradeCentre(tAPIs).id, "3")
end

-- sell advice over the size limit: refused, logged once, the last list kept
do
	local tLogged = {}
	package.loaded["pz2qol.core"] = {
		Mark = function() end,
		Log = function(_, sArea, sEvent) tLogged[#tLogged + 1] = sArea .. " " .. sEvent end,
	}
	Kin:SetRelay("SellAdvice", "[1]")
	Kin:SetRelay("SellAdvice", string.rep("x", Kin.tRelays.SellAdvice.nMax + 1))
	Kin:SetRelay("SellAdvice", string.rep("x", Kin.tRelays.SellAdvice.nMax + 2))
	package.loaded["pz2qol.core"] = nil
	check("the last list that fit is kept", Kin.tRelays.SellAdvice.sValue, "[1]")
	check("the refusal is logged once", #tLogged, 1)
	check("the log names it", tLogged[1], "kin sell_advice_too_big")
end

-- store resets say why: a park start or end, or the store's answer within a park
do
	local tReasons = {}
	local oUI = { IsReady = function() return true end, TriggerEventAtNextAdvance = function(_, sEvent, sWhy)
		if sEvent == "PZ2QoL_StoreReset" then tReasons[#tReasons + 1] = tostring(sWhy) end
	end }
	local tClosed = {}
	local oClosed = { IsReady = function() return false end, TriggerEventAtNextAdvance = function(_, sEvent) tClosed[#tClosed + 1] = sEvent end }
	Kin.tViews[oUI] = true
	Kin.tViews[oClosed] = true
	Kin:_ParkStoreStart({ park = { GetParkName = function() return "Zoo" end } })
	Kin.nStoreFirstTick = -100
	Kin:_ResolveStore()
	Kin:_ParkStoreEnd()
	Kin.tViews[oUI] = nil
	Kin.tViews[oClosed] = nil
	check("resets in order", table.concat(tReasons, " "), "park data park")
	check("a view already shut down gets none", #tClosed, 0)
end

-- grandparents of an absent parent: a failed or empty lookup is asked again
do
	local tAnswers = { ["7001"] = { nil, {}, { "8001", "8002" } } }
	local tCalls = {}
	local function fnParents(g)
		tCalls[g] = (tCalls[g] or 0) + 1
		local tList = tAnswers[g]
		return tList and tList[tCalls[g]] or nil
	end
	local tAnimals = { { par = { "7001" } } }
	local tCache = {}
	check("no answer: the absent parent is left out", Kin:_Ancestors(tAnimals, {}, fnParents, tCache)["7001"], nil)
	check("empty answer: no grandparents yet", #Kin:_Ancestors(tAnimals, {}, fnParents, tCache)["7001"], 0)
	check("asked again: both grandparents", #Kin:_Ancestors(tAnimals, {}, fnParents, tCache)["7001"], 2)
	Kin:_Ancestors(tAnimals, {}, fnParents, tCache)
	check("a real answer is kept", tCalls["7001"], 3)
end

-- contraception for an exhibit animal: the game gets the UID the scan read, not its text
do
	local tSet = {}
	local exhibits = { SetExhibitAnimalUsingContraceptiveUsingUID = function(_, uid, bOn) tSet[#tSet + 1] = { uid = uid, bOn = bOn } end }
	local fnWorld, fnState = Kin._ParkWorld, Kin._SendState
	local sState
	Kin._ParkWorld = function() return { exhibits = exhibits } end
	Kin._SendState = function(_, _, s) sState = s end
	local raw = { "01a16560-71a8-7907-9cee-213d364d2394" }
	Kin.tStatic["x01a16560-71a8-7907-9cee-213d364d2394"] = { uid = raw }
	Kin:Contracept({}, "x01a16560-71a8-7907-9cee-213d364d2394", true)
	check("exhibit contraception: the game's own UID", tSet[1] and tSet[1].uid, raw)
	check("exhibit contraception: done", sState, "contracept")
	Kin.tStatic["x01a16560-71a8-7907-9cee-213d364d2394"] = nil
	Kin._ParkWorld, Kin._SendState = fnWorld, fnState
end

-- the gate on the start screen: no park, so the park's own state is never asked (it crashed natively there)
do
	local nAsked = 0
	local fnWorld = Kin._ParkWorld
	_G.api.planetHub = { IsPlayerAnimalMovementEnabled = function() nAsked = nAsked + 1 return true end }
	Kin._ParkWorld = function() return nil end
	local sOut
	Kin:AutoGate({ TriggerEventAtNextAdvance = function(_, _, _, s) sOut = s end }, "g1")
	check("start screen: movement never asked", nAsked, 0)
	check("start screen: the gate says no park", string.find(sOut or "", "\"park\":false", 1, true) ~= nil, true)
	Kin._ParkWorld = fnWorld
	_G.api.planetHub = nil
end

-- an aquarium of the wrong water: no move there (the Move screen only warns)
do
	local tAPIs = {
		animals = {
			GetSpeciesFromGUID = function(_, g) return g == "fresh" and "Fish_Fresh" or "Fish_Salt" end,
			IsSalinitySuitable = function(_, sSpecies, n) return (sSpecies == "Fish_Salt") == (n == 2) end,
		},
		habitat = { IsAquarium = function() return true end, IsAquariumGateBelowWaterLevel = function() return true end },
		park = { Salinity_Freshwater = 0, Salinity_Saltwater = 2, GetSalinity = function() return 2 end },
	}
	local bOk, sWhy = Kin:_HabitatOk(tAPIs, 5, { "fresh" })
	check("a freshwater fish never goes into saltwater", bOk, false)
	check("and says why", sWhy, "Wrong water for this species (saltwater).")
	check("a saltwater fish may", (Kin:_HabitatOk(tAPIs, 5, { "salt" })), true)
end

-- an exhibit UID is a GUID whose text can't give it back: the key keeps the game's value
do
	local guid = setmetatable({}, { __tostring = function() return "01a1-uid" end })
	local sKey = Kin:_ExhibitKey(guid)
	check("an exhibit key is x and the UID's text", sKey, "x01a1-uid")
	check("and leads back to the game's own UID", Kin.tExhibitUid[sKey], guid)
end

-- a send to the trade centre reads pregnancy and youth at that moment: a calf born there never grows up
do
	local fnWorld = Kin._ParkWorld
	local tPrev = { bPregnant = true }
	local nSent = 0
	local animals = {
		IsAlive = function() return true end,
		IsEscaped = function() return false end,
		CanSendAnimalToTradeCentre = function() return true end,
		GetRelocatePreventers = function() return tPrev end,
		AttemptToSendToTradeCentre = function() nSent = nSent + 1 return true end,
	}
	Kin._ParkWorld = function() return { animals = animals, park = {} } end
	local tAnswers = {}
	local oUI = { TriggerEventAtNextAdvance = function(_, _, _, bOk, sDetail) tAnswers[#tAnswers + 1] = { bOk, sDetail } end }
	Kin:Move(oUI, "r1", "7", "trade:3")
	check("a female pregnant this moment is not sent", nSent, 0)
	check("and the answer says why", tAnswers[1][2], "She is pregnant: she gives birth in her habitat first.")
	tPrev = { bJuvenile = true }
	Kin:Move(oUI, "r2", "7", "trade:3")
	check("nor a young one", nSent, 0)
	tPrev = {}
	Kin:Move(oUI, "r3", "7", "trade:3")
	check("an adult goes", nSent, 1)
	Kin._ParkWorld = fnWorld
end
