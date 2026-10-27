-- Behaviour test for the PZ2QoL Lua side against a mock of the game API.
-- Run: lua53 tests/lua/test_pz2qol.lua <path-to-mods/PZ2QoL/Main/>
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

-----------------------------------------------------------------------
-- Mock engine environment
-----------------------------------------------------------------------
local tCalls = {}
local function record(sName, ...)
	tCalls[#tCalls + 1] = { sName = sName, tArgs = table.pack(...) }
end
local function calls(sName)
	local t = {}
	for _, c in ipairs(tCalls) do
		if c.sName == sName then t[#t + 1] = c end
	end
	return t
end

-- Frontier's module(): returns (and registers) the module table.
function module(sName, tBase)
	local t = tBase or {}
	package.loaded[string.lower(sName)] = t
	return t
end

-- Case-insensitive loader for the mod's files (game resource names are lower case).
local fnOriginalRequire = require
table.insert(package.searchers, 2, function(sName)
	local sPath = sModDir .. string.lower(sName) .. ".lua"
	local f = io.open(sPath, "r")
	if not f then return nil end
	f:close()
	-- the game passes the module name as the chunk's `...` (used by module(...))
	return function(sModName) return assert(loadfile(sPath))(sModName) end, sPath
end)
require = function(sName)
	local sKey = string.lower(sName)
	if package.loaded[sKey] ~= nil then return package.loaded[sKey] end
	local tMod = fnOriginalRequire(sKey)
	-- module() already registered under the lower-case key
	return package.loaded[sKey] or tMod
end
tryrequire = function(sName)
	local bOk, t = pcall(require, sName)
	return bOk and t or nil
end

local tOverlayLoaded = {}
local bOverlayReady = true
local tReceivers = {}
local nViews = 0
api = {
	debug = {
		Trace = function(s) record("Trace", s) end,
		Error = function(s) record("NativeError", s) end,
		Assert = function(b, s) record("NativeAssert", b, s) end,
	},
	time = {
		GetPerformanceTimer = function() return os.clock() end,
		PerformanceTimeToMilliseconds = function(n) return n * 1000 end,
	},
	messaging = {
		MsgType_DatabaseErrorMessage = 77,
		RegisterGlobalReceiver = function(nType, fn) tReceivers[nType] = fn end,
	},
	ui2 = {
		LoadOverlay = function(sName, sPath) record("LoadOverlay", sName, sPath); tOverlayLoaded[sName] = bOverlayReady end,
		IsOverlayLoaded = function(sName) return tOverlayLoaded[sName] == true end,
		MapResources = function(sName) record("MapResources", sName) end,
	},
	world = {
		GetWorldAPIs = function()
			return { franchise = {
				DatabaseError_Ok = 0, DatabaseError_NotEnoughCC = 8, DatabaseError_DidNotGetResponse = 2,
				RequestType_CloseZooDryRun = 1,
			} }
		end,
	},
}

-- Minimal stand-ins for the game modules the mod patches.
local ViewWrapper = module("UI2.ViewWrapper")
ViewWrapper.new = function(self)
	return setmetatable({}, { __index = self })
end
ViewWrapper.Init = function(self, t)
	nViews = nViews + 1
	self.view = "view" .. nViews
	self.sViewAddress = t.sViewAddress
	self.fnReady = t.fnOnReadyCallback
	self.bReady = false
	record("ViewInit", t.sViewName, t.sViewAddress)
end
ViewWrapper.IsReady = function(self) return self.bReady end
ViewWrapper.TriggerEventAtNextAdvance = function(self, sName, ...) record("Trigger", sName, ...); tCalls[#tCalls].oView = self end
-- JS -> Lua listeners; tests fire them with fireUI(view, name, args...)
ViewWrapper.AddEventListener = function(self, sName, nArgs, fn, arg)
	self.tListeners = self.tListeners or {}
	self.tListeners[sName] = function(...) return fn(arg, ...) end
end
local function fireUI(oView, sName, ...)
	local fn = oView.tListeners and oView.tListeners[sName]
	assert(fn, "no listener " .. sName)
	return fn(...)
end
ViewWrapper.Shutdown = function(self) record("ViewShutdown", self.sViewAddress); self.view = nil end
local function makeReady(oView)
	oView.bReady = true
	if oView.fnReady then oView.fnReady() end
end

local FrontEndUI = setmetatable({}, { __index = ViewWrapper })
FrontEndUI.new = function(self, fnReady)
	local o = setmetatable({}, { __index = FrontEndUI })
	o:Init({ sViewName = "FrontEnd", sViewAddress = "coui://UIGameface/Frontend.html", fnOnReadyCallback = fnReady })
	return o
end
module("UI.Controllers.FrontEndUI", FrontEndUI)
package.loaded["ui.controllers.frontendui"] = nil -- loaded lazily through require below
local tFrontEndUIModule = FrontEndUI

-----------------------------------------------------------------------
-- 1. Boot through the database entry point
-----------------------------------------------------------------------
-- Like Database.Main.InitContentToCall: tryrequire inside a coroutine (the
-- require itself cannot yield), then AddContentToCall, which may yield.
bOverlayReady = false
local nFrame = 0
local co = coroutine.create(function()
	local db = tryrequire("Database.PZ2QoLLuaDatabase")
	assert(db and db.AddContentToCall, "database module missing")
	db.AddContentToCall({})
end)
local bOk, sErr = coroutine.resume(co)
while bOk and coroutine.status(co) ~= "dead" and nFrame < 1000 do
	nFrame = nFrame + 1
	-- the overlay finishes loading after a few frames, then the probe page
	if nFrame == 3 then tOverlayLoaded["PZ2QoLUI"] = true end
	local Hub = package.loaded["pz2qol.hub"]
	if nFrame >= 6 and Hub and Hub.oProbe and not Hub.oProbe.bReady then makeReady(Hub.oProbe) end
	bOk, sErr = coroutine.resume(co)
end
check(bOk and coroutine.status(co) == "dead", "boot ran without error: " .. tostring(sErr))
check(nFrame < 20, "waited only until ready (" .. nFrame .. " frames)")
local Core = package.loaded["pz2qol.core"]
check(Core and Core.bBooted, "core booted")
check(#calls("LoadOverlay") == 1 and calls("LoadOverlay")[1].tArgs[2] == "PZ2QoL/UI/PZ2QoLUI", "overlay loaded from PZ2QoL/UI/PZ2QoLUI")
check(#calls("MapResources") == 1, "overlay mapped")
local Hub = package.loaded["pz2qol.hub"]
for _, c in ipairs(calls("Trace")) do
	if string.find(tostring(c.tArgs[1]), "fail", 1, true) then print("  trace: " .. tostring(c.tArgs[1])) end
end
check(Hub.bProbeOk, "probe reported ready")

-----------------------------------------------------------------------
-- 2. FrontEnd view is redirected once FrontEndUI is required
-----------------------------------------------------------------------
package.loaded["ui.controllers.frontendui"] = nil
local fnPrevRequire = require
-- simulate the game loading the module for the first time through the hooked require
package.preload = package.preload or {}
local tLoaded = tFrontEndUIModule
require = Core and require or fnPrevRequire
local tFE = (function()
	-- the mod's require hook wraps the global require; emulate a first load
	package.loaded["ui.controllers.frontendui"] = tLoaded
	return require("UI.Controllers.FrontEndUI")
end)()
check(rawget(tFE, "Init") ~= nil, "FrontEndUI.Init patched")
local oFE = tFE:new(function() record("GameReady") end)
check(oFE.sViewAddress == "coui://UIGameface/PZ2QoLFrontend.html", "FrontEnd redirected to mod page (got " .. tostring(oFE.sViewAddress) .. ")")
makeReady(oFE)
check(#calls("GameReady") == 1, "game's own ready callback still runs")
local tHello = calls("Trigger")
check(#tHello >= 1 and tHello[1].tArgs[1] == "PZ2QoL_Hello", "mod UI greeted")
check(Hub.oProbe == nil, "probe view shut down")

-----------------------------------------------------------------------
-- 3. Server errors reach the UI with names and hints
-----------------------------------------------------------------------
tCalls = {}
local fnReceiver = tReceivers[api.messaging.MsgType_DatabaseErrorMessage]
check(fnReceiver ~= nil, "database error receiver registered")
fnReceiver({ { nError = 8, nRequestType = 1 }, { nError = 0, nRequestType = 1 } })
local tErr = calls("Trigger")
check(#tErr == 1, "one error forwarded (Ok ignored), got " .. #tErr)
if tErr[1] then
	check(tErr[1].tArgs[1] == "PZ2QoL_Error" and tErr[1].tArgs[2] == "server", "server error event")
	check(string.find(tErr[1].tArgs[3], "NotEnoughCC", 1, true) ~= nil, "error named: " .. tostring(tErr[1].tArgs[3]))
	check(string.find(tErr[1].tArgs[4], "CloseZooDryRun", 1, true) ~= nil, "request named: " .. tostring(tErr[1].tArgs[4]))
end
fnReceiver({ { nError = 8, nRequestType = 1 } })
check(#calls("Trigger") == 1, "duplicate error suppressed within 5s")

-----------------------------------------------------------------------
-- 4. Script errors in coroutines are reported, results unchanged
-----------------------------------------------------------------------
tCalls = {}
local coBad = coroutine.create(function() error("boom in hub mode") end)
local bRes, sMsg = coroutine.resume(coBad)
check(bRes == false and string.find(sMsg, "boom", 1, true), "resume still returns the error")
local tLua = calls("Trigger")
check(#tLua == 1 and tLua[1].tArgs[2] == "lua", "lua error forwarded")
local coDead = coroutine.create(function() end)
coroutine.resume(coDead)
tCalls = {}
coroutine.resume(coDead)
check(#calls("Trigger") == 0, "dead-coroutine resume not reported")
local coYield = coroutine.create(function(a) local b = coroutine.yield(a + 1); return b * 2 end)
local _, v1 = coroutine.resume(coYield, 1)
local _, v2 = coroutine.resume(coYield, 5)
check(v1 == 2 and v2 == 10, "values pass through resume wrapper")

-----------------------------------------------------------------------
-- 5. api.debug hooks
-----------------------------------------------------------------------
tCalls = {}
api.debug.Error("native said no")
check(#calls("NativeError") == 1, "original Error still called")
check(#calls("Trigger") == 1, "Error forwarded to UI")
api.debug.Assert(false, "minor")
check(#calls("NativeAssert") == 1, "original Assert still called")
check(#calls("Trigger") == 1, "failed Assert logged, not shown")

-----------------------------------------------------------------------
-- 6. Without a working overlay the vanilla page is used
-----------------------------------------------------------------------
Hub.bProbeOk = false
local oFE2 = tFE:new(function() end)
check(oFE2.sViewAddress == "coui://UIGameface/Frontend.html", "vanilla FrontEnd when probe failed")
check(Hub:GetModUI() == nil, "no mod UI reported for vanilla page")

-----------------------------------------------------------------------
-- 7. In-park HUD view is redirected to the mod's HUD page too
-----------------------------------------------------------------------
Hub.bProbeOk = true
local HUDUI = setmetatable({}, { __index = ViewWrapper })
HUDUI.Init = function(self, t)
	ViewWrapper.Init(self, t)
	self.bHUDOwnInit = true
end
HUDUI.new = function(self, fnReady)
	local o = setmetatable({}, { __index = HUDUI })
	o:Init({ sViewName = "HUD", sViewAddress = "coui://UIGameface/HUD.html", fnOnReadyCallback = fnReady })
	return o
end
package.loaded["ui.controllers.hudui"] = HUDUI
local tHUD = require("UI.Controllers.HUDUI")
local oHUD = tHUD:new(function() record("HUDReady") end)
check(oHUD.sViewAddress == "coui://UIGameface/PZ2QoLHUD.html", "HUD redirected to mod page (got " .. tostring(oHUD.sViewAddress) .. ")")
check(oHUD.bHUDOwnInit, "HUD's own Init still runs")
tCalls = {}
makeReady(oHUD)
check(#calls("HUDReady") == 1, "game's HUD ready callback still runs")
check(Hub:GetModUI() == oHUD, "errors go to the HUD view when it is up")
-- the hub page (storage lister) still hears about them, silently
local oSavedFE, bSavedFE = Hub.oFrontEndUI, Hub.bFrontEndIsModded
Hub.oFrontEndUI, Hub.bFrontEndIsModded = oFE, true -- section 6 left a vanilla page
tCalls = {}
fnReceiver({ { nError = 99, nRequestType = 1 } })
local tTo = calls("Trigger")
check(#tTo == 2, "server error sent to both modded views, got " .. #tTo)
if #tTo == 2 then
	local tByView = {}
	for _, c in ipairs(tTo) do tByView[c.oView] = c.tArgs end
	check(tByView[oHUD] and tByView[oHUD][5] == false, "HUD shows it")
	check(tByView[oFE] and tByView[oFE][5] == true, "hub page gets a silent copy")
	check(tByView[oFE] and string.find(tByView[oFE][3], "code 99", 1, true) ~= nil, "unknown code kept as a number")
end
Hub.oFrontEndUI, Hub.bFrontEndIsModded = oSavedFE, bSavedFE
Hub.bProbeOk = false
local oHUD2 = tHUD:new(function() end)
check(oHUD2.sViewAddress == "coui://UIGameface/HUD.html", "vanilla HUD when probe failed")

-----------------------------------------------------------------------
-- 8. On exit the mod's overlay is unmapped and unloaded, before the game's
-----------------------------------------------------------------------
tCalls = {}
Hub.sOverlayState = "mapped"
api.ui2.UnmapResources = function(s) record("Unmap", s) end
api.ui2.AreResourcesUnmapped = function(s) return true end
api.ui2.UnloadOverlay = function(s) record("Unload", s) end
local GameScript = { OnPrepareToShutdown = function(self) record("GameShutdown") end }
package.loaded["game.gamescript"] = GameScript
Core:AddModulePatch("Game.GameScript", function(t) Hub:_PatchGameScript(t) end)
local coExit = coroutine.create(function() GameScript.OnPrepareToShutdown({}) end)
local bExitOk, sExitErr = coroutine.resume(coExit)
check(bExitOk, "shutdown ran: " .. tostring(sExitErr))
local seq = {}
for _, c in ipairs(tCalls) do
	if c.sName == "Unmap" or c.sName == "Unload" or c.sName == "GameShutdown" then seq[#seq + 1] = c.sName .. (c.tArgs[1] and (":" .. c.tArgs[1]) or "") end
end
check(table.concat(seq, ",") == "Unmap:PZ2QoLUI,Unload:PZ2QoLUI,GameShutdown", "overlay unmapped+unloaded before the game's shutdown: " .. table.concat(seq, ","))

-----------------------------------------------------------------------
-- 9. Background market check from Animal Storage (PZ2QoL.MarketPeek)
-----------------------------------------------------------------------
local nClock = 0
api.time.GetPerformanceTimer = function() return nClock end
api.time.PerformanceTimeToMilliseconds = function(n) return n * 1000 end
local bPending = false
local tSavedSettings = { sort = "price", species = { 7 } }
api.planetHub = {
	AnimalMarketDisplay_None = 0, AnimalMarketDisplay_Market = 1, AnimalMarketDisplay_TradeHistory = 2,
	MarketFilterType_Currency = 5,
	MarketUISetDisplayType = function(n) record("Display", n) end,
	MarketUIGetSortFilterSettings = function() return tSavedSettings end,
	MarketUISetSortFilterSettings = function(t) record("RestoreSettings", t) end,
	MarketUIResetFiltersToDefault = function() record("ResetFilters") end,
	MarketUIClearFilterText = function() record("ClearText") end,
	MarketUIClearSourceFilter = function() record("ClearSource") end,
	MarketUISetSpeciesFilter = function(t) record("Species", t) end,
	MarketUISetFilterValue = function(nType, nValue) record("FilterValue", nType, nValue) end,
	MarketUIApplyFilters = function() record("Apply") end,
	MarketUIRequestData = function() record("Request"); bPending = true end,
	MarketUIHasPendingDataRequests = function() return bPending end,
	MarketUISetPage = function(n) record("SetPage", n); bPending = true end,
}
local MarketPeek = package.loaded["pz2qol.marketpeek"]
check(MarketPeek ~= nil, "market check module booted")
local StorageMode = {
	TransitionIn = function(self) record("StorageIn") end,
	TransitionOut = function(self) record("StorageOut") end,
	Advance = function(self, dt) record("StorageAdvance") end,
}
package.loaded["startscreen.globe.animalstoragehubmode"] = StorageMode
require("StartScreen.Globe.AnimalStorageHubMode")
local oStorage = setmetatable({}, { __index = StorageMode })
-- a modded hub page that is ready gets the listeners
Hub.bProbeOk = true
Hub.sOverlayState = "mapped" -- section 8 unloaded it
local oPage = tFE:new(function() end)
makeReady(oPage)
check(oPage.tListeners and oPage.tListeners["PZ2QoL_MarketPeek"] ~= nil, "market check listener on the hub page")
local function peekStates()
	local t = {}
	for _, c in ipairs(calls("Trigger")) do
		if c.tArgs[1] == "PZ2QoL_MarketPeekState" then t[#t + 1] = c.tArgs[2] end
	end
	return table.concat(t, ",")
end
local function frames(n)
	for _ = 1, n do
		nClock = nClock + 0.016
		oStorage:Advance(0.016)
	end
end

-- not in storage: refused, nothing touched
tCalls = {}
fireUI(oPage, "PZ2QoL_MarketPeek", 42)
check(peekStates() == "failed" and #calls("Display") == 0, "refused outside Animal Storage: " .. peekStates())

-- in storage: one request for the species, CC only, then ready, then restored
oStorage:TransitionIn()
tCalls = {}
fireUI(oPage, "PZ2QoL_MarketPeek", 42)
check(#calls("Display") == 1 and calls("Display")[1].tArgs[1] == 1, "market display switched on")
check(#calls("Species") == 1 and calls("Species")[1].tArgs[1][1] == 42, "filtered to the species")
local tCur = calls("FilterValue")[1]
check(tCur and tCur.tArgs[1] == 5 and tCur.tArgs[2] == 0, "Conservation Credits only")
check(#calls("Request") == 1, "one data request")
check(peekStates() == "loading", "page told: loading (" .. peekStates() .. ")")
fireUI(oPage, "PZ2QoL_MarketPeek", 42)
check(#calls("Request") == 1 and peekStates() == "loading,busy", "second click while running refused")
frames(30)
check(not string.find(peekStates(), "ready", 1, true), "not ready while the request is pending")
bPending = false
frames(30)
check(peekStates() == "loading,busy,ready", "ready once answered: " .. peekStates())
check(#calls("StorageAdvance") == 60, "storage's own Advance still runs")

-- paging: one page at a time, only after the last one was read, capped
tCalls = {}
fireUI(oPage, "PZ2QoL_MarketPeekPage", 20)
check(#calls("SetPage") == 0 and peekStates() == "failed" and MarketPeek.tPeek ~= nil, "page past the cap refused: " .. peekStates())
tCalls = {}
fireUI(oPage, "PZ2QoL_MarketPeekPage", 1)
check(#calls("SetPage") == 1 and calls("SetPage")[1].tArgs[1] == 1 and #calls("Request") == 0, "page 1 via SetPage, no new request")
fireUI(oPage, "PZ2QoL_MarketPeekPage", 2)
check(#calls("SetPage") == 1 and peekStates() == "loading,busy", "next page refused while one loads: " .. peekStates())
frames(30)
check(not string.find(peekStates(), "ready", 1, true), "page not ready while pending")
bPending = false
frames(30)
check(peekStates() == "loading,busy,ready", "page ready once answered: " .. peekStates())
fireUI(oPage, "PZ2QoL_MarketPeekPage", 2)
bPending = false
frames(30)
check(#calls("SetPage") == 2 and calls("SetPage")[2].tArgs[1] == 2, "page 2 after page 1 was read")

tCalls = {}
fireUI(oPage, "PZ2QoL_MarketPeekRelease")
check(#calls("SetPage") == 1 and calls("SetPage")[1].tArgs[1] == 0, "market back on its first page")
check(#calls("RestoreSettings") == 1 and calls("RestoreSettings")[1].tArgs[1] == tSavedSettings, "market filters restored")
check(#calls("Display") == 1 and calls("Display")[1].tArgs[1] == 0, "market display back to None")
check(MarketPeek.tPeek == nil, "check finished")

-- cooldown between clicks
tCalls = {}
fireUI(oPage, "PZ2QoL_MarketPeek", 42)
check(peekStates() == "busy" and #calls("Request") == 0, "cooldown between checks")

-- leaving storage mid-check restores the market before storage's own TransitionOut
nClock = nClock + 10
tCalls = {}
fireUI(oPage, "PZ2QoL_MarketPeek", 43)
oStorage:TransitionOut()
local seqOut = {}
for _, c in ipairs(tCalls) do
	if c.sName == "Display" or c.sName == "StorageOut" then seqOut[#seqOut + 1] = c.sName .. (c.tArgs[1] ~= nil and (":" .. tostring(c.tArgs[1])) or "") end
end
check(table.concat(seqOut, ",") == "Display:1,Display:0,StorageOut", "restored before leaving storage: " .. table.concat(seqOut, ","))
check(MarketPeek.tPeek == nil and MarketPeek.oStorageMode == nil, "no check left after leaving storage")

-- no answer from the server: gives up and restores
oStorage:TransitionIn()
nClock = nClock + 10
bPending = false
api.planetHub.MarketUIRequestData = function() record("Request"); bPending = true end
tCalls = {}
fireUI(oPage, "PZ2QoL_MarketPeek", 44)
frames(1400) -- ~22 s
check(peekStates() == "loading,failed" and calls("Display")[2] and calls("Display")[2].tArgs[1] == 0, "timeout restores: " .. peekStates())


-----------------------------------------------------------------------
-- 10. Relatedness data for the page (PZ2QoL.Kin)
-----------------------------------------------------------------------
-- minimal JSON decoder, enough for the snapshot
local function jsonDecode(s)
	local i = 1
	local function ws() i = string.find(s, "[^ \t\r\n]", i) or #s + 1 end
	local value
	local function str()
		local out = {}
		i = i + 1
		while true do
			local c = string.sub(s, i, i)
			if c == '"' then i = i + 1; break end
			if c == "\\" then
				local e = string.sub(s, i + 1, i + 1)
				if e == "u" then
					local n = tonumber(string.sub(s, i + 2, i + 5), 16)
					out[#out + 1] = n < 128 and string.char(n) or utf8.char(n)
					i = i + 6
				else
					out[#out + 1] = ({ n = "\n", t = "\t", r = "\r", b = "\b", f = "\f" })[e] or e
					i = i + 2
				end
			else
				out[#out + 1] = c
				i = i + 1
			end
		end
		return table.concat(out)
	end
	value = function()
		ws()
		local c = string.sub(s, i, i)
		if c == "{" then
			local t = {}
			i = i + 1; ws()
			if string.sub(s, i, i) == "}" then i = i + 1; return t end
			while true do
				ws(); local k = str(); ws(); i = i + 1 -- ':'
				t[k] = value(); ws()
				local d = string.sub(s, i, i); i = i + 1
				if d == "}" then return t end
			end
		elseif c == "[" then
			local t = {}
			i = i + 1; ws()
			if string.sub(s, i, i) == "]" then i = i + 1; return t end
			while true do
				t[#t + 1] = value(); ws()
				local d = string.sub(s, i, i); i = i + 1
				if d == "]" then return t end
			end
		elseif c == '"' then return str()
		elseif string.sub(s, i, i + 3) == "true" then i = i + 4; return true
		elseif string.sub(s, i, i + 4) == "false" then i = i + 5; return false
		elseif string.sub(s, i, i + 3) == "null" then i = i + 4; return nil
		else
			local num = string.match(s, "^-?[%d%.eE+-]+", i)
			i = i + #num
			return tonumber(num)
		end
	end
	return value()
end

local Kin = package.loaded["pz2qol.kin"]
check(Kin ~= nil, "kin module booted")
check(oHUD.tListeners and oHUD.tListeners["PZ2QoL_KinScan"] ~= nil, "kin listeners on the park HUD page")

local function genes(c1, c2)
	local t = {}
	for i = 1, 6 do t[i] = c1 end
	for i = 7, 12 do t[i] = c2 end
	return t
end
local tParkAnimals = {
	[1] = { sName = "Ama", sSpecies = "Lion", nGender = 0, nAgeGroup = 1, bAlive = true, sLocation = "Savannah Habitat", bAlpha = true },
	[2] = { sName = "Kito", sSpecies = "Lion", nGender = 0, nAgeGroup = 1, bAlive = true, sLocation = "Savannah Habitat" },
	[3] = { sName = "Zo\195\171", sSpecies = "Lion", nGender = 1, nAgeGroup = 1, bAlive = true, sLocation = "Savannah Habitat", nLocateEntity = 333 },
	[4] = { sName = "Bo \"Big\"", sSpecies = "Lion", nGender = 1, nAgeGroup = 0, bAlive = true, sLocation = "Savannah Habitat", bIsUsingContraceptive = true, bIsInfertile = true },
	[5] = { sName = "Away", sSpecies = "Lion", nGender = 1, nAgeGroup = 1, bAlive = true, sLocation = nil },
	[6] = { sName = "Gone", sSpecies = "Lion", nGender = 1, nAgeGroup = 1, bAlive = false },
	-- bought, waiting at the trade centre: only in the trade-centre list
	[7] = { sName = "Newbie", sSpecies = "Lion", nGender = 1, nAgeGroup = 1, bAlive = true, sLocation = "Trade Centre", nLocationType = 5 },
}
local tGuids = { [1] = 1001, [2] = 1002, [3] = 1003, [4] = 1004, [5] = 1005, [6] = 1006, [7] = 1007 }
local tParentsOf = { [1001] = {}, [1002] = { 1001, 2000 }, [1003] = { 1001, 2000 }, [1004] = { "", 1001 }, [1005] = {}, [2000] = { 3000, 2001 }, [3000] = {} }
local nParentCalls = 0
local animalsAPI = {
	Juvenile = 0,
	CurrentLocationType_TradeCentre = 5,
	EntityIDToAnimalGUID = function(self, e) return tGuids[e] or 0 end,
	GetParents = function(self, g)
		nParentCalls = nParentCalls + 1
		if g == 2001 then error("not known") end
		return tParentsOf[g] or {}
	end,
	GetGenes = function(self, e) return { tFertility = genes("A", "B"), tImmunity = genes("C", "C"), tSize = genes("A", "D"), tLongevity = genes("B", "B") } end,
	GetMateData = function(self, e) if e == 2 then return { bIsBeta = false, tMateData = { { nID = 3, sName = "Zoe" } } } end return nil end,
	-- the game's move block: an adult by age group counts as young until it lifts
	GetRelocatePreventers = function(self, e) return { bJuvenile = false } end,
	GetUIAnimalListDataForIDs = function(self, tIDs)
		record("ListData", #tIDs)
		if #tIDs > 1 then
			for _, e in ipairs(tIDs) do
				if e == 99 then error("bad id") end
			end
		end
		local out = {}
		for _, e in ipairs(tIDs) do out[e] = tParkAnimals[e] end
		return out
	end,
	SetUsingContraceptive = function(self, e, b) record("Contracept", e, b) end,
	GetMarketAnimalGenes = function(self, id, nType) return { tFertility = genes("E", "F") } end,
}
local exhibitsAPI = {
	GetAllAnimalIDs = function(self) return { 77, 78 } end,
	GetUIAnimalListDataForIDs = function(self, tIDs)
		return { [77] = { sName = "Rex", sSpecies = "Gecko", nGender = 0, nAgeGroup = 1, bAlive = true, sLocation = "Reptile House" },
			[78] = { sName = "Rita", sSpecies = "Gecko", nGender = 1, nAgeGroup = 1, bAlive = true, sLocation = "Reptile House" } }
	end,
	GetAnimalFamilyMemberUID = function(self, uid, i) if uid == 78 and i == 0 then return 77 end return nil end,
	ExhibitAnimalUIDToEntityID = function(self, uid) return uid + 500 end,
	GetAnimalParentExhibit = function(self, e) return 900.0 end,
	GetMarketAnimalGenes = function(self, uid, n) return nil end,
	SetExhibitAnimalUsingContraceptiveUsingUID = function(self, uid, b) record("ExhibitContracept", uid, b) end,
}
local tParkAPIs = {
	animals = animalsAPI,
	exhibits = exhibitsAPI,
	habitat = {
		GetHabitats = function(self) return { 101, 102 } end,
		IsHabitat = function(self, h) return true end,
		GetHabitatIDFromEntityID = function(self, h) return h - 100 end,
		GetAnimalsInHabitat = function(self, h) if h == 101 then return { 1, 2, 3, 4, 6 } end return {} end,
	},
	animalsDataHelpers = {
		AnimalListType_Habitat = 1,
		AnimalListType_HabitatInTradeCenterWithEntities = 2,
		GetAllAnimalEntities = function(self, n)
			if n == 2 then return { 7 } end
			return { 1, 2, 3, 4, 5, 6, 99 }
		end,
	},
	CameraModeManager = { RequestMode = function(self, s, t) record("Camera", s, t.targetEntityID, t.bLocate) end },
	transform = { HasTransform = function(self, e) return e ~= 5 end },
	InfoPopUpComponent = {
		HasInfoPopUpComponent = function(self, e) return true end,
		CreateAndOpenInfoPopUpForEntity = function(self, e) record("InfoPopup", e) end,
	},
}
local fnSavedWorld = api.world.GetWorldAPIs
api.world.GetWorldAPIs = function() return tParkAPIs end

local function kinChunks(oView)
	local t = {}
	for _, c in ipairs(calls("Trigger")) do
		if c.tArgs[1] == "PZ2QoL_KinChunk" and (oView == nil or c.oView == oView) then t[#t + 1] = c.tArgs end
	end
	return t
end
local function kinStates()
	local t = {}
	for _, c in ipairs(calls("Trigger")) do
		if c.tArgs[1] == "PZ2QoL_KinState" then t[#t + 1] = c.tArgs[2] end
	end
	return table.concat(t, ",")
end
local function snapshotFrom(tChunks)
	local parts = {}
	for _, c in ipairs(tChunks) do parts[c[3]] = c[5] end
	local n = tChunks[1] and tChunks[1][4] or 0
	if n == 0 or #parts ~= n then return nil, "missing chunks" end
	return jsonDecode(table.concat(parts)), table.concat(parts)
end

-- No park running (the intro sequence, the start screen): nothing is touched.
-- In game, a scan there called exhibits:GetAllAnimalIDs in the wrong world
-- and crashed natively (2026-10-15).
tCalls = {}
fireUI(oHUD, "PZ2QoL_KinScan", "intro")
check(kinStates() == "nopark" and #calls("ListData") == 0, "no park running: no scan, no API calls (" .. kinStates() .. ")")
fireUI(oHUD, "PZ2QoL_KinContracept", "3", true)
check(#calls("Contracept") == 0, "no park running: no actions either")

-- frame hook (heat map manager's Advance): incremental, original still runs
local HeatMapManager = {
	Init = function(self) record("HMInit") end,
	Advance = function(self) record("HMAdvance") end,
	Shutdown = function(self) record("HMShutdown") end,
	ClaimViewModeRequest = function(self, n, s) record("HMClaim", n, s) end,
	SetCategory = function(self, s) record("HMCategory", s) end,
	ReleaseViewModeRequest = function(self) record("HMRelease") end,
	Hide = function(self) record("HMHide") end,
}
package.loaded["managers.heatmapmanager"] = HeatMapManager
require("Managers.HeatMapManager")
local oHM = setmetatable({ whiteWorldUIAPI = { VM_InbreedingRisk = 9 } }, { __index = HeatMapManager })
oHM.tWorldAPIs = tParkAPIs -- the manager's own world (HeatMapManager.Init sets it)
oHM:Init()
tCalls = {}
oHM:Advance()
check(#calls("HMAdvance") == 1, "heat map manager's own Advance still runs")

-- a scan in the running park: a few dozen animals per frame
local function scan(oView, sReason)
	fireUI(oView, "PZ2QoL_KinScan", sReason)
	local n = 0
	while Kin.tJob ~= nil and n < 200 do
		n = n + 1
		oHM:Advance()
	end
end
tCalls = {}
scan(oHUD, "test")
local tChunks = kinChunks(oHUD)
check(#tChunks >= 1, "snapshot sent (" .. #tChunks .. " chunks, states " .. kinStates() .. ")")
local tSnap, sJson = snapshotFrom(tChunks)
check(tSnap ~= nil and tSnap.scope == "park" and tSnap.v == 1, "snapshot decodes")
if tSnap then
	local byId = {}
	for _, a in ipairs(tSnap.animals) do byId[a.id] = a end
	check(byId["2"] and byId["2"].guid == "1002" and byId["2"].key == "animal_2", "ids, keys and guids as strings")
	check(byId["2"] and table.concat(byId["2"].par, ",") == "1001,2000", "parents from GetParents")
	check(byId["4"] and #byId["4"].par == 1 and byId["4"].par[1] == "1001", "unknown parent dropped")
	check(byId["4"] and byId["4"].juv == true and byId["4"].contra == true, "juvenile and contraception flags")
	check(byId["2"] and byId["2"].hab == "101" and byId["5"] and byId["5"].hab == "", "habitat membership; outside animals kept for lineage")
	check(byId["6"] == nil, "dead animals left out")
	check(byId["7"] and byId["7"].lt == "trade" and byId["7"].hab == "", "animals waiting at the trade centre are in the snapshot, marked trade")
	check(byId["2"] and byId["2"].mates and byId["2"].mates[1] == "3", "current mates")
	check(byId["2"] and byId["2"].genes and byId["2"].genes.F == "AAAAAABBBBBB", "alleles as strings")
	check(byId["3"] and byId["3"].name == "Zo\195\171", "non-ASCII names survive")
	check(byId["4"] and byId["4"].name == "Bo \"Big\"", "quotes escaped")
	check(not string.find(sJson, "[\128-\255]"), "payload is pure ASCII")
	check(byId["x78"] and byId["x78"].par[1] == "x77" and byId["x78"].hab == "xe:900" and byId["x78"].exhibit, "exhibit animals with their parents, grouped by exhibit (" .. tostring(byId["x78"] and byId["x78"].hab) .. ")")
	check(tSnap.anc["2000"] and table.concat(tSnap.anc["2000"], ",") == "2001,3000", "parents of absent ancestors")
	check(tSnap.anc["3000"] ~= nil, "two generations up")
	check(tSnap.anc["2000"] and tSnap.anc["2000"][1] == "2001" and tSnap.anc["2001"] == nil and nParentCalls > 0, "failing GetParents tolerated (2001 asked, left out)")
	local tHabNames = {}
	for _, h in ipairs(tSnap.habitats) do tHabNames[h.id] = h.name end
	check(tHabNames["101"] == "Savannah Habitat" and tHabNames["xe:900"] == "Reptile House", "habitat names from the animals' locations")
	-- every habitat, the empty one too, with the game's habitat id: entity ids
	-- change when the zoo loads, so the page matches saved assignments by these
	local tHabs = {}
	for _, h in ipairs(tSnap.habs or {}) do tHabs[h.id] = h end
	check(tHabs["101"] and tHabs["101"].hid == "1" and tHabs["102"] and tHabs["102"].hid == "2", "every habitat with its habitat id (" .. #(tSnap.habs or {}) .. ")")
end
-- unchanged: no resend
tCalls = {}
local nBefore = nParentCalls
scan(oHUD, "again")
check(#kinChunks(oHUD) == 0 and kinStates() == "same", "unchanged snapshot not resent: " .. kinStates())
check(nParentCalls - nBefore <= 3, "lineage cached between scans (" .. (nParentCalls - nBefore) .. " new GetParents calls)")

-- chunking
tCalls = {}
Kin.nChunkSize = 150
tParkAnimals[2].bIsUsingContraceptive = true
scan(oHUD, "chunks")
local tSmall = kinChunks(oHUD)
check(#tSmall > 3 and tSmall[1][4] == #tSmall, "split into " .. #tSmall .. " chunks")
local tSnap2 = snapshotFrom(tSmall)
check(tSnap2 and #tSnap2.animals == 8, "chunks reassemble")
Kin.nChunkSize = 12000

Kin.nPerFrame = 2
tParkAnimals[2].bIsUsingContraceptive = false
tCalls = {}
fireUI(oHUD, "PZ2QoL_KinScan", "ticked")
check(#kinChunks(oHUD) == 0 and Kin.tJob ~= nil, "scan waits for frames")
fireUI(oHUD, "PZ2QoL_KinScan", "double")
check(kinStates() == "busy", "second scan while one runs: busy")
local nFrames = 0
while Kin.tJob ~= nil and nFrames < 50 do
	nFrames = nFrames + 1
	oHM:Advance()
end
check(nFrames >= 3 and nFrames < 10, "spread over frames (" .. nFrames .. ")")
check(#kinChunks(oHUD) >= 1, "sent when done")
Kin.nPerFrame = 40

do
-- pair bonds: the game's monogamy check for each bonded adult against the
-- other adults of its species in its habitat (docs/PLAN-pair-bonds.md)
check(tSnap and tSnap.bondsOk == false, "no GetMatingMonogamyIcon: bondsOk false")
local fnMateData = animalsAPI.GetMateData
animalsAPI.GetMateData = function(self, e)
	if e == 1 then return { bIsBeta = false, bIsMonogamous = true, tMateData = {} } end
	if e == 2 then return { bIsBeta = false, bIsMonogamous = true, tMateData = { { nID = 3, sName = "Zoe" } } } end
	if e == 3 then return { bIsBeta = false, bIsMonogamous = true, tMateData = { { nID = 2, sName = "Kito" } } } end
	return nil
end
animalsAPI.GetMatingMonogamyIcon = function(self, e, nOther, nType)
	record("MonoIcon", e, nOther, nType)
	if (e == 2 and nOther == 3) or (e == 3 and nOther == 2) then return "ring" end
	if e == 2 or e == 3 then return "IconLock" end
	return ""
end
animalsAPI.GetCurrentMournTimeForUI = function(self, e) return "", 0 end
animalsAPI.GetAssignedHabitatEntityID = function(self, e) if e == 1 or e == 2 or e == 3 then return 101 end return nil end
animalsAPI.IsInDeathState = function(self, e) return false end
local function bondScan(sReason)
	tCalls = {}
	scan(oHUD, sReason)
	local t = snapshotFrom(kinChunks(oHUD))
	local by = {}
	for _, a in ipairs(t and t.animals or {}) do by[a.id] = a end
	return t, by
end
local tB, byB = bondScan("bonds")
check(tB and tB.bondsOk == true, "bond pass answered: bondsOk")
check(byB["2"] and byB["2"].bond and byB["2"].bond.mate == "3" and byB["2"].bond.ring == true, "bonded mate and the game's ring")
check(byB["2"] and byB["2"].bond and byB["2"].bond.here == true, "mate assigned to the same habitat and alive: here")
check(byB["3"] and byB["3"].bond and #byB["3"].bond.lock == 1 and byB["3"].bond.lock[1] == "1", "locked against the other male, not its mate (" .. tostring(byB["3"] and byB["3"].bond and #byB["3"].bond.lock) .. ")")
check(byB["2"] and byB["2"].bond and #byB["2"].bond.lock == 0, "the juvenile and the mate are not checked")
check(byB["1"] and byB["1"].bond == nil and byB["4"] and byB["4"].bond == nil, "no mate or juvenile: no bond")
check(byB["2"] and byB["2"].mates and byB["2"].mates[1] == "3", "mates unchanged")
local bTypes, bSelf = true, true
for _, c in ipairs(calls("MonoIcon")) do
	if c.tArgs[3] ~= 0 then bTypes = false end
	if c.tArgs[1] ~= 2 and c.tArgs[1] ~= 3 then bSelf = false end
end
check(#calls("MonoIcon") == 3 and bTypes and bSelf, "only bonded adults asked (2 ring checks, Zoe vs Ama), with entity id type 0 (" .. #calls("MonoIcon") .. " calls)")
-- spread over frames
Kin.nBondPerFrame = 1
local tB2, byB2 = bondScan("bonds slow")
check(Kin.tJob == nil, "budgeted bond pass finishes")
Kin.nBondPerFrame = 200
-- a failing check: no bond data at all (nothing held, nothing looks broken)
animalsAPI.GetMatingMonogamyIcon = function() error("gone") end
local tF, byF = bondScan("bonds fail")
check(tF and tF.bondsOk == false and byF["2"] and byF["2"].bond == nil, "every check failed: bondsOk false, bonds dropped")
-- an error inside the pass itself costs only the bond data, never the scan
animalsAPI.GetMatingMonogamyIcon = function() return "" end
bondScan("bonds again") -- a different snapshot first (an unchanged one is not resent)
local fnSaved = Kin._BondStep
Kin._BondStep = function() error("boom") end
local tE, byE = bondScan("bonds error")
check(tE and tE.bondsOk == false and #tE.animals > 0, "bond pass error: scan still sent, bondsOk false")
Kin._BondStep = fnSaved
animalsAPI.GetMatingMonogamyIcon = nil
animalsAPI.GetCurrentMournTimeForUI = nil
animalsAPI.GetAssignedHabitatEntityID = nil
animalsAPI.IsInDeathState = nil
animalsAPI.GetMateData = fnMateData
bondScan("bonds off")
end

-- actions
tCalls = {}
fireUI(oHUD, "PZ2QoL_KinContracept", "3", true)
fireUI(oHUD, "PZ2QoL_KinContracept", "x78", false)
check(#calls("Contracept") == 1 and calls("Contracept")[1].tArgs[1] == 3 and calls("Contracept")[1].tArgs[2] == true, "contraception through the game's own setter")
check(#calls("ExhibitContracept") == 1 and calls("ExhibitContracept")[1].tArgs[1] == 78, "exhibit animals too")
check(kinStates() == "contracept,contracept", "page told: " .. kinStates())
-- an exhibit UID that is a GUID (Franchise, 3.2.0 player log): the game gets back the value it gave
check(Kin.tStatic["x78"] and Kin.tStatic["x78"].uid == 78, "the scan keeps each exhibit animal's UID")
-- a table stands in for a native GUID value
Kin.tStatic["x01a1583f-37da-76dd-b9aa-ea664ebd5888"] = { sGuid = "x01a1583f-37da-76dd-b9aa-ea664ebd5888", tPar = {}, uid = { guid = "01a1583f-37da-76dd-b9aa-ea664ebd5888" } }
tCalls = {}
fireUI(oHUD, "PZ2QoL_KinContracept", "x01a1583f-37da-76dd-b9aa-ea664ebd5888", true)
check(#calls("ExhibitContracept") == 1 and rawequal(calls("ExhibitContracept")[1].tArgs[1], Kin.tStatic["x01a1583f-37da-76dd-b9aa-ea664ebd5888"].uid) and kinStates() == "contracept", "a GUID exhibit UID: contraception set, " .. kinStates())
tCalls = {}
fireUI(oHUD, "PZ2QoL_KinContracept", "x01a1583f-0000", true)
check(#calls("ExhibitContracept") == 0 and kinStates() == "failed", "an exhibit id the scan never saw: refused, nothing sent")
tCalls = {}
fireUI(oHUD, "PZ2QoL_KinLocate", "3")
check(#calls("Camera") == 1 and calls("Camera")[1].tArgs[2] == 333 and #calls("InfoPopup") == 1, "locate: camera to the animal's locate entity, info panel opened")
tCalls = {}
fireUI(oHUD, "PZ2QoL_KinLocate", "5")
check(#calls("Camera") == 0 and kinStates() == "failed", "locate refused for an animal that is not in the world: " .. kinStates())
tCalls = {}
fireUI(oHUD, "PZ2QoL_KinLocate", "x78")
check(#calls("Camera") == 0 and kinStates() == "failed", "exhibit animals are not located")
check(Kin.IdString(77.0) == "77" and Kin.IdString(77) == "77" and Kin.IdString("a") == "a", "ids printed the same for floats and integers")
-- "Show in park" for a habitat or an exhibit (FocusCameraOnEntity, copied)
do
	local habitatAPI = tParkAPIs.habitat
	local fnSavedPop, fnSavedHas = tParkAPIs.InfoPopUpComponent.HasInfoPopUpComponent, tParkAPIs.transform.HasTransform
	local fnSavedName = api.ui2.GetEntityName
	-- 4001 (a fence post of the habitat) -> parent 4000 (the habitat's info entity)
	tParkAPIs.transform.GetParent = function(self, e) if e == 4001 then return 4000 end if e == 900 then return 901 end return nil end
	tParkAPIs.transform.HasTransform = function(self, e) return e ~= nil and e ~= 5 and e ~= 666 end
	tParkAPIs.InfoPopUpComponent.HasInfoPopUpComponent = function(self, e) return e == 4000 or e == 901 or e == 333 or e == 4100 end
	habitatAPI.GetUIHabitatListData = function(self) return { [101] = { sName = "Savannah Habitat", nLocateEntity = 4001 }, [555] = { sName = "Old Name", nLocateEntity = 4100 } } end
	api.ui2.GetEntityName = function(e) if e == 102 then return "Old Name" end return "" end
	local function placeStates()
		local t = {}
		for _, c in ipairs(calls("Trigger")) do
			if c.tArgs[1] == "PZ2QoL_KinState" then t[#t + 1] = c.tArgs[2] .. ":" .. tostring(c.tArgs[3]) end
		end
		return table.concat(t, ",")
	end
	check(oHUD.tListeners["PZ2QoL_KinLocatePlace"] ~= nil, "show in park: listener registered")
	tCalls = {}
	fireUI(oHUD, "PZ2QoL_KinLocatePlace", "101", "3")
	check(#calls("Camera") == 1 and calls("Camera")[1].tArgs[2] == 4000 and calls("Camera")[1].tArgs[3] == true and #calls("InfoPopup") == 1 and calls("InfoPopup")[1].tArgs[1] == 4000,
		"habitat: the Habitats list's locate entity, walked up to its info panel (" .. placeStates() .. ")")
	check(placeStates() == "located_place:101", "habitat: page told " .. placeStates())
	tCalls = {}
	fireUI(oHUD, "PZ2QoL_KinLocatePlace", "102", "")
	check(#calls("Camera") == 1 and calls("Camera")[1].tArgs[2] == 4100, "habitat not keyed in the list: found by its name")
	tCalls = {}
	fireUI(oHUD, "PZ2QoL_KinLocatePlace", "xe:900", "x78")
	check(#calls("Camera") == 1 and calls("Camera")[1].tArgs[2] == 901 and placeStates() == "located_place:xe:900", "exhibit: its entity, walked up to the info panel (" .. placeStates() .. ")")
	tCalls = {}
	fireUI(oHUD, "PZ2QoL_KinLocatePlace", "xh:Reptile House", "x78")
	check(#calls("Camera") == 1 and calls("Camera")[1].tArgs[2] == 901, "exhibit by name: through its animal's parent exhibit")
	-- a habitat the list does not know, with no camera target of its own: one of its animals
	habitatAPI.GetUIHabitatListData = function(self) return {} end
	tCalls = {}
	fireUI(oHUD, "PZ2QoL_KinLocatePlace", "666", "3")
	check(#calls("Camera") == 1 and calls("Camera")[1].tArgs[2] == 333, "habitat fallback: a resident's locate entity (" .. placeStates() .. ")")
	tCalls = {}
	fireUI(oHUD, "PZ2QoL_KinLocatePlace", "666", "5")
	check(#calls("Camera") == 0 and string.sub(placeStates(), 1, 7) == "failed:", "nothing found: refused, no camera move (" .. placeStates() .. ")")
	tCalls = {}
	fireUI(oHUD, "PZ2QoL_KinLocatePlace", "", "")
	check(#calls("Camera") == 0 and string.sub(placeStates(), 1, 7) == "failed:", "no place: refused")
	habitatAPI.GetUIHabitatListData = nil
	tParkAPIs.transform.GetParent = nil
	tParkAPIs.transform.HasTransform = fnSavedHas
	tParkAPIs.InfoPopUpComponent.HasInfoPopUpComponent = fnSavedPop
	api.ui2.GetEntityName = fnSavedName
end
-- ages to 0.1 year: a growing float must not make every scan look new ("same" fires)
do
	check(Kin.RoundAge(3.14159) == 3.1 and Kin.RoundAge(2.96) == 3.0 and Kin.RoundAge(nil) == nil and Kin.RoundAge(0 / 0) == nil, "age rounding")
	tParkAnimals[1].nAge = 3.14159
	tCalls = {}
	scan(oHUD, "age 1")
	local t1 = snapshotFrom(kinChunks(oHUD))
	local nAge
	for _, a in ipairs(t1 and t1.animals or {}) do if a.id == "1" then nAge = a.age end end
	check(nAge == 3.1, "snapshot age rounded (" .. tostring(nAge) .. ")")
	tParkAnimals[1].nAge = 3.14231
	tCalls = {}
	scan(oHUD, "age 2")
	check(#kinChunks(oHUD) == 0 and string.find(kinStates(), "same", 1, true) ~= nil, "a slightly older animal: nothing resent, 'same' (" .. kinStates() .. ")")
	tParkAnimals[1].nAge = 3.3
	tCalls = {}
	scan(oHUD, "age 3")
	check(#kinChunks(oHUD) > 0, "a visible change (0.1 year) is sent")
	tParkAnimals[1].nAge = nil
	tCalls = {}
	scan(oHUD, "age reset")
end
-- boxed (the Animals list's bBoxed) passes through; omitted when false
do
	tParkAnimals[5].bBoxed = true
	tCalls = {}
	scan(oHUD, "boxed")
	local t = snapshotFrom(kinChunks(oHUD))
	local by = {}
	for _, a in ipairs(t and t.animals or {}) do by[a.id] = a end
	check(by["5"] and by["5"].boxed == true, "boxed animal flagged (" .. tostring(by["5"] and by["5"].boxed) .. ")")
	check(by["1"] and by["1"].boxed == nil, "not boxed: no field")
	tParkAnimals[5].bBoxed = nil
	tCalls = {}
	scan(oHUD, "boxed reset")
end
tCalls = {}
fireUI(oHUD, "PZ2QoL_KinHeatmap", true)
check(#calls("HMClaim") == 1 and calls("HMClaim")[1].tArgs[1] == 9 and #calls("HMCategory") == 1, "breeding heat map on")
fireUI(oHUD, "PZ2QoL_KinHeatmap", false)
check(#calls("HMRelease") == 1 and #calls("HMHide") == 1, "and off")

-- hub: Animal Storage lineage through the storage mode's background world
check(oPage.tListeners and oPage.tListeners["PZ2QoL_KinStorage"] ~= nil, "kin listeners on the hub page")
oStorage.backgroundWorldDataManager = { GetWorldAPIs = function() return { animals = animalsAPI } end }
oStorage:TransitionOut()
oStorage:TransitionIn()
api.planetHub.StorageGetIDAndAIDType = function(s)
	if s == "s9" then return 77, 1 end -- a listing, not a stored animal
	return ({ s1 = 1002, s2 = 1003 })[s], 2
end
tCalls = {}
fireUI(oPage, "PZ2QoL_KinStorage", "s1,s2,s9")
local tStore = snapshotFrom(kinChunks(oPage))
check(tStore and tStore.scope == "storage" and #tStore.animals == 2, "storage lineage for stored animals only")
check(tStore and tStore.animals[1].id == "s1" and tStore.animals[1].par[2] == "2000", "keyed by storage row id")
check(tStore and tStore.animals[1].genes and tStore.animals[1].genes.F == "EEEEEEFFFFFF", "storage genes via GetMarketAnimalGenes")
oStorage:TransitionOut()
tCalls = {}
fireUI(oPage, "PZ2QoL_KinStorage", "s1")
check(kinStates() == "nostorage", "outside storage: " .. kinStates())

-- exit to the main menu: the start screen comes up while the park's last tick
-- is still fresh and its manager is never shut down; a scan in that second
-- crashed natively in game (Y: 2026-10-18 21:05:57, dump 6d5c0b58)
oHM:Advance()
Kin:SetStartScreen(true)
tCalls = {}
fireUI(oHUD, "PZ2QoL_KinScan", "menu")
check(kinStates() == "nopark" and #calls("ListData") == 0 and Kin.tJob == nil, "start screen up, park tick fresh: no scan (" .. kinStates() .. ")")
Kin:SetStartScreen(false)
oHM:Advance()
tCalls = {}
scan(oHUD, "back")
check((#kinChunks(oHUD) >= 1 or kinStates() == "same") and #calls("ListData") > 0, "start screen gone, park ticking: scans again (" .. kinStates() .. ")")

-- leaving the park: the cache is cleared and nothing is scanned any more
oHM:Shutdown()
check(next(Kin.tStatic) == nil and Kin.oHeatMapManager == nil, "park shutdown clears the cache")
tCalls = {}
fireUI(oHUD, "PZ2QoL_KinScan", "hub")
check(kinStates() == "nopark" and #calls("ListData") == 0, "after the park: " .. kinStates())
api.world.GetWorldAPIs = fnSavedWorld

-----------------------------------------------------------------------
-- 11. Species board: snapshot extras, destinations, one move at a time
-----------------------------------------------------------------------
local tMoveCalls = {}
local function moveCalls(sName)
	local n = 0
	for _, c in ipairs(tMoveCalls) do if c == sName then n = n + 1 end end
	return n
end
local tJobs = { [2] = false }
animalsAPI.CurrentLocationType_Habitat = 1
animalsAPI.CurrentLocationType_TradeCentre = 2
animalsAPI.CurrentLocationType_BeingCarried = 3
tParkAnimals[5].nLocationType = 2 -- "Away" waits at the trade centre
animalsAPI.GetAnimalTransportData = function(self, e) return { bHasTransportJob = tJobs[e] == true } end
animalsAPI.GetAgeQuarterForUI = function(self, e) return e == 2 and 3 or 2 end
animalsAPI.GetSpeciesFertilityBounds = function(self, sp) return 3, 15 end
animalsAPI.GetSpeciesLongevity = function(self, sp) return 16, 20 end
animalsAPI.IsSpeciesABoid = function(self, sp) return false end
-- the geckos stand in for a colony species (butterflies, bees...)
exhibitsAPI.IsColonySpecies = function(self, sp) return sp == "Gecko", false, false end
animalsAPI.GetSpecies = function(self, e) return tParkAnimals[e] and tParkAnimals[e].sSpecies end
animalsAPI.IsAlive = function(self, e) return e ~= 6 end
animalsAPI.IsEscaped = function(self, e) return false end
animalsAPI.IsBoxAnimating = function(self, e) return false end
animalsAPI.IsBoxingClaimed = function(self, e) return false end
animalsAPI.GetAssignedHabitatEntityID = function(self, e) return (e >= 1 and e <= 4) and 101 or nil end
animalsAPI.IsValidHabitatForAnimalsGUID = function(self, h, tGuids)
	table.insert(tMoveCalls, "IsValid")
	return h ~= 103 -- 103: wrong type for lions
end
animalsAPI.CanTransportToEntity = function(self, bExhibit, h) return h ~= 104, 7 end
animalsAPI.DoesTransportRequireStaff = function(self, e, h) return false end
animalsAPI.ClaimBoxing = function(self, e) table.insert(tMoveCalls, "Claim") end
animalsAPI.ReleaseBoxing = function(self, e) table.insert(tMoveCalls, "Release") end
local bRefuseTransport = false
animalsAPI.AttemptRequestToTransportAnimalToTarget = function(self, e, h, nType)
	table.insert(tMoveCalls, "Transport:" .. e .. ">" .. h .. "/" .. nType)
	if bRefuseTransport then return false end
	tJobs[e] = true
	return true
end
tParkAPIs.habitat.GetAllCompleteHabitats = function(self) return { 101, 102, 103, 104 } end
tParkAPIs.habitat.IsAquarium = function(self, h) return h == 102 end
tParkAPIs.habitat.IsAquariumGateBelowWaterLevel = function(self, h) return false end
tParkAPIs.staff = { CanStaffDeliverAnimalToFacility = function(self, e, h) return h ~= 105 end }
tParkAPIs.facilities = { GetTradeCentres = function(self) return { [555] = true } end }
tParkAPIs.franchise = { PlanetHubType_FranchiseOnline = 3, GetPlanetHubType = function(self) return 1 end }
tParkAPIs.park = { GetParkName = function(self) return "Lemur Valley" end,
	GetTradeCentreMaxCapacity = function(self) return 10 end,
	GetNumberOfAnimalsInTradeCentre = function(self) return tTradeCount or 0 end }
animalsAPI.CanSendAnimalToTradeCentre = function(self, e) return e ~= 4 end
animalsAPI.AttemptToSendToTradeCentre = function(self, e)
	table.insert(tMoveCalls, "Trade:" .. e)
	tJobs[e] = true
	return true
end
api.ui2.GetEntityName = function(e) return ({ [101] = "Savannah Habitat", [102] = "Reef", [103] = "Pond", [104] = "Plains", [555] = "Trade Centre" })[e] end
api.world.GetWorldAPIs = function() return tParkAPIs end
-- a park again
oHM = setmetatable({ whiteWorldUIAPI = { VM_InbreedingRisk = 9 }, tWorldAPIs = tParkAPIs }, { __index = HeatMapManager })
oHM:Init()
oHM:Advance()

tCalls = {}
fireUI(oHUD, "PZ2QoL_KinForget")
scan(oHUD, "board")
local tBoard = snapshotFrom(kinChunks(oHUD))
check(tBoard ~= nil, "board snapshot sent (" .. kinStates() .. ")")
if tBoard then
	local byId = {}
	for _, a in ipairs(tBoard.animals) do byId[a.id] = a end
	check(byId["2"].lt == "habitat" and byId["5"].lt == "trade", "location kinds: habitat, trade centre")
	check(tBoard.speciesFacts and tBoard.speciesFacts.Lion and tBoard.speciesFacts.Lion.maturity == 3 and tBoard.speciesFacts.Lion.infertility == 15 and tBoard.speciesFacts.Lion.life == 20, "species fertility ages and lifespan in the snapshot")
	check(not tBoard.speciesFacts.Lion.collective and tBoard.speciesFacts.Gecko and tBoard.speciesFacts.Gecko.collective == true, "colony species flagged collective, others not")
	check(byId["2"].ageQ == 3 and byId["3"].ageQ == 2, "the game's age group per animal")
	check(byId["2"].moving == false, "not on the move")
	check(tBoard.mode == "offline", "game mode: offline (got " .. tostring(tBoard.mode) .. ")")
	check(tBoard.park == "Lemur Valley", "park name for the habitat assignments")
	check(tBoard.tradeCentre and tBoard.tradeCentre.id == "555" and tBoard.tradeCentre.name == "Trade Centre", "trade centre in the snapshot")
end

-- away for a while (the vet): counted in its assigned habitat, marked away
do
	animalsAPI.CurrentLocationType_VetSurgery = 6
	local nOldLt = tParkAnimals[5].nLocationType
	local fnOldAssigned = animalsAPI.GetAssignedHabitatEntityID
	tParkAnimals[5].nLocationType = 6
	animalsAPI.GetAssignedHabitatEntityID = function(self, e) return (e >= 1 and e <= 5) and 101 or nil end
	tCalls = {}
	fireUI(oHUD, "PZ2QoL_KinForget")
	scan(oHUD, "board")
	local tVet = snapshotFrom(kinChunks(oHUD))
	local a5 = nil
	for _, a in ipairs(tVet and tVet.animals or {}) do if a.id == "5" then a5 = a end end
	check(a5 ~= nil and a5.hab == "101" and a5.away == "vet" and a5.lt == "vet", "at the vet: counted in its assigned habitat, marked away (" .. tostring(a5 and a5.hab) .. "/" .. tostring(a5 and a5.away) .. ")")
	tParkAnimals[5].nLocationType = nOldLt
	animalsAPI.GetAssignedHabitatEntityID = fnOldAssigned
	animalsAPI.CurrentLocationType_VetSurgery = nil
	tCalls = {}
	fireUI(oHUD, "PZ2QoL_KinForget")
end

-- destinations: the game's own checks per habitat
tCalls = {}
fireUI(oHUD, "PZ2QoL_KinDestinations", "r1", "2,3")
local tDestCall = calls("Trigger")[1]
check(tDestCall and tDestCall.tArgs[1] == "PZ2QoL_KinDestinationsResult" and tDestCall.tArgs[2] == "r1", "destinations answered with the request id")
local tDest = tDestCall and jsonDecode(tDestCall.tArgs[3])
if tDest then
	local d = tDest.bySpecies.Lion
	check(d and d["101"].ok and d["104"].ok, "suitable habitats ok")
	check(d and d["103"].ok == false and string.find(d["103"].reason, "does not allow", 1, true), "wrong habitat type refused with a reason")
	check(d and d["102"].ok == false and string.find(d["102"].reason, "gate", 1, true), "aquarium with the gate above water refused")
	check(#tDest.habitats == 4 and tDest.tradeCentre.id == "555", "habitat names and the trade centre")
	check(tDest.habitats[1].hid ~= nil, "destinations carry the game's habitat id")
end
check(moveCalls("IsValid") == 4, "one IsValidHabitatForAnimalsGUID per habitat for the species (" .. moveCalls("IsValid") .. ")")

-- one move: the game's own sequence
local function lastMoveResult()
	local r = nil
	for _, c in ipairs(calls("Trigger")) do
		if c.tArgs[1] == "PZ2QoL_KinMoveResult" then r = c.tArgs end
	end
	return r
end
tCalls = {}
tMoveCalls = {}
fireUI(oHUD, "PZ2QoL_KinMove", "m1", "3", "101")
local r = lastMoveResult()
check(r and r[2] == "m1" and r[3] == false and string.find(r[4], "already lives there", 1, true), "no move to its own habitat")
tCalls = {}
fireUI(oHUD, "PZ2QoL_KinMove", "m2", "3", "103")
r = lastMoveResult()
check(r and r[3] == false and moveCalls("Claim") == 0, "unsuitable habitat refused before anything is claimed")
tCalls = {}
tMoveCalls = {}
fireUI(oHUD, "PZ2QoL_KinMove", "m3", "3", "104")
r = lastMoveResult()
check(r and r[3] == false, "refused when the game cannot transport there")
check(moveCalls("Claim") == 0 and moveCalls("Release") == 0, "nothing claimed when the transport check fails")
tCalls = {}
tMoveCalls = {}
fireUI(oHUD, "PZ2QoL_KinMove", "m4", "3", "105")
r = lastMoveResult()
check(r and r[3] == false and string.find(r[4], "keeper", 1, true), "refused when keepers cannot reach it")
tCalls = {}
tMoveCalls = {}
bRefuseTransport = true
tParkAPIs.habitat.GetAllCompleteHabitats = function(self) return { 101, 106 } end
fireUI(oHUD, "PZ2QoL_KinMove", "m5", "3", "106")
r = lastMoveResult()
check(r and r[3] == false and moveCalls("Claim") == 1 and moveCalls("Release") == 1, "a refused transport releases the box claim")
bRefuseTransport = false
tCalls = {}
tMoveCalls = {}
fireUI(oHUD, "PZ2QoL_KinMove", "m6", "3", "106")
r = lastMoveResult()
check(r and r[2] == "m6" and r[3] == true, "move accepted")
check(moveCalls("Transport:3>106/7") == 1 and moveCalls("Claim") == 1, "one transport request with the game's transport type")
tCalls = {}
tMoveCalls = {}
fireUI(oHUD, "PZ2QoL_KinMove", "m7", "3", "106")
r = lastMoveResult()
check(r and r[3] == false and string.find(r[4], "already being moved", 1, true) and #tMoveCalls == 0, "an animal already on the move is left alone")
tCalls = {}
tMoveCalls = {}
fireUI(oHUD, "PZ2QoL_KinMove", "m8", "2", "trade:555")
r = lastMoveResult()
check(r and r[3] == true and moveCalls("Trade:2") == 1 and #tMoveCalls == 1, "to the trade centre: the game's own Send to Trade Centre, nothing else")
tJobs[2] = false
tCalls = {}
tMoveCalls = {}
fireUI(oHUD, "PZ2QoL_KinMove", "m8b", "2", "trade:auto")
r = lastMoveResult()
check(r and r[3] == true and moveCalls("Trade:2") == 1, "trade:auto finds the trade centre at move time")
tJobs[2] = false
tTradeCount = 10
tCalls = {}
tMoveCalls = {}
fireUI(oHUD, "PZ2QoL_KinMove", "m8d", "2", "trade:555")
r = lastMoveResult()
check(r and r[3] == false and string.find(r[4], "full", 1, true) and #tMoveCalls == 0, "a full trade centre: refused, nothing sent")
tTradeCount = nil
tCalls = {}
fireUI(oHUD, "PZ2QoL_KinMove", "m8e", "4", "trade:555")
r = lastMoveResult()
check(r and r[3] == false and #tMoveCalls == 0, "an animal the game won't send is refused")
tJobs[2] = false
local fnTC = tParkAPIs.facilities.GetTradeCentres
tParkAPIs.facilities.GetTradeCentres = function(self) return {} end
tCalls = {}
fireUI(oHUD, "PZ2QoL_KinMove", "m8c", "2", "trade:auto")
r = lastMoveResult()
check(r and r[3] == false and string.find(r[4], "no trade centre", 1, true), "no trade centre: a clear refusal")
tParkAPIs.facilities.GetTradeCentres = fnTC
-- tradeq: a sick or injured animal goes to a quarantine first; a healthy one to the trade centre
do
	tJobs[2] = false
	local tQ = {}
	animalsAPI.IsAnimalInfected = function(self, e) return e == 2 end
	animalsAPI.IsAnimalInjured = function(self, e) return false end
	animalsAPI.CouldRequestTransportToQuarantine = function(self, e) return true end
	animalsAPI.RequestTransportToQuarantine = function(self, e) table.insert(tQ, e) end
	tCalls = {}
	tMoveCalls = {}
	fireUI(oHUD, "PZ2QoL_KinMove", "mq1", "2", "tradeq:555")
	r = lastMoveResult()
	check(r and r[3] == true and r[4] == "quarantine" and #tQ == 1 and tQ[1] == 2 and #tMoveCalls == 0, "tradeq: a sick animal goes to a quarantine, not the trade centre")
	animalsAPI.IsAnimalInfected = function(self, e) return false end
	tCalls = {}
	tMoveCalls = {}
	fireUI(oHUD, "PZ2QoL_KinMove", "mq2", "2", "tradeq:555")
	r = lastMoveResult()
	check(r and r[3] == true and r[4] == "" and moveCalls("Trade:2") == 1 and #tQ == 1, "tradeq: a healthy animal goes straight to the trade centre")
	animalsAPI.IsAnimalInfected = nil
	animalsAPI.IsAnimalInjured = nil
	animalsAPI.CouldRequestTransportToQuarantine = nil
	animalsAPI.RequestTransportToQuarantine = nil
	tJobs[2] = false
end
tCalls = {}
fireUI(oHUD, "PZ2QoL_KinMove", "m9", "x78", "101")
r = lastMoveResult()
check(r and r[3] == false, "exhibit animals are not moved from here")

-- out of the trade centre: animal 5 waits there
animalsAPI.GetCurrentLocationType = function(self, e) return tParkAnimals[e] and tParkAnimals[e].nLocationType or 1 end
local fnAssigned = animalsAPI.GetAssignedHabitatEntityID
animalsAPI.RequestTransportToAssignedHabitat = function(self, e) table.insert(tMoveCalls, "Return:" .. e); tJobs[e] = true end
tParkAPIs.habitat.GetAllCompleteHabitats = function(self) return { 101, 106 } end
tJobs[5] = false
tCalls = {}
tMoveCalls = {}
fireUI(oHUD, "PZ2QoL_KinMove", "t1", "5", "106")
r = lastMoveResult()
check(r and r[3] == true and moveCalls("Transport:5>106/7") == 1, "from the trade centre into a habitat: the usual Move")
tJobs[5] = false
animalsAPI.GetAssignedHabitatEntityID = function(self, e) return e == 5 and 106 or fnAssigned(self, e) end
tCalls = {}
tMoveCalls = {}
fireUI(oHUD, "PZ2QoL_KinMove", "t2", "5", "106")
r = lastMoveResult()
check(r and r[3] == true and moveCalls("Return:5") == 1 and moveCalls("Transport:5>106/7") == 0, "back to its own habitat: the game's Return to habitat")
tJobs[5] = false
tJobs[3] = false
tCalls = {}
tMoveCalls = {}
fireUI(oHUD, "PZ2QoL_KinMove", "t3", "3", "101")
r = lastMoveResult()
check(r and r[3] == false and string.find(r[4], "already lives there", 1, true), "a habitat animal is still refused a move to its own habitat")
animalsAPI.GetAssignedHabitatEntityID = fnAssigned


-- breeding programme: the species facts, asked on demand
animalsAPI.Monogamy = 11
animalsAPI.Polygyny = 12
animalsAPI.GetMonogamyRule = function(self, sp) return 12 end
animalsAPI.GetSocialRequirements = function(self, sp) return { nMin = 2, nMax = 9 } end
animalsAPI.GetSpeciesFertilityBounds = function(self, sp) return 3, 18 end
animalsAPI.GetAnimalSpeciesFertility = function(self, sp) return 0.7 end
animalsAPI.GetMatingResearchBonus = function(self, sp) return 0.1 end
local tProbCalls = {}
animalsAPI.CalculateProbabilityOfBreedingEvent = function(self, wM, wF, fM, fF, sf, bonus)
	tProbCalls[#tProbCalls + 1] = { wM, wF, fM, fF, sf, bonus }
	return (fM + fF) / 12 * sf
end
animalsAPI.GetSpaceRequirementsInHabitatForSpecies = function(self, h, sp) return { nLandArea = 300, nWaterArea = 0 } end
tParkAPIs.habitat.GetHabitatSpeciesOverallNavAreaData = function(self, h, sp)
	if h == 102 then return true, nil end
	return false, { nLandArea = 900, nWaterArea = 50 }
end
tParkAPIs.habitat.GetNumberOfAdultsOfGivenSpecies = function(self, h, sp) return 3 end
-- group make-up: the game's social groups (wild-territory API; an unknown
-- type keeps its symbol, an entry without counts is skipped) and the most
-- adults per sex, found one level deep in the sociality data
tParkAPIs.wildterritory = {
	SocialGroupType_MixedGroup = 1, SocialGroupType_MixedGroupLarge = 2, SocialGroupType_MaleBachelor = 3,
	SocialGroupType_FemaleBachelor = 4, SocialGroupType_MaleSolitary = 5, SocialGroupType_FemaleSolitary = 6,
	SocialGroupType_BreedingPartners = 7,
	GetTerritorySocialGroupsForSpecies = function(self, sp)
		return {
			{ nSocialGroupType = 1, sNameSymbol = "MixedGroup", nMale = 1, nFemale = 3 },
			{ nSocialGroupType = 7, sNameSymbol = "BreedingPartners", nMale = 1, nFemale = 1 },
			{ nSocialGroupType = 2, sNameSymbol = "MixedGroupLarge" },
			{ nSocialGroupType = 99, sNameSymbol = "Herd", nMale = 2, nFemale = 6 },
		}
	end,
}
animalsAPI.GetSpeciesSocialityData = function(self, sp) return { tGroup = { nMaxMales = 1, nMaxFemales = 5 } } end
tCalls = {}
-- the log's welfare curve is asked once a species a session: taken as logged, so only the table is counted
Kin.tWelfareLogged.Lion = true
fireUI(oHUD, "PZ2QoL_KinSpecies", "s1", "Lion", "101,102")
local tSpCall = calls("Trigger")[1]
check(tSpCall and tSpCall.tArgs[1] == "PZ2QoL_KinSpeciesResult" and tSpCall.tArgs[2] == "s1", "species facts answered with the request id")
local tSp = tSpCall and jsonDecode(tSpCall.tArgs[3])
if tSp then
	check(tSp.social and tSp.social.max == 9 and tSp.fertilityAges.maturity == 3 and tSp.fertilityAges.infertility == 18, "social range and fertility ages")
	check(tSp.mating == "polygyny", "mating system from the game's rule (" .. tostring(tSp.mating) .. ")")
	check(#tSp.conception == 7 and #tSp.conception[1] == 7, "conception table 7 x 7")
	check(math.abs(tSp.conception[7][1] - 0.35) < 1e-6, "conception table by (male, female) fertility grade")
	check(#tProbCalls == 49 and tProbCalls[1][1] == 1 and tProbCalls[1][6] == 0.1, "the game's own probability, at full welfare")
	check(tSp.habitats["101"].available.land == 900 and tSp.habitats["101"].required.land == 300 and tSp.habitats["101"].adults == 3, "habitat space and adults")
	check(tSp.habitats["102"].calculating == true and tSp.habitats["102"].available == nil, "space still being calculated")
	check(type(tSp.groups) == "table" and #tSp.groups == 3, "social groups: the ones with counts (" .. tostring(tSp.groups and #tSp.groups) .. ")")
	check(tSp.groups and tSp.groups[1].kind == "mixed" and tSp.groups[1].m == 1 and tSp.groups[1].f == 3, "social groups: the mixed group's make-up")
	check(tSp.groups and tSp.groups[2].kind == "pair" and tSp.groups[2].m == 1 and tSp.groups[2].f == 1, "social groups: breeding partners")
	check(tSp.groups and tSp.groups[3] and tSp.groups[3].kind == "Herd" and tSp.groups[3].f == 6, "social groups: an unknown type keeps its symbol")
	check(tSp.sexMax and tSp.sexMax.male == 1 and tSp.sexMax.female == 5, "most adults per sex, one level deep")
end
-- no wild-territory API and the sociality call fails: both left out, the
-- rest still answered
do
	tParkAPIs.wildterritory = nil
	animalsAPI.GetSpeciesSocialityData = function(self, sp) error("bad argument #1") end
	tCalls = {}
	fireUI(oHUD, "PZ2QoL_KinSpecies", "s2", "Lion", "101")
	local c = calls("Trigger")[1]
	check(c and c.tArgs[1] == "PZ2QoL_KinSpeciesResult" and c.tArgs[2] == "s2", "species facts answered without group data")
	local t = c and jsonDecode(c.tArgs[3])
	check(t and t.species == "Lion" and t.social and t.social.max == 9 and t.habitats["101"] ~= nil, "species facts intact without group data")
	check(t and t.groups == nil and t.sexMax == nil, "no group data: groups and sexMax left out")
	check(t and t.mating == "polygyny" and t.matingRaw == nil, "a rule the mod read sends no raw value")
	animalsAPI.GetSpeciesSocialityData = nil
end
-- the mating rule: enum fields, text, Polygyandry, and what is not understood
do
	local KinM = package.loaded["pz2qol.kin"]
	local function sys(rule, tExtra)
		local a = { Monogamy = 0, Polygyny = 1, Polyandre = 2, Polygyandry = 3 }
		for k, v in pairs(tExtra or {}) do a[k] = v end
		a.GetMonogamyRule = function(self, sp) return rule end
		return KinM:_MatingSystem(a, "Tiger_Sumatran")
	end
	local s, r = sys(3)
	check(s == "mixed" and r == nil, "Polygyandry is read as mixed (both sexes several mates), no raw value")
	s, r = sys(2)
	check(s == "polyandry" and r == nil, "Polyandre is read as polyandry")
	s, r = sys("Promiscuous")
	check(s == "mixed" and r == nil, "the Zoopedia word Promiscuous is read as mixed")
	s, r = sys("MonogamyRule_Polygyandry")
	check(s == "mixed", "Polygyandry as text is not taken for polygyny or polyandry (" .. tostring(s) .. ")")
	s, r = sys("Polygynous")
	check(s == "polygyny", "Polygynous as text")
	s, r = sys(9)
	check(s == nil and r == "9", "an unknown number: no system, sent raw (" .. tostring(r) .. ")")
	s, r = sys({ nRule = 4 })
	check(s == nil and r == "{nRule=4}", "a table is sent as its fields (" .. tostring(r) .. ")")
	s, r = sys(nil)
	check(s == nil and r == nil, "no rule: nothing sent")
	-- the enum fields missing from the API: a number can't be read
	s, r = sys(1, { Monogamy = false, Polygyny = false, Polyandre = false, Polygyandry = false })
	check(s == nil and r == "1", "enum fields missing: unread, sent raw")
end

-- Find a mate: the player's stored adults of a species (Franchise only, as
-- the game's own Compare Mates lists them next to the park's adults)
do
	local KinS = package.loaded["pz2qol.kin"]
	local tMarks = {}
	local fnMark = Core.Mark
	Core.Mark = function(self, s) tMarks[#tMarks + 1] = s; return fnMark(self, s) end
	local function hasMark(s)
		for _, m in ipairs(tMarks) do if m == s then return true end end
		return false
	end
	local function storedAnswer(sReq)
		local tParts, n = {}, 0
		for _, c in ipairs(calls("Trigger")) do
			if c.tArgs[1] == "PZ2QoL_KinStoredChunk" and c.tArgs[2] == sReq then
				tParts[c.tArgs[3]] = c.tArgs[5]
				n = c.tArgs[4]
			end
		end
		if n == 0 or #tParts ~= n then return nil, n end
		return jsonDecode(table.concat(tParts)), n
	end
	check(oHUD.tListeners["PZ2QoL_KinStored"] ~= nil, "stored adults: listener on the park page")
	local fnHubType = tParkAPIs.franchise.GetPlanetHubType
	local tStoredData = {
		[5001] = { sName = "Stash", nGender = 0, nMaturity = 2, sRating = "silver", bForSale = false, tGenes = { nSize = 0.5, nLongevity = 0.4, nFertility = 0.8, nImmunity = 0.6 } },
		[5002] = { sName = "Sis", nGender = 1, nMaturity = 1, bForSale = true },
		[5003] = { sName = "Oldie", nGender = 1, nMaturity = 6 },
	}
	local nSplitCalls = 0
	api.planetHub.GetAdultsOfSpeciesInStorageSplitByGender = function(sp)
		nSplitCalls = nSplitCalls + 1
		record("StoredSplit", sp)
		return { { 5001 }, { 5002, 5003 } }
	end
	local fnParents = animalsAPI.GetParents
	animalsAPI.GetParents = function(self, g)
		if g == 5002 then return { 1001, 6000 } end -- Kito's half-sister (father Ama)
		if g == 6000 then return { 6001, "" } end
		return fnParents(self, g)
	end
	animalsAPI.GetMarketAnimalCompareMatesData = function(self, guid, nType)
		record("CompareData", guid, nType)
		return tStoredData[guid]
	end
	-- an offline park: refused, the storage call is never made
	tCalls = {}
	fireUI(oHUD, "PZ2QoL_KinStored", "q1", "Lion")
	local t = storedAnswer("q1")
	check(t and t.error == "notfranchise" and nSplitCalls == 0, "stored adults: offline park refused, storage not asked (" .. tostring(t and t.error) .. ")")
	-- Franchise: both sexes, parents, genes, absent ancestors
	tParkAPIs.franchise.GetPlanetHubType = function(self) return 3 end
	tCalls = {}
	tMarks = {}
	fireUI(oHUD, "PZ2QoL_KinStored", "q2", "Lion")
	t = storedAnswer("q2")
	check(t and t.species == "Lion" and t.error == nil and #t.animals == 3, "stored adults: three answered (" .. tostring(t and t.animals and #t.animals) .. ")")
	local by = {}
	for _, a in ipairs(t and t.animals or {}) do by[a.guid] = a end
	check(by["5001"] and by["5001"].id == "s5001" and by["5001"].sex == 0 and by["5001"].name == "Stash" and by["5001"].rating == "silver", "stored male with id, name and medal")
	check(by["5002"] and by["5002"].sex == 1 and by["5002"].forSale == true and table.concat(by["5002"].par, ",") == "1001,6000", "stored female: for sale, parents from GetParents")
	check(by["5003"] and by["5003"].maturity == 6, "the game's maturity kept (6: elderly, infertile)")
	check(by["5001"] and by["5001"].genes and by["5001"].genes.F == "EEEEEEFFFFFF" and by["5001"].grades.F == 0.8, "alleles via GetMarketAnimalGenes(guid, 2), grades from the compare data")
	check(t and t.anc and t.anc["6000"] and t.anc["6000"][1] == "6001", "absent ancestors of stored animals")
	check(t and t.capped == false, "not capped")
	local bType2 = #calls("CompareData") == 3
	for _, c in ipairs(calls("CompareData")) do if c.tArgs[2] ~= 2 then bType2 = false end end
	check(bType2, "compare data asked with id type 2 (GUID)")
	check(hasMark("kin_stored_ok"), "trace: kin_stored_ok")
	-- chunked like the snapshot
	KinS.nChunkSize = 120
	tCalls = {}
	fireUI(oHUD, "PZ2QoL_KinStored", "q3", "Lion")
	local t3, n3 = storedAnswer("q3")
	check(n3 > 2 and t3 and #t3.animals == 3, "stored adults: chunked and reassembled (" .. tostring(n3) .. " chunks)")
	KinS.nChunkSize = 12000
	-- capped
	KinS.nStoredMax = 2
	tCalls = {}
	fireUI(oHUD, "PZ2QoL_KinStored", "q4", "Lion")
	t = storedAnswer("q4")
	check(t and #t.animals == 2 and t.capped == true, "capped at nStoredMax")
	KinS.nStoredMax = 150
	-- none stored
	api.planetHub.GetAdultsOfSpeciesInStorageSplitByGender = function(sp) return { {}, {} } end
	tCalls = {}
	tMarks = {}
	fireUI(oHUD, "PZ2QoL_KinStored", "q5", "Lion")
	t = storedAnswer("q5")
	check(t and t.error == nil and #t.animals == 0 and hasMark("kin_stored_none"), "nothing stored: an empty list")
	-- the call throws: failed, and the park scan is unaffected
	api.planetHub.GetAdultsOfSpeciesInStorageSplitByGender = function(sp) error("server") end
	tCalls = {}
	tMarks = {}
	fireUI(oHUD, "PZ2QoL_KinStored", "q6", "Lion")
	t = storedAnswer("q6")
	check(t and t.error == "failed" and hasMark("kin_stored_failed"), "storage call throws: failed")
	tCalls = {}
	fireUI(oHUD, "PZ2QoL_KinForget")
	scan(oHUD, "after stored")
	check(snapshotFrom(kinChunks(oHUD)) ~= nil, "park scan still works after a failed storage call")
	-- the call missing: nostorage
	api.planetHub.GetAdultsOfSpeciesInStorageSplitByGender = nil
	tCalls = {}
	tMarks = {}
	fireUI(oHUD, "PZ2QoL_KinStored", "q7", "Lion")
	t = storedAnswer("q7")
	check(t and t.error == "nostorage" and hasMark("kin_stored_unavailable"), "storage call missing: nostorage")
	tParkAPIs.franchise.GetPlanetHubType = fnHubType
	animalsAPI.GetParents = fnParents
	animalsAPI.GetMarketAnimalCompareMatesData = nil
	Core.Mark = fnMark
end

-- growing up (Kin alerts): a juvenile's adult age, outsiders and why, the
-- species' group limit and maturation rule; all optional, nothing else changes
do
	local KinL = package.loaded["pz2qol.kin"]
	local tMarks = {}
	local fnMark = Core.Mark
	Core.Mark = function(self, s) tMarks[#tMarks + 1] = s; return fnMark(self, s) end
	local function hasMark(s)
		for _, m in ipairs(tMarks) do if m == s then return true end end
		return false
	end
	local function lifeScan(sReason)
		tCalls = {}
		fireUI(oHUD, "PZ2QoL_KinForget")
		scan(oHUD, sReason)
		local t = snapshotFrom(kinChunks(oHUD))
		local by = {}
		for _, a in ipairs(t and t.animals or {}) do by[a.id] = a end
		return t, by
	end
	animalsAPI.GetAgeProps = function(self, e) return { nAdult = 0.2 } end
	animalsAPI.GetAnimalDeathAge = function(self, e) return 20 end
	animalsAPI.GetAge = function(self, e) return e == 4 and 3.5 or 8 end
	animalsAPI.MaturationType_RejectMales, animalsAPI.MaturationType_RejectFemales = 21, 22
	animalsAPI.MaturationType_RejectAll, animalsAPI.MaturationType_RejectNone = 23, 24
	animalsAPI.GetSocialityData = function(self, e) return { nMaturationType = 21 } end
	animalsAPI.RejectionReason_Overpopulation, animalsAPI.RejectionReason_Maturation, animalsAPI.RejectionReason_GenderRatio = 31, 32, 33
	animalsAPI.HasEnemiesInHabitat = function(self, e) return e == 1 or e == 3 end
	animalsAPI.GetRejectionReason = function(self, e)
		if e == 3 then return 32 end
		error("integrating")
	end
	KinL.tMaturation = {}
	tMarks = {}
	KinL.sLastLife = nil
	local t, by = lifeScan("life")
	check(t ~= nil, "growing up: snapshot sent")
	check(by["4"] and by["4"].adultAge == 4 and math.abs((by["4"].adultIn or -1) - 0.5) < 1e-9, "juvenile: adult age (death age x nAdult) and the years left (" .. tostring(by["4"] and by["4"].adultIn) .. ")")
	check(by["2"] and by["2"].adultAge == nil and by["2"].adultIn == nil, "adults get no adult age")
	check(by["3"] and by["3"].out == "mat", "an outsider driven out at maturation: out = mat")
	check(by["1"] and by["1"].out == "yes", "an outsider whose reason fails: out = yes")
	check(by["2"] and by["2"].out == nil and by["4"].out == nil, "group members and juveniles: no out")
	check(by["5"] and by["5"].out == nil, "animals outside a habitat: no out")
	local f = t and t.speciesFacts and t.speciesFacts.Lion
	check(f and f.social and f.social.max == 9 and f.social.min == 2, "species group limit from GetSocialRequirements")
	check(f and f.maturation == "males", "species maturation rule from GetSocialityData (" .. tostring(f and f.maturation) .. ")")
	check(f and f.maturity == 3, "the other species facts unchanged")
	check(hasMark("kin_social_found") and hasMark("kin_maturation_found") and hasMark("kin_adultage_found"), "trace: social, maturation and adult age found")
	-- the game gives none of it: the fields are simply absent, the scan as before
	animalsAPI.GetAgeProps, animalsAPI.GetAnimalDeathAge, animalsAPI.GetAge = nil, nil, nil
	animalsAPI.GetSocialityData, animalsAPI.HasEnemiesInHabitat, animalsAPI.GetRejectionReason = nil, nil, nil
	local fnSocial = animalsAPI.GetSocialRequirements
	animalsAPI.GetSocialRequirements = function() error("no") end
	KinL.tSocial, KinL.tMaturation = {}, {}
	if KinL.tStatic["4"] then KinL.tStatic["4"].nAdultAge = nil end
	tMarks = {}
	local t2, by2 = lifeScan("life missing")
	check(t2 ~= nil and #t2.animals == #t.animals, "growing up APIs missing: the scan still sent, same animals")
	check(by2["4"] and by2["4"].adultAge == nil and by2["3"] and by2["3"].out == nil, "missing: no adult age, no out")
	local f2 = t2 and t2.speciesFacts and t2.speciesFacts.Lion
	check(f2 and f2.social == nil and f2.maturation == nil and f2.maturity == 3, "missing: no social or maturation, the rest kept")
	check(hasMark("kin_social_none") and hasMark("kin_maturation_none") and hasMark("kin_adultage_none"), "trace: social, maturation and adult age none")
	animalsAPI.GetSocialRequirements = fnSocial
	KinL.tSocial, KinL.tMaturation = {}, {}
	Core.Mark = fnMark
end

-- the player's data (habitat assignments): kept on this device in the
-- game's player save (tData.PZ2QoL.Assign, one entry per zoo), in every
-- zoo, Franchise included; found on the park tick
local Kin = package.loaded["pz2qol.kin"]
local PlayerStore = package.loaded["pz2qol.playerstore"]
check(PlayerStore ~= nil and Core.PlayerStore == PlayerStore, "the player store registers itself on Core")
PlayerStore.bCleaned = false
local nClock = 1000
local fnTimerWas11 = api.time.GetPerformanceTimer
api.time.GetPerformanceTimer = function() return nClock end
-- the game's MainPlayer GetData/SetData (database.mainplayer.lua)
local function findData(t, k, ...)
	if k == nil then return t end
	if t[k] == nil then return nil end
	return findData(t[k], ...)
end
local function applyData(v, t, k, k2, ...)
	if k2 == nil then
		t[k] = v
	else
		if t[k] == nil then t[k] = {} end
		applyData(v, t[k], k2, ...)
	end
end
local tPData = { PZ2QoL = { Probe = '{"run":5}', Big = string.rep("x", 12000) }, bEulaAccepted = true, Career = { n = 3 } }
local tPlayerObj = { tData = tPData }
tPlayerObj.GetData = function(self, ...) return findData(self.tData, ...) end
tPlayerObj.SetData = function(self, v, ...) applyData(v, self.tData, ...) end
local nPlayerKey = 0 -- no player profile yet
local tGdbWas = package.loaded["database.gamedatabase"]
package.loaded["database.gamedatabase"] = {
	GetPlayerKey = function(o) return o == "owner" and nPlayerKey or 0 end,
	GetPlayer = function(n) return n == 7 and tPlayerObj or nil end,
}
local apiPlayerWas, apiSaveWas = api.player, api.save
api.player = { GetGameOwner = function() return "owner" end }
local nMainSaves = 0
api.save = { RequestSaveMainPlayer = function() nMainSaves = nMainSaves + 1 end }
local function assignArea() return tPData.PZ2QoL and tPData.PZ2QoL.Assign end

local tClients = {}
local tSaveCalls = {}
tParkAPIs.worldserialisation = {
	RegisterWorldSerialisationClient = function(self, sName, nVer, fnSave, fnLoad, fnCanLoad)
		tSaveCalls[#tSaveCalls + 1] = "register:" .. sName
		tClients[sName] = { nVer = nVer, fnSave = fnSave, fnLoad = fnLoad, fnCanLoad = fnCanLoad }
	end,
	UnregisterWorldSerialisationClient = function(self, sName)
		tSaveCalls[#tSaveCalls + 1] = "unregister:" .. sName
		tClients[sName] = nil
	end,
}
local sZooGuid = nil
tParkAPIs.franchise.GetPlanetHubGuid = function(self) return "hub-1111" end
tParkAPIs.franchise.GetCurrentZooGUID = function(self) return sZooGuid end
oHM:Shutdown()
local function storeCalls(sEvent)
	local t = {}
	for _, c in ipairs(calls("Trigger")) do
		if c.tArgs[1] == sEvent then t[#t + 1] = c end
	end
	return t
end
local function resetsTo(oView)
	local n = 0
	for _, c in ipairs(storeCalls("PZ2QoL_StoreReset")) do
		if c.oView == oView then n = n + 1 end
	end
	return n
end
local function load(sReq)
	tCalls = {}
	fireUI(oHUD, "PZ2QoL_StoreLoad", sReq)
	local tData = storeCalls("PZ2QoL_StoreData")
	local sJoined = ""
	for _, c in ipairs(tData) do sJoined = sJoined .. tostring(c.tArgs[6]) end
	return tData, sJoined
end
local function save(sReq, sText)
	tCalls = {}
	fireUI(oHUD, "PZ2QoL_StoreSave", sReq, sText)
	local c = storeCalls("PZ2QoL_StoreSaved")[1]
	return c and c.tArgs[2] == sReq and c.tArgs[3]
end
local function tick(nSeconds)
	nClock = nClock + (nSeconds or 0)
	oHM:Advance()
end

-- an offline park starts; nothing is known before its first tick
tCalls = {}
oHM = setmetatable({ whiteWorldUIAPI = { VM_InbreedingRisk = 9 }, tWorldAPIs = tParkAPIs }, { __index = HeatMapManager })
oHM:Init()
check(#calls("HMInit") == 1, "the manager's own Init still runs")
check(#storeCalls("PZ2QoL_StoreReset") >= 1, "the views are told to read the store again")
check(tClients["PZ2QoL"] ~= nil, "offline park: the old park-save client is registered (to read only)")
local tData = load("L0")
check(#tData == 1 and tData[1].tArgs[3] == false and tData[1].tArgs[6] == "wait", "before the first tick: answered false, reason wait")
-- no player profile yet: wait, then report it
tick(0)
check(Kin.sZooKey == nil and Kin.sStoreOff == "wait", "no player yet: still waiting")
tCalls = {}
tick(25)
check(Kin.sStoreOff == "noplayer" and resetsTo(oHUD) == 1, "no player for a while: noplayer, the views are told")
tData = load("L1")
check(#tData == 1 and tData[1].tArgs[3] == false and tData[1].tArgs[6] == "noplayer", "no player: answered false, reason noplayer")
check(save("S0", '{"a":1}') == false, "no player: nothing kept")
-- the profile arrives: the zoo's key is found and the views read again
nPlayerKey = 7
tCalls = {}
tick(0.5)
check(Kin.sZooKey == nil, "retries at most once a second")
tick(1)
check(type(Kin.sZooKey) == "string" and Kin.sZooKey:match("^o_hub%-1111_LemurValley_%x%x%x%x%x%x%x%x$") ~= nil, "offline zoo key from the hub and the park's name (" .. tostring(Kin.sZooKey) .. ")")
check(resetsTo(oHUD) == 1, "the views are told the store is there")
check(tPData.PZ2QoL.Probe == nil and tPData.PZ2QoL.Big == nil and tPData.bEulaAccepted == true and tPData.Career.n == 3, "the probe's leftovers removed, nothing else touched")
check(nMainSaves == 1, "the cleanup is saved once")
local tData2, sJoined = load("L2")
check(#tData2 == 1 and tData2[1].tArgs[3] == true and sJoined == "", "nothing kept yet: answered with no data")
-- the page saves: kept in the player's table in <= 4000-character strings
local sBig = '{"kinAssign":{"Lemur Valley":{"101":{"name":"Lemur Woods","species":["RingTailedLemur"]}}},"pad":"' .. string.rep("x", 30000) .. '"}'
check(save("S1", sBig) == true, "kept in the player store")
local tEntry = assignArea()[Kin.sZooKey]
local bPartsOk = tEntry ~= nil and tEntry.N == tostring(math.ceil(#sBig / 4000))
local tJoin = {}
for i = 1, tonumber(tEntry and tEntry.N or 0) do
	local s = tEntry["P" .. i]
	bPartsOk = bPartsOk and type(s) == "string" and #s <= 4000
	tJoin[#tJoin + 1] = s or ""
end
check(bPartsOk and table.concat(tJoin) == sBig and type(tEntry.S) == "string", "stored as ASCII strings of at most 4000 characters")
-- written to disk a few seconds after the last change, not on every click
check(nMainSaves == 1, "no save request straight away")
tick(1)
check(save("S1b", sBig) == true and nMainSaves == 1, "a second change pushes the request back")
tick(3)
check(nMainSaves == 1, "not yet 4 s after the last change")
tick(1.5)
check(nMainSaves == 2, "the game is asked to save the player once")
tick(10)
check(nMainSaves == 2, "and only once")
check(save("S2", '{"a":"caf\195\169"}') == false and load("L3") and select(2, load("L3")) == sBig, "non-ASCII text refused, the data kept")
check(save("S3", "not json") == false and select(2, load("L4")) == sBig, "anything but a JSON object refused")
check(save("S3b", "{" .. string.rep(" ", 70000) .. "}") == false, "more than one zoo may hold refused")
local tData5, sJoined5 = load("L5")
check(#tData5 == 3 and tData5[1].tArgs[5] == 3 and sJoined5 == sBig, "read back in 12 KB event chunks")
-- the old client never writes to the park save
local tParkSave = {}
tClients["PZ2QoL"].fnSave(tParkSave)
check(next(tParkSave) == nil, "nothing is written to the park save")
check(tClients["PZ2QoL"].fnCanLoad(1) == true, "old version 1 saves load")
-- leaving the park
local sOfflineKey = Kin.sZooKey
oHM:Shutdown()
check(tClients["PZ2QoL"] == nil and Kin.sZooKey == nil, "park end: the reader unregistered, the key forgotten")
tData = load("L6")
check(#tData == 1 and tData[1].tArgs[3] == false and tData[1].tArgs[6] == "nopark", "no park: answered false, reason nopark")
-- the game restarted (the player save is all that is left): the same park reads it back
Kin.sZooKey = nil
oHM = setmetatable({ whiteWorldUIAPI = { VM_InbreedingRisk = 9 }, tWorldAPIs = tParkAPIs }, { __index = HeatMapManager })
oHM:Init()
tick(0)
check(Kin.sZooKey == sOfflineKey and select(2, load("L7")) == sBig, "the same park reads its data back")
oHM:Shutdown()

-- a Franchise zoo: keyed by planet hub and zoo GUIDs, kept the same way
local fnHubType = tParkAPIs.franchise.GetPlanetHubType
tParkAPIs.franchise.GetPlanetHubType = function(self) return 3 end
tSaveCalls = {}
sZooGuid = nil
oHM = setmetatable({ whiteWorldUIAPI = { VM_InbreedingRisk = 9 }, tWorldAPIs = tParkAPIs }, { __index = HeatMapManager })
oHM:Init()
check(#tSaveCalls == 0 and tClients["PZ2QoL"] == nil, "Franchise zoo: nothing registered with the park save")
tick(0)
check(Kin.sZooKey == nil and Kin.sStoreOff == "wait", "Franchise zoo without its GUID yet: waits")
sZooGuid = "abcd-0001"
tCalls = {}
tick(1)
check(Kin.sZooKey == "f_hub-1111_abcd-0001", "Franchise zoo key (" .. tostring(Kin.sZooKey) .. ")")
check(resetsTo(oHUD) == 1, "Franchise: the views read again")
tData, sJoined = load("L8")
check(#tData == 1 and tData[1].tArgs[3] == true and sJoined == "", "Franchise zoo: its own (empty) data, not the offline park's")
local sFr = '{"kinAssign":{"Savanna Hub":{"201":{"name":"Plains","species":["Lion"]}}}}'
check(save("S4", sFr) == true, "Franchise: kept on this device")
check(assignArea()["f_hub-1111_abcd-0001"] ~= nil and assignArea()[sOfflineKey] ~= nil, "one entry per zoo")
oHM:Shutdown()
-- another Franchise zoo on the same hub
sZooGuid = "abcd-0002"
oHM = setmetatable({ whiteWorldUIAPI = { VM_InbreedingRisk = 9 }, tWorldAPIs = tParkAPIs }, { __index = HeatMapManager })
oHM:Init()
tick(0)
check(Kin.sZooKey == "f_hub-1111_abcd-0002" and select(2, load("L9")) == "", "a second Franchise zoo starts empty")
oHM:Shutdown()
sZooGuid = "abcd-0001"
oHM = setmetatable({ whiteWorldUIAPI = { VM_InbreedingRisk = 9 }, tWorldAPIs = tParkAPIs }, { __index = HeatMapManager })
oHM:Init()
tick(0)
check(select(2, load("L10")) == sFr, "the first Franchise zoo reads its own data back")
oHM:Shutdown()
sZooGuid = nil
tParkAPIs.franchise.GetPlanetHubType = fnHubType

-- the game mode cannot be read: waits, then keys the park by name
tParkAPIs.franchise.GetPlanetHubType = function(self) error("no hub type") end
oHM = setmetatable({ whiteWorldUIAPI = { VM_InbreedingRisk = 9 }, tWorldAPIs = tParkAPIs }, { __index = HeatMapManager })
oHM:Init()
check(tClients["PZ2QoL"] == nil, "unknown mode: nothing registered with the park save")
tick(0)
check(Kin.sZooKey == nil and Kin.sStoreOff == "wait", "unknown mode: waits")
tick(11)
check(Kin.sZooKey == sOfflineKey, "unknown mode for 10 s: keyed by the park's name")
oHM:Shutdown()
tParkAPIs.franchise.GetPlanetHubType = fnHubType

-- an old build's data in an offline park save moves to the player store
local fnParkWas = tParkAPIs.park.GetParkName
tParkAPIs.park.GetParkName = function(self) return "Old Park" end
oHM = setmetatable({ whiteWorldUIAPI = { VM_InbreedingRisk = 9 }, tWorldAPIs = tParkAPIs }, { __index = HeatMapManager })
oHM:Init()
local sOld = '{"kinAssign":{"Old Park":{"301":{"name":"Pen","species":["Zebra"]}}}}'
check(tClients["PZ2QoL"].fnLoad({ sData = sOld }, 1) == true, "the old save's data is read")
check(tClients["PZ2QoL"].fnLoad({ sData = 42 }, 1) == true, "a bad old value never breaks the load")
tick(0)
check(select(2, load("L11")) == sOld, "moved to the player store once the zoo is known")
check(save("S5", '{"kinAssign":{}}') == true, "changed afterwards")
check(tClients["PZ2QoL"].fnLoad({ sData = sOld }, 1) == true and select(2, load("L12")) == '{"kinAssign":{}}', "the old data never overwrites newer data")
check(save("S6", "{}") == true and assignArea()[Kin.sZooKey] == nil, "empty data removes the zoo's entry")
oHM:Shutdown()
tParkAPIs.park.GetParkName = fnParkWas

-- the game's register call fails: the park still runs, the store still works
tParkAPIs.worldserialisation.RegisterWorldSerialisationClient = function() error("ID already registered") end
oHM = setmetatable({ whiteWorldUIAPI = { VM_InbreedingRisk = 9 }, tWorldAPIs = tParkAPIs }, { __index = HeatMapManager })
tCalls = {}
oHM:Init()
tick(0)
check(#calls("HMInit") == 1 and Kin.sZooKey == sOfflineKey, "a failed register never breaks the park start or the store")
oHM:Shutdown()
tParkAPIs.worldserialisation = nil

-- the cap: 64 KB over all zoos, the zoos written longest ago go first
local nSeqSaves = nMainSaves
local s25 = '{"p":"' .. string.rep("y", 25000) .. '"}'
check(PlayerStore:Write("o_x_a", s25, nClock) and PlayerStore:Write("o_x_b", s25, nClock), "two large zoos fit")
check(assignArea()["o_x_a"] ~= nil and assignArea()["o_x_b"] ~= nil, "both kept")
check(PlayerStore:Write("o_x_c", s25, nClock) == true, "a third is kept")
local tA = assignArea()
check(tA["o_x_a"] == nil and tA["o_x_b"] ~= nil and tA["o_x_c"] ~= nil, "the oldest zoo is dropped past the cap")
local nTotal = 0
for k, e in pairs(tA) do for _, v in pairs(e) do if type(v) == "string" then nTotal = nTotal + #v end end end
check(nTotal <= PlayerStore.nCap, "total under the cap (" .. nTotal .. ")")
local bBig, sWhyBig = PlayerStore:Write("o_x_d", '{"p":"' .. string.rep("z", 70000) .. '"}', nClock)
check(bBig == false and sWhyBig == "toobig" and assignArea()["o_x_b"] ~= nil, "one zoo larger than the cap is refused, nothing dropped")
check(PlayerStore:Write("bad key!", "{}", nClock) == false, "only short ASCII keys")
-- something else under the mod's key is replaced, never anything outside it
tPData.PZ2QoL = "junk"
check(PlayerStore:Write("o_x_e", '{"a":1}', nClock) == true and type(tPData.PZ2QoL) == "table" and tPData.bEulaAccepted == true, "a broken PZ2QoL entry is replaced")
-- the player's calls failing never break anything
tPlayerObj.GetData = function() error("boom") end
tPlayerObj.SetData = function() error("boom") end
local sR = PlayerStore:Read("o_x_e")
local bW, sW = PlayerStore:Write("o_x_e", '{"a":2}', nClock)
check(sR == "" and bW == false and sW == "failed", "failing player calls: read empty, write refused")
tPlayerObj.GetData = function(self, ...) return findData(self.tData, ...) end
tPlayerObj.SetData = function(self, v, ...) applyData(v, self.tData, ...) end
PlayerStore.nDirtySince, PlayerStore.nDirtyLast = nil, nil -- nothing left unsaved

-- the player-wide settings (prefs.js): tData.PZ2QoL.Prefs, one set across
-- zoos, a separate area from Assign (in a do-block: the main chunk is at
-- Lua's 200-local limit)
do
	local tMarks = {}
	local fnMark = Core.Mark
	Core.Mark = function(self, s) tMarks[#tMarks + 1] = s; return fnMark(self, s) end
	local function marked(s)
		for _, m in ipairs(tMarks) do if m == s then return true end end
		return false
	end
	local function prefs() return tPData.PZ2QoL and tPData.PZ2QoL.Prefs end
	-- no player profile: nothing read or kept
	nPlayerKey = 0
	local sNo, sWhyNo = PlayerStore:ReadPrefs()
	local bNo, sWhyNoW = PlayerStore:WritePrefs('{"a":1}', nClock)
	check(sNo == nil and sWhyNo == "noplayer" and bNo == false and sWhyNoW == "noplayer", "prefs: no player, read nil + noplayer, write refused")
	nPlayerKey = 7
	tPData.PZ2QoL.Prefs = nil
	check(PlayerStore:ReadPrefs() == "", "prefs: nothing kept yet reads empty")
	-- round trip
	tMarks = {}
	local sP = '{"progOpt":{"engine":"deep","preset":"standard","cpu":"normal"}}'
	PlayerStore.nDirtySince, PlayerStore.nDirtyLast = nil, nil -- nothing left unsaved
	check(PlayerStore:WritePrefs(sP, nClock) == true and marked("prefs_written"), "prefs: written (prefs_written)")
	local tP = prefs()
	check(type(tP) == "table" and tP.N == "1" and tP.P1 == sP and tP.S == "1", "prefs: stored as { S, N, P1 }")
	check(PlayerStore:ReadPrefs() == sP, "prefs: read back")
	check(PlayerStore:WritePrefs(sP, nClock) == true and prefs().S == "2", "prefs: the write count goes up")
	-- saved with the player a few seconds later, like the assignments
	local nSavesP = nMainSaves
	PlayerStore:Tick(nClock + 1)
	check(nMainSaves == nSavesP, "prefs: no save request straight away")
	PlayerStore:Tick(nClock + 5)
	check(nMainSaves == nSavesP + 1, "prefs: the game is asked to save the player")
	-- the cap: 4000 characters
	local s4000 = '{"p":"' .. string.rep("q", 4000 - 8) .. '"}'
	check(#s4000 == 4000 and PlayerStore:WritePrefs(s4000, nClock) == true and PlayerStore:ReadPrefs() == s4000, "prefs: 4000 characters kept")
	tMarks = {}
	local bBigP, sBigP = PlayerStore:WritePrefs('{"p":"' .. string.rep("q", 4000) .. '"}', nClock)
	check(bBigP == false and sBigP == "toobig" and PlayerStore:ReadPrefs() == s4000 and marked("prefs_refused"), "prefs: over 4000 refused (prefs_refused), the old kept")
	check(PlayerStore:WritePrefs(sP, nClock) == true, "prefs: back to the short text")
	-- bad text refused
	local bA, sA = PlayerStore:WritePrefs('{"a":"caf\195\169"}', nClock)
	local bJ, sJ = PlayerStore:WritePrefs("not json", nClock)
	local bN, sN = PlayerStore:WritePrefs(42, nClock)
	check(bA == false and sA == "bad" and bJ == false and sJ == "bad" and bN == false and sN == "bad" and PlayerStore:ReadPrefs() == sP, "prefs: non-ASCII, non-object and non-string refused, the data kept")
	-- an unreadable entry reads empty
	tPData.PZ2QoL.Prefs = { N = "2", P1 = "{" }
	check(PlayerStore:ReadPrefs() == "", "prefs: a broken entry reads empty")
	check(PlayerStore:WritePrefs(sP, nClock) == true and PlayerStore:ReadPrefs() == sP, "prefs: a broken entry is replaced")
	-- the assignments' writes, trim and removal never touch Prefs
	local s25p = '{"p":"' .. string.rep("w", 25000) .. '"}'
	tMarks = {}
	check(PlayerStore:Write("o_p_a", s25p, nClock) and PlayerStore:Write("o_p_b", s25p, nClock) and PlayerStore:Write("o_p_c", s25p, nClock), "prefs: three large zoos written")
	check(marked("assign_store_trimmed") and PlayerStore:ReadPrefs() == sP, "prefs: the zoos' trim leaves Prefs intact")
	check(PlayerStore:Write("o_p_c", "{}", nClock) == true and assignArea()["o_p_c"] == nil and PlayerStore:ReadPrefs() == sP, "prefs: removing a zoo leaves Prefs intact")
	-- the probe cleanup never touches Prefs
	tPData.PZ2QoL.Probe, tPData.PZ2QoL.Big = "x", "y"
	PlayerStore.bCleaned = false
	PlayerStore:Cleanup()
	check(tPData.PZ2QoL.Probe == nil and tPData.PZ2QoL.Big == nil and PlayerStore:ReadPrefs() == sP and assignArea()["o_p_b"] ~= nil, "prefs: the cleanup leaves Prefs and Assign intact")
	-- writing Prefs never touches the assignments
	check(PlayerStore:WritePrefs('{"b":2}', nClock) == true and assignArea()["o_p_b"] ~= nil, "prefs: a Prefs write leaves Assign intact")
	-- something else under the mod's key is replaced, never anything outside it
	tPData.PZ2QoL = "junk"
	check(PlayerStore:ReadPrefs() == "", "prefs: a broken PZ2QoL entry reads empty")
	check(PlayerStore:WritePrefs(sP, nClock) == true and type(tPData.PZ2QoL) == "table" and PlayerStore:ReadPrefs() == sP and tPData.bEulaAccepted == true, "prefs: a broken PZ2QoL entry is replaced")
	-- removal
	check(PlayerStore:WritePrefs("{}", nClock) == true and prefs() == nil and PlayerStore:ReadPrefs() == "", "prefs: {} removes the entry")
	check(PlayerStore:WritePrefs("", nClock) == true and prefs() == nil, "prefs: removing nothing is fine")
	-- the Kin events (need only the player, not a zoo: no park here)
	check(Kin.sZooKey == nil, "prefs: no zoo key")
	local function prefsLoad(sReq)
		tCalls = {}
		fireUI(oHUD, "PZ2QoL_PrefsLoad", sReq)
		local t = storeCalls("PZ2QoL_PrefsData")
		return #t, t[1] and t[1].tArgs[2], t[1] and t[1].tArgs[3], t[1] and t[1].tArgs[4]
	end
	local function prefsSave(sReq, sText)
		tCalls = {}
		fireUI(oHUD, "PZ2QoL_PrefsSave", sReq, sText)
		local t = storeCalls("PZ2QoL_PrefsSaved")
		return #t == 1 and t[1].tArgs[2] == sReq and t[1].tArgs[3]
	end
	tMarks = {}
	local n1, r1, ok1, txt1 = prefsLoad("P1")
	check(n1 == 1 and r1 == "P1" and ok1 == true and txt1 == "" and marked("prefs_empty"), "prefs event: nothing kept, answered true with '' (prefs_empty)")
	check(prefsSave("Q1", sP) == true and PlayerStore:ReadPrefs() == sP, "prefs event: saved, answered true")
	tMarks = {}
	local n2, r2, ok2, txt2 = prefsLoad("P2")
	check(n2 == 1 and r2 == "P2" and ok2 == true and txt2 == sP and marked("prefs_loaded"), "prefs event: read back (prefs_loaded)")
	check(prefsSave("Q2", "not json") == false and PlayerStore:ReadPrefs() == sP, "prefs event: bad text answered false, the data kept")
	check(prefsSave("Q3", 42) == false, "prefs event: a non-string answered false")
	nPlayerKey = 0
	tMarks = {}
	local n3, _, ok3, txt3 = prefsLoad("P3")
	check(n3 == 1 and ok3 == false and txt3 == "noplayer" and marked("prefs_unavailable"), "prefs event: no player, answered false + noplayer (prefs_unavailable)")
	check(prefsSave("Q4", sP) == false, "prefs event: no player, the save answered false")
	nPlayerKey = 7
	-- the store module missing
	local tStoreWas, tLoadedWas = Core.PlayerStore, package.loaded["pz2qol.playerstore"]
	Core.PlayerStore, package.loaded["pz2qol.playerstore"] = nil, nil
	local n4, _, ok4, txt4 = prefsLoad("P4")
	check(n4 == 1 and ok4 == false and txt4 == "unavailable", "prefs event: no store, answered false + unavailable")
	check(prefsSave("Q5", sP) == false, "prefs event: no store, the save answered false")
	Core.PlayerStore, package.loaded["pz2qol.playerstore"] = tStoreWas, tLoadedWas
	-- the player's calls failing never break anything
	tPlayerObj.GetData = function() error("boom") end
	tPlayerObj.SetData = function() error("boom") end
	local sRP = PlayerStore:ReadPrefs()
	local bWP, sWP = PlayerStore:WritePrefs('{"c":3}', nClock)
	local n5, _, ok5, txt5 = prefsLoad("P5")
	check(sRP == "" and bWP == false and sWP == "failed" and n5 == 1 and ok5 == true and txt5 == "", "prefs: failing player calls, read empty, write refused")
	check(prefsSave("Q6", '{"c":3}') == false, "prefs event: failing player calls, the save answered false")
	tPlayerObj.GetData = function(self, ...) return findData(self.tData, ...) end
	tPlayerObj.SetData = function(self, v, ...) applyData(v, self.tData, ...) end
	PlayerStore.nDirtySince, PlayerStore.nDirtyLast = nil, nil -- nothing left unsaved
	Core.Mark = fnMark
end

package.loaded["database.gamedatabase"] = tGdbWas
api.player, api.save = apiPlayerWas, apiSaveWas
api.time.GetPerformanceTimer = fnTimerWas11

api.world.GetWorldAPIs = fnSavedWorld

-----------------------------------------------------------------------
-- 12. Park managers load through the Environment's own require copy
-----------------------------------------------------------------------
-- The game's Environment module takes `local require = require` before the
-- mod boots, so managers never pass the require hook; the patches must apply
-- in _LoadManagerModule, before the manager instance (and its cached phase
-- functions) exist. In game the Kin frame hook was never installed (2026-10-15).
local tRawModules = { ["managers.testmanager"] = { Advance = function() return "original" end } }
local Environment = { _LoadManagerModule = function(self, sName) return tRawModules[string.lower(sName)] end }
package.loaded["environment.environment"] = nil
package.preload["environment.environment"] = nil
package.loaded["environment.environment"] = Environment
require("Environment.Environment") -- first load through the hooked require applies the Core patch
local bPatched = false
Core:AddModulePatch("Managers.TestManager", function(t)
	bPatched = true
	local fn = t.Advance
	t.Advance = function(...) return "patched:" .. fn(...) end
end)
check(not bPatched, "manager not patched before it is loaded")
local oEnv = setmetatable({}, { __index = Environment })
local tMgr = oEnv:_LoadManagerModule("Managers.TestManager")
check(bPatched and tMgr.Advance() == "patched:original", "manager patched as the environment loads it")

-----------------------------------------------------------------------
-- 13. Guards: the game's Move screen with a stale selection
-----------------------------------------------------------------------
-- ModeHelper (loaded before the mod) requires its modes with its own require
-- copy, so the Move mode reaches the guard through the SetModes sweep.
local tMoveModeRaw = {}
tMoveModeRaw.SetupAnimalMovementContext = function(self)
	local tSpeciesCounts = {}
	if not self.bFailedToVerify then
		for _, guid in pairs(self.tSelectedAnimals) do
			local sSpecies = self.animalsAPI:GetSpeciesFromGUID(guid)
			tSpeciesCounts[sSpecies] = (tSpeciesCounts[sSpecies] or 0) + 1 -- game: errors on nil
		end
	end
	self.tCounts = tSpeciesCounts
end
local ModeHelper = { SetModes = function(self, tModes) self.tModes = tModes end }
package.loaded["gamehelpers.modehelper"] = ModeHelper
Core.tPatched["gamehelpers.modehelper"] = nil
Core:_ApplyPatches("gamehelpers.modehelper", ModeHelper)
check(package.loaded["editors.animal.animalmovementeditmode"] == nil, "move mode not loaded yet")
-- the engine's require copy: loads without passing the hook
package.preload["editors.animal.animalmovementeditmode"] = function() return tMoveModeRaw end
local oHelper = setmetatable({}, { __index = ModeHelper })
oHelper:SetModes({ AnimalMovementMode = "Editors.Animal.AnimalMovementEditMode" })
check(oHelper.tModes ~= nil, "SetModes still runs the game's original")
local MoveMode = package.loaded["editors.animal.animalmovementeditmode"]
check(MoveMode == tMoveModeRaw, "move mode loaded by the sweep")

local tSpeciesByGUID = { a = "Lion", b = "Lion" }
local tMoveAnimals = { GetSpeciesFromGUID = function(self, guid) return tSpeciesByGUID[guid] end }
local function newMove(tGUIDs)
	return setmetatable({ animalsAPI = tMoveAnimals, tSelectedAnimals = tGUIDs }, { __index = MoveMode })
end
local nReportsBefore = #package.loaded["pz2qol.errors"].tEntries
local oMove = newMove({ "a", "b" })
local bMoveOk = pcall(oMove.SetupAnimalMovementContext, oMove)
check(bMoveOk and oMove.tCounts.Lion == 2 and not oMove.bFailedToVerify, "known selection: the game's own count, untouched")
oMove = newMove({ "a", "gone" })
bMoveOk = pcall(oMove.SetupAnimalMovementContext, oMove)
check(bMoveOk, "stale selection no longer crashes")
check(oMove.bFailedToVerify == true, "stale selection goes the game's own failed-verification way")
local tReports = package.loaded["pz2qol.errors"].tEntries
check(#tReports == nReportsBefore + 1 and tReports[#tReports].sTitle == "Move cancelled to prevent a crash", "player told why the move was cancelled")
oHelper:SetModes({ AnimalMovementMode = "Editors.Animal.AnimalMovementEditMode" })
oMove = newMove({ "a" })
pcall(oMove.SetupAnimalMovementContext, oMove)
check(oMove.tCounts.Lion == 1, "guard applied once, not stacked by a second sweep")

-----------------------------------------------------------------------
-- 14. SaveTrace: autosave chain breadcrumbs (debug builds only)
-----------------------------------------------------------------------
local SaveTrace = package.loaded["pz2qol.savetrace"]
check(SaveTrace ~= nil and package.loaded["managers.parkloadsavemanager"] == nil, "save trace idle without a debug build")
local tSaveMarks = {}
local fnMark, fnMarkNumber, bTraceWas = Core.Mark, Core.MarkNumber, Core.bTrace
Core.bTrace = true
Core.Mark = function(self, s) tSaveMarks[#tSaveMarks + 1] = s end
Core.MarkNumber = function(self, s, n) tSaveMarks[#tSaveMarks + 1] = s .. "=" .. tostring(n) end
local tArmed = {}
api.save = {
	SetAutosave = function(cToken, tInfo) tArmed[#tArmed + 1] = tInfo.interval; return true end,
	GetNumAutosaveSlotsForType = function() return 3 end,
}
local PLSM = {}
PLSM.SelectAppropriateAutosaveSlot = function(self) self:OnAutosaveComplete() end
PLSM.OnAutosaveComplete = function(self, tDetails)
	if not self.autosaveCoroutine then
		self.autosaveCoroutine = coroutine.create(function() self:_SelectAppropriateAutosaveSlot(tDetails) end)
	end
end
PLSM._SelectAppropriateAutosaveSlot = function(self)
	local nSlots = api.save.GetNumAutosaveSlotsForType("zooauto")
	coroutine.yield()
	api.save.SetAutosave("token", { interval = self.nAutoSaveInterval })
	return nSlots
end
PLSM.ClearAutosaveSlot = function(self) end
SaveTrace:Init(Core)
package.loaded["managers.parkloadsavemanager"] = PLSM
Core:ApplyLoadedPatches()
local function hasMark(s)
	for _, m in ipairs(tSaveMarks) do if m == s then return true end end
	return false
end
local oPLSM = setmetatable({ nAutoSaveInterval = 120 }, { __index = PLSM })
oPLSM:SelectAppropriateAutosaveSlot()
check(hasMark("save_patched") and hasMark("save_arm") and hasMark("save_interval=120"), "arming marked with the interval")
coroutine.resume(oPLSM.autosaveCoroutine)
check(hasMark("save_select_begin") and hasMark("save_slots=3") and not hasMark("save_select_end"), "select marked across its yield")
local bResumed = coroutine.resume(oPLSM.autosaveCoroutine)
check(bResumed and hasMark("save_select_end") and hasMark("save_api_set") and tArmed[1] == 120, "next autosave armed through the original")
oPLSM:OnAutosaveComplete({})
check(hasMark("save_cb") and hasMark("save_cb_busy"), "a callback while the old coroutine lives is marked busy")
oPLSM:OnAutosaveComplete({ exception = "disk" })
check(hasMark("save_cb_error"), "failed autosave marked")
Core.Mark, Core.MarkNumber, Core.bTrace = fnMark, fnMarkNumber, bTraceWas

-----------------------------------------------------------------------
-- 15. Autosave: the mod's own clock, carried across hub trips
-----------------------------------------------------------------------
local Autosave = package.loaded["pz2qol.autosave"]
check(Autosave ~= nil and Autosave.bAvailable == false and Autosave.nMinutes == 0, "no RequestAutosave in the API: the game's own behaviour")
local nClock = 1000
local fnTimerWas = api.time.GetPerformanceTimer
api.time.GetPerformanceTimer = function() return nClock end -- seconds (the mock's PerformanceTimeToMilliseconds multiplies by 1000)
local tAsCalls = { request = 0, reset = 0 }
local vRequestResult = true
api.player = { GetGameOwner = function() return "owner" end }
api.save = {
	ID_Zoo = 1, ID_ZooAutosave = 2,
	GetIdentForSaveID = function(n) return n == 1 and "zoo" or "zooauto" end,
	RequestAutosave = function(oPlayer, sIdent) tAsCalls.request = tAsCalls.request + 1; tAsCalls.sIdent = sIdent; return vRequestResult end,
	ResetAutosaveTimer = function() tAsCalls.reset = tAsCalls.reset + 1 end,
	SetAutosave = function() return true end,
	SetNewAutosave = function() return true end,
	UnsetAutosave = function() end,
	RequestSave = function() return true end,
}
local PLSM2 = { OnAutosaveComplete = function(self, tDetails) self.nCallbacks = (self.nCallbacks or 0) + 1 end }
local HMM = { Advance = function() return "advanced" end }
Autosave:Init(Core)
check(Autosave.bAvailable and Autosave.nMinutes == 5, "available, every 5 minutes by default")
package.loaded["managers.parkloadsavemanager"] = PLSM2
package.loaded["managers.heatmapmanager"] = HMM
Core.tPatched["managers.parkloadsavemanager"] = nil
Core.tPatched["managers.heatmapmanager"] = nil
Core:ApplyLoadedPatches()
local oAsView = setmetatable({}, { __index = ViewWrapper })
oAsView.view = "asview"
Autosave:Attach(oAsView)
local function frames(n)
	for _ = 1, n do
		nClock = nClock + 1
		HMM.Advance({})
	end
end
local oMgr2 = setmetatable({}, { __index = PLSM2 })

check(Autosave:ClampMinutes(1) == 2 and Autosave:ClampMinutes(0) == 0 and Autosave:ClampMinutes(500) == 60 and Autosave:ClampMinutes(3.4) == 3 and Autosave:ClampMinutes("x") == 0, "interval: off or 2..60 minutes")
fireUI(oAsView, "PZ2QoL_AutosaveSet", 1)
check(Autosave.nMinutes == 2, "the UI cannot go below 2 minutes")
fireUI(oAsView, "PZ2QoL_AutosaveSet", 5)

-- park opens: the game arms its autosave
frames(10)
check(tAsCalls.request == 0, "no request before the game arms an autosave")
api.save.SetNewAutosave("owner", "zooauto", {})
check(Autosave.bArmed, "armed by SetNewAutosave")
Autosave.nElapsed = 0
frames(295)
check(tAsCalls.request == 0, "nothing before 5 minutes in the park")
frames(10)
check(tAsCalls.request == 1 and tAsCalls.sIdent == "zooauto", "autosave requested with the game's own call after 5 minutes")
frames(30)
check(tAsCalls.request == 1, "one request at a time")
oMgr2:OnAutosaveComplete({ save = "slot" })
check(oMgr2.nCallbacks == 1, "the game's callback still runs")
check(Autosave.nElapsed == 0 and Autosave.sLastKind == "mod" and tAsCalls.reset == 1, "our save: clock back to 0, the game's timer reset")
check(not Autosave.bArmed, "waits for the game to arm the next slot")
api.save.SetAutosave("token", {})

-- a hub trip: the game cancels its autosave; our clock keeps what it had
frames(200)
local nBefore = Autosave.nElapsed
api.save.UnsetAutosave("owner", "zooauto")
nClock = nClock + 600 -- ten minutes in the hub, no park frames
frames(1)
check(Autosave.nElapsed - nBefore <= 2, "time in the hub does not count")
api.save.SetAutosave("token", {})
frames(20)
check(tAsCalls.request == 1, "clock carried over, not yet due")
frames(100)
check(tAsCalls.request == 2, "due save made after the trip instead of starting again")
oMgr2:OnAutosaveComplete({})
api.save.SetAutosave("token", {})

-- the game's own autosave and manual saves also reset the clock
frames(100)
oMgr2:OnAutosaveComplete({})
check(Autosave.nElapsed == 0 and Autosave.sLastKind == "game", "the game's own autosave counts")
api.save.SetAutosave("token", {})
frames(100)
api.save.RequestSave("owner", { type = "player" })
check(Autosave.nElapsed >= 100, "a player-profile save is not a zoo save")
api.save.RequestSave("token", { type = "zoo" })
check(Autosave.nElapsed == 0 and Autosave.sLastKind == "manual", "a manual zoo save counts")

-- failures: shown once, retried after a minute
local nReportsAs = #package.loaded["pz2qol.errors"].tEntries
vRequestResult = false
Autosave.nElapsed = 300
frames(1)
check(tAsCalls.request == 3 and Autosave.sLastError ~= "", "refused request recorded")
frames(30)
check(tAsCalls.request == 3, "no retry within a minute")
frames(31)
check(tAsCalls.request == 4, "retried after a minute")
local tAsReports = package.loaded["pz2qol.errors"].tEntries
check(#tAsReports == nReportsAs + 2 and tAsReports[#tAsReports - 1].bShow and not tAsReports[#tAsReports].bShow, "the same failure is shown once, then only logged")
vRequestResult = true

-- off: never requests; Save now still works
fireUI(oAsView, "PZ2QoL_AutosaveSet", 0)
Autosave.nElapsed = 5000
frames(120)
check(tAsCalls.request == 4, "off: no autosave requests")
fireUI(oAsView, "PZ2QoL_AutosaveNow")
check(tAsCalls.request == 5 and Autosave.nPendingSince ~= nil, "Save now asks the game at once")
oMgr2:OnAutosaveComplete({})

-- state for the page
local tAsState = nil
for i = #tCalls, 1, -1 do
	local c = tCalls[i]
	if c.sName == "Trigger" and c.tArgs[1] == "PZ2QoL_AutosaveState" then tAsState = c.tArgs[2] break end
end
check(type(tAsState) == "string" and tAsState:find('"minutes":0', 1, true) and tAsState:find('"lastKind":"mod"', 1, true), "state sent to the page as JSON")
api.time.GetPerformanceTimer = fnTimerWas

-----------------------------------------------------------------------
-- 16. PlayerStore: the 2026-10-16 probe's leftovers removed once, from the hub
-----------------------------------------------------------------------
local PlayerStore16 = package.loaded["pz2qol.playerstore"]
check(package.loaded["pz2qol.playerprobe"] == nil, "the debug probe is gone")
local tPlayerData = { PZ2QoL = { Probe = '{"run":4}', Big = string.rep("x", 12000) }, Other = 1 }
local tFakePlayer = {
	GetData = function(self, a, b) if b == nil then return tPlayerData[a] end return tPlayerData[a] and tPlayerData[a][b] end,
	SetData = function(self, v, a, b) tPlayerData[a] = tPlayerData[a] or {}; tPlayerData[a][b] = v end,
}
local nKey16 = 0
package.loaded["database.gamedatabase"] = { GetPlayerKey = function() return nKey16 end, GetPlayer = function(n) return n == 1 and tFakePlayer or nil end }
local nSaveMain = 0
api.save.RequestSaveMainPlayer = function() nSaveMain = nSaveMain + 1 end
PlayerStore16.bCleaned = false
PlayerStore16:Cleanup()
check(not PlayerStore16.bCleaned and tPlayerData.PZ2QoL.Big ~= nil and nSaveMain == 0, "no player yet: tried again later")
nKey16 = 1
PlayerStore16:Cleanup()
check(tPlayerData.PZ2QoL.Probe == nil and tPlayerData.PZ2QoL.Big == nil and tPlayerData.Other == 1, "Probe and Big removed, nothing else touched")
check(nSaveMain == 1, "the cleanup is saved")
tPlayerData.PZ2QoL.Probe = "again"
PlayerStore16:Cleanup()
check(nSaveMain == 1 and tPlayerData.PZ2QoL.Probe == "again", "once per session")
PlayerStore16.bCleaned = false
PlayerStore16:Cleanup()
tPlayerData.PZ2QoL = { Assign = {} }
PlayerStore16.bCleaned = false
local nBefore16 = nSaveMain
PlayerStore16:Cleanup()
check(nSaveMain == nBefore16, "nothing to clean: no save request")

-----------------------------------------------------------------------
-- 17. Auto mode's gate (PZ2QoL_AutoGate): read-only facts, always answered
-----------------------------------------------------------------------
-- a function, not just do ... end: the main chunk is at Lua's 200-local limit
-- and a do block's locals still count against it
do (function()
	local Kin17 = package.loaded["pz2qol.kin"]
	local Send17 = package.loaded["pz2qol.storagesend"]
	check(oHUD.tListeners and oHUD.tListeners["PZ2QoL_AutoGate"] ~= nil, "gate: listener on the park HUD page")
	check(Core.StorageSend == Send17, "gate: StorageSend registered on Core")
	local nClock17 = 5000.25
	local fnTimerWas17 = api.time.GetPerformanceTimer
	api.time.GetPerformanceTimer = function() return nClock17 end
	local function gate(sReq)
		tCalls = {}
		fireUI(oHUD, "PZ2QoL_AutoGate", sReq)
		local t = calls("Trigger")
		check(#t == 1 and t[1].tArgs[1] == "PZ2QoL_AutoGateResult" and t[1].tArgs[2] == sReq, "gate: one answer for " .. sReq)
		return t[1] and jsonDecode(t[1].tArgs[3]) or {}, t[1] and t[1].tArgs[3] or ""
	end

	-- no park, no movement API, no mode seen yet
	local tHMWas, nTickWas = Kin17.oHeatMapManager, Kin17.nLastTick
	Kin17.oHeatMapManager, Kin17.nLastTick = nil, nil
	Send17.sLastUIMode = nil
	local tG, sG = gate("g1")
	check(tG.park == false and tG.gameMode == "unknown" and tG.uiMode == "" and tG.t == 5000, "gate: no park (" .. sG .. ")")
	check(tG.move == nil and tG.dbBusy == nil and tG.tcMax == nil and tG.tcCount == nil, "gate: unknown facts omitted")

	-- a park (offline), movement allowed, nothing pending
	local bMove, bBusy = true, false
	api.planetHub.IsPlayerAnimalMovementEnabled = function() return bMove end
	local nHubType = 1
	local tGateWorld = {
		franchise = {
			PlanetHubType_FranchiseOnline = 2,
			GetPlanetHubType = function() return nHubType end,
			IsDatabaseOperationInProgress = function() return bBusy, 28 end,
		},
		park = {
			GetTradeCentreMaxCapacity = function() return 20 end,
			GetNumberOfAnimalsInTradeCentre = function() return 3 end,
		},
	}
	Kin17.oHeatMapManager, Kin17.nLastTick = { tWorldAPIs = tGateWorld }, nClock17
	tG, sG = gate("g2")
	check(tG.park == true and tG.gameMode == "offline" and tG.move == true and tG.dbBusy == false, "gate: offline park (" .. sG .. ")")
	check(tG.tcMax == 20 and tG.tcCount == 3, "gate: trade centre capacity and count")
	-- the park calendar: the real date and the month's length; an invalid
	-- date or a throwing call leaves the fields out
	check(tG.year == nil and tG.month == nil and tG.monthSec == nil, "gate: no calendar calls, no calendar fields")
	local tDate17 = { y = 3, m = 7, p = 0.25, valid = true }
	tGateWorld.park.GetTimeOfMonth = function()
		return {
			Valid = function() return tDate17.valid end,
			Year = function() return tDate17.y end,
			Month = function() return tDate17.m end,
			Prop = function() return tDate17.p end,
		}
	end
	tGateWorld.park.GetMonthDurationInSeconds = function() return 150 end
	tG, sG = gate("g2e")
	check(tG.year == 3 and tG.month == 7 and tG.monthProp == 0.25 and tG.monthSec == 150, "gate: the calendar (" .. sG .. ")")
	tDate17.valid = false
	tG = gate("g2f")
	check(tG.year == nil and tG.monthSec == 150, "gate: an invalid date is left out")
	tDate17.valid = true
	tGateWorld.park.GetTimeOfMonth = function() error("boom") end
	tG = gate("g2g")
	check(tG.year == nil and tG.park == true and tG.tcMax == 20, "gate: a failing date call changes nothing else")
	tGateWorld.park.GetTimeOfMonth, tGateWorld.park.GetMonthDurationInSeconds = nil, nil
	-- Franchise, the movement switch off (tutorial), a request in flight
	nHubType, bMove, bBusy = 2, false, true
	tG, sG = gate("g3")
	check(tG.gameMode == "franchise" and tG.move == false and tG.dbBusy == true, "gate: franchise, movement off, busy (" .. sG .. ")")

	-- the current mode, recorded by the BaseUIMode wrapper, which still
	-- forwards every call exactly as before
	local tOrig17 = {}
	local BaseUIMode17 = { SetNewMode = function(sMode, tParams, x) tOrig17[#tOrig17 + 1] = { sMode, tParams, x }; return "ret:" .. tostring(sMode) end }
	package.loaded["editors.shared.baseuimode"] = BaseUIMode17
	Core.tPatched["editors.shared.baseuimode"] = nil
	Core:ApplyLoadedPatches()
	local tParams17 = { tSelectedAnimals = { 1, 2 } }
	local r = BaseUIMode17.SetNewMode("AnimalMovementMode", tParams17, "extra")
	check(r == "ret:AnimalMovementMode" and #tOrig17 == 1 and tOrig17[1][1] == "AnimalMovementMode" and tOrig17[1][2] == tParams17 and tOrig17[1][3] == "extra", "gate: the wrapped SetNewMode forwards arguments and result")
	tG = gate("g4")
	check(tG.uiMode == "AnimalMovementMode", "gate: uiMode is the last mode set")
	BaseUIMode17.SetNewMode("SelectMode")
	tG = gate("g5")
	check(tG.uiMode == "SelectMode" and #tOrig17 == 2, "gate: uiMode follows the next mode")
	-- found through package.loaded when Core has no entry
	Core.StorageSend = nil
	tG = gate("g6")
	check(tG.uiMode == "SelectMode", "gate: StorageSend found through package.loaded")
	Core.StorageSend = Send17

	-- failing or missing calls: still one answer, without those facts
	api.planetHub.IsPlayerAnimalMovementEnabled = function() error("boom") end
	tGateWorld.franchise.IsDatabaseOperationInProgress = function() error("boom") end
	tGateWorld.park = {}
	tG, sG = gate("g7")
	check(tG.park == true and tG.move == nil and tG.dbBusy == nil, "gate: erroring calls leave move and dbBusy out (" .. sG .. ")")
	check(tG.tcMax == nil and tG.tcCount == nil, "gate: missing trade centre calls leave tcMax and tcCount out")
	api.planetHub.IsPlayerAnimalMovementEnabled = nil
	tGateWorld.franchise = nil
	tG, sG = gate("g8")
	check(tG.park == true and tG.move == nil and tG.dbBusy == nil and tG.gameMode == "unknown", "gate: no franchise API, no movement API (" .. sG .. ")")
	-- a stale tick: the park is not counted as running
	nClock17 = nClock17 + 5
	tG = gate("g9")
	check(tG.park == false, "gate: no fresh park tick, no park")

	Kin17.oHeatMapManager, Kin17.nLastTick = tHMWas, nTickWas
	api.time.GetPerformanceTimer = fnTimerWas17
end)() end

print(string.format("%d passed, %d failed", nPassed, nFailed))
os.exit(nFailed == 0 and 0 or 1)
