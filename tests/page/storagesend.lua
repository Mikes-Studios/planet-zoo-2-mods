-- Lua 5.3 check of PZ2QoL.StorageSend (run: lua5.3 tests/storagesend.lua from mods/PZ2QoL)
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
local Send = load("pz2qol.storagesend.lua")
local function check(sWhat, bOk)
	if not bOk then error(sWhat) end
	print("ok " .. sWhat)
end

local tAnimal = { bAnimating = false, nSent = 0 }
local animals = {
	IsAlive = function() return true end,
	IsEscaped = function() return false end,
	IsAnimalBoxed = function() return true end,
	IsBoxAnimating = function() return tAnimal.bAnimating end,
	IsAnimalInBoxAndBoxAnimating = function() return tAnimal.bAnimating end,
	IsBoxingClaimed = function() return false end,
	GetAnimalTransportData = function() return { bHasTransportJob = false } end,
	AttemptToSendToTradeCentre = function() tAnimal.nSent = tAnimal.nSent + 1 return true end,
}
local park = { GetTradeCentreMaxCapacity = function() return 10 end, GetNumberOfAnimalsInTradeCentre = function() return 2 end }
-- the zoo of the active world: the park's while in it, the one the hub sends to while in the hub
local sWorldZoo = nil
package.loaded["pz2qol.kin"] = {
	WorldZooKey = function() return sWorldZoo end,
	ZoosDiffer = load("pz2qol.kin.lua").ZoosDiffer,
	_ParkWorld = function() return { animals = animals, park = park } end,
	_TradeCentre = function() return { id = 5 } end,
}

tAnimal.bAnimating = true
local bMoved, sDetail = Send:_ArrivalToTrade("7")
check("an arrival mid box animation is not sent", bMoved == false and sDetail == "This animal is already being moved." and tAnimal.nSent == 0)
tAnimal.bAnimating = false
check("a boxed arrival at rest is sent", Send:_ArrivalToTrade("7") == true and tAnimal.nSent == 1)

-- the Move-screen hand-over: the game's SelectMode opens it for storage arrivals
local tOpened = {}
local BaseUIMode = { SetNewMode = function(sMode) tOpened[#tOpened + 1] = sMode end }
local SelectMode = {
	Advance = function(oMode)
		if oMode.tPending then
			BaseUIMode.SetNewMode("AnimalMovementMode", { tSelectedAnimals = oMode.tPending })
			oMode.tPending = nil
		end
	end,
}
Send:_PatchBaseUIMode(BaseUIMode)
Send:_PatchSelectMode(SelectMode)
package.loaded["pz2qol.hub"] = { bHUDIsModded = true, oHUDUI = { IsReady = function() return true end, TriggerEventAtNextAdvance = function() end } }
local Kin = package.loaded["pz2qol.kin"]
local oMode = {}
local function frames(nSeconds)
	for _ = 1, nSeconds do
		nClock = nClock + 1
		SelectMode.Advance(oMode)
	end
end

Send:Arm(1, "habitat")
BaseUIMode.SetNewMode("AnimalMovementMode", { tSelectedAnimals = { 7 } })
check("the player's own Move while armed opens the Move screen", tOpened[#tOpened] == "AnimalMovementMode" and Send.tArm ~= nil)
Send.sLastUIMode = "Select"
oMode.tPending = { 7 }
frames(1)
check("the arrivals' Move request is taken", #tOpened == 1 and Send.tArrived ~= nil and Send.tArm == nil)
check("a taken request leaves the last opened mode alone", Send.sLastUIMode == "Select")

Send:Arm(1, "habitat")
frames(17)
check("an arm unused through the first park frames goes", Send.tArm == nil)
oMode.tPending = { 8 }
frames(1)
check("so a later storage Move is the game's", tOpened[#tOpened] == "AnimalMovementMode" and #tOpened == 2)

Send:Arm(1, "habitat")
frames(10)
nClock = nClock + 30
frames(10)
check("a gap in the frames (the world transition) starts the count again", Send.tArm ~= nil)

sWorldZoo = "zooA"
Send:Arm(1, "habitat")
sWorldZoo = "zooB"
oMode.tPending = { 9 }
frames(1)
check("an arm from another zoo's hub takes nothing", #tOpened == 3)

-- one animal's facts: the status read skips the habitat survey
local nSurveys = 0
local tSent = nil
animals.GetSpecies = function() return "Okapi" end
animals.EntityIDToAnimalGUID = function() return "g7" end
animals.GetName = function() return "Bo" end
Kin.Encode = function(t) tSent = t return "{}" end
Kin._GameMode = function() return "offline" end
Kin.Array = function() return {} end
Kin._HabitatOk = function() return true end
local habitat = { GetAllCompleteHabitats = function() nSurveys = nSurveys + 1 return { 3 } end, GetAnimalsInHabitat = function() return {} end }
Kin._ParkWorld = function() return { animals = animals, park = park, habitat = habitat, staff = {} } end
local oFactsUI = { TriggerEventAtNextAdvance = function() end }
Send:Facts(oFactsUI, "q1", "7", "status")
check("a status read has no habitats and no survey", nSurveys == 0 and tSent.habitats == nil and tSent.lt ~= nil)
Send:Facts(oFactsUI, "q2", "7", "full")
check("a full read surveys the habitats", nSurveys == 1 and #tSent.habitats == 1)

-- the game's own select-frame error reaches the game with its own stack
local function gameAdvanceFails()
	error("select frame failed")
end
local FailingSelectMode = { Advance = function() gameAdvanceFails() end }
Send:_PatchSelectMode(FailingSelectMode)
local _, sTrace = xpcall(FailingSelectMode.Advance, debug.traceback, {})
check("a game error in the select frame keeps the game's frames in its traceback", sTrace:find("in upvalue 'gameAdvanceFails'", 1, true) ~= nil)
check("and the select-frame flag is cleared after it", Send.bInSelectAdvance == false)
local SelectModeWithResult = { Advance = function() return "a", nil, "c" end }
Send:_PatchSelectMode(SelectModeWithResult)
local tResults = table.pack(SelectModeWithResult.Advance({}))
check("and the game's results pass through", tResults.n == 3 and tResults[1] == "a" and tResults[3] == "c")
