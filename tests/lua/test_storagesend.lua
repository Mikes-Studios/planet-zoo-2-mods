-- Behaviour test for PZ2QoL.StorageSend ("Find a habitat") against a mock
-- of the game API. Run:
--   lua53 tests/lua/test_storagesend.lua <path-to-mods/PZ2QoL/Main/>
local sModDir = arg[1] or "mods/PZ2QoL/Main/"

local nFailed, nPassed = 0, 0
local function check(bCond, sName)
	if bCond then
		nPassed = nPassed + 1
	else
		nFailed = nFailed + 1
		print("FAIL: " .. sName)
	end
end

function module(sName, tBase)
	local t = tBase or {}
	package.loaded[string.lower(sName)] = t
	return t
end
local fnOriginalRequire = require
table.insert(package.searchers, 2, function(sName)
	local sPath = sModDir .. string.lower(sName) .. ".lua"
	local f = io.open(sPath, "r")
	if not f then return nil end
	f:close()
	return function(sModName) return assert(loadfile(sPath))(sModName) end, sPath
end)
require = function(sName)
	local sKey = string.lower(sName)
	if package.loaded[sKey] ~= nil then return package.loaded[sKey] end
	local tMod = fnOriginalRequire(sKey)
	return package.loaded[sKey] or tMod
end

