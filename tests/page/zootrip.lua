-- Lua 5.3 check of the zoo a storage hand-over goes to, park -> hub -> park (run: lua5.3 tests/zootrip.lua from mods/PZ2QoL)
local nClock = 1000
local tWorld = nil
_G.api = {
	time = { GetPerformanceTimer = function() return nClock * 1000 end, PerformanceTimeToMilliseconds = function(n) return n end },
	world = { GetWorldAPIs = function() return tWorld end },
}
local function load(sFile)
	local tModule = {}
	_G.module = function() return tModule end
	dofile("Main/" .. sFile)
	return tModule
end
package.loaded["PZ2QoL.Handover"] = load("pz2qol.handover.lua")
package.loaded["PZ2QoL.ParkReads"] = load("pz2qol.parkreads.lua")
local Kin = load("pz2qol.kin.lua")
package.loaded["pz2qol.kin"] = Kin
local Fetch = load("pz2qol.storagefetch.lua")
package.loaded["pz2qol.storagefetch"] = Fetch
local Send = load("pz2qol.storagesend.lua")
local function check(sWhat, bOk)
	if not bOk then error(sWhat) end
	print("ok " .. sWhat)
end

package.loaded["pz2qol.errors"] = { Report = function() end }
package.loaded["pz2qol.tradejump"] = {
	CleanSpecies = function(s) return s end,
	_OpenHub = function(_, _, _, fnBefore) fnBefore() return true, "" end,
}
Kin._ParkWorld = function() return tWorld end
Kin._TradeCentre = function() return { id = 1 } end
Kin.Core = { PlayerStore = { Available = function() return true end, Read = function() return "" end, Write = function() return true end } }
local tAnswer
local oUI = { TriggerEventAtNextAdvance = function(_, sEvent, ...) tAnswer = { sEvent, ... } end }

-- a Franchise world; sZooGuid nil: the game does not name its zoo
local function world(sZooGuid)
	return {
		park = {},
		franchise = {
			PlanetHubType_FranchiseOnline = 1,
			GetPlanetHubType = function() return 1 end,
			GetPlanetHubGuid = function() return "hub" end,
			GetCurrentZooGUID = function() return sZooGuid end,
		},
	}
end
local function park(sZooGuid)
	Kin:_ParkStoreEnd()
	tWorld = world(sZooGuid)
	Kin:_ParkStoreStart(tWorld)
	Kin.nStoreFirstTick = 0
	Kin:_ResolveStore()
end
-- the hub: sZooGuid nil when the game names no zoo there
local function hub(sZooGuid)
	Kin:_ParkStoreEnd()
	tWorld = world(sZooGuid)
end
local function handedOver()
	tAnswer = nil
	Fetch:Hello(oUI)
	return tAnswer ~= nil and tAnswer[1] == "PZ2QoL_FetchPending"
end

park("A")
Fetch:Start(oUI, "r1", "Okapi", "")
hub(nil)
check("a hub that names no zoo hands the click's request over", handedOver())
hub("A")
check("a hub named as the click's zoo hands it over", handedOver())
Send:Arm(1, "trade")
park("B")
check("an arrival in another zoo's park is refused", Send:_SameZoo(Send.tArm, "franchise") == false)
park("A")
hub(nil)
check("a retry from the click's park hands the kept request over", handedOver())
park("A")
check("and its arrival in the click's park is taken", Send:_SameZoo({ sZoo = "f_hub_A" }, "franchise") == true)

Fetch.tPending = nil
park("A")
Fetch:Start(oUI, "r2", "Okapi", "")
hub("B")
check("a hub named as another zoo drops the request", not handedOver() and Fetch.tPending == nil)

package.loaded["pz2qol.hub"] = { bHUDIsModded = true, oHUDUI = { IsReady = function() return true end, TriggerEventAtNextAdvance = function() end } }
local function arrivalTaken()
	Send.tArrived = nil
	return Send:_TryTake({ tSelectedAnimals = { 7 } }) and Send.tArrived ~= nil
end
for _, sTarget in ipairs({ "trade", "habitat" }) do
	Fetch.tPending = nil
	park("A")
	Fetch:Start(oUI, "r3", "Okapi", "")
	hub("A")
	Send:Arm(1, sTarget)
	park("B")
	check("a " .. sTarget .. " arrival in another zoo's park is not taken", not arrivalTaken())
	park("A")
	hub("A")
	Send:Arm(1, sTarget)
	park("A")
	check("a " .. sTarget .. " arrival in its own zoo's park is taken", arrivalTaken())
end

Fetch.tPending = nil
park(nil)
Fetch:Start(oUI, "r4", "Okapi", "")
check("a Franchise click before the game names its zoo is refused at once", tAnswer[3] == false and tAnswer[4] == "nozoo" and Fetch.tPending == nil)
