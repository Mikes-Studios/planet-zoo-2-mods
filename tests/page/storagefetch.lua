-- Lua 5.3 check of PZ2QoL.StorageFetch's request (run: lua5.3 tests/storagefetch.lua from mods/PZ2QoL)
local nClock = 1000
_G.api = { time = { GetPerformanceTimer = function() return nClock * 1000 end, PerformanceTimeToMilliseconds = function(n) return n end } }
local function load(sFile)
	local tModule = {}
	_G.module = function() return tModule end
	dofile("Main/" .. sFile)
	return tModule
end
package.loaded["PZ2QoL.Handover"] = load("pz2qol.handover.lua")
package.loaded["PZ2QoL.ParkReads"] = load("pz2qol.parkreads.lua")
local Fetch = load("pz2qol.storagefetch.lua")
local function check(sWhat, bOk)
	if not bOk then error(sWhat) end
	print("ok " .. sWhat)
end

-- the zoo of the active world: the park's while in it, the one the hub sends to while in the hub
local sWorldZoo = "zooA"
local sGameMode = "franchise"
package.loaded["pz2qol.tradejump"] = {
	CleanSpecies = function(s) return s end,
	_OpenHub = function(_, _, _, fnBefore) fnBefore() return true, "" end,
}
package.loaded["pz2qol.kin"] = {
	_ParkWorld = function() return { park = {} } end,
	_TradeCentre = function() return { id = 1 } end,
	_GameMode = function() return sGameMode end,
	_ZooKey = function() return sWorldZoo end,
	WorldZooKey = function() return sWorldZoo end,
	ZoosDiffer = load("pz2qol.kin.lua").ZoosDiffer,
}
local tAnswer = nil
local oUI = { TriggerEventAtNextAdvance = function(_, sEvent, ...) tAnswer = { sEvent, ... } end }
local function handedOver()
	tAnswer = nil
	Fetch:Hello(oUI)
	return tAnswer ~= nil and tAnswer[1] == "PZ2QoL_FetchPending"
end

local sNamed = "m:1:50.50.50.50:zola"
local sPark = string.rep(",n:1:okapi:keeper", 1500)
Fetch:Start(oUI, "r1", "Okapi", sNamed .. sPark)
check("a long list keeps its named animals", tAnswer[3] == true and string.sub(Fetch.tPending.sExclude, 1, #sNamed) == sNamed)
check("a long list is capped", #Fetch.tPending.sExclude <= Fetch.nMaxExclude)
Fetch.tPending = nil
Fetch:Start(oUI, "r2", "Okapi", string.sub(sPark, 2) .. "," .. sNamed)
check("a cap through the named animals is refused", tAnswer[3] == false and tAnswer[4] == "toolong" and Fetch.tPending == nil)

Fetch:Start(oUI, "r3", "Okapi", "")
Fetch:Hello(oUI)
check("the click's own hello is fresh", tAnswer[1] == "PZ2QoL_FetchPending" and tAnswer[6] == true)
Fetch:Hello(oUI)
check("a second hello is not", tAnswer[6] == false)
Fetch:Start(oUI, "r4", "Okapi", "")
nClock = nClock + 300
Fetch:Hello(oUI)
check("a first hello long after the click is not fresh", tAnswer[1] == "PZ2QoL_FetchPending" and tAnswer[6] == false)
nClock = nClock + 301
tAnswer = nil
Fetch:Hello(oUI)
check("a request past its time is dropped", tAnswer == nil and Fetch.tPending == nil)

Fetch:Start(oUI, "r5", "Okapi", "")
sWorldZoo = "zooB"
tAnswer = nil
Fetch:Hello(oUI)
check("a request made in another zoo is dropped in this zoo's hub", tAnswer == nil and Fetch.tPending == nil)

sWorldZoo = "zooA"
Fetch:Start(oUI, "r6", "Okapi", "")
sWorldZoo = nil
check("a hub that does not name its zoo is handed the request", handedOver())

Fetch.tPending = nil
Fetch:Start(oUI, "r7", "Okapi", "")
check("a Franchise click in a zoo the game has not named yet is refused", tAnswer[1] == "PZ2QoL_FetchStartResult" and tAnswer[3] == false
	and tAnswer[4] == "nozoo" and Fetch.tPending == nil)
sGameMode = "offline"
Fetch:Start(oUI, "r8", "Okapi", "")
check("an offline click is sent as before", tAnswer[3] == true and Fetch.tPending ~= nil)
