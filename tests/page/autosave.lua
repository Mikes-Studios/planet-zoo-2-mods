-- Lua 5.3 check of PZ2QoL.Autosave (run: lua5.3 tests/autosave.lua from mods/PZ2QoL)
local nClock = 1000
local bSaveTaken = false
local tSave = {
	ID_Zoo = 1, ID_ZooAutosave = 2,
	GetIdentForSaveID = function(nId) return nId == 1 and "zoo" or "zooauto" end,
	RequestAutosave = function() return true end,
	RequestSave = function() return bSaveTaken end,
	SetAutosave = function() end, SetNewAutosave = function() end, UnsetAutosave = function() end,
	ResetAutosaveTimer = function() end,
}
_G.api = {
	time = { GetPerformanceTimer = function() return nClock * 1000 end, PerformanceTimeToMilliseconds = function(n) return n end },
	player = { GetGameOwner = function() return "p" end },
	save = tSave,
}
local function load(sFile)
	local tModule = {}
	_G.module = function() return tModule end
	dofile("Main/" .. sFile)
	return tModule
end
package.loaded["PZ2QoL.Handover"] = load("pz2qol.handover.lua")
local Autosave = load("pz2qol.autosave.lua")
local tReports = {}
package.loaded["pz2qol.errors"] = { Report = function(_, _, _, sDetail) tReports[#tReports + 1] = sDetail end }
Autosave:Init({ Mark = function() end, AddModulePatch = function() end, Trace = function() end })
local function check(sWhat, bOk)
	if not bOk then error(sWhat) end
	print("ok " .. sWhat)
end
local function ticks(nSeconds)
	for _ = 1, nSeconds do
		nClock = nClock + 1
		Autosave:Tick()
	end
end

Autosave.nElapsed = 280
tSave.RequestSave("p", { type = "zoo" })
check("a manual save the game refused leaves the clock running", Autosave.nElapsed == 280 and Autosave.sLastKind == "")
bSaveTaken = true
tSave.RequestSave("p", { type = "zoo" })
check("a manual save the game took restarts it", Autosave.nElapsed == 0 and Autosave.sLastKind == "manual")

Autosave:Set(0)
tSave.SetNewAutosave()
ticks(40)
tSave.RequestAutosave = function() return false end
Autosave:SaveNow()
check("a failed report says what failed and where the next try is shown", tReports[#tReports]:find("The Autosave card shows when it tries again.", 1, true) ~= nil)
check("a failed Save now with the mod's autosave off tries only on Save now", Autosave:State().nextTry == "manual" and Autosave:State().retryIn == nil)
check("and the state says so in JSON", Autosave:StateJson():find('"retryIn":null,"nextTry":"manual"', 1, true) ~= nil)

Autosave:Set(2)
Autosave.nElapsed = 200
ticks(1)
check("the mod's own failed autosave tries again in a minute", Autosave:State().nextTry == "retry" and Autosave:State().retryIn == 60)
local nAsked = 0
tSave.RequestAutosave = function() nAsked = nAsked + 1 return true end
ticks(61)
check("and it does, a minute later", nAsked == 1)

ticks(91)
check("an unanswered request counts as failed", Autosave.nPendingSince == nil and Autosave.sLastError ~= "")
Autosave:_OnAutosaveComplete({})
check("its late answer is the mod's save, not the game's", Autosave.sLastKind == "mod" and Autosave.sLastError == "")

Autosave.sLastError = "Could not write (\xC3\xA5\xC3\xA4\xC3\xB6) \"x\"."
local sJson = Autosave:StateJson()
check("UTF-8 text passes into the state as it is", sJson:find('"lastError":"Could not write (\xC3\xA5\xC3\xA4\xC3\xB6) \\u0022x\\u0022."', 1, true) ~= nil)
check("the state carries when the mod tries next", sJson:find('"retryIn":120,"nextTry":"interval"', 1, true) ~= nil)

tSave.RequestAutosave = function() return false end
tSave.SetNewAutosave()
Autosave.nElapsed = 200
Autosave:SaveNow()
check("a failed Save now just after the game armed waits out the settle period", Autosave:State().nextTry == "waiting" and Autosave:State().retryIn == nil)
nAsked = 0
tSave.RequestAutosave = function() nAsked = nAsked + 1 return true end
ticks(30)
check("then the minute's retry counts down", Autosave:State().nextTry == "retry" and Autosave:State().retryIn == 30 and nAsked == 0)
ticks(31)
check("and it tries", nAsked == 1)

Autosave:_OnAutosaveComplete({})
tSave.SetNewAutosave()
Autosave:_OnAutosaveComplete({ exception = "disk full" })
check("a failure before the interval is up is tried at the next autosave, not in a minute", Autosave:State().nextTry == "interval" and Autosave:State().retryIn == 120)
Autosave.nElapsed = 200
check("a due save the game has not armed for is waiting, with no time", Autosave:State().nextTry == "waiting" and Autosave:State().retryIn == nil)

tSave.SetNewAutosave()
ticks(40)
Autosave.nElapsed = 90
tSave.RequestAutosave = function() return false end
Autosave:SaveNow()
check("the interval counts park time only, not the minute's retry", Autosave:State().nextTry == "interval" and Autosave:State().retryIn == 30)
nClock = nClock + 5
check("a park the mod has left keeps the interval in park time", Autosave:State().inPark == false and Autosave:State().retryIn == 30)
Autosave.nElapsed = 200
check("and a due save there is waiting", Autosave:State().nextTry == "waiting")

nAsked = 0
tSave.RequestAutosave = function() nAsked = nAsked + 1 return true end
Autosave.nRetryAt = 0
nClock = nClock + 300
ticks(29)
check("back from the hub with the slot still armed, a due save waits for the park to settle", nAsked == 0)
ticks(2)
check("and is asked for once it has", nAsked == 1)
