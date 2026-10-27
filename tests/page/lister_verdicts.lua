-- Lua 5.3 check of when PZ2QoL.Lister sends a run's verdicts (run: lua5.3 tests/lister_verdicts.lua from mods/PZ2QoL)
_G.api = {}
function module()
	_G.__lister = {}
	return _G.__lister
end
dofile("Main/pz2qol.lister.lua")
local Lister = _G.__lister
local function check(sWhat, bOk)
	if not bOk then error(sWhat) end
	print("ok " .. sWhat)
end
local tStates = {}
local oUI = {
	TriggerEventAtNextAdvance = function(_, sEvent, sJson)
		if sEvent == "PZ2QoL_ListerState" then tStates[#tStates + 1] = sJson end
	end,
}
local function newRun()
	return { nId = 1, sPhase = "done", nIndex = 2, tResults = { { guid = "7", status = "listed", verdict = "V1" } } }
end
local function lastHasVerdict()
	return tStates[#tStates]:find('"verdict":"V1"', 1, true) ~= nil
end

local tRun = newRun()
Lister:_Emit(tRun)
check("a state that reaches no page keeps its verdicts for the next one", tRun.tResults[1].bVerdictSent == nil)
Lister:_Emit(tRun, nil, oUI)
check("the next state that reaches the page carries them", #tStates == 1 and lastHasVerdict())
Lister:_Emit(tRun, nil, oUI)
check("and they go once", #tStates == 2 and not lastHasVerdict())

Lister.tRun = newRun()
Lister:Hello(oUI, nil)
check("a page's first hello gets every verdict", lastHasVerdict())
Lister:Hello(oUI, nil)
check("a second hello without a page id is the same page: nothing again", not lastHasVerdict())
Lister:Hello(oUI, "Ha1_1")
check("a page id that is new gets every verdict again", lastHasVerdict())
Lister:Hello(oUI, "Ha1_2")
check("the same page id asking again gets nothing again", not lastHasVerdict())
Lister:Hello(oUI, "Hb2_1")
check("a changed page id gets every verdict again", lastHasVerdict())