-----------------------------------------------------------------------
-- Mock game
-----------------------------------------------------------------------
local nClock = 100
local sHubType = "offline"
local tCalls = {}
local function record(sName, ...) tCalls[#tCalls + 1] = { sName = sName, tArgs = table.pack(...) } end
local function count(sName)
	local n = 0
	for _, c in ipairs(tCalls) do if c.sName == sName then n = n + 1 end end
	return n
end

local franchise = {
	PlanetHubType_FranchiseOnline = 2,
	GetPlanetHubType = function() return sHubType == "franchise" and 2 or 1 end,
	IsDatabaseOperationInProgress = function() return false end,
}

-- animals 101 (lion cub, parents 1 and 2), 102 (tiger), 1/2 lion parents in habitat 500
local tSpecies = { [101] = "Lion", [102] = "Tiger", [1] = "Lion", [2] = "Lion", [3] = "Lion", [9] = "Zebra" }
local tHabOf = { [1] = 500, [2] = 500, [3] = 501, [9] = 502 }
local animals = {
	CurrentLocationType_Habitat = 1, CurrentLocationType_TradeCentre = 2, CurrentLocationType_FreeRoaming = 5,
	GetSpecies = function(_, e) return tSpecies[e] end,
	EntityIDToAnimalGUID = function(_, e) return tSpecies[e] and ("g" .. e) or 0 end,
	AnimalGUIDToEntityID = function(_, g) return tonumber(string.sub(g, 2)) or 0 end,
	GetName = function(_, e) return "Animal" .. e end,
	IsAlive = function() return true end,
	IsEscaped = function() return false end,
	IsBoxAnimating = function() return false end,
	IsBoxingClaimed = function() return false end,
	GetCurrentLocationType = function(_, e) return tHabOf[e] and 1 or 2 end,
	GetAnimalTransportData = function(_, e) return { bHasTransportJob = false } end,
	GetAssignedHabitatEntityID = function(_, e) return tHabOf[e] or 0 end,
	GetParents = function(_, g) if g == "g101" then return { "g1", "g2" } end return { "", "" } end,
	IsValidHabitatForAnimalsGUID = function(_, h, tGuids)
		local sp = tSpecies[tonumber(string.sub(tGuids[1], 2))]
		if sp == "Lion" then return h == 500 or h == 501 end
		if sp == "Tiger" then return h == 501 end
		return false
	end,
	CanTransportToEntity = function() return true, 3 end,
	DoesTransportRequireStaff = function() return true end,
	AttemptRequestToTransportAnimalToTarget = function(_, e, h, n) record("Transport", e, h, n) return true end,
}
local habitat = {
	GetAllCompleteHabitats = function() return { 500, 501, 502 } end,
	GetAnimalsInHabitat = function(_, h)
		local t = {}
		for e, hh in pairs(tHabOf) do if hh == h then t[#t + 1] = e end end
		table.sort(t)
		return t
	end,
	IsAquarium = function() return false end,
	IsHabitatTooCrowded = function() return false end,
}
local tWorld = {
	franchise = franchise, animals = animals, habitat = habitat,
	staff = { CanStaffDeliverAnimalToFacility = function() return true end },
	editors = { IsValidTutorialPlacement = function() return true end },
	park = {},
	facilities = { GetTradeCentres = function() return {} end },
}
api = {
	debug = { Trace = function() end },
	time = {
		GetPerformanceTimer = function() return nClock end,
		PerformanceTimeToMilliseconds = function(n) return n * 1000 end,
	},
	ui2 = { GetEntityName = function(e) return "Hab" .. tostring(e) end },
	world = { GetWorldAPIs = function() return tWorld end },
}

-- a view: records Lua -> JS events, fires JS -> Lua listeners
local oView = { tListeners = {}, tSent = {} }
function oView:AddEventListener(sName, nArgs, fn, arg) self.tListeners[sName] = function(...) return fn(arg, ...) end end
function oView:TriggerEventAtNextAdvance(sName, ...) self.tSent[#self.tSent + 1] = { sName = sName, tArgs = table.pack(...) } end
function oView:IsReady() return true end
local function fire(sName, ...) return assert(oView.tListeners[sName], "no listener " .. sName)(...) end
local function lastSent(sName)
	for i = #oView.tSent, 1, -1 do
		if oView.tSent[i].sName == sName then return oView.tSent[i] end
	end
end

package.loaded["pz2qol.hub"] = { bHUDIsModded = true, oHUDUI = oView }

local tPatches = {}
local Core = { AddModulePatch = function(_, sName, fn) tPatches[string.lower(sName)] = fn end, Mark = function() end }

local Kin = require("PZ2QoL.Kin")
local StorageSend = require("PZ2QoL.StorageSend")
StorageSend:Init(Core)
check(tPatches["editors.shared.baseuimode"] ~= nil, "patches BaseUIMode")

local tOriginal = {}
local BaseUIMode = { SetNewMode = function(sMode, tParams) tOriginal[#tOriginal + 1] = { sMode = sMode, tParams = tParams } end }
tPatches["editors.shared.baseuimode"](BaseUIMode)
-- the game opens the Move screen for animals from storage from
-- SelectMode.Advance; only such a request is taken
check(tPatches["editors.select.selectmode"] ~= nil, "patches SelectMode")
local SelectMode = { Advance = function(_, fn) if fn then fn() end end }
tPatches["editors.select.selectmode"](SelectMode)
local function fromStorage(tParams)
	SelectMode.Advance({}, function() BaseUIMode.SetNewMode("AnimalMovementMode", tParams) end)
end
StorageSend:Attach(oView)
for _, s in ipairs({ "PZ2QoL_SendArm", "PZ2QoL_SendDisarm", "PZ2QoL_SendHello", "PZ2QoL_SendAck", "PZ2QoL_SendFacts", "PZ2QoL_SendMove" }) do
	check(oView.tListeners[s] ~= nil, "listener " .. s)
end

-----------------------------------------------------------------------
-- 1. Taking the Move screen request
-----------------------------------------------------------------------
-- not armed: the game's Move screen opens
BaseUIMode.SetNewMode("AnimalMovementMode", { tSelectedAnimals = { 101, 102 } })
check(#tOriginal == 1, "unarmed: vanilla Move screen")

-- armed (offline zoo): taken, handed to the park page, not opened
fire("PZ2QoL_SendArm", 2)
fromStorage({ tSelectedAnimals = { 101, 102 } })
check(#tOriginal == 1, "armed: Move screen not opened")
local tArrived = lastSent("PZ2QoL_SendArrived")
check(tArrived ~= nil and tArrived.tArgs[2] == "101,102", "arrived ids sent to the page")
check(tArrived ~= nil and tArrived.tArgs[3] == "habitat", "the target passed on")
-- other modes pass through untouched
BaseUIMode.SetNewMode("Select")
check(#tOriginal == 2 and tOriginal[2].sMode == "Select", "other modes untouched")
-- the arm is used once
fromStorage({ tSelectedAnimals = { 101 } })
check(#tOriginal == 3, "arm used only once")
-- hello re-sends until acked
local nBefore = #oView.tSent
fire("PZ2QoL_SendHello")
check(#oView.tSent == nBefore + 1, "hello re-sends the arrival")
fire("PZ2QoL_SendAck", tArrived.tArgs[1])
fire("PZ2QoL_SendHello")
check(#oView.tSent == nBefore + 1, "no re-send after ack")

-- more animals than armed, exhibits, or a disarm: vanilla
fire("PZ2QoL_SendArm", 1)
fromStorage({ tSelectedAnimals = { 101, 102 } })
check(#tOriginal == 4, "count mismatch: vanilla")
fire("PZ2QoL_SendArm", 5)
fromStorage({ tSelectedAnimals = { "g1" }, bIsExhibit = true })
check(#tOriginal == 5, "exhibit animals: vanilla")
fire("PZ2QoL_SendArm", 5)
fire("PZ2QoL_SendDisarm")
fromStorage({ tSelectedAnimals = { 101 } })
check(#tOriginal == 6, "disarmed: vanilla")
-- an old arm expires
fire("PZ2QoL_SendArm", 5)
nClock = nClock + 601
fromStorage({ tSelectedAnimals = { 101 } })
check(#tOriginal == 7, "expired arm: vanilla")

-- the player's own Move request while armed (an info panel, a gate): the game's Move screen
fire("PZ2QoL_SendArm", 2)
BaseUIMode.SetNewMode("AnimalMovementMode", { tSelectedAnimals = { 101 } })
check(#tOriginal == 8, "not from storage: vanilla")
-- Franchise: the player's click is the go-ahead
sHubType = "franchise"
fire("PZ2QoL_SendArm", 2)
fromStorage({ tSelectedAnimals = { 101 } })
check(#tOriginal == 8, "franchise: taken")
sHubType = "offline"

-- no modded park page: vanilla
package.loaded["pz2qol.hub"].bHUDIsModded = false
fire("PZ2QoL_SendArm", 2)
fromStorage({ tSelectedAnimals = { 101 } })
check(#tOriginal == 9, "no mod page: vanilla")
package.loaded["pz2qol.hub"].bHUDIsModded = true

-----------------------------------------------------------------------
-- 2. Facts for one animal
-----------------------------------------------------------------------
Kin.oHeatMapManager = { tWorldAPIs = tWorld }
Kin.nLastTick = nClock
fire("PZ2QoL_SendFacts", "ss1", "101")
local tFacts = lastSent("PZ2QoL_SendFactsResult")
check(tFacts ~= nil and tFacts.tArgs[1] == "ss1", "facts answered")
local sJson = tFacts and tFacts.tArgs[2] or ""
check(string.find(sJson, '"species":"Lion"', 1, true) ~= nil, "facts: species")
check(string.find(sJson, '"parentHabs":["500"]', 1, true) ~= nil, "facts: parents' habitat (once) " .. sJson)
check(string.find(sJson, '"mode":"offline"', 1, true) ~= nil, "facts: mode")
local function habJson(sId)
	for sObj in string.gmatch(sJson, "{[^{}]*}") do
		if string.find(sObj, '"id":"' .. sId .. '"', 1, true) then return sObj end
	end
	return ""
end
check(string.find(habJson("500"), '"ok":true', 1, true) ~= nil, "facts: habitat 500 allowed")
check(string.find(habJson("500"), '"same":2', 1, true) ~= nil, "facts: same-species count")
check(string.find(habJson("502"), '"ok":false', 1, true) ~= nil, "facts: habitat 502 refused")
fire("PZ2QoL_SendFacts", "ss2", "999")
check(string.find(lastSent("PZ2QoL_SendFactsResult").tArgs[2], '"gone":true', 1, true) ~= nil, "facts: unknown animal is gone")
Kin.nLastTick = nil
fire("PZ2QoL_SendFacts", "ss3", "101")
check(string.find(lastSent("PZ2QoL_SendFactsResult").tArgs[2], '"error":"nopark"', 1, true) ~= nil, "facts: no park")
Kin.nLastTick = nClock

-----------------------------------------------------------------------
-- 3. One move (Kin's Move: the game's own sequence)
-----------------------------------------------------------------------
fire("PZ2QoL_SendMove", "ss4", "101", "500")
local tMove = lastSent("PZ2QoL_SendMoveResult")
check(tMove ~= nil and tMove.tArgs[1] == "ss4" and tMove.tArgs[2] == true, "move ok")
check(count("Transport") == 1, "exactly one transport request")
fire("PZ2QoL_SendMove", "ss5", "102", "500") -- tigers are not allowed in 500
tMove = lastSent("PZ2QoL_SendMoveResult")
check(tMove.tArgs[2] == false and tMove.tArgs[3] ~= "", "refused move answered with a reason")
check(count("Transport") == 1, "no transport for a refused move")
fire("PZ2QoL_SendMove", "ss6", "101", "trade:auto")
check(lastSent("PZ2QoL_SendMoveResult").tArgs[2] == false, "trade:auto with no trade centre is refused")

-----------------------------------------------------------------------
-- 4. "Bring to the trade centre" (PZ2QoL.StorageFetch + the trade target)
-----------------------------------------------------------------------
local nTcNow, nTcMax = 3, 12
local bTradeCentre = false
local sParkName = "Okapi Park"
local tBoxed = {}
tWorld.facilities.GetTradeCentres = function() if bTradeCentre then return { [77] = true } end return {} end
tWorld.facilities.ParkHasBuildingForAnimalStorage = function() return true end
tWorld.park.GetTradeCentreMaxCapacity = function() return nTcMax end
tWorld.park.GetNumberOfAnimalsInTradeCentre = function() return nTcNow end
tWorld.park.GetParkName = function() return sParkName end
franchise.GetCurrentZooGUID = function() return nil end
franchise.GetPlanetHubGuid = function() return "hub1" end
animals.IsAnimalBoxed = function(_, e) return tBoxed[e] == true end
animals.CanSendAnimalToTradeCentre = function(_, e) record("CanSend", e) return false end
animals.AttemptToSendToTradeCentre = function(_, e) record("SendToTC", e) return true end
api.game = { GetEnvironment = function() return { RequireInterface = function() return {
	SetInitialHubScreen = function(_, n, sub) record("SetInitialHubScreen", n, sub) end,
	SetAnimalMarketSpeciesFilter = function() end,
} end } end }
api.world.GetActive = function() return 1 end
api.world.GetScript = function() return { GetHUD = function() return { OnWorldTransition_OpenHUB = function() record("OpenHUB") end } end } end
package.loaded["ui.controllers.frontendui"] = { HUB_ANIMAL_MARKET = 2, ANIMAL_MARKET_SCREEN_MARKET = 0, ANIMAL_MARKET_SCREEN_STORAGE = 1 }

local TradeJump = require("PZ2QoL.TradeJump")
TradeJump:Init(Core)
local Fetch = require("PZ2QoL.StorageFetch")
Fetch:Init(Core)
check(Core.StorageFetch == Fetch, "fetch registers on Core")
Fetch:Attach(oView)
for _, s in ipairs({ "PZ2QoL_FetchStart", "PZ2QoL_FetchHello", "PZ2QoL_FetchAck" }) do
	check(oView.tListeners[s] ~= nil, "listener " .. s)
end
check(oView.tListeners["PZ2QoL_SendOpenMove"] ~= nil, "listener PZ2QoL_SendOpenMove")
check(tPatches["editors.select.selectmode"] ~= nil, "patches SelectMode")

-- 4a. the click: no trade centre, full, bad species, then ok
Kin.nLastTick = nClock
fire("PZ2QoL_FetchStart", "f1", "Okapi", "g:1,n:1:asha")
local tStart = lastSent("PZ2QoL_FetchStartResult")
check(tStart.tArgs[2] == false and tStart.tArgs[3] == "notradecentre", "start: no trade centre")
bTradeCentre = true
nTcNow = 12
fire("PZ2QoL_FetchStart", "f2", "Okapi", "")
tStart = lastSent("PZ2QoL_FetchStartResult")
check(tStart.tArgs[2] == false and tStart.tArgs[3] == "full", "start: full")
nTcNow = 3
fire("PZ2QoL_FetchStart", "f3", "x;y", "")
check(lastSent("PZ2QoL_FetchStartResult").tArgs[3] == "badspecies", "start: bad species")
check(count("OpenHUB") == 0, "no hub opened on refusals")
fire("PZ2QoL_FetchStart", "f4", "[Animal_Okapi]", "g:1,n:1:asha,<bad>")
tStart = lastSent("PZ2QoL_FetchStartResult")
check(tStart.tArgs[1] == "f4" and tStart.tArgs[2] == true and tStart.tArgs[4] == 9, "start: ok with room 9")
check(count("OpenHUB") == 1, "start: the hub opened once")
check(Fetch.tLastClick ~= nil and Fetch.tLastClick.sMode == "offline" and Fetch.tLastClick.sZoo ~= nil, "start: the zoo of the click kept")
-- the hub page: fresh once, then not
fire("PZ2QoL_FetchHello")
local tPend = lastSent("PZ2QoL_FetchPending")
check(tPend ~= nil and tPend.tArgs[2] == "Okapi" and tPend.tArgs[3] == 9 and tPend.tArgs[5] == true, "pending: fresh the first time")
check(tPend.tArgs[4] == "g:1,n:1:asha,bad", "pending: exclude list cleaned " .. tostring(tPend.tArgs[4]))
fire("PZ2QoL_FetchHello")
check(lastSent("PZ2QoL_FetchPending").tArgs[5] == false, "pending: not fresh after that")
local nPend = #oView.tSent
fire("PZ2QoL_FetchAck", tPend.tArgs[1])
fire("PZ2QoL_FetchHello")
check(#oView.tSent == nPend, "pending: gone after the ack")
-- "Bring all": the species "*" goes through as is, with a long exclude list
local tLong = {}
for i = 1, 600 do tLong[#tLong + 1] = "g:" .. (1000000 + i) end
fire("PZ2QoL_FetchStart", "fa", "*", table.concat(tLong, ","))
tStart = lastSent("PZ2QoL_FetchStartResult")
check(tStart.tArgs[1] == "fa" and tStart.tArgs[2] == true, "start all: ok")
fire("PZ2QoL_FetchHello")
tPend = lastSent("PZ2QoL_FetchPending")
check(tPend.tArgs[2] == "*", "pending all: the species is *")
check(#tPend.tArgs[4] > 4000 and #tPend.tArgs[4] <= Fetch.nMaxExclude and string.sub(tPend.tArgs[4], -1) ~= ",", "pending all: the long exclude list kept whole items " .. #tPend.tArgs[4])
fire("PZ2QoL_FetchAck", tPend.tArgs[1])
fire("PZ2QoL_FetchStart", "f5", "Okapi", "")
nClock = nClock + 601
Kin.nLastTick = nClock
fire("PZ2QoL_FetchHello")
check(Fetch.tPending == nil, "pending: expires after 10 minutes")

-- 4b. the trade arm: taken in the same zoo, with the target
fire("PZ2QoL_SendArm", 2, "trade")
fromStorage({ tSelectedAnimals = { 101, 102 } })
local nOrig = #tOriginal
tArrived = lastSent("PZ2QoL_SendArrived")
check(tArrived.tArgs[2] == "101,102" and tArrived.tArgs[3] == "trade", "trade arrival sent with its target")
fire("PZ2QoL_SendHello")
check(lastSent("PZ2QoL_SendArrived").tArgs[3] == "trade", "re-sent on hello with the target")
local nTradeSeq = tArrived.tArgs[1]
-- another park name: a different zoo, not taken
sParkName = "Other Park"
fire("PZ2QoL_SendArm", 2, "trade")
fromStorage({ tSelectedAnimals = { 101 } })
check(#tOriginal == nOrig + 1, "another zoo: the game's Move screen")
sParkName = "Okapi Park"
-- Franchise with no zoo GUID: not taken
sHubType = "franchise"
Fetch.tLastClick = { sZoo = nil, sMode = "franchise" }
fire("PZ2QoL_SendArm", 2, "trade")
fromStorage({ tSelectedAnimals = { 101 } })
check(#tOriginal == nOrig + 2, "franchise, zoo unknown: the game's Move screen")
sHubType = "offline"
-- the Find a habitat arm still says habitat
fire("PZ2QoL_SendArm", 1, "habitat")
fromStorage({ tSelectedAnimals = { 9 } })
check(lastSent("PZ2QoL_SendArrived").tArgs[3] == "habitat", "habitat arm keeps its target")
-- back to the trade arrivals for the moves below
Fetch.tLastClick = { sZoo = Kin:_ZooKey(tWorld, 1e9), sMode = "offline" }
fire("PZ2QoL_SendArm", 2, "trade")
fromStorage({ tSelectedAnimals = { 101, 102 } })
nTradeSeq = lastSent("PZ2QoL_SendArrived").tArgs[1]

-- 4c. facts carry the trade centre; one arrival per move, the Move screen's sequence
tBoxed[101] = true
fire("PZ2QoL_SendFacts", "sf1", "101")
sJson = lastSent("PZ2QoL_SendFactsResult").tArgs[2]
check(string.find(sJson, '"tc":"77"', 1, true) ~= nil and string.find(sJson, '"tcMax":12', 1, true) ~= nil and string.find(sJson, '"boxed":true', 1, true) ~= nil, "facts: trade centre fields " .. sJson)
fire("PZ2QoL_SendMove", "sm1", "101", "trade:arrival", nTradeSeq)
check(lastSent("PZ2QoL_SendMoveResult").tArgs[2] == true, "arrival sent to the trade centre")
check(count("SendToTC") == 1 and count("CanSend") == 0, "arrival: AttemptToSendToTradeCentre once, no CanSend check")
-- an old run's seq: the strict path (CanSend says no)
fire("PZ2QoL_SendMove", "sm2", "102", "trade:arrival", nTradeSeq - 1)
check(lastSent("PZ2QoL_SendMoveResult").tArgs[2] == false and count("CanSend") == 1, "old seq: strict path")
-- not an arrival: strict path
fire("PZ2QoL_SendMove", "sm3", "9", "trade:arrival", nTradeSeq)
check(count("SendToTC") == 1, "not an arrival: no loose send")
-- full: refused
nTcNow = 12
fire("PZ2QoL_SendMove", "sm4", "102", "trade:arrival", nTradeSeq)
local tFull = lastSent("PZ2QoL_SendMoveResult")
check(tFull.tArgs[2] == false and string.find(tFull.tArgs[3], "full", 1, true) ~= nil, "arrival: full trade centre refused")
nTcNow = 3

-- 4d. the game's Move screen for leftovers: on the next SelectMode tick, once
local SelectMode = { Advance = function() record("SelectAdvance") return "adv" end }
tPatches["editors.select.selectmode"](SelectMode)
local nOrigBefore = #tOriginal
fire("PZ2QoL_SendOpenMove", "om1", "102,999")
check(#tOriginal == nOrigBefore, "open move: not from the event itself")
check(SelectMode.Advance({}) == "adv", "SelectMode.Advance passes the result through")
check(#tOriginal == nOrigBefore + 1 and tOriginal[#tOriginal].sMode == "AnimalMovementMode", "open move: the game's Move screen on the tick")
local tIds = tOriginal[#tOriginal].tParams.tSelectedAnimals
check(#tIds == 1 and tIds[1] == 102, "open move: only this run's arrivals")
check(lastSent("PZ2QoL_SendOpenMoveResult").tArgs[2] == true, "open move answered")
SelectMode.Advance({})
check(#tOriginal == nOrigBefore + 1, "open move: once")
fire("PZ2QoL_SendOpenMove", "om2", "102")
nClock = nClock + 31
Kin.nLastTick = nClock
SelectMode.Advance({})
local tExp = lastSent("PZ2QoL_SendOpenMoveResult")
check(tExp.tArgs[1] == "om2" and tExp.tArgs[2] == false and tExp.tArgs[3] == "expired", "open move: expires")
fire("PZ2QoL_SendOpenMove", "om3", "999")
check(lastSent("PZ2QoL_SendOpenMoveResult").tArgs[3] == "none", "open move: nothing of this run")

-- salinity (Nexus report 2026-10-20: sharks placed in freshwater tanks).
-- The game's Move screen only warns; the mod's habitat check refuses.
do
	local tSalinityOf = { [600] = 0, [601] = 2 }
	local tWater = {
		animals = {
			IsValidHabitatForAnimalsGUID = function() return true end,
			GetSpeciesFromGUID = function(_, g) return g == "gShark" and "BlacktipReefShark" or "Axolotl" end,
			IsSalinitySuitable = function(_, sp, n) if sp == "BlacktipReefShark" then return n == 2 end return n == 0 end,
		},
		habitat = { IsAquarium = function(_, h) return h ~= 602 end, IsAquariumGateBelowWaterLevel = function() return true end },
		park = { Salinity_Freshwater = 0, Salinity_Brackish = 1, Salinity_Saltwater = 2, GetSalinity = function(_, h) return tSalinityOf[h] end },
	}
	local bOk, sReason = Kin:_HabitatOk(tWater, 600, { "gShark" })
	check(bOk == false and string.find(sReason or "", "freshwater") ~= nil, "salinity: shark refused in a freshwater tank")
	check(Kin:_HabitatOk(tWater, 601, { "gShark" }) == true, "salinity: shark allowed in a saltwater tank")
	check(Kin:_HabitatOk(tWater, 601, { "gAxo" }) == false, "salinity: freshwater species refused in saltwater")
	check(Kin:_HabitatOk(tWater, 602, { "gShark" }) == true, "salinity: not checked for land habitats")
	tWater.animals.IsSalinitySuitable = nil
	check(Kin:_HabitatOk(tWater, 600, { "gShark" }) == true, "salinity: no game call, no refusal (fail soft)")
end

print(string.format("%d passed, %d failed", nPassed, nFailed))
if nFailed > 0 then os.exit(1) end
