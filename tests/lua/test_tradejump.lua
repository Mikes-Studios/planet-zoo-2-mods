-- Behaviour test for PZ2QoL.TradeJump (trade shortcuts: park -> the hub's
-- Animal Storage / Market for one species) against a mock of the game API.
-- Run:
--   lua53 tests/lua/test_tradejump.lua <path-to-mods/PZ2QoL/Main/>
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
local sHubType = "franchise"
local bHasBuilding = true
local bHUDThrows = false
local tCalls = {}
local function record(sName, ...) tCalls[#tCalls + 1] = { sName = sName, tArgs = table.pack(...) } end
local function calls(sName)
	local t = {}
	for _, c in ipairs(tCalls) do if c.sName == sName then t[#t + 1] = c end end
	return t
end
local function reset() tCalls = {} end

local franchise = {
	PlanetHubType_FranchiseOnline = 2,
	GetPlanetHubType = function() return sHubType == "franchise" and 2 or 1 end,
}
local tWorld = {
	franchise = franchise,
	-- g5 is listed on the market: the counts leave it out
	animals = { GetMarketAnimalCompareMatesData = function(_, guid) return { bForSale = guid == "g5" } end },
	facilities = { ParkHasBuildingForAnimalStorage = function() return bHasBuilding end },
}
local oBWDM = {
	SetInitialHubScreen = function(_, n, sub) record("SetInitialHubScreen", n, sub) end,
	SetAnimalMarketSpeciesFilter = function(_, t) record("SetAnimalMarketSpeciesFilter", t) end,
}
local oHUD = {
	OnWorldTransition_OpenHUB = function() record("OpenHUB") end,
}
local tStorage = {
	Lion = { { "g1", "g2" }, { "g3", "g4", "g5" } },
	Leopard_African = { {}, { "g9" } },
}
local bCountsApi = true
local planetHub = {}
local function setCountsApi(b)
	planetHub.GetAdultsOfSpeciesInStorageSplitByGender = b and function(sp)
		record("Counts", sp)
		if sp == "Broken" then error("native refused") end
		return tStorage[sp] or { {}, {} }
	end or nil
end
setCountsApi(true)

package.loaded["ui.controllers.frontendui"] = { HUB_ANIMAL_MARKET = 2, ANIMAL_MARKET_SCREEN_MARKET = 0, ANIMAL_MARKET_SCREEN_STORAGE = 1 }

api = {
	debug = { Trace = function() end },
	time = {
		GetPerformanceTimer = function() return nClock end,
		PerformanceTimeToMilliseconds = function(n) return n * 1000 end,
	},
	ui2 = { GetEntityName = function(e) return "E" .. tostring(e) end },
	world = {
		GetWorldAPIs = function() return tWorld end,
		GetActive = function() return 1 end,
		GetScript = function()
			return { GetHUD = function() if bHUDThrows then error("no hud") end return oHUD end }
		end,
	},
	game = {
		GetEnvironment = function()
			return { RequireInterface = function(_, s) record("RequireInterface", s) return oBWDM end }
		end,
	},
	planetHub = planetHub,
}

local oView = { tListeners = {}, tSent = {} }
function oView:AddEventListener(sName, nArgs, fn, arg) self.tListeners[sName] = function(...) return fn(arg, ...) end end
function oView:TriggerEventAtNextAdvance(sName, ...) self.tSent[#self.tSent + 1] = { sName = sName, tArgs = table.pack(...) } end
local function fire(sName, ...) return assert(oView.tListeners[sName], "no listener " .. sName)(...) end
local function lastSent(sName)
	for i = #oView.tSent, 1, -1 do
		if oView.tSent[i].sName == sName then return oView.tSent[i] end
	end
end
local function sentCount(sName)
	local n = 0
	for _, s in ipairs(oView.tSent) do if s.sName == sName then n = n + 1 end end
	return n
end

local Core = { AddModulePatch = function() end, Mark = function() end }
local Kin = require("PZ2QoL.Kin")
Kin.oHeatMapManager = { tWorldAPIs = tWorld }
Kin.nLastTick = nClock
local TradeJump = require("PZ2QoL.TradeJump")
TradeJump:Init(Core)
check(Core.TradeJump == TradeJump, "registers on Core")
TradeJump:Attach(oView)
TradeJump:Attach(oView) -- twice: no second set of listeners
for _, s in ipairs({ "PZ2QoL_TradeOpen", "PZ2QoL_TradeCounts", "PZ2QoL_TradeHello", "PZ2QoL_TradeAck" }) do
	check(oView.tListeners[s] ~= nil, "listener " .. s)
end

-- species names
check(TradeJump.CleanSpecies("[Animal_Lion]") == "Lion", "clean [Animal_Lion]")
check(TradeJump.CleanSpecies("Animal_Leopard_African") == "Leopard_African", "clean Animal_ prefix")
check(TradeJump.CleanSpecies("Lion") == "Lion", "clean plain")
check(TradeJump.CleanSpecies("x;y") == nil, "refuses x;y")
check(TradeJump.CleanSpecies("") == nil, "refuses empty")

-----------------------------------------------------------------------
-- 1. Market for a species
-----------------------------------------------------------------------
reset()
fire("PZ2QoL_TradeOpen", "r1", "market", "Lion")
local t = calls("SetAnimalMarketSpeciesFilter")
check(#t == 1 and type(t[1].tArgs[1]) == "table" and t[1].tArgs[1][1] == "Lion" and #t[1].tArgs[1] == 1, "market: species filter {\"Lion\"}")
t = calls("SetInitialHubScreen")
check(#t == 1 and t[1].tArgs[1] == 2 and t[1].tArgs[2] == 0, "market: initial screen (2, 0)")
check(#calls("OpenHUB") == 1, "market: one transition")
check(calls("RequireInterface")[1].tArgs[1] == "Interfaces.IBackgroundWorldDataManager", "the BWDM interface")
local r = lastSent("PZ2QoL_TradeOpenResult")
check(r and r.tArgs[1] == "r1" and r.tArgs[2] == true, "market: ok")
check(TradeJump.tPending == nil, "market: no storage filter pending")

-----------------------------------------------------------------------
-- 2. Storage for a species (the bracketed row form)
-----------------------------------------------------------------------
reset()
fire("PZ2QoL_TradeOpen", "r2", "storage", "[Animal_Lion]")
check(#calls("SetAnimalMarketSpeciesFilter") == 0, "storage: no market filter")
t = calls("SetInitialHubScreen")
check(#t == 1 and t[1].tArgs[1] == 2 and t[1].tArgs[2] == 1, "storage: initial screen (2, 1)")
check(#calls("OpenHUB") == 1, "storage: one transition")
check(lastSent("PZ2QoL_TradeOpenResult").tArgs[2] == true, "storage: ok")
check(TradeJump.tPending and TradeJump.tPending.sSpecies == "Lion", "storage: Lion pending")
local nSeq = TradeJump.tPending.nSeq

-- the hub page says hello until it confirms
fire("PZ2QoL_TradeHello")
local f = lastSent("PZ2QoL_TradeFilter")
check(f and f.tArgs[1] == nSeq and f.tArgs[2] == "storage" and f.tArgs[3] == "Lion", "hello delivers the filter")
fire("PZ2QoL_TradeHello")
check(sentCount("PZ2QoL_TradeFilter") == 2, "again on the next hello")
fire("PZ2QoL_TradeAck", nSeq + 5)
check(TradeJump.tPending ~= nil, "a wrong ack keeps it")
fire("PZ2QoL_TradeAck", nSeq)
check(TradeJump.tPending == nil, "ack clears it")
fire("PZ2QoL_TradeHello")
check(sentCount("PZ2QoL_TradeFilter") == 2, "nothing after the ack")

-- too old: dropped
fire("PZ2QoL_TradeOpen", "r2b", "storage", "Lion")
nClock = nClock + 601
Kin.nLastTick = nClock
fire("PZ2QoL_TradeHello")
check(sentCount("PZ2QoL_TradeFilter") == 2 and TradeJump.tPending == nil, "nothing after 600 s")

-- no species: just the screen
reset()
fire("PZ2QoL_TradeOpen", "r2c", "storage", "")
check(#calls("OpenHUB") == 1 and TradeJump.tPending == nil, "storage without a species: no filter")

-----------------------------------------------------------------------
-- 3. Refusals
-----------------------------------------------------------------------
reset()
fire("PZ2QoL_TradeOpen", "r3", "market", "x;y")
r = lastSent("PZ2QoL_TradeOpenResult")
check(r.tArgs[2] == false and r.tArgs[3] == "badspecies", "bad species refused")
check(#calls("OpenHUB") == 0 and #calls("SetInitialHubScreen") == 0, "no transition for a bad species")

fire("PZ2QoL_TradeOpen", "r3b", "rewards", "Lion")
check(lastSent("PZ2QoL_TradeOpenResult").tArgs[3] == "badkind", "unknown screen refused")

bHasBuilding = false
fire("PZ2QoL_TradeOpen", "r4", "storage", "Lion")
r = lastSent("PZ2QoL_TradeOpenResult")
check(r.tArgs[2] == false and r.tArgs[3] == "nobuilding", "no trade centre: nobuilding")
check(#calls("OpenHUB") == 0 and TradeJump.tPending == nil, "no transition, nothing pending without a trade centre")
bHasBuilding = true

Kin.nLastTick = nil
fire("PZ2QoL_TradeOpen", "r5", "market", "Lion")
check(lastSent("PZ2QoL_TradeOpenResult").tArgs[3] == "nopark", "no running park: nopark")
Kin.nLastTick = nClock

reset()
bHUDThrows = true
fire("PZ2QoL_TradeOpen", "r6", "storage", "Lion")
r = lastSent("PZ2QoL_TradeOpenResult")
check(r.tArgs[2] == false and r.tArgs[3] == "nohud", "GetHUD throws: nohud")
t = calls("SetInitialHubScreen")
check(#t == 2 and t[2].tArgs[1] == nil, "initial screen reset to nil")
check(TradeJump.tPending and TradeJump.tPending.sSpecies == "Lion", "pending kept for the fallback")
check(#calls("OpenHUB") == 0, "no transition")
bHUDThrows = false
TradeJump.tPending = nil

-----------------------------------------------------------------------
-- 4. Counts
-----------------------------------------------------------------------
reset()
fire("PZ2QoL_TradeCounts", "c1", "Lion,[Animal_Leopard_African],Lion,x;y,Broken")
local c = lastSent("PZ2QoL_TradeCountsResult")
check(c and c.tArgs[1] == "c1", "counts answered")
local s = c.tArgs[2]
check(string.find(s, '"ok":true', 1, true) ~= nil, "counts ok")
check(string.find(s, '"mode":"franchise"', 1, true) ~= nil, "counts mode")
check(string.find(s, '"Lion":{', 1, true) ~= nil and (string.find(s, '"m":2', 1, true) ~= nil) and (string.find(s, '"f":2', 1, true) ~= nil), "Lion 2 m 2 f (the listed one left out): " .. s)
check(string.find(s, '"Leopard_African":{', 1, true) ~= nil, "Leopard counted")
check(string.find(s, '"Broken"', 1, true) == nil, "a failing species is left out")
check(#calls("Counts") == 3, "each species asked once (bad name skipped)")

setCountsApi(false)
fire("PZ2QoL_TradeCounts", "c2", "Lion")
s = lastSent("PZ2QoL_TradeCountsResult").tArgs[2]
check(string.find(s, '"ok":false', 1, true) ~= nil, "no API: ok=false")
setCountsApi(true)

Kin.nLastTick = nil
fire("PZ2QoL_TradeCounts", "c3", "Lion")
s = lastSent("PZ2QoL_TradeCountsResult").tArgs[2]
check(string.find(s, '"ok":false', 1, true) ~= nil and string.find(s, "nopark", 1, true) ~= nil, "no park: ok=false nopark")
Kin.nLastTick = nClock

local tMany = {}
for i = 1, 60 do tMany[#tMany + 1] = "Sp" .. i end
reset()
fire("PZ2QoL_TradeCounts", "c4", table.concat(tMany, ","))
check(#calls("Counts") == 40, "at most 40 species")

print(string.format("%d passed, %d failed", nPassed, nFailed))
if nFailed > 0 then os.exit(1) end
