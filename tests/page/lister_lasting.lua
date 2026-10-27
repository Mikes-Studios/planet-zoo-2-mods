-- Lua 5.3 check of which listing problems take the run's "If refused" quick action (run: lua5.3 tests/lister_lasting.lua from mods/PZ2QoL)
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
check("a Frontier zoo's animal never lists: its quick action may follow", Lister:_LastingProblem({ "SelectionCannotTrade", "NoBirthZoo" }))
check("an injury passes: the animal waits in storage", not Lister:_LastingProblem({ "Injured" }))
check("no reason the game named: the animal waits", not Lister:_LastingProblem({}))
