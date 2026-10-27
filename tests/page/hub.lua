-- Lua 5.3 check of how PZ2QoL.Hub attaches the features (run: lua5.3 tests/hub.lua from mods/PZ2QoL)
_G.api = { debug = { Trace = function() end }, ui2 = { LoadOverlay = function() error("no UI here") end } }
local tCalls = {}
local function feature(sName, bAttach)
	local tModule = { Init = function() end }
	if bAttach then
		tModule.Attach = function() tCalls[#tCalls + 1] = sName end
	end
	return tModule
end
local tModules = {}
for _, sName in ipairs({ "MarketPeek", "Lister", "Kin", "Autosave", "BoxRelease", "StorageSend", "TradeJump", "StorageFetch" }) do
	tModules["PZ2QoL." .. sName] = feature(sName, true)
end
for _, sName in ipairs({ "Errors", "PlayerStore", "Guards", "SaveTrace", "BoxTrace" }) do
	tModules["PZ2QoL." .. sName] = feature(sName, false)
end
local function load(sFile)
	local tModule = {}
	_G.module = function() return tModule end
	dofile("Main/" .. sFile)
	return tModule
end
local Core = load("pz2qol.core.lua")
local Hub = load("pz2qol.hub.lua")
tModules["PZ2QoL.Hub"] = Hub
_G.require = function(sName) return tModules[sName] end
Core:Boot()
local function check(sWhat, bOk)
	if not bOk then error(sWhat) end
	print("ok " .. sWhat)
end

local oView = { TriggerEventAtNextAdvance = function(_, sEvent) tCalls[#tCalls + 1] = sEvent end }
Hub.oFrontEndUI = oView
Hub:_OnModFrontEndReady(oView)
check("the hub view gets every feature, the greeting before Autosave", table.concat(tCalls, " ") ==
	"MarketPeek Lister Kin PZ2QoL_Hello PZ2QoL_LogState Autosave BoxRelease StorageSend TradeJump StorageFetch")
tCalls = {}
Hub:_OnModFrontEndReady({ TriggerEventAtNextAdvance = oView.TriggerEventAtNextAdvance })
check("the park view skips the hub-only ones", table.concat(tCalls, " ") ==
	"Kin PZ2QoL_Hello PZ2QoL_LogState Autosave BoxRelease StorageSend TradeJump StorageFetch")
