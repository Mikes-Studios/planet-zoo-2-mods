-- Lua 5.3 check of PZ2QoL.Errors' server errors (run: lua5.3 tests/errors.lua from mods/PZ2QoL)
local nClock = 0
local tFranchise = { DatabaseError_Ok = 0, DatabaseError_NotAllowed = 6, RequestType_Count = 5 }
local tWorld = { GetWorldAPIs = function() return { franchise = tFranchise } end }
_G.api = {
	time = { GetPerformanceTimer = function() nClock = nClock + 1 return nClock end, PerformanceTimeToMilliseconds = function(n) return n * 1000 end },
	debug = { Trace = function() end },
	world = tWorld,
}
local tErrors = {}
_G.module = function() return tErrors end
dofile("Main/pz2qol.errors.lua")
local Errors = tErrors
local function check(sWhat, bOk)
	if not bOk then error(sWhat) end
	print("ok " .. sWhat)
end

local tHeard = {}
Errors:AddServerErrorListener(function(nError, sName, nRequest) tHeard[#tHeard + 1] = sName .. "|" .. nRequest end)
Errors:OnDatabaseErrorMessages({ { nError = 6, nRequestType = 28 } })
local tEntry = Errors.tEntries[#Errors.tEntries]
check("a server error is logged by its name, and its request", tEntry.sTitle == "Server error: NotAllowed" and string.find(tEntry.sDetail, "request #28", 1, true) ~= nil)
check("and told to the features that wait on the server", tHeard[1] == "NotAllowed|28")
Errors:OnDatabaseErrorMessages({ { nError = 0, nRequestType = 5 } })
check("an Ok answer is no error", #Errors.tEntries == 1)

tWorld.GetWorldAPIs = function() error("no world") end
Errors:OnDatabaseErrorMessages({ { nError = 0, nRequestType = 5 } })
local tLast = Errors.tEntries[#Errors.tEntries]
check("without the online API an error is unknown, not code 0", tLast.sTitle == "Server error: unknown" and not string.find(tLast.sDetail, "code", 1, true))
