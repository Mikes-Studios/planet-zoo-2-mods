-- Lua 5.3 check of PZ2QoL.PlayerStore's save requests (run: lua5.3 tests/playerstore.lua from mods/PZ2QoL)
local nClock = 1000
local nSaves = 0
_G.api = {
	time = { GetPerformanceTimer = function() return nClock * 1000 end, PerformanceTimeToMilliseconds = function(n) return n end },
	save = { RequestSaveMainPlayer = function() nSaves = nSaves + 1 end },
	debug = { Trace = function() end },
}
local tStore = {}
_G.module = function() return tStore end
dofile("Main/pz2qol.playerstore.lua")
local Store = tStore
local function check(sWhat, bOk)
	if not bOk then error(sWhat) end
	print("ok " .. sWhat)
end

local World = { AdvanceWhileRunning = function() end }
Store:Init({ AddModulePatch = function(_, _, fnPatch) fnPatch(World) end })
Store:_Changed(nClock)
World.AdvanceWhileRunning()
check("no save on the change itself", nSaves == 0)
nClock = nClock + 5
World.AdvanceWhileRunning()
check("the hub's world tick saves a change a few seconds later", nSaves == 1)
World.AdvanceWhileRunning()
check("and only once", nSaves == 1)
Store:_Changed(nClock)
pcall(Store.Forget, Store) -- what kin.lua's park start calls
check("a park start keeps the unsaved change", Store.nDirtyLast ~= nil)
