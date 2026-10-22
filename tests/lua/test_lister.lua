-- Behaviour test for PZ2QoL.Lister (the Market desk's listing engine)
-- against a mock of the game: api.planetHub, the hub DataStore, the
-- franchise API and MsgType_DatabaseErrorMessage. Run:
--   lua53 tests/lua/test_lister.lua <path-to-mods/PZ2QoL/Main/>
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

function module(sName, tBase)
	local t = tBase or {}
	package.loaded[string.lower(sName)] = t
	return t
end
local fnOriginalRequire = require
table.insert(package.searchers, 2, function(sName)
	local sPath = sModDir .. string.lower(sName) .. ".lua"
	local f = io.open(sPath, "r")
	if not f then return nil end
	f:close()
	return function(sModName) return assert(loadfile(sPath))(sModName) end, sPath
end)
require = function(sName)
	local sKey = string.lower(sName)
	if package.loaded[sKey] ~= nil then return package.loaded[sKey] end
	local tMod = fnOriginalRequire(sKey)
	return package.loaded[sKey] or tMod
end

-----------------------------------------------------------------------
-- A small JSON decoder (null -> JNULL, so a present null can be checked)
-----------------------------------------------------------------------
local JNULL = setmetatable({}, { __tostring = function() return "null" end })
local function decode(s)
	local pos = 1
	local function ws() pos = string.find(s, "[^ \t\r\n]", pos) or #s + 1 end
	local function str()
		local out = {}
		pos = pos + 1
		while true do
			local c = string.sub(s, pos, pos)
			if c == '"' then
				pos = pos + 1
				return table.concat(out)
			elseif c == "\\" then
				local e = string.sub(s, pos + 1, pos + 1)
				if e == "u" then
					out[#out + 1] = utf8.char(tonumber(string.sub(s, pos + 2, pos + 5), 16))
					pos = pos + 6
				else
					out[#out + 1] = ({ n = "\n", t = "\t", r = "\r", b = "\b", f = "\f" })[e] or e
					pos = pos + 2
				end
			elseif c == "" then
				error("unterminated string")
			else
				out[#out + 1] = c
				pos = pos + 1
			end
		end
	end
	local value
	value = function()
		ws()
		local c = string.sub(s, pos, pos)
		if c == "{" then
			pos = pos + 1
			local t = {}
			ws()
			if string.sub(s, pos, pos) == "}" then pos = pos + 1 return t end
			while true do
				ws()
				local k = str()
				ws()
				assert(string.sub(s, pos, pos) == ":", "expected : at " .. pos)
				pos = pos + 1
				t[k] = value()
				ws()
				local d = string.sub(s, pos, pos)
				pos = pos + 1
				if d == "}" then return t end
				assert(d == ",", "bad object at " .. pos)
			end
		elseif c == "[" then
			pos = pos + 1
			local t = {}
			ws()
			if string.sub(s, pos, pos) == "]" then pos = pos + 1 return t end
			while true do
				t[#t + 1] = value()
				ws()
				local d = string.sub(s, pos, pos)
				pos = pos + 1
				if d == "]" then return t end
				assert(d == ",", "bad array at " .. pos)
			end
		elseif c == '"' then
			return str()
		elseif string.sub(s, pos, pos + 3) == "true" then
			pos = pos + 4
			return true
		elseif string.sub(s, pos, pos + 4) == "false" then
			pos = pos + 5
			return false
		elseif string.sub(s, pos, pos + 3) == "null" then
			pos = pos + 4
			return JNULL
		end
		local n = string.match(s, "^-?%d+%.?%d*[eE]?[-+]?%d*", pos)
		assert(n and n ~= "", "bad value at " .. pos .. " in " .. s)
		pos = pos + #n
		return math.tointeger(tonumber(n)) or tonumber(n)
	end
	local v = value()
	ws()
	assert(pos > #s, "trailing data")
	return v
end

-----------------------------------------------------------------------
-- Mock game
-----------------------------------------------------------------------
local nClock = 1000
local DT = 0.05
local tCalls = {}
local function record(sName, ...) tCalls[#tCalls + 1] = { sName = sName, t = nClock, tArgs = table.pack(...) } end
local function calls(sName)
	local t = {}
	for _, c in ipairs(tCalls) do if c.sName == sName then t[#t + 1] = c end end
	return t
end

-- The storage: tOrder[i] is the GUID behind row key animal_<i> (keys are
-- positions); tAnimals[guid] the row and what the native does for it.
local tAnimals, tOrder = {}, {}
local function keyOf(g)
	for i, x in ipairs(tOrder) do if x == g then return "animal_" .. i end end
	return nil
end
local function guidAt(sKey)
	local i = tonumber(string.match(tostring(sKey), "^animal_(%d+)$") or "")
	return i and tOrder[i] or nil
end
local function gs(g)
	if math.type(g) == "float" then return string.format("%d", g) end
	return tostring(g)
end
local function reshuffle(tNew) tOrder = tNew end

local tNative
-- what the native's per-animal calls make of an id
local function guidForNative(sId)
	if tNative and tNative.bIdOther then
		local g = tonumber(string.match(tostring(sId), "^id_(%d+)$") or "")
		if g ~= nil then
			for _, x in ipairs(tOrder) do if x == g then return x end end
			return nil
		end
		-- a row key passed as an id: another animal (the next one along)
		local i = tonumber(string.match(tostring(sId), "^animal_(%d+)$") or "")
		if i == nil or #tOrder == 0 then return nil end
		return tOrder[i % #tOrder + 1]
	end
	return guidAt(sId)
end
local tTimers = {}
local function after(nDelay, fn) tTimers[#tTimers + 1] = { at = nClock + nDelay, fn = fn, n = #tTimers } end
local function nativeFrame()
	local tDue, tKeep = {}, {}
	for _, x in ipairs(tTimers) do
		if x.at <= nClock + 1e-9 then tDue[#tDue + 1] = x else tKeep[#tKeep + 1] = x end
	end
	tTimers = tKeep
	table.sort(tDue, function(a, b) if a.at ~= b.at then return a.at < b.at end return a.n < b.n end)
	for _, x in ipairs(tDue) do x.fn() end
end

local function defaultLimits()
	return { tradePriceMin = 100, tradePriceMax = 5000, tradePriceDefault = 800, tradeDurationMin = 1, tradeDurationMax = 12, tradeDurationDefault = 6 }
end
local function copy(t)
	local o = {}
	for k, v in pairs(t or {}) do o[k] = v end
	return o
end

local function addAnimal(g, t)
	t = t or {}
	tAnimals[g] = {
		timer = t.timer or -1, isMoving = t.isMoving == true, isPregnant = t.isPregnant == true, maturity = t.maturity or 2,
		tradeAllowed = t.tradeAllowed ~= false, reason = t.reason, limits = t.limits or defaultLimits(),
		noSelect = t.noSelect, selectError = t.selectError, sendError = t.sendError,
		outcome = t.outcome, onSelect = t.onSelect, aidType = t.aidType,
		quickOutcome = t.quickOutcome, quickDelay = t.quickDelay, quickError = t.quickError,
		-- the quick actions' fields the native writes for the selection (actions context)
		quick = t.quick,
		-- what StorageGetIDAndAIDType returns for its key (default: the GUID, 2)
		aidFn = t.aidFn, name = t.name, species = t.species, gender = t.gender, source = t.source,
	}
	tOrder[#tOrder + 1] = g
end

local tReceivers = {}
local MSG_DB_ERROR = 77
local function serverError(nError, nRequestType)
	tReceivers[MSG_DB_ERROR]({ { nError = nError, nRequestType = nRequestType } })
end
local function errorAt(nDelay, nError, nRequestType)
	after(nDelay, function() serverError(nError, nRequestType) end)
end
local function listNow(g, nHours)
	tAnimals[g].timer = (nHours or 12) * 3600
	-- the native clears the selection on success (inferred from the UI)
	tNative.tSelection = {}
end
local function listAt(nDelay)
	return function(g, nHours) after(nDelay, function() listNow(g, nHours) end) end
end
local function never() return function() end end

local function resetNative()
	tNative = {
		tSelection = {}, tActions = {}, tLimits = {},
		bConnecting = false, bLoading = false, bDbBusy = false, vRequests = 0, nHubType = 2,
		nSelectDelay = 0.15, nDataDelay = 0.25, nListDelay = 0.5,
		bSelUnreadable = false, bListUnreadable = false, bRowCtxUnreadable = false,
		-- in game: selectedAnimalIDs read from Lua stays empty, the row's
		-- own `selected` flag is right (Y: 2026-10-17)
		bSelArrayEmpty = false, bNoRowFlag = false,
		-- the row id differs from the row key (as in game): SelectItem
		-- takes the id (a key there selects another animal),
		-- GetIDAndAIDType the key (an id finds nothing)
		bIdOther = false,
		-- Lua's own reads broken in other ways (the page still sees the truth):
		-- the flag nil and the array empty; the flag always false; tradeAllowed
		-- and the limits nil
		bLuaSelBroken = false, bLuaFlagFalse = false, bLuaDataBroken = false,
		nGoneDelay = 0.33,
	}
end
resetNative()

-- a quick trade / release as the native does it (Phase 0b, Y: 2026-10-18):
-- the row leaves the storage list ~0.33 s later; a.quickOutcome "stay"
-- keeps it, a function does something else; a.quickError raises
local function quickAct(t)
	local sKey = type(t) == "table" and t[1] or nil
	local g = sKey and guidAt(sKey)
	local a = g and tAnimals[g]
	if a == nil then return end
	if a.quickError then error("quick call blew up") end
	if a.quickOutcome == "stay" then return end
	if type(a.quickOutcome) == "function" then return a.quickOutcome(g) end
	after(a.quickDelay or tNative.nGoneDelay, function()
		local tNew = {}
		for _, x in ipairs(tOrder) do if x ~= g then tNew[#tNew + 1] = x end end
		tOrder = tNew
		tNative.tSelection = {}
	end)
end
local tAuctions = {}
local planetHub = {
	StorageGetIDAndAIDType = function(sKey)
		local g = guidAt(sKey)
		if g ~= nil and tAnimals[g] and tAnimals[g].aidFn then return tAnimals[g].aidFn(sKey) end
		if g ~= nil then return g, (tAnimals[g] and tAnimals[g].aidType) or 2 end
		return 0, 0
	end,
	StorageUIClearSelectedItems = function()
		record("Clear")
		tNative.tSelection = {}
		-- a native that also empties the selection's data on Clear (unknown in game)
		if tNative.bClearResets then tNative.tActions, tNative.tLimits = {}, {} end
	end,
	StorageUISelectItem = function(sId)
		local g = guidForNative(sId)
		-- the selection holds the row key of the animal selected
		local sKey = g and keyOf(g) or sId
		record("Select", sKey, g)
		local a = g and tAnimals[g]
		if a and a.selectError then error("select blew up") end
		if a == nil or a.noSelect then return end
		-- the selection, then its data, a few frames later; until then the
		-- previous animal's data stays (the worst case)
		after(tNative.nSelectDelay, function() tNative.tSelection = { sKey } end)
		after(tNative.nDataDelay, function()
			tNative.tActions = { tradeAllowed = a.tradeAllowed, tradeDisallowedReason = a.reason }
			for k, v in pairs(a.quick or {}) do tNative.tActions[k] = v end
			tNative.tLimits = copy(a.limits)
		end)
		if a.onSelect then a.onSelect(sKey, g) end
	end,
	-- the permanent quick actions: the engine must never call them (Phase 1)
	StorageUIQuickTradeAnimals = function(...) record("QuickTrade", ...); quickAct(...) end,
	StorageUIReleaseAnimalsToWild = function(...) record("Release", ...); quickAct(...) end,
	StorageUIStartAnimalAuction = function(sKey, nPrice, nHours)
		local g = guidAt(sKey)
		tAuctions[#tAuctions + 1] = { key = sKey, price = nPrice, hours = nHours, guid = g, t = nClock }
		record("Auction", sKey, nPrice, nHours)
		local a = g and tAnimals[g]
		if a and a.sendError then error("auction call blew up") end
		local fn = a and a.outcome or listAt(tNative.nListDelay)
		fn(g, nHours)
	end,
}

-- DataStore: contexts are { sPath }; only the ones the native made exist.
local tRoots = {
	["hubAnimalsData"] = true, ["hubAnimalsData/animalStorageData"] = true,
	["hubAnimalsData/animalStorageData/list"] = true, ["hubAnimalsData/animalStorageData/actions"] = true,
	["hubAnimalsData/network"] = true, ["animalTradeListingData"] = true,
}
local function exists(sPath)
	if tRoots[sPath] then return true end
	local sKey = string.match(sPath, "^hubAnimalsData/animalStorageData/list/(animal_%d+)$")
	return sKey ~= nil and guidAt(sKey) ~= nil and not tNative.bRowCtxUnreadable
end
local function rowTable(sKey)
	local a = tAnimals[guidAt(sKey)]
	local bSelected = nil
	if not tNative.bNoRowFlag and not tNative.bLuaSelBroken then
		bSelected = false
		for _, k in ipairs(tNative.tSelection) do if k == sKey then bSelected = true end end
		if tNative.bLuaFlagFalse then bSelected = false end
	end
	return { id = tNative.bIdOther and ("id_" .. gs(guidAt(sKey))) or sKey, auctionTimerSeconds = a.timer, auctionPrice = a.auctionPrice, isMoving = a.isMoving, isPregnant = a.isPregnant, maturity = a.maturity, name = a.name or "Animal", species = a.species, gender = a.gender, selected = bSelected, source = a.source }
end
local ui2 = {
	GetNoCreateDataStoreContext = function(a, ...)
		local tParts = { type(a) == "table" and a.sPath or a }
		for _, s in ipairs({ ... }) do tParts[#tParts + 1] = s end
		local sPath = table.concat(tParts, "/")
		if exists(sPath) then return { sPath = sPath } end
		return nil
	end,
	GetDataStoreContext = function(...) record("CreateContext", ...) return { sPath = table.concat({ ... }, "/") } end,
	GetDataStoreElement = function(ctx, sName)
		local p = ctx.sPath
		if p == "hubAnimalsData/animalStorageData" and sName == "selectedAnimalIDs" then
			if tNative.bSelUnreadable then return nil end
			if tNative.bSelArrayEmpty or tNative.bLuaSelBroken or tNative.bLuaFlagFalse then return {} end
			return copy(tNative.tSelection)
		elseif p == "hubAnimalsData/animalStorageData/actions" then
			if tNative.bLuaDataBroken then return nil end
			return tNative.tActions[sName]
		elseif p == "animalTradeListingData" then
			if tNative.bLuaDataBroken then return nil end
			return tNative.tLimits[sName]
		elseif p == "hubAnimalsData/network" then
			if sName == "connectingAction" then return tNative.bConnecting end
			if sName == "loadingItems" then return tNative.bLoading end
		else
			local sKey = string.match(p, "^hubAnimalsData/animalStorageData/list/(animal_%d+)$")
			if sKey and guidAt(sKey) then return rowTable(sKey)[sName] end
		end
		return nil
	end,
	GetDataStoreContextAsTable = function(ctx)
		if ctx.sPath == "hubAnimalsData/animalStorageData/list" then
			if tNative.bListUnreadable then error("not a table") end
			-- when the list was read (no read may fall in the rebuild after a quick send)
			tNative.tListReads = tNative.tListReads or {}
			tNative.tListReads[#tNative.tListReads + 1] = nClock
			local t = {}
			for i in ipairs(tOrder) do t["animal_" .. i] = rowTable("animal_" .. i) end
			return t
		end
		return nil
	end,
}

local franchise = {
	PlanetHubType_FranchiseOnline = 2,
	DatabaseError_Ok = 0, DatabaseError_Unknown = 255, DatabaseError_DidNotGetResponse = 2,
	DatabaseError_NotAllowed = 5, DatabaseError_NotEnoughCC = 8,
	GetPlanetHubType = function(self) return tNative.nHubType end,
	IsDatabaseOperationInProgress = function(self) return tNative.bDbBusy, 42 end,
	RequestsInProgress = function(self) return tNative.vRequests end,
}

api = {
	debug = { Trace = function(s) record("Trace", s) end },
	time = {
		GetPerformanceTimer = function() return nClock end,
		PerformanceTimeToMilliseconds = function(n) return n * 1000 end,
	},
	messaging = {
		MsgType_DatabaseErrorMessage = MSG_DB_ERROR,
		RegisterGlobalReceiver = function(nType, fn) tReceivers[nType] = fn end,
	},
	planetHub = planetHub,
	ui2 = ui2,
	world = { GetWorldAPIs = function() return { franchise = franchise } end },
}

-- the hub page: records Lua -> JS events (with the game time), fires JS -> Lua
local oView = { tListeners = {}, tSent = {} }
function oView:AddEventListener(sName, nArgs, fn, arg) self.tListeners[sName] = function(...) return fn(arg, ...) end end
function oView:TriggerEventAtNextAdvance(sName, ...) self.tSent[#self.tSent + 1] = { sName = sName, t = nClock, tArgs = table.pack(...) } end
function oView:IsReady() return true end
local function fire(sName, ...) return assert(oView.tListeners[sName], "no listener " .. sName)(...) end

package.loaded["pz2qol.hub"] = {
	bFrontEndIsModded = true, oFrontEndUI = oView,
	GetModUI = function() return nil end, GetModUIs = function() return {} end,
}
local tPatches = {}
local tMarks = {}
local Core = {
	AddModulePatch = function(_, sName, fn) tPatches[string.lower(sName)] = fn end,
	Mark = function(_, s) tMarks[#tMarks + 1] = s end,
	MarkNumber = function() end,
	Checkpoint = function() end,
	Trace = function() end,
}
package.loaded["pz2qol.core"] = Core

local Errors = require("PZ2QoL.Errors")
Errors:Init(Core)
check(type(Errors.AddServerErrorListener) == "function", "errors: listener list")
local Lister = require("PZ2QoL.Lister")
Lister:Init(Core)
check(#Errors.tServerErrorListeners == 1, "lister listens to server errors")
check(tPatches["startscreen.globe.animalstoragehubmode"] ~= nil, "patches AnimalStorageHubMode")

local StorageMode = {
	TransitionIn = function(self) record("StorageIn") end,
	TransitionOut = function(self) record("StorageOut") end,
	Advance = function(self) record("StorageAdvance") end,
	-- the game's quick handlers (one-line pass-throughs in 1.0.5): what they
	-- were called with, and what they return (the wrappers must pass both on)
	OnQuickTradeAnimals = function(...)
		record("GameQuickTrade", ...)
		if StorageModeThrow then error("game handler error") end
		return "qt", nil, 3
	end,
	OnReleaseAnimalsToWild = function(...)
		record("GameRelease", ...)
		return "rel"
	end,
}
local fnGameQuickTrade, fnGameRelease = StorageMode.OnQuickTradeAnimals, StorageMode.OnReleaseAnimalsToWild
tPatches["startscreen.globe.animalstoragehubmode"](StorageMode)
local oStorage = setmetatable({ tWorldAPIs = { franchise = franchise } }, { __index = StorageMode })

Lister:Attach(oView)
for _, s in ipairs({ "PZ2QoL_ListerHello", "PZ2QoL_ListerResolve", "PZ2QoL_ListerStart", "PZ2QoL_ListerStop", "PZ2QoL_ListerPace" }) do
	check(oView.tListeners[s] ~= nil, "listener " .. s)
end

-----------------------------------------------------------------------
-- Helpers
-----------------------------------------------------------------------
local fnPageFrame = nil -- the page's own frame (set by the page-assisted tests)
local function tick(n)
	for _ = 1, n or 1 do
		nClock = nClock + DT
		nativeFrame()
		oStorage:Advance(DT)
		if fnPageFrame then fnPageFrame() end
	end
end
local function seconds(s) tick(math.floor(s / DT + 0.5)) end
local function tickUntil(fn, nMax)
	local nEnd = nClock + (nMax or 60)
	while not fn() and nClock < nEnd do tick(1) end
	return fn()
end
local function runToEnd(nMax)
	return tickUntil(function() return Lister.tRun == nil end, nMax or 200)
end

local function sent(sName, nFrom)
	local t = {}
	for i = (nFrom or 0) + 1, #oView.tSent do
		local x = oView.tSent[i]
		if x.sName == sName then t[#t + 1] = x end
	end
	return t
end
-- decoded states sent after position nFrom (each with its game time in _t)
local function states(nFrom)
	local t = {}
	for _, x in ipairs(sent("PZ2QoL_ListerState", nFrom)) do
		local s = decode(x.tArgs[1])
		s._t = x.t
		t[#t + 1] = s
	end
	return t
end
local function lastState()
	local t = sent("PZ2QoL_ListerState")
	return t[#t] and decode(t[#t].tArgs[1]) or nil
end
-- when result i (1-based) first showed a final status
local function resultTime(tStates, i)
	for _, s in ipairs(tStates) do
		local r = s.results and s.results[i]
		if r and r.status ~= "pending" and r.status ~= "working" then return s._t, r end
	end
	return nil
end
local function stepsSeen(tStates)
	local t = {}
	for _, s in ipairs(tStates) do t[s.step] = true end
	return t
end
local function countMarks(sName)
	local n = 0
	for _, s in ipairs(tMarks) do if s == sName then n = n + 1 end end
	return n
end
local function job(nPace, tLines) return "v1 " .. nPace .. "\n" .. table.concat(tLines, "\n") end
local function line(g, sPrice, sHours, sKey) return gs(g) .. " " .. (sKey or keyOf(g) or "-") .. " " .. sPrice .. " " .. sHours end

local nReq = 0
local function reset()
	if Lister.tRun ~= nil then fire("PZ2QoL_ListerStop") end
	tAnimals, tOrder, tAuctions, tTimers, tCalls, tMarks = {}, {}, {}, {}, {}, {}
	oView.tSent = {}
	resetNative()
	Lister.nLastServer = nil
	-- far enough on that no pause is still running
	nClock = nClock + 100
end
local function start(sJob)
	nReq = nReq + 1
	local sReq = "req" .. nReq
	local nFrom = #oView.tSent
	fire("PZ2QoL_ListerStart", sReq, sJob)
	return sReq, nFrom
end

-----------------------------------------------------------------------
-- 1. Hello -> Caps
-----------------------------------------------------------------------
reset()
addAnimal(4400000000001)
addAnimal(12345.0) -- a float GUID (game Lua numbers are 32-bit floats: keep it exact)
addAnimal(77)
fire("PZ2QoL_ListerHello", "h1")
local tCaps = sent("PZ2QoL_ListerCaps")
check(#tCaps == 1 and tCaps[1].tArgs[1] == "h1", "caps answered with the request id")
local c = decode(tCaps[1].tArgs[2])
check(c.ok == true and #c.missing == 0 and c.storage == false and c.running == false and c.version == 1, "caps outside storage")
check(c.rows == JNULL and c.online == JNULL, "caps outside storage: rows and online unknown")
oStorage:TransitionIn()
fire("PZ2QoL_ListerHello", "h2")
c = decode(sent("PZ2QoL_ListerCaps")[2].tArgs[2])
check(c.ok == true and c.storage == true and c.rows == 3 and c.online == true, "caps in storage: rows " .. tostring(c.rows))
local fnSavedAuction = planetHub.StorageUIStartAnimalAuction
planetHub.StorageUIStartAnimalAuction = nil
fire("PZ2QoL_ListerHello", "h3")
c = decode(sent("PZ2QoL_ListerCaps")[3].tArgs[2])
check(c.ok == false and c.missing[1] == "api.planetHub.StorageUIStartAnimalAuction", "caps name a missing call")
planetHub.StorageUIStartAnimalAuction = fnSavedAuction
tNative.bListUnreadable = true
fire("PZ2QoL_ListerHello", "h4")
c = decode(sent("PZ2QoL_ListerCaps")[4].tArgs[2])
check(c.ok == false and c.missing[1] == "storageList" and c.rows == JNULL, "caps: unreadable list")
check(countMarks("lister_hello") == 4 and countMarks("lister_list_unreadable") == 1, "hello marks")
tNative.bListUnreadable = false

-----------------------------------------------------------------------
-- 2. Resolve: row keys -> exact GUID strings
-----------------------------------------------------------------------
fire("PZ2QoL_ListerResolve", "k1", "animal_1,animal_2, animal_3,animal_9")
local tIds = sent("PZ2QoL_ListerIds")
check(#tIds == 1 and tIds[1].tArgs[1] == "k1", "ids answered with the request id")
local r = decode(tIds[1].tArgs[2])
check(r.ids.animal_1 == "4400000000001" and r.ids.animal_2 == "12345" and r.ids.animal_3 == "77", "exact GUID strings (float GUID without .0)")
check(#r.failed == 1 and r.failed[1] == "animal_9", "unknown key failed")
oStorage:TransitionOut()
fire("PZ2QoL_ListerResolve", "k2", "animal_1")
r = decode(sent("PZ2QoL_ListerIds")[2].tArgs[2])
check(next(r.ids) == nil and r.failed[1] == "animal_1", "keys mean nothing outside storage")

-----------------------------------------------------------------------
-- 3. Refused starts
-----------------------------------------------------------------------
local _, nFrom = start(job(3000, { line(77, "500", "max") }))
local s = states(nFrom)[1]
check(s and s.refused == true and s.run == 0 and s.phase == "closed" and s.req == "req1", "refused outside storage")
check(#calls("Select") == 0 and Lister.tRun == nil, "nothing selected when refused")
oStorage:TransitionIn()
_, nFrom = start("v2 3000\n77 animal_3 500 max")
s = states(nFrom)[1]
check(s.refused == true and string.find(s.message, "v1", 1, true) ~= nil, "unknown job format refused")
_, nFrom = start("v1 3000\n77 animal_3 lots max")
check(states(nFrom)[1].refused == true, "bad price refused")
_, nFrom = start("v1 3000\n7;7 animal_3 500 max")
check(states(nFrom)[1].refused == true, "bad GUID refused")
_, nFrom = start("v1 3000\n")
check(states(nFrom)[1].refused == true, "empty job refused")
tNative.nHubType = 1
_, nFrom = start(job(3000, { line(77, "500", "max") }))
check(states(nFrom)[1].refused == true and Lister.tRun == nil, "refused outside online Franchise")
tNative.nHubType = 2
check(countMarks("lister_start_refused") == 6, "refusals marked")
oStorage:TransitionOut()

-----------------------------------------------------------------------
-- 4. A normal run: prices, clamps, integer arguments, pace
-----------------------------------------------------------------------
reset()
oStorage:TransitionIn()
addAnimal(101)
addAnimal(102)
addAnimal(103)
addAnimal(104)
addAnimal(105)
local sReq
sReq, nFrom = start(job(2000, {
	line(101, "1234", "max"),
	line(102, "99999", "default"),
	line(103, "-", "20"),
	line(104, "10", "0"),
	line(105, "1500.6", "3"),
}))
s = states(nFrom)[1]
check(s.phase == "running" and s.req == sReq and s.run >= 1 and s.total == 5 and s.index == 0 and s.paceMs == 2000, "run started")
check(s.results[1].status == "working" and s.results[2].status == "pending" and s.results[1].guid == "101", "first animal working")
check(s.results[2].capped == JNULL and s.results[2].kind == JNULL and s.results[2].usedDefault == false, "null fields present")
check(runToEnd(60), "run finished")
local tAll = states(nFrom)
s = tAll[#tAll]
check(s.phase == "done" and s.index == 5 and s.step == "", "done: " .. tostring(s.phase))
check(#tAuctions == 5, "five listings sent")
local tExpect = {
	{ 101, 1234, 12, JNULL, false }, { 102, 5000, 6, "max", false }, { 103, 800, 12, JNULL, true },
	{ 104, 100, 1, "min", false }, { 105, 1501, 3, JNULL, false },
}
for i, e in ipairs(tExpect) do
	local a = tAuctions[i]
	check(a and a.guid == e[1] and a.price == e[2] and a.hours == e[3], "listing " .. i .. ": " .. tostring(a and a.price) .. " CC " .. tostring(a and a.hours) .. " h")
	check(a and math.type(a.price) == "integer" and math.type(a.hours) == "integer", "listing " .. i .. ": integer arguments")
	local rr = s.results[i]
	check(rr.status == "listed" and rr.price == e[2] and rr.hours == e[3] and rr.capped == e[4] and rr.usedDefault == e[5], "result " .. i)
end
for i = 2, #tAuctions do
	check(tAuctions[i].t - tAuctions[i - 1].t >= 2.5, "pace between listings " .. (i - 1) .. "-" .. i .. ": " .. string.format("%.2f", tAuctions[i].t - tAuctions[i - 1].t))
end
local tSel = calls("Select")
check(#tSel == 5, "selected once each")
for i, a in ipairs(tAuctions) do
	check(a.t - tSel[i].t >= (i == 1 and 0.25 or 0.15) + 0.3 - 1e-3, "listing " .. i .. " waited for the selection and the settle")
end
local tSteps = stepsSeen(tAll)
check(tSteps.server and tSteps.select and tSteps.selected and tSteps.confirm and tSteps.pause, "steps reported")
check(countMarks("lister_run_start") == 1 and countMarks("lister_send") == 5 and countMarks("lister_listed") == 5 and countMarks("lister_run_end") == 1, "run marks")
check(s.message == "Listed 5 of 5.", "summary: " .. s.message)
check(#calls("CreateContext") == 0, "no DataStore context created")

-----------------------------------------------------------------------
-- 5. Skips before anything is selected: no pause between them
-----------------------------------------------------------------------
reset()
oStorage:TransitionIn()
addAnimal(201, { timer = 3600 })
addAnimal(202, { isMoving = true })
addAnimal(203, { maturity = 6 })
addAnimal(204, { maturity = 0 })
addAnimal(205)
local nStart = nClock
sReq, nFrom = start(job(3000, {
	"299 animal_9 500 max", line(201, "500", "max"), line(202, "500", "max"),
	line(203, "500", "max"), line(204, "500", "max"), line(205, "500", "max"),
}))
check(runToEnd(60), "skip run finished")
s = lastState()
local tKinds = { "gone", "listed", "moving", "elderly", "juvenile" }
for i, k in ipairs(tKinds) do
	check(s.results[i].status == "skipped" and s.results[i].kind == k, "skip " .. k .. ": " .. tostring(s.results[i].kind))
end
check(s.results[6].status == "listed", "the sellable one listed")
check(#tAuctions == 1 and tAuctions[1].guid == 205, "only the sellable one sent")
check(tAuctions[1].t - nStart < 1.5, "no pause after local skips")
check(#calls("Select") == 1, "skipped animals never selected")
check(countMarks("lister_skip") == 5, "skips marked")

-----------------------------------------------------------------------
-- 5b. A pregnant animal is refused by the engine too (the page never puts
--     one in a job; a stale or forced job must still not list her)
-----------------------------------------------------------------------
reset()
oStorage:TransitionIn()
addAnimal(211, { isPregnant = true })
addAnimal(212, { isPregnant = true, maturity = 3 })
addAnimal(213)
sReq, nFrom = start(job(3000, { line(211, "500", "max"), line(212, "700", "max"), line(213, "500", "max") }))
check(runToEnd(60), "pregnant run finished")
s = lastState()
for i = 1, 2 do
	check(s.results[i].status == "skipped" and s.results[i].kind == "pregnant", "pregnant " .. i .. " skipped: " .. tostring(s.results[i].kind))
	check(s.results[i].detail == "Pregnant: the market won't take it until she gives birth.", "pregnant " .. i .. " reason: " .. tostring(s.results[i].detail))
end
check(s.results[3].status == "listed", "the other one listed")
check(#tAuctions == 1 and tAuctions[1].guid == 213, "a pregnant animal is never sent")
check(#calls("Select") == 1, "a pregnant animal is never selected")
check(countMarks("lister_skip_pregnant") == 2, "pregnant skips marked")

-----------------------------------------------------------------------
-- 6. untradeable (after a tradeable one: its data is still there for a
--    moment), unselectable, noprice
-----------------------------------------------------------------------
reset()
oStorage:TransitionIn()
addAnimal(301)
addAnimal(302, { tradeAllowed = false, reason = "[AnimalList_Problem_Pregnant]" })
addAnimal(303, { noSelect = true })
local tNoDefault = defaultLimits()
tNoDefault.tradePriceDefault = 0
addAnimal(304, { limits = tNoDefault })
addAnimal(305)
sReq, nFrom = start(job(1000, { line(301, "500", "max"), line(302, "500", "max"), line(303, "500", "max"), line(304, "-", "max"), line(305, "0", "max") }))
check(runToEnd(60), "run finished")
tAll = states(nFrom)
s = tAll[#tAll]
check(s.results[1].status == "listed", "tradeable listed")
check(s.results[2].kind == "untradeable" and s.results[2].detail == "[AnimalList_Problem_Pregnant]", "untradeable with the game's reason: " .. tostring(s.results[2].detail))
check(s.results[3].kind == "unselectable", "unselectable")
local t2 = resultTime(tAll, 2)
local t3 = resultTime(tAll, 3)
check(t3 - t2 >= 5 and t3 - t2 < 5.5, "unselectable after 5 s: " .. string.format("%.2f", t3 - t2))
check(s.results[4].kind == "noprice" and s.results[4].usedDefault == true, "no price and no default")
check(s.results[5].kind == "noprice" and s.results[5].usedDefault == false, "zero price")
check(#tAuctions == 1, "only the tradeable one sent")
check(countMarks("lister_unsel_selection") == 1 and string.find(s.results[3].detail, "select", 1, true), "unselectable: the selection never came")

-- tradeable but the price limits never come: says so
reset()
oStorage:TransitionIn()
addAnimal(311, { limits = { tradeDurationMax = 12 } })
sReq, nFrom = start(job(1000, { line(311, "500", "max") }))
check(runToEnd(30), "run finished")
s = lastState()
check(s.results[1].kind == "unselectable" and string.find(s.results[1].detail, "limits", 1, true), "no limits: " .. s.results[1].detail)
check(countMarks("lister_unsel_limits") == 1 and #tAuctions == 0, "no limits: marked, not sent")

-----------------------------------------------------------------------
-- 7. Busy: wait for the server, give up after 10 s
-----------------------------------------------------------------------
reset()
oStorage:TransitionIn()
addAnimal(401)
tNative.bDbBusy = true
after(3, function() tNative.bDbBusy = false end)
nStart = nClock
sReq, nFrom = start(job(1000, { line(401, "500", "max") }))
check(runToEnd(30), "run finished")
tAll = states(nFrom)
check(tAll[#tAll].results[1].status == "listed", "listed once the server was free")
check(tAuctions[1].t - nStart >= 3, "nothing sent while busy")
local nMaxWaited, nServerStates = 0, 0
for _, x in ipairs(tAll) do
	if x.step == "server" then
		nServerStates = nServerStates + 1
		nMaxWaited = math.max(nMaxWaited, x.waited)
	end
end
check(nServerStates >= 3 and nMaxWaited >= 2, "state about once a second while waiting (" .. nServerStates .. " states, waited " .. nMaxWaited .. ")")
check(countMarks("lister_busy_db") == 1, "busy reason marked once")

-- RequestsInProgress alone: waited on for 2 s only (it may count background
-- polls), then the listing goes ahead and the run marks it once
reset()
oStorage:TransitionIn()
addAnimal(404)
tNative.vRequests = 2
sReq, nFrom = start(job(1000, { line(404, "500", "max") }))
check(runToEnd(30), "run finished")
tAll = states(nFrom)
check(lastState().results[1].status == "listed" and #tAuctions == 1, "requests alone: listed after the short wait")
check(tAuctions[1] and tAuctions[1].t - tAll[1]._t >= 2 and tAuctions[1].t - tAll[1]._t < 3, "requests alone: sent after about 2 s")
check(countMarks("lister_busy_requests") == 1 and countMarks("lister_busy_requests_ignored") == 1, "requests alone: marked waited, then ignored")
tNative.vRequests = nil

-- connectingAction, loadingItems: each keeps it waiting
for _, tCase in ipairs({ { "bConnecting", true, "connecting" }, { "bLoading", true, "loading" } }) do
	reset()
	oStorage:TransitionIn()
	addAnimal(402)
	tNative[tCase[1]] = tCase[2]
	sReq, nFrom = start(job(1000, { line(402, "500", "max") }))
	check(runToEnd(30), "run finished")
	tAll = states(nFrom)
	local t1, rr = resultTime(tAll, 1)
	check(rr and rr.kind == "busy" and #tAuctions == 0, tCase[3] .. ": skipped busy")
	check(t1 and t1 - tAll[1]._t >= 10 and t1 - tAll[1]._t < 10.5, tCase[3] .. ": after 10 s")
	check(countMarks("lister_busy_" .. tCase[3]) == 1, tCase[3] .. ": marked")
end

-- busy again after the selection: the send waits (bounded)
reset()
oStorage:TransitionIn()
addAnimal(403, { onSelect = function()
	after(0.4, function() tNative.bDbBusy = true end)
	after(2.4, function() tNative.bDbBusy = false end)
end })
sReq, nFrom = start(job(1000, { line(403, "500", "max") }))
check(runToEnd(30), "run finished")
check(lastState().results[1].status == "listed" and tAuctions[1].t - calls("Select")[1].t >= 2.4, "send waited for the server")
check(stepsSeen(states(nFrom)).send, "send step reported while waiting")

-----------------------------------------------------------------------
-- 8. Server answers
-----------------------------------------------------------------------
reset()
oStorage:TransitionIn()
local function outcome(tSteps_)
	return function(g, nHours)
		for _, x in ipairs(tSteps_) do
			if x[1] == "list" then
				after(x[2], function() listNow(g, nHours) end)
			else
				errorAt(x[2], x[3], x[4])
			end
		end
	end
end
addAnimal(501, { outcome = outcome({ { "err", 0.1, 8, 28 }, { "list", 0.5 }, { "err", 1.0, 5, 42 } }) }) -- other request type; a late error
addAnimal(502, { outcome = outcome({ { "err", 0.2, 5, 42 } }) })     -- NotAllowed
addAnimal(503, { outcome = outcome({ { "err", 0.2, 255, 42 } }) })   -- Unknown, never listed
addAnimal(504, { outcome = outcome({ { "err", 0.2, 255, 42 }, { "list", 2 } }) }) -- Unknown, listed after all
addAnimal(505, { outcome = outcome({ { "err", 0.2, 77, 42 } }) })    -- unnamed code
addAnimal(506, { outcome = outcome({ { "err", 1, 2, 42 }, { "list", 6 } }) }) -- DidNotGetResponse, late listing
addAnimal(507, { outcome = outcome({ { "err", 1, 2, 42 } }) })       -- DidNotGetResponse, never
addAnimal(508, { outcome = never() })                                  -- no answer at all
local tJob = {}
for g = 501, 508 do tJob[#tJob + 1] = line(g, "500", "max") end
sReq, nFrom = start(job(1000, tJob))
check(runToEnd(200), "run finished")
tAll = states(nFrom)
s = tAll[#tAll]
local function sentAt(g)
	for _, a in ipairs(tAuctions) do if a.guid == g then return a.t end end
end
local function after_(i, g) return (resultTime(tAll, i)) - sentAt(g) end
check(s.results[1].status == "listed", "other request types ignored")
check(s.results[2].status == "refused" and s.results[2].kind == "refused" and string.find(s.results[2].detail, "NotAllowed", 1, true), "named refusal: " .. s.results[2].detail)
check(after_(2, 502) < 0.6, "named refusal at once: " .. string.format("%.2f", after_(2, 502)))
check(s.results[3].status == "refused" and after_(3, 503) >= 3.2 and after_(3, 503) < 3.8, "Unknown refused after the grace: " .. string.format("%.2f", after_(3, 503)))
check(s.results[4].status == "listed", "Unknown but listed within the grace")
check(s.results[5].status == "refused" and string.find(s.results[5].detail, "code 77", 1, true), "unnamed code refused: " .. s.results[5].detail)
check(after_(5, 505) >= 3.2, "unnamed code got the grace")
check(s.results[6].status == "listed", "DidNotGetResponse then a late listing")
check(s.results[7].status == "timeout" and s.results[7].kind == "timeout" and after_(7, 507) >= 9 and after_(7, 507) < 9.5, "DidNotGetResponse: 8 s more: " .. string.format("%.2f", after_(7, 507)))
check(s.results[8].status == "timeout" and after_(8, 508) >= 30 and after_(8, 508) < 30.5, "no answer: 30 s: " .. string.format("%.2f", after_(8, 508)))
check(sentAt(503) - (resultTime(tAll, 2)) >= 1, "pause after a refusal")
check(#tAuctions == 8, "each sent once")
check(countMarks("lister_refused") == 3 and countMarks("lister_timeout") == 2, "refused/timeout marked")

-----------------------------------------------------------------------
-- 9. Stop at each step
-----------------------------------------------------------------------
local function stopCase(sName, fnSetup, fnWhen, fnCheck)
	reset()
	oStorage:TransitionIn()
	addAnimal(601)
	addAnimal(602)
	if fnSetup then fnSetup() end
	sReq, nFrom = start(job(1000, { line(601, "500", "max"), line(602, "500", "max") }))
	check(tickUntil(fnWhen, 40), sName .. ": reached")
	local nAuctions, nSelects = #tAuctions, #calls("Select")
	fire("PZ2QoL_ListerStop")
	check(Lister.tRun == nil, sName .. ": run ended at once")
	s = lastState()
	check(s.phase == "stopped" and s.step == "" and s.message == "Stopped by you.", sName .. ": phase stopped")
	seconds(5)
	check(#tAuctions == nAuctions and #calls("Select") == nSelects, sName .. ": nothing more sent or selected")
	fnCheck(s)
end
stopCase("stop while waiting for the server", function() tNative.bDbBusy = true end,
	function() return lastState().waited >= 1 end,
	function(x) check(x.results[1].status == "pending" and x.results[2].status == "pending" and x.index == 0 and #tAuctions == 0, "server: both still to do") end)
stopCase("stop while selecting", function() tAnimals[601].noSelect = true end,
	function() return Lister.tRun.sStep == "select" end,
	function(x) check(x.results[1].status == "pending" and #tAuctions == 0, "select: still to do") end)
stopCase("stop while settling", nil,
	function() return Lister.tRun.sStep == "selected" end,
	function(x) check(x.results[1].status == "pending" and x.results[1].price == JNULL and #tAuctions == 0, "selected: still to do") end)
stopCase("stop while the send waits", function()
		tAnimals[601].onSelect = function() after(0.3, function() tNative.bDbBusy = true end) end
	end,
	function() return Lister.tRun.sStep == "send" end,
	function(x) check(x.results[1].status == "pending" and #tAuctions == 0, "send: still to do") end)
stopCase("stop while confirming", function() tAnimals[601].outcome = never() end,
	function() return Lister.tRun.sStep == "confirm" end,
	function(x)
		check(x.results[1].status == "stopped" and x.results[1].kind == "stopped" and string.find(x.results[1].detail, "may still appear", 1, true), "confirm: stopped, may still appear")
		check(x.results[2].status == "pending" and x.index == 1 and #tAuctions == 1, "confirm: next still to do")
	end)
stopCase("stop while confirming, already listed", function() tAnimals[601].outcome = listAt(0.1) end,
	function() return Lister.tRun.sStep == "confirm" and tAnimals[601].timer > 0 end,
	function(x) check(x.results[1].status == "listed", "confirm: a last look finds it listed") end)
stopCase("stop while pausing", nil,
	function() return Lister.tRun.sStep == "pause" end,
	function(x) check(x.results[1].status == "listed" and x.results[2].status == "pending" and x.index == 1, "pause: first listed, second to do") end)
check(countMarks("lister_stop") == 1, "stop marked")
-- Stop without a run: the page gets the last state again
local nBefore = #sent("PZ2QoL_ListerState")
fire("PZ2QoL_ListerStop")
check(#sent("PZ2QoL_ListerState") == nBefore + 1 and lastState().phase == "stopped", "stop without a run re-sends the last state")

-----------------------------------------------------------------------
-- 10. Leaving Animal Storage ends the run
-----------------------------------------------------------------------
reset()
oStorage:TransitionIn()
addAnimal(701, { outcome = never() })
addAnimal(702)
sReq, nFrom = start(job(1000, { line(701, "500", "max"), line(702, "500", "max") }))
tickUntil(function() return Lister.tRun.sStep == "confirm" end)
oStorage:TransitionOut()
s = lastState()
check(Lister.tRun == nil and s.phase == "closed", "closed")
check(s.results[1].status == "stopped" and string.find(s.results[1].detail, "closed", 1, true), "closed while confirming: may still appear")
check(s.results[2].status == "pending", "closed: the rest still to do")
local tOut = calls("StorageOut")
check(#tOut == 1, "storage's own TransitionOut still runs")
check(countMarks("lister_closed") == 1, "closed marked")
_, nFrom = start(job(1000, { line(702, "500", "max") }))
check(states(nFrom)[1].refused == true and states(nFrom)[1].phase == "closed", "no run with storage closed")
-- closed while selecting: that animal stays to do
oStorage:TransitionIn()
tAnimals[702].noSelect = true
sReq, nFrom = start(job(1000, { line(702, "500", "max") }))
tickUntil(function() return Lister.tRun.sStep == "select" end)
oStorage:TransitionOut()
check(lastState().phase == "closed" and lastState().results[1].status == "pending", "closed while selecting: still to do")

-----------------------------------------------------------------------
-- 11. Keys change under the run
-----------------------------------------------------------------------
-- between two animals (and between Resolve and Start): found again by GUID
reset()
oStorage:TransitionIn()
addAnimal(801)
addAnimal(802)
addAnimal(803)
addAnimal(804)
local sJob = job(1000, { line(801, "500", "max"), line(802, "600", "max"), line(803, "700", "max") })
reshuffle({ 804, 803, 802, 801 }) -- after the page resolved its keys
sReq, nFrom = start(sJob)
tickUntil(function() return #tAuctions == 1 end)
reshuffle({ 802, 801, 804, 803 })
check(runToEnd(60), "run finished")
check(#tAuctions == 3, "three listings")
for i, g in ipairs({ 801, 802, 803 }) do
	check(tAuctions[i] and tAuctions[i].guid == g and tAuctions[i].price == 400 + 100 * i, "listing " .. i .. " is the right animal (" .. tostring(tAuctions[i] and tAuctions[i].guid) .. ")")
end
check(tAuctions[1].key == "animal_4" and tAuctions[2].key == "animal_1", "listed under the keys of the moment")
s = lastState()
check(s.results[1].status == "listed" and s.results[2].status == "listed" and s.results[3].status == "listed", "listed though the first one's key moved while confirming")

-- between the selection and the send: never the wrong animal
reset()
oStorage:TransitionIn()
addAnimal(811, { onSelect = function() after(0.35, function() reshuffle({ 812, 811, 813 }) end) end })
addAnimal(812)
addAnimal(813)
sReq, nFrom = start(job(1000, { line(811, "500", "max") }))
check(runToEnd(30), "run finished")
s = lastState()
check(s.results[1].status == "skipped" and s.results[1].kind == "changed", "changed: " .. tostring(s.results[1].kind))
check(#tAuctions == 0, "the animal now at that key was not listed")

-- the player selects another row while it settles
reset()
oStorage:TransitionIn()
addAnimal(821, { onSelect = function() after(0.3, function() tNative.tSelection = { "animal_2" } end) end })
addAnimal(822)
sReq, nFrom = start(job(1000, { line(821, "500", "max") }))
check(runToEnd(30), "run finished")
check(#tAuctions == 0 and lastState().results[1].kind ~= "listed", "another selection: not sent (" .. tostring(lastState().results[1].kind) .. ")")

-- ... or while the send waits for the server: checked again at the send
reset()
oStorage:TransitionIn()
addAnimal(831, { onSelect = function()
	after(0.3, function() tNative.bDbBusy = true end)
	after(1.0, function() tNative.tSelection = { "animal_2" } end)
	after(1.5, function() tNative.bDbBusy = false end)
end })
addAnimal(832)
sReq, nFrom = start(job(1000, { line(831, "500", "max") }))
check(runToEnd(30), "run finished")
check(#tAuctions == 0 and lastState().results[1].kind == "changed", "selection changed before the send: changed (" .. tostring(lastState().results[1].kind) .. ")")

-----------------------------------------------------------------------
-- 12. Unreadable selection or list
-----------------------------------------------------------------------
reset()
oStorage:TransitionIn()
addAnimal(901)
addAnimal(902)
-- neither the array nor the row flag readable
tNative.bSelUnreadable, tNative.bNoRowFlag = true, true
sReq, nFrom = start(job(1000, { line(901, "500", "max"), line(902, "600", "max") }))
check(runToEnd(30), "run finished")
check(#tAuctions == 2 and tAuctions[1].guid == 901 and tAuctions[2].guid == 902, "selection unreadable: limits and settle")
check(countMarks("lister_sel_unknown") == 2, "selection unknown marked per animal")

reset()
oStorage:TransitionIn()
addAnimal(911)
addAnimal(912)
tNative.bListUnreadable = true
sReq, nFrom = start(job(1000, { line(911, "500", "max"), gs(912) .. " animal_1 600 max" }))
check(runToEnd(30), "run finished")
s = lastState()
check(s.results[1].status == "listed", "list unreadable: found by its key, confirmed by its row")
check(s.results[2].kind == "gone" and string.find(s.results[2].detail, "could not be read", 1, true), "list unreadable and a stale key: gone")
check(#tAuctions == 1 and tAuctions[1].guid == 911, "only the right one sent")
check(countMarks("lister_list_unreadable") >= 2, "unreadable list marked")

-----------------------------------------------------------------------
-- 13. A Lua error in one animal's step skips it; the run carries on
-----------------------------------------------------------------------
reset()
oStorage:TransitionIn()
addAnimal(1001, { selectError = true })
addAnimal(1002, { sendError = true })
addAnimal(1003)
sReq, nFrom = start(job(1500, { line(1001, "500", "max"), line(1002, "500", "max"), line(1003, "500", "max") }))
check(runToEnd(30), "run finished")
tAll = states(nFrom)
s = tAll[#tAll]
check(s.results[1].kind == "error" and string.find(s.results[1].detail, "select blew up", 1, true), "error in select: skipped")
check(s.results[2].kind == "error", "error in the send: skipped")
check(s.results[3].status == "listed", "the run carried on")
check(sentAt(1003) - (resultTime(tAll, 2)) >= 1.5, "a failed send still gets the pause")
check(countMarks("lister_error") == 2, "errors marked")

-----------------------------------------------------------------------
-- 14. Pace: changed during a run, clamped, kept between runs
-----------------------------------------------------------------------
reset()
oStorage:TransitionIn()
addAnimal(1101)
addAnimal(1102)
addAnimal(1103)
sReq, nFrom = start(job(1000, { line(1101, "500", "max"), line(1102, "500", "max"), line(1103, "500", "max") }))
tickUntil(function() return Lister.tRun.sStep == "pause" end)
fire("PZ2QoL_ListerPace", 5000)
check(lastState().paceMs == 5000, "pace change reported")
tickUntil(function() return #tAuctions == 2 end)
fire("PZ2QoL_ListerPace", 200)
check(lastState().paceMs == 1000, "pace at least 1 s")
check(runToEnd(60), "run finished")
check(tAuctions[2].t - tAuctions[1].t >= 5.5, "the longer pause applied mid-pause")
check(tAuctions[3].t - tAuctions[2].t >= 1.5 and tAuctions[3].t - tAuctions[2].t < 4, "then the shorter one (plus the same-data settle)")
fire("PZ2QoL_ListerPace", 99999)
check(Lister.nPaceMs == 10000, "pace at most 10 s")
fire("PZ2QoL_ListerPace", "junk")
check(Lister.nPaceMs == 10000, "junk pace ignored")
_, nFrom = start("v1 50\n" .. line(1101, "500", "max"))
check(states(nFrom)[1].paceMs == 1000, "job pace clamped too")
fire("PZ2QoL_ListerStop")

-- a new run right after one: the pause still applies to its first listing
reset()
oStorage:TransitionIn()
addAnimal(1201)
addAnimal(1202)
sReq, nFrom = start(job(3000, { line(1201, "500", "max") }))
check(runToEnd(30), "first run finished")
local tFirst = states(nFrom)
local nResult = resultTime(tFirst, 1)
sReq, nFrom = start(job(3000, { line(1202, "500", "max") }))
check(states(nFrom)[1].step == "pause", "second run starts with the pause")
check(runToEnd(30), "second run finished")
check(tAuctions[2].t - nResult >= 3, "pace kept across runs: " .. string.format("%.2f", tAuctions[2].t - nResult))

-----------------------------------------------------------------------
-- 15. One run at a time; a page that reloads picks the run up
-----------------------------------------------------------------------
reset()
oStorage:TransitionIn()
addAnimal(1301)
addAnimal(1302)
addAnimal(1303)
sReq, nFrom = start(job(1000, { line(1301, "500", "max"), line(1302, "500", "max"), line(1303, "500", "max") .. "\n" .. line(1301, "900", "max") }))
check(states(nFrom)[1].total == 3, "a GUID listed twice counts once")
local nRun = Lister.tRun.nId
local sReq2, nFrom2 = start(job(1000, { line(1302, "500", "max") }))
local tTwo = states(nFrom2)
check(#tTwo == 2 and tTwo[1].refused == true and tTwo[1].req == sReq2 and tTwo[2].run == nRun and tTwo[2].phase == "running", "second start refused, current state re-sent")
fire("PZ2QoL_ListerHello", "h9")
c = decode(sent("PZ2QoL_ListerCaps")[1].tArgs[2])
check(c.running == true, "caps: running")
check(runToEnd(60), "run finished")
check(#tAuctions == 3 and lastState().run == nRun, "the first run went on")

-----------------------------------------------------------------------
-- 15b. The previous animal's data must not pass for this one's: the
-- selection shows at once, the data 0.9 s later, and Clear leaves the old
-- data (the worst case)
-----------------------------------------------------------------------
do
	reset()
	oStorage:TransitionIn()
	tNative.nSelectDelay, tNative.nDataDelay = 0.05, 0.9
	addAnimal(1501)                                            -- tradeable
	addAnimal(1502, { tradeAllowed = false, reason = "[AnimalList_Problem_Pregnant]" })
	local sR, nF = start(job(1000, { line(1501, "500", "max"), line(1502, "500", "max") }))
	check(runToEnd(60), "stale: run finished")
	local tLast = lastState()
	check(#tAuctions == 1 and tAuctions[1].guid == 1501, "stale: only the tradeable one was sent (" .. #tAuctions .. ")")
	check(tLast.results[2].status == "skipped" and tLast.results[2].kind == "untradeable", "stale: the untradeable one skipped on its own data")
	check(countMarks("lister_data_same") >= 1, "stale: waited while the data was unchanged")
	-- same data for both: the second still goes, after the longer wait
	reset()
	oStorage:TransitionIn()
	tNative.nSelectDelay, tNative.nDataDelay = 0.05, 0.9
	addAnimal(1503)
	addAnimal(1504)
	sR, nF = start(job(1000, { line(1503, "500", "max"), line(1504, "700", "max") }))
	check(runToEnd(60), "same data: run finished")
	local tSel = calls("Select")
	check(#tAuctions == 2 and tAuctions[2].guid == 1504 and tAuctions[2].price == 700, "same data: both sent, the second at its own price")
	check(tSel[2] and tAuctions[2].t - tSel[2].t >= 1.5, "same data: the second waited for the longer settle")
	resetNative()
end

-----------------------------------------------------------------------
-- 16. Hours fallbacks; every mark name is in checkpoints.txt
-----------------------------------------------------------------------
reset()
oStorage:TransitionIn()
local tNoMax = defaultLimits()
tNoMax.tradeDurationMax = nil
addAnimal(1401, { limits = tNoMax })
local tNoHours = defaultLimits()
tNoHours.tradeDurationMax, tNoHours.tradeDurationDefault, tNoHours.tradeDurationMin = nil, nil, nil
addAnimal(1402, { limits = tNoHours })
sReq, nFrom = start(job(1000, { line(1401, "500", "max"), line(1402, "500", "default") }))
check(runToEnd(30), "run finished")
check(#tAuctions == 1 and tAuctions[1].hours == 6, "hours: no max -> the game's default (" .. tostring(tAuctions[1] and tAuctions[1].hours) .. ")")
-- no duration limits at all: never sent (it would go out for 1 h)
check(lastState().results[2].status == "skipped" and lastState().results[2].kind == "unselectable", "no duration limits: skipped, not sent")

-----------------------------------------------------------------------
-- The selection as the game shows it to Lua: selectedAnimalIDs empty, the
-- row's own flag right (Y: 2026-10-17, every animal was "unselectable")
-----------------------------------------------------------------------
reset()
oStorage:TransitionIn()
tNative.bSelArrayEmpty = true
addAnimal(1501)
addAnimal(1502)
sReq, nFrom = start(job(1000, { line(1501, "500", "max"), line(1502, "600", "max") }))
check(runToEnd(30), "array empty: run finished")
check(#tAuctions == 2 and lastState().results[1].status == "listed" and lastState().results[2].status == "listed", "array empty: listed by the row flag")
check(countMarks("lister_sel_array_empty") == 1 and countMarks("lister_sel_array_ok") == 0 and countMarks("lister_unsel_selection") == 0, "array empty: marked once, nothing unselectable")

-- the array readable: marked ok (read after selecting, not after the Clear)
reset()
oStorage:TransitionIn()
addAnimal(1505)
sReq, nFrom = start(job(1000, { line(1505, "500", "max") }))
check(runToEnd(30), "array ok: run finished")
check(countMarks("lister_sel_array_ok") == 1 and countMarks("lister_sel_array_empty") == 0, "array readable: marked ok")

-- neither the array nor the flag: listed on the data alone (as before)
reset()
oStorage:TransitionIn()
tNative.bSelArrayEmpty, tNative.bNoRowFlag = true, true
addAnimal(1511)
sReq, nFrom = start(job(1000, { line(1511, "500", "max") }))
check(runToEnd(30), "no flag: run finished")
check(#tAuctions == 1 and lastState().results[1].status == "listed", "no flag, empty array: listed on the data")

-- the selection does not take (flag stays false): unselectable, never sent
reset()
oStorage:TransitionIn()
tNative.bSelArrayEmpty = true
addAnimal(1521, { noSelect = true })
addAnimal(1522)
sReq, nFrom = start(job(1000, { line(1521, "500", "max"), line(1522, "500", "max") }))
check(runToEnd(30), "flag false: run finished")
check(#tAuctions == 1 and tAuctions[1].guid == 1522, "flag false: only the second sent")
check(lastState().results[1].kind == "unselectable" and countMarks("lister_unsel_selection") == 1, "flag false: unselectable")

-- another animal ticked as well just before sending: not sent
reset()
oStorage:TransitionIn()
addAnimal(1531, { onSelect = function(sKey)
	after(0.3, function() tNative.tSelection = { sKey, keyOf(1532) } end)
end })
addAnimal(1532)
sReq, nFrom = start(job(1000, { line(1531, "500", "max") }))
check(runToEnd(30), "multi: run finished")
check(#tAuctions == 0 and lastState().results[1].status ~= "listed", "multi-selection: not sent (" .. tostring(lastState().results[1].kind) .. ")")
check(countMarks("lister_sel_other") >= 1, "multi-selection marked")

-----------------------------------------------------------------------
-- 17. Page-assisted reads: the page reports the selection, tradeAllowed
-- and the limits (PZ2QoL_ListerWatch -> PZ2QoL_ListerSeen) while Lua's own
-- reads of them are broken (Y: 2026-10-17, every animal "unselectable")
-----------------------------------------------------------------------
check(oView.tListeners["PZ2QoL_ListerSeen"] ~= nil, "listener PZ2QoL_ListerSeen")

-- the page's text, exactly as listercore.js encodeSeen writes it
local p = Lister.ParseSeen("v1|animal_3|animal_3|1|100,5000,812.5,1,12,6|")
check(p and p.sKey == "animal_3" and #p.tSel == 1 and p.tSel[1] == "animal_3" and p.bAllowed == true and p.sReason == "", "parse: selected, allowed")
check(p and p.tLimits.nPriceMin == 100 and p.tLimits.nPriceMax == 5000 and p.tLimits.nPriceDefault == 812.5 and p.tLimits.nHoursMax == 12 and p.tLimits.nHoursDefault == 6, "parse: limits")
p = Lister.ParseSeen("v1|animal_3||0|-,-,-,-,-,-|[STRING_LITERAL:Value=|Pregnant|] ")
check(p and #p.tSel == 0 and p.bAllowed == false and p.tLimits.nPriceMin == nil and p.sReason == "[STRING_LITERAL:Value=|Pregnant|] ", "parse: empty selection, a reason with pipes")
p = Lister.ParseSeen("v1|animal_3|?|-|-,-,-,-,-,-|")
check(p and p.tSel == nil and p.bAllowed == nil, "parse: unreadable selection")
check(Lister.ParseSeen("v2|animal_3|||||") == nil and Lister.ParseSeen(nil) == nil and Lister.ParseSeen("v1||a|1|1|") == nil, "parse: junk refused")

-- the fake page: gets Lua's events a frame late, reports every 0.1 s what
-- the game really shows (tNative), not what Lua's broken reads give
local tPage
local function pageReset(t)
	tPage = { bOn = true, nIdx = 0, sReq = nil, sKey = nil, nNext = 0, nReports = 0, nWatches = 0, nStops = 0 }
	for k, v in pairs(t or {}) do tPage[k] = v end
end
local function pageText()
	local tSel = tPage.fnSel and tPage.fnSel() or tNative.tSelection
	local a = tNative.tActions.tradeAllowed
	local tN = {}
	for _, sName in ipairs({ "tradePriceMin", "tradePriceMax", "tradePriceDefault", "tradeDurationMin", "tradeDurationMax", "tradeDurationDefault" }) do
		local n = tNative.tLimits[sName]
		tN[#tN + 1] = type(n) == "number" and tostring(n) or "-"
	end
	return table.concat({ "v1", tPage.sKey, table.concat(tSel, ","), a == true and "1" or a == false and "0" or "-",
		table.concat(tN, ","), tNative.tActions.tradeDisallowedReason or "" }, "|")
end
fnPageFrame = function()
	if tPage == nil or not tPage.bOn then return end
	if tPage.nIdx > #oView.tSent then tPage.nIdx = 0 end
	while tPage.nIdx < #oView.tSent and oView.tSent[tPage.nIdx + 1].t < nClock do
		tPage.nIdx = tPage.nIdx + 1
		local x = oView.tSent[tPage.nIdx]
		if x.sName == "PZ2QoL_ListerWatch" then
			local sWReq, sKey = x.tArgs[1], x.tArgs[2]
			if sWReq == "" or sKey == "" then
				tPage.sReq, tPage.nStops = nil, tPage.nStops + 1
			elseif sWReq ~= tPage.sReq then
				tPage.sReq, tPage.sKey, tPage.nNext, tPage.nWatches = sWReq, sKey, nClock, tPage.nWatches + 1
				tPage.nThis = 0
			end
		end
	end
	if tPage.sReq ~= nil and nClock >= tPage.nNext - 1e-9 and (tPage.nMax == nil or tPage.nThis < tPage.nMax) then
		tPage.nNext = nClock + 0.1
		tPage.nReports = tPage.nReports + 1
		tPage.nThis = tPage.nThis + 1
		fire("PZ2QoL_ListerSeen", tPage.sFixedReq or tPage.sReq, (tPage.fnText or pageText)())
	end
end
local function pageRun(tSetup, tSpec, sLabel)
	reset()
	oStorage:TransitionIn()
	for k, v in pairs(tSetup.native or {}) do tNative[k] = v end
	pageReset(tSetup.page)
	for _, a in ipairs(tSpec) do addAnimal(a[1], a[2]) end
	local tLines = {}
	for _, a in ipairs(tSpec) do tLines[#tLines + 1] = line(a[1], a[3] or "500", "max") end
	sReq, nFrom = start(job(1000, tLines))
	check(runToEnd(90), sLabel .. ": run finished")
	return lastState()
end

-- every Lua read broken (flag nil, array empty, tradeAllowed and limits nil):
-- listed on the page's reports, at their own prices
local tOwn = defaultLimits()
tOwn.tradePriceMax = 4000
s = pageRun({ native = { bLuaSelBroken = true, bLuaDataBroken = true } }, { { 1601 }, { 1602, { limits = tOwn }, "99999" }, { 1603, nil, "-" } }, "page")
check(#tAuctions == 3 and s.results[1].status == "listed" and s.results[2].status == "listed" and s.results[3].status == "listed", "page: all listed (" .. #tAuctions .. ")")
check(tAuctions[3] and tAuctions[1].price == 500 and tAuctions[2].price == 4000 and tAuctions[3].price == 800 and tAuctions[1].hours == 12, "page: the page's limits clamp and default")
check(countMarks("lister_page_seen") == 1 and countMarks("lister_unsel_selection") == 0, "page: seen marked once, nothing unselectable")
check(countMarks("lister_diag_flag_nil") == 1 and countMarks("lister_diag_arr_empty") == 1 and countMarks("lister_diag_allowed_nil") == 1 and countMarks("lister_diag_limits_none") == 1, "page: Lua's own reads diagnosed once per run")
check(tPage.nWatches == 6 and tPage.nStops >= 3 and tPage.sReq == nil, "page: watched at each clear and select, stopped after (" .. tPage.nWatches .. " watches, " .. tPage.nStops .. " stops)")
local tSelCalls = calls("Select")
for i, a in ipairs(tAuctions) do
	check(tSelCalls[i] and a.t - tSelCalls[i].t >= 0.25 + 0.6 - 1e-3, "page: listing " .. i .. " waited for the data and the settle")
end
check(tSelCalls[2] and tAuctions[2] and tAuctions[2].t - tSelCalls[2].t < 1.5, "page: the second (its own data) compared like with like: no extra settle")

-- the flag always false, the rest of Lua's reads fine: the page decides
s = pageRun({ native = { bLuaFlagFalse = true } }, { { 1611 } }, "flag false")
check(#tAuctions == 1 and s.results[1].status == "listed", "flag false: listed on the page's report")
check(countMarks("lister_diag_flag_false") == 1 and countMarks("lister_diag_allowed_bool") == 1 and countMarks("lister_diag_limits_ok") == 1, "flag false: diagnosed")

-- the page shows another animal selected: never sent
s = pageRun({ native = { bLuaSelBroken = true, bLuaDataBroken = true }, page = { fnSel = function() return { "animal_9" } end } }, { { 1621 }, { 1622 } }, "other")
check(#tAuctions == 0 and s.results[1].kind == "unselectable" and s.results[2].kind == "unselectable", "other: nothing sent")
check(countMarks("lister_page_sel_other") == 2, "other: the page's view marked")

-- right at first, then another one selected before the send (while it waits for the server)
s = pageRun({ native = { bLuaSelBroken = true, bLuaDataBroken = true } }, { { 1631, { onSelect = function()
	after(0.4, function() tNative.bDbBusy = true end)
	after(2.5, function() tPage.fnSel = function() return { "animal_2" } end end)
	after(3.5, function() tNative.bDbBusy = false end)
end } }, { 1632 } }, "other at send")
local bSent1631 = false
for _, a in ipairs(tAuctions) do if a.guid == 1631 then bSent1631 = true end end
check(not bSent1631 and s.results[1].kind == "changed", "other at send: not sent, changed (" .. tostring(s.results[1].kind) .. ")")

-- the page's limits missing: never sent without them
s = pageRun({ native = { bLuaSelBroken = true } }, { { 1641, { limits = { tradeDurationMax = 12 } } } }, "no limits")
check(#tAuctions == 0 and s.results[1].kind == "unselectable" and countMarks("lister_unsel_limits") == 1 and countMarks("lister_page_sel_key") == 1, "page limits missing: not sent")

-- not tradeable, by the page: skipped with the game's reason
s = pageRun({ native = { bLuaSelBroken = true, bLuaDataBroken = true } }, { { 1651, { tradeAllowed = false, reason = "[AnimalList_Problem_Pregnant]" } } }, "untradeable")
check(#tAuctions == 0 and s.results[1].kind == "untradeable" and s.results[1].detail == "[AnimalList_Problem_Pregnant]", "page untradeable: the reason (" .. tostring(s.results[1].detail) .. ")")

-- no page reports at all and Lua's reads broken: as before, unselectable
s = pageRun({ native = { bLuaSelBroken = true, bLuaDataBroken = true }, page = { bOn = false } }, { { 1661 } }, "no page")
check(#tAuctions == 0 and s.results[1].kind == "unselectable" and countMarks("lister_page_none") == 1 and countMarks("lister_page_seen") == 0, "no page: unselectable, marked")

-- stale reports: the page answers a few times per watch, then goes quiet
s = pageRun({ native = { bLuaSelBroken = true, bLuaDataBroken = true }, page = { nMax = 3 } }, { { 1671 } }, "stale")
check(#tAuctions == 0 and s.results[1].kind == "unselectable", "stale reports: not used, not sent")
-- ... with Lua's own reads working, the fallback lists as before
s = pageRun({ page = { nMax = 3 } }, { { 1672 } }, "stale, Lua fine")
check(#tAuctions == 1 and s.results[1].status == "listed", "stale reports, Lua's reads fine: listed on Lua's reads")

-- reports for an older watch never count
s = pageRun({ native = { bLuaSelBroken = true, bLuaDataBroken = true }, page = { sFixedReq = "w0_1" } }, { { 1681 } }, "old req")
check(#tAuctions == 0 and s.results[1].kind == "unselectable" and countMarks("lister_page_seen") == 0, "old watch id: ignored")

-- the key moves to another animal after the select: the same-tick check still holds
s = pageRun({ native = { bLuaSelBroken = true, bLuaDataBroken = true } }, { { 1691, { onSelect = function()
	after(0.35, function() reshuffle({ 1692, 1691 }) end)
end } }, { 1692, { noSelect = true } } }, "reshuffle")
check(#tAuctions == 0, "page + reshuffle: never the wrong animal (" .. #tAuctions .. ")")
check(s.results[1].kind == "changed" or s.results[1].kind == "unselectable", "page + reshuffle: skipped (" .. tostring(s.results[1].kind) .. ")")

-- a page that misses its watch is asked again
s = pageRun({ native = { bLuaSelBroken = true, bLuaDataBroken = true }, page = { bOn = false } }, { { 1697, { noSelect = true } } }, "resend")
local nWatchSends = #sent("PZ2QoL_ListerWatch")
check(nWatchSends >= 5, "watch asked again while nothing reports (" .. nWatchSends .. ")")

-- the page in a working game: Lua's reads fine too, still listed
s = pageRun({}, { { 1695 }, { 1696 } }, "both")
check(#tAuctions == 2 and countMarks("lister_diag_flag_true") == 1 and countMarks("lister_diag_arr_key") == 1, "both readable: listed, diagnosed")
local fnPageFrameSaved = fnPageFrame
fnPageFrame = nil

-----------------------------------------------------------------------
-- Row id != row key (proven in game, 2026-10-17, lister_id_differs):
-- SelectItem takes the row's id (a key there is another animal),
-- GetIDAndAIDType and the listing call take the key. The engine selects
-- by id, resolves and lists by key.
-----------------------------------------------------------------------
reset()
oStorage:TransitionIn()
tNative.bIdOther = true
addAnimal(1601)
addAnimal(1602)
addAnimal(1603)
sReq, nFrom = start(job(1000, { line(1602, "500", "max"), line(1603, "600", "max") }))
check(runToEnd(30), "id != key: run finished")
check(#tAuctions == 2 and tAuctions[1].guid == 1602 and tAuctions[2].guid == 1603, "id != key: the right animals listed (" .. tostring(tAuctions[1] and tAuctions[1].guid) .. ", " .. tostring(tAuctions[2] and tAuctions[2].guid) .. ")")
check(tAuctions[1] and tAuctions[1].key == keyOf(1602), "id != key: listed by the row key")
local tSelId = calls("Select")
check(#tSelId == 2 and tSelId[1].tArgs[2] == 1602 and tSelId[2].tArgs[2] == 1603, "id != key: selected the right animals")
check(countMarks("lister_id_differs") >= 1, "id != key: marked")

-----------------------------------------------------------------------
-- Other id types (exhibit animals: 4): identified and listed by key
-----------------------------------------------------------------------
reset()
oStorage:TransitionIn()
addAnimal(1701, { aidType = 4 })
addAnimal(1702)
fire("PZ2QoL_ListerResolve", "r17", keyOf(1701) .. "," .. keyOf(1702))
local tIdsMsg = sent("PZ2QoL_ListerIds")
local tIdsAns = decode(tIdsMsg[#tIdsMsg].tArgs[2])
check(tIdsAns.ids[keyOf(1701)] == "t4_1701" and tIdsAns.ids[keyOf(1702)] == "1702", "type 4 resolved as t4_<id> (" .. tostring(tIdsAns.ids[keyOf(1701)]) .. ")")
sReq, nFrom = start(job(1000, { "t4_1701 " .. keyOf(1701) .. " 500 max", line(1702, "600", "max") }))
check(runToEnd(30), "type 4: run finished")
check(#tAuctions == 2 and tAuctions[1].guid == 1701 and tAuctions[2].guid == 1702, "type 4: both listed")
check(countMarks("lister_idtype_4") == 1, "type 4 traced")
-- a skip says why
reset()
oStorage:TransitionIn()
addAnimal(1711, { tradeAllowed = false })
sReq, nFrom = start(job(1000, { line(1711, "500", "max") }))
check(runToEnd(30), "untradeable: run finished")
check(countMarks("lister_skip_untradeable") == 1, "skip kind traced")

-----------------------------------------------------------------------
-- The desk sees every animal: PZ2QoL_DeskFilters clears the game's own
-- storage filters (as its Reset all filters does) and puts the kept
-- settings back on close, after a run, or when Animal Storage closes.
-----------------------------------------------------------------------
do
	local tSettings = { species = { 7 }, text = "Leo" }
	planetHub.StorageUIGetSortFilterSettings = function() record("GetSettings") return tSettings end
	planetHub.StorageUISetSortFilterSettings = function(t) record("SetSettings", t) end
	planetHub.StorageUIResetFiltersToDefault = function() record("ResetFilters") end
	planetHub.StorageUIClearFilterText = function() record("ClearText") end
	planetHub.StorageUIRequestData = function() record("RequestData") end
	local function deskAns(sReq)
		local t = sent("PZ2QoL_DeskFiltersState")
		local x = t[#t]
		return x and x.tArgs[1] == sReq and decode(x.tArgs[2]) or nil
	end
	local function order()
		local t = {}
		for _, c in ipairs(tCalls) do
			if c.sName == "GetSettings" or c.sName == "SetSettings" or c.sName == "ResetFilters" or c.sName == "ClearText" or c.sName == "RequestData" or c.sName == "StorageOut" then t[#t + 1] = c.sName end
		end
		return table.concat(t, ",")
	end
	check(oView.tListeners["PZ2QoL_DeskFilters"] ~= nil, "listener PZ2QoL_DeskFilters")

	-- outside Animal Storage: nothing changes
	reset()
	oStorage:TransitionOut()
	fire("PZ2QoL_DeskFilters", "d0", "clear")
	local a = deskAns("d0")
	check(a and a.ok == false and a.detail == "nostorage" and order() == "StorageOut", "desk clear outside storage refused, nothing called")

	-- clear, then restore on close: the game's own sequences
	reset()
	oStorage:TransitionIn()
	fire("PZ2QoL_DeskFilters", "d1", "clear")
	a = deskAns("d1")
	check(a and a.ok == true and a.cleared == true, "desk clear answered")
	check(order() == "GetSettings,ResetFilters,ClearText,RequestData", "desk clear: settings kept, then Reset all filters (" .. order() .. ")")
	check(countMarks("lister_desk_clear") == 1, "desk clear marked")
	fire("PZ2QoL_DeskFilters", "d2", "clear")
	a = deskAns("d2")
	check(a and a.ok and a.detail == "again" and #calls("GetSettings") == 1, "desk clear again: settings not taken twice")
	tCalls = {}
	fire("PZ2QoL_DeskFilters", "d3", "restore")
	a = deskAns("d3")
	local tSet = calls("SetSettings")
	check(a and a.ok == true and a.cleared == false, "desk restore answered")
	check(order() == "SetSettings,RequestData" and tSet[1].tArgs[1] == tSettings, "desk restore: the kept settings back (" .. order() .. ")")
	tCalls = {}
	fire("PZ2QoL_DeskFilters", "d4", "restore")
	check(deskAns("d4").detail == "none" and order() == "", "desk restore twice: nothing more")

	-- a run going on keeps the full list until it ends
	reset()
	oStorage:TransitionIn()
	addAnimal(1801)
	addAnimal(1802)
	fire("PZ2QoL_DeskFilters", "d5", "clear")
	start(job(1000, { line(1801, "500", "max"), line(1802, "600", "max") }))
	tick(2)
	tCalls = {}
	fire("PZ2QoL_DeskFilters", "d6", "restore")
	check(deskAns("d6").detail == "later" and order() == "", "desk restore during a run: later")
	check(runToEnd(40), "desk: run finished")
	check(#tAuctions == 2, "desk: both listed with the filters cleared")
	check(order() == "SetSettings,RequestData", "desk restore after the run (" .. order() .. ")")
	check(countMarks("lister_desk_restore_later") == 1 and countMarks("lister_desk_restore") == 1, "desk restore later marked")

	-- reopened before the run ended: stays cleared
	reset()
	oStorage:TransitionIn()
	addAnimal(1811)
	fire("PZ2QoL_DeskFilters", "d7", "clear")
	start(job(1000, { line(1811, "500", "max") }))
	tick(2)
	fire("PZ2QoL_DeskFilters", "d8", "restore")
	fire("PZ2QoL_DeskFilters", "d9", "clear")
	tCalls = {}
	check(runToEnd(40), "desk reopened: run finished")
	check(order() == "" and Lister.tDesk ~= nil, "desk reopened during the run: filters stay cleared")

	-- leaving Animal Storage restores them before the game saves its filters
	tCalls = {}
	oStorage:TransitionOut()
	check(order() == "SetSettings,RequestData,StorageOut" and Lister.tDesk == nil, "desk: storage closed restores first (" .. order() .. ")")

	-- no settings to put back: the player's filters are left alone
	reset()
	oStorage:TransitionIn()
	planetHub.StorageUIGetSortFilterSettings = function() record("GetSettings") return nil end
	fire("PZ2QoL_DeskFilters", "d10", "clear")
	a = deskAns("d10")
	check(a and a.ok == false and a.detail == "nosettings" and order() == "GetSettings", "desk clear without settings: nothing reset")
	-- an older game without the calls
	planetHub.StorageUIGetSortFilterSettings = nil
	fire("PZ2QoL_DeskFilters", "d11", "clear")
	a = deskAns("d11")
	check(a and a.ok == false and string.find(a.detail, "missing", 1, true) == 1, "desk clear on a game without the calls refused")
	planetHub.StorageUISetSortFilterSettings, planetHub.StorageUIResetFiltersToDefault = nil, nil
	planetHub.StorageUIClearFilterText, planetHub.StorageUIRequestData = nil, nil
	oStorage:TransitionOut()
end

-----------------------------------------------------------------------
-- 18. The detailed log (Core:Log, debug builds): one animal can be
-- followed end to end by run + guid, a skip says why, a server error
-- carries its code and request, the end has the counts
-----------------------------------------------------------------------
do
	local tLog = {}
	Core.bTrace = true
	Core.Log = function(_, sArea, sEvent, t) tLog[#tLog + 1] = { area = sArea, ev = sEvent, t = t or {} } end
	reset()
	oStorage:TransitionIn()
	addAnimal(1801, { outcome = outcome({ { "err", 0.1, 8, 28 }, { "list", 0.5 } }) }) -- background error, then listed
	addAnimal(1802, { maturity = 0 })                                                  -- juvenile: skipped
	addAnimal(1803, { outcome = outcome({ { "err", 0.2, 5, 42 } }) })                  -- NotAllowed
	sReq, nFrom = start(job(1000, { line(1801, "700", "max"), line(1802, "500", "max"), line(1803, "500", "max") }))
	check(runToEnd(60), "log: run finished")
	-- one animal's events in order, and whether each carried run and i
	local function evs(sGuid)
		local t, bAll = {}, true
		for _, x in ipairs(tLog) do
			if x.area == "lister" and x.t.guid == sGuid then
				t[#t + 1] = x.ev
				bAll = bAll and x.t.run ~= nil and x.t.i ~= nil
			end
		end
		return t, bAll
	end
	local function inOrder(t, tWant)
		local j = 1
		for _, s in ipairs(t) do
			if s == tWant[j] then j = j + 1 end
		end
		return j > #tWant
	end
	local function find(sEv, sGuid)
		for _, x in ipairs(tLog) do
			if x.ev == sEv and (sGuid == nil or x.t.guid == sGuid) then return x.t end
		end
	end
	local t1, bAll1 = evs("1801")
	check(inOrder(t1, { "job", "animal", "step", "resolve", "select", "price", "send", "server_error", "result" }), "log: listed animal end to end: " .. table.concat(t1, ","))
	check(bAll1, "log: every line of the animal has run and i")
	local tStart = find("start")
	check(tStart and tStart.n == 3 and tStart.paceMs == 1000 and tStart.req == sReq, "log: start with count, pace and request")
	local tSend = find("send", "1801")
	check(tSend and tSend.price == 700 and tSend.hours == 12 and tSend.key == "animal_1", "log: send with key, price and hours")
	local tPrice = find("price", "1801")
	check(tPrice and tPrice.jobPrice == 700 and tPrice.price == 700 and tPrice.pmin == 100 and tPrice.pmax == 5000 and tPrice.hmax == 12, "log: price inputs (job price, limits)")
	local tErr1 = find("server_error", "1801")
	check(tErr1 and tErr1.ignored == "otherrequest" and tErr1.req == 28, "log: a background error is logged as ignored")
	local tRes1 = find("result", "1801")
	check(tRes1 and tRes1.status == "listed" and tRes1.sent == true and tRes1.afterSend ~= nil, "log: listed result with time after the send")
	local t2 = evs("1802")
	check(inOrder(t2, { "job", "animal", "resolve", "result" }), "log: skipped animal: " .. table.concat(t2, ","))
	local tRes2 = find("result", "1802")
	check(tRes2 and tRes2.status == "skipped" and tRes2.kind == "juvenile" and tRes2.sent == false, "log: skip kind")
	local tRow2 = find("resolve", "1802")
	check(tRow2 and tRow2.maturity == 0 and tRow2.key == "animal_2", "log: resolve shows the row's maturity")
	local tErr3 = find("server_error", "1803")
	check(tErr3 and tErr3.ignored == false and tErr3.code == 5 and tErr3.req == 42 and tErr3.name == "NotAllowed", "log: the listing's own error counts, with code, name, request")
	local tRes3 = find("result", "1803")
	check(tRes3 and tRes3.status == "refused" and tRes3.err == "NotAllowed", "log: refused with the server's name")
	local tEnd = find("end")
	check(tEnd and tEnd.phase == "done" and tEnd.counts.listed == 1 and tEnd.counts.skip_juvenile == 1 and tEnd.counts.refused == 1, "log: end counts")
	-- every logged value is printable by the formatter (no functions, no userdata)
	local bPlain = true
	for _, x in ipairs(tLog) do
		for _, v in pairs(x.t) do
			local sT = type(v)
			if sT ~= "string" and sT ~= "number" and sT ~= "boolean" and sT ~= "table" then bPlain = false end
		end
	end
	check(bPlain, "log: only plain values")
	-- Stop and pace are logged too
	tLog = {}
	reset()
	oStorage:TransitionIn()
	addAnimal(1811)
	addAnimal(1812)
	start(job(1000, { line(1811, "500", "max"), line(1812, "500", "max") }))
	fire("PZ2QoL_ListerPace", 2500)
	tick(2)
	fire("PZ2QoL_ListerStop")
	check(find("pace") and find("pace").ms == 2500, "log: pace change")
	check(find("stop") and find("stop").run ~= nil, "log: stop")
	check(find("end") and find("end").phase == "stopped", "log: stopped end")
	Core.bTrace = nil
	Core.Log = nil
	oStorage:TransitionOut()
end

-----------------------------------------------------------------------
-- 19. Ids the game gives in other shapes (in game 2026-10-18 only 4 of 63
-- rows gave a plain decimal): big floats, strings, nothing, userdata; a
-- float collision is no id; a row without an id is found by a unique
-- fingerprint, never by an ambiguous one; the send checks again by the
-- same rule; what failed is logged once per shape
-----------------------------------------------------------------------
do
	local function resolve(sReq, tKeys)
		fire("PZ2QoL_ListerResolve", sReq, table.concat(tKeys, ","))
		local t = sent("PZ2QoL_ListerIds")
		return decode(t[#t].tArgs[2])
	end
	local function lion(sName, t)
		t = t or {}
		t.species, t.name, t.gender = t.species or "Animal_Lion", sName, t.gender or 1
		return t
	end
	local BIG = 2.0 ^ 63
	-- the token rules themselves
	local s, bLossy, sWhy = Lister.IdToken(true, BIG, 2)
	check(s == string.format("%.0f", BIG) and string.match(s, "^922337203685477") and bLossy == true, "id: float 2^63 -> %.0f, lossy (" .. tostring(s) .. ")")
	s, bLossy = Lister.IdToken(true, 2.0 ^ 64 + 4096.0 * 4096.0 * 4096.0, 2)
	check(s == string.format("%.0f", 2.0 ^ 64 + 4096.0 * 4096.0 * 4096.0) and bLossy, "id: float above 2^64")
	s, bLossy = Lister.IdToken(true, 12345.0, 2)
	check(s == "12345" and not bLossy, "id: small whole float exact")
	s, bLossy = Lister.IdToken(true, 77, 2)
	check(s == "77" and not bLossy, "id: integer exact")
	check(Lister.IdToken(true, "a1B2-c3:d_4", 2) == "a1B2-c3:d_4", "id: GUID-like string")
	check(Lister.IdToken(true, " 991 ", 0) == "t0_991", "id: digit string, type 0")
	check(Lister.IdToken(true, 5, nil) == "tx_5", "id: no type kept apart")
	s, _, sWhy = Lister.IdToken(true, nil, 2)
	check(s == nil and sWhy == "nil", "id: nil -> none")
	s, _, sWhy = Lister.IdToken(true, io.stdout, 2)
	check(s == nil and sWhy == "userdata", "id: userdata -> none (" .. tostring(sWhy) .. ")")
	s, _, sWhy = Lister.IdToken(true, {}, 2)
	check(s == nil and sWhy == "table", "id: table -> none")
	check(Lister.IdToken(true, 0, 2) == nil and Lister.IdToken(true, "0", 2) == nil and Lister.IdToken(true, 0.0, 2) == nil, "id: zero -> none")
	check(Lister.IdToken(true, 12.5, 2) == nil and Lister.IdToken(true, 0 / 0, 2) == nil, "id: fraction, NaN -> none")
	check(Lister.IdToken(true, "a b", 2) == nil and Lister.IdToken(true, string.rep("x", 65), 2) == nil, "id: odd strings -> none")
	s, _, sWhy = Lister.IdToken(false, "boom", nil)
	check(s == nil and sWhy == "error", "id: call raised -> none")

	local tLog = {}
	Core.bTrace = true
	Core.Log = function(_, sArea, sEvent, t) tLog[#tLog + 1] = { area = sArea, ev = sEvent, t = t or {} } end
	local function logs(sEv)
		local t = {}
		for _, x in ipairs(tLog) do if x.ev == sEv then t[#t + 1] = x.t end end
		return t
	end

	-- a. float >= 2^63, string, nil, userdata (the last two look the same: no fingerprint either)
	reset()
	oStorage:TransitionIn()
	addAnimal(1901, lion("Big", { aidFn = function() return BIG, 2 end }))
	addAnimal(1902, lion("Str", { aidFn = function() return "abc-1902:x", 2 end }))
	addAnimal(1903, lion("Twin", { aidFn = function() return nil, nil end }))
	addAnimal(1904, lion("Twin", { aidFn = function() return io.stdout, 2 end }))
	tLog = {}
	local r = resolve("r19a", { "animal_1", "animal_2", "animal_3", "animal_4" })
	check(r.ids.animal_1 == string.format("%.0f", BIG) and r.via.animal_1 == "lossy", "a: big float resolved (lossy, unique)")
	check(r.ids.animal_2 == "abc-1902:x" and r.via.animal_2 == "id", "a: string id resolved")
	check(r.ids.animal_3 == nil and r.ids.animal_4 == nil and #r.failed == 2, "a: nil and userdata: no id, same fingerprint: failed")
	local tKeysLog = logs("resolve_keys")
	check(#tKeysLog == 1 and tKeysLog[1].failed == 2 and tKeysLog[1].via.lossy == 1 and tKeysLog[1].via.id == 1 and tKeysLog[1].via.none == 2 and tKeysLog[1].types["2"] == 2, "a: resolve_keys with the type and way mix")
	local tFail = logs("resolve_fail")
	check(#tFail == 2, "a: one resolve_fail line per shape (" .. #tFail .. ")")
	local tByType = {}
	for _, x in ipairs(tFail) do tByType[x.idType] = x end
	check(tByType["nil"] and tByType["nil"].ok == true and tByType["nil"].nType == "nil" and tByType["nil"].row == true and tByType["nil"].n == 1 and string.find(tByType["nil"].why, "ambiguous"), "a: the nil shape")
	check(tByType.userdata and tByType.userdata.nType == 2 and tByType.userdata.numType == nil and type(tByType.userdata.id) == "string" and #tByType.userdata.id <= 40, "a: the userdata shape (described, value cut)")
	-- asked again with nothing changed: no new lines
	resolve("r19a2", { "animal_1", "animal_2", "animal_3", "animal_4" })
	check(#logs("resolve_keys") == 1 and #logs("resolve_fail") == 2, "a: same answer again: not logged again")
	-- the send re-resolves by the same rule: both listed
	start(job(1000, { r.ids.animal_1 .. " animal_1 500 max", r.ids.animal_2 .. " animal_2 600 max" }))
	check(runToEnd(40), "a: run finished")
	check(#tAuctions == 2 and tAuctions[1].guid == 1901 and tAuctions[2].guid == 1902, "a: big float and string ids listed")

	-- b. float collision: no id; then the fingerprint if it is unique, else nothing
	reset()
	oStorage:TransitionIn()
	addAnimal(1911, lion("Kaya", { aidFn = function() return BIG, 2 end }))
	addAnimal(1912, lion("Zuri", { aidFn = function() return BIG, 2 end }))
	addAnimal(1913, lion("Same", { aidFn = function() return BIG * 4, 2 end }))
	addAnimal(1914, lion("Same", { aidFn = function() return BIG * 4, 2 end }))
	tLog = {}
	r = resolve("r19b", { "animal_1", "animal_2", "animal_3", "animal_4" })
	check(r.via.animal_1 == "fp" and r.via.animal_2 == "fp" and r.ids.animal_1 ~= r.ids.animal_2, "b: colliding floats: no id, unique fingerprints used")
	check(r.ids.animal_1 ~= string.format("%.0f", BIG) and r.ids.animal_2 ~= string.format("%.0f", BIG), "b: the colliding float is no id")
	check(r.ids.animal_3 == nil and r.ids.animal_4 == nil, "b: colliding floats and the same fingerprint: no id")
	tFail = logs("resolve_fail")
	check(#tFail == 1 and tFail[1].numType == "float" and tFail[1].n == 2 and string.find(tFail[1].why, "collision") and string.find(tFail[1].why, "ambiguous"), "b: collision logged with its shape")

	-- c. a unique fingerprint is listed (the right animal)
	reset()
	oStorage:TransitionIn()
	addAnimal(1921, lion("Solo", { aidFn = function() return nil end }))
	addAnimal(1922, lion("Other", { aidFn = function() return nil end }))
	r = resolve("r19c", { "animal_1", "animal_2" })
	check(r.via.animal_1 == "fp" and string.match(r.ids.animal_1, "^fp%d+$") and r.rows.animal_1.name == "Solo", "c: fingerprint token")
	start(job(1000, { r.ids.animal_1 .. " animal_1 500 max" }))
	check(runToEnd(30), "c: run finished")
	check(#tAuctions == 1 and tAuctions[1].guid == 1921 and lastState().results[1].status == "listed", "c: listed the animal with that fingerprint")

	-- d. two identical fingerprints: skipped as ambiguous, never sent
	reset()
	oStorage:TransitionIn()
	addAnimal(1931, lion("Nala", { aidFn = function() return nil end }))
	addAnimal(1932, lion("Sarabi", { aidFn = function() return nil end }))
	r = resolve("r19d", { "animal_1", "animal_2" })
	local sTok = r.ids.animal_1
	tAnimals[1932].name = "Nala" -- a look-alike now (renamed): can't be told apart
	start(job(1000, { sTok .. " animal_1 500 max" }))
	check(runToEnd(30), "d: run finished")
	check(#tAuctions == 0 and lastState().results[1].kind == "ambiguous", "d: ambiguous before selecting (" .. tostring(lastState().results[1].kind) .. ")")
	check(countMarks("lister_skip_ambiguous") == 1, "d: traced")
	-- ... and when the look-alike appears between the selection and the send
	reset()
	oStorage:TransitionIn()
	addAnimal(1935, lion("Kiara", { aidFn = function() return nil end, onSelect = function() after(0.35, function() tAnimals[1936].name = "Kiara" end) end }))
	addAnimal(1936, lion("Vitani", { aidFn = function() return nil end }))
	r = resolve("r19d2", { "animal_1", "animal_2" })
	start(job(1000, { r.ids.animal_1 .. " animal_1 500 max" }))
	check(runToEnd(30), "d2: run finished")
	check(#tAuctions == 0 and lastState().results[1].kind == "ambiguous", "d2: checked again at the send: ambiguous (" .. tostring(lastState().results[1].kind) .. ")")

	-- e. the list reshuffled between Resolve and the send: the right key, or a skip
	reset()
	oStorage:TransitionIn()
	addAnimal(1941, lion("Asha", { aidFn = function() return nil end }))
	addAnimal(1942, lion("Bahati", { aidFn = function() return nil end }))
	addAnimal(1943, lion("Chui", { aidFn = function() return BIG * 2, 2 end }))
	r = resolve("r19e", { "animal_1", "animal_2", "animal_3" })
	reshuffle({ 1943, 1942, 1941 })
	start(job(1000, { r.ids.animal_1 .. " animal_1 500 max", r.ids.animal_3 .. " animal_3 600 max" }))
	check(runToEnd(40), "e: run finished")
	check(#tAuctions == 2 and tAuctions[1].guid == 1941 and tAuctions[1].key == "animal_3" and tAuctions[2].guid == 1943 and tAuctions[2].key == "animal_1", "e: fingerprint and lossy ids found under their new keys")
	-- reshuffled while it settles (after the selection): changed, the animal now at the key not listed
	reset()
	oStorage:TransitionIn()
	addAnimal(1945, lion("Dalila", { aidFn = function() return nil end, onSelect = function() after(0.35, function() reshuffle({ 1946, 1945 }) end) end }))
	addAnimal(1946, lion("Eshe", { aidFn = function() return nil end }))
	r = resolve("r19e2", { "animal_1", "animal_2" })
	start(job(1000, { r.ids.animal_1 .. " animal_1 500 max" }))
	check(runToEnd(30), "e2: run finished")
	check(#tAuctions == 0 and lastState().results[1].kind == "changed", "e2: reshuffled before the send: changed (" .. tostring(lastState().results[1].kind) .. ")")
	-- an id that follows the position, not the animal: the row no longer
	-- shows what Resolve saw with it, so it is not listed
	reset()
	oStorage:TransitionIn()
	local function byPos(sKey) return tonumber(string.match(sKey, "%d+")) + 500, 0 end
	addAnimal(1951, lion("Fumo", { aidFn = byPos }))
	addAnimal(1952, lion("Gamba", { aidFn = byPos }))
	r = resolve("r19f", { "animal_1", "animal_2" })
	check(r.ids.animal_1 == "t0_501", "f: position-like id resolved")
	reshuffle({ 1952, 1951 })
	start(job(1000, { r.ids.animal_1 .. " animal_1 500 max" }))
	check(runToEnd(30), "f: run finished")
	check(#tAuctions == 0 and lastState().results[1].status == "skipped", "f: the animal now at that position was not listed (" .. tostring(lastState().results[1].kind) .. ")")

	Core.bTrace = nil
	Core.Log = nil
	oStorage:TransitionOut()
end

-----------------------------------------------------------------------
-- 20. Quick trade / quick release (docs/PLAN-desk-quick-release.md,
-- Phases 0 and 1): the page report v2, check runs (they never send), the
-- Phase 0a log lines, and the log-only wrappers around the game's own
-- quick handlers (Phase 0b)
-----------------------------------------------------------------------
do
	-- encodeURIComponent, as the page writes v2's text fields
	local function pct(s)
		return (string.gsub(tostring(s or ""), "[^%w%-_%.!~%*'%(%)]", function(c) return string.format("%%%02X", string.byte(c)) end))
	end
	local sLong = "[AnimalExchange_Conditions_Concatenate:first=[AnimalExchange_Conditions_Concatenate:first=[AnimalList_SelectionCannotTrade]:second=[AnimalExchange_Conditions_NewLine]]:second=[AnimalList_Problem_NoBirthZoo]]"
	local sOdd = "a|b,c%d 100% |x| \195\169"
	local sV2 = table.concat({ "v2", "animal_3", "animal_3", "0", "100,5000,812.5,1,12,6", pct(sLong), "1", "", pct("$1,200"), "0", pct(sOdd), pct("85"),
		"0", "1200,85", "1,0", "-", pct("[AnimalExchange_Source_Description:Value=|Wild|]") }, "|")
	local p2 = Lister.ParseSeen(sV2)
	check(p2 and p2.nV == 2 and p2.sKey == "animal_3" and p2.tSel[1] == "animal_3" and p2.bAllowed == false, "v2: key, selection, allowed")
	check(p2 and p2.sReason == sLong and p2.tLimits.nPriceDefault == 812.5 and p2.tLimits.nHoursMax == 12, "v2: the long nested reason survives, limits")
	check(p2 and p2.tQuick.bTrade == true and p2.tQuick.sTradeValue == "$1,200" and p2.tQuick.bRelease == false and p2.tQuick.sReleaseReason == sOdd and p2.tQuick.sReleaseValue == "85", "v2: quick fields with | , % decoded")
	check(p2 and p2.tQuick.bRehome == false and p2.tQuick.nTradePrice == 1200 and p2.tQuick.nReleasePrice == 85, "v2: rehome and the numeric prices")
	check(p2 and p2.tNet.bConn == true and p2.tNet.bLoading == false and p2.bReleaseable == nil and p2.sSource == "[AnimalExchange_Source_Description:Value=|Wild|]", "v2: network, filter, source")
	local p1 = Lister.ParseSeen("v1|animal_3|animal_3|1|100,5000,812.5,1,12,6|[x|y]")
	check(p1 and p1.nV == 1 and p1.bAllowed == true and p1.sReason == "[x|y]" and p1.tQuick == nil, "v1 still parsed")
	check(Lister.ParseSeen("v2|animal_3|animal_3|1|1,2,3,4,5,6|") == nil and Lister.ParseSeen("v2||a|1|||||||||||||") == nil, "v2: too few fields or no key refused")
	check(Lister.Unpct("%7C%2C%25") == "|,%" and Lister.CompactReason(sLong) == "[AnimalList_Problem_NoBirthZoo]" and Lister.CompactReason("plain") == "plain", "unpct, compact reason")
	local tJ, nP, sM = Lister.ParseJob("v1 150 check\n11 animal_1 - default")
	check(tJ and #tJ == 1 and nP == 150 and sM == "check", "job: check mode")
	tJ, nP, sM = Lister.ParseJob("v1 3000\n11 animal_1 500 max")
	check(tJ and sM == "list", "job: no word is a listing")
	tJ, nP = Lister.ParseJob("v1 3000 sellall\n11 animal_1 500 max")
	check(tJ == nil and string.find(nP, "Unknown job mode", 1, true), "job: an unknown mode is refused")

	-- the fake page, v2: what the game shows, quick fields included
	local function pageTextV2()
		local A, L = tNative.tActions, tNative.tLimits
		local function f(v) return v == true and "1" or v == false and "0" or "-" end
		local function n(v) return type(v) == "number" and tostring(v) or "-" end
		local tN = {}
		for _, sName in ipairs({ "tradePriceMin", "tradePriceMax", "tradePriceDefault", "tradeDurationMin", "tradeDurationMax", "tradeDurationDefault" }) do tN[#tN + 1] = n(L[sName]) end
		return table.concat({ "v2", tPage.sKey, table.concat(tNative.tSelection, ","), f(A.tradeAllowed), table.concat(tN, ","), pct(A.tradeDisallowedReason),
			f(A.quickTradeAllowed), pct(A.quickTradeDisallowedReason), pct(A.quickTradeValue), f(A.quickReleaseAllowed), pct(A.quickReleaseDisallowedReason),
			pct(A.quickReleaseValue), f(A.rehomeAllowed), n(L.quickTradePrice) .. "," .. n(L.quickReleasePrice), f(tNative.bConnecting) .. "," .. f(tNative.bLoading),
			"-", pct(tPage.sSource or "") }, "|")
	end
	local function lim(t)
		local l = defaultLimits()
		for k, v in pairs(t or {}) do l[k] = v end
		return l
	end
	local tMarket = { quick = { quickTradeAllowed = true, quickTradeValue = "$900", quickReleaseAllowed = true, quickReleaseValue = "40", rehomeAllowed = false }, limits = lim({ quickTradePrice = 900, quickReleasePrice = 40 }) }
	local tQuickOnly = { tradeAllowed = false, reason = sLong, limits = lim({ quickTradePrice = 1200, quickReleasePrice = 85 }),
		quick = { quickTradeAllowed = true, quickTradeValue = "$1,200", quickReleaseAllowed = false, quickReleaseDisallowedReason = sLong, quickReleaseValue = "85", rehomeAllowed = false } }
	local tRehome = { tradeAllowed = false, reason = "[AnimalList_Problem_CantBeSold]", quick = { quickTradeAllowed = false, quickReleaseAllowed = false, rehomeAllowed = true } }
	local function checkJob(tSpec, nPace)
		local tLines = {}
		for _, a in ipairs(tSpec) do tLines[#tLines + 1] = line(a[1], "-", "default") end
		return "v1 " .. (nPace or 150) .. " check\n" .. table.concat(tLines, "\n")
	end
	local function checkRun(tSpec, tPageSetup, nPace)
		reset()
		oStorage:TransitionIn()
		fnPageFrame = fnPageFrameSaved
		pageReset(tPageSetup or { fnText = pageTextV2 })
		for _, a in ipairs(tSpec) do addAnimal(a[1], a[2]) end
		return start(checkJob(tSpec, nPace))
	end

	-- a check run: every animal selected and recorded, nothing sent, the selection cleared after
	local tLog = {}
	Core.bTrace = true
	Core.Log = function(_, sArea, sEvent, t) tLog[#tLog + 1] = { area = sArea, ev = sEvent, t = t or {} } end
	local function find(sEv, sGuid)
		for _, x in ipairs(tLog) do
			if x.ev == sEv and (sGuid == nil or x.t.guid == sGuid) then return x.t end
		end
	end
	local function count(sEv)
		local n = 0
		for _, x in ipairs(tLog) do if x.ev == sEv then n = n + 1 end end
		return n
	end
	local nListerPace = Lister.nPaceMs
	checkRun({ { 2001, tMarket }, { 2002, tQuickOnly }, { 2003, tRehome } }, nil, 50)
	check(runToEnd(60), "check: run finished")
	local sc = lastState()
	check(#tAuctions == 0 and #calls("QuickTrade") == 0 and #calls("Release") == 0, "check: nothing sent (" .. #tAuctions .. " listings)")
	check(sc.mode == "check" and sc.phase == "done" and sc.message == "Checked 3 of 3." and sc.paceMs == 150, "check: state (" .. tostring(sc.message) .. ", pace " .. tostring(sc.paceMs) .. ")")
	check(Lister.nPaceMs == nListerPace, "check: the listing pace is left alone")
	check(sc.results[1].status == "checked" and sc.results[2].status == "checked" and sc.results[3].status == "checked", "check: every animal checked")
	local v1, v2, v3 = sc.results[1].verdict, sc.results[2].verdict, sc.results[3].verdict
	check(v1.trade == true and v1.quickTrade == true and v1.quickTradePrice == 900 and v1.src == "page" and v1.v == 2, "check: market animal's verdict")
	check(v2.trade == false and v2.tradeWhy == "[AnimalList_Problem_NoBirthZoo]" and v2.quickTrade == true and v2.quickTradeValue == "$1,200" and v2.quickTradePrice == 1200, "check: quick-only animal's verdict")
	check(v2.quickRelease == false and v2.quickReleaseWhy == "[AnimalList_Problem_NoBirthZoo]" and v2.quickReleasePrice == 85 and v2.rehome == false, "check: its release refused with the reason")
	check(v3.trade == false and v3.rehome == true and v3.quickTrade == false and v3.tradeWhy == "[AnimalList_Problem_CantBeSold]", "check: rehome-only verdict")
	local tSel3 = calls("Select")
	local tClr = calls("Clear")
	check(#tSel3 == 3 and #tClr >= 4 and tClr[#tClr].t >= tSel3[3].t and #tNative.tSelection == 0, "check: the selection ends cleared")
	check(countMarks("lister_check_start") == 1 and countMarks("lister_check_cleared") == 1 and countMarks("lister_checked") == 3, "check: marked")
	check(countMarks("lister_cat_market") == 1 and countMarks("lister_cat_quick") == 1 and countMarks("lister_cat_rehome") == 1 and countMarks("lister_quick_seen_page") == 1, "check: a category mark per animal")
	check(countMarks("lister_select_net_quiet") == 3 and countMarks("lister_select_net_busy") == 0, "check: no request seen around the selects")
	-- the pause between checks is the check pace (150 ms), not the listing pace
	local nGap = tSel3[2].t - tSel3[1].t
	check(nGap < 2.5, "check: quick between animals (" .. nGap .. " s)")
	-- Phase 0a lines
	local q2 = find("quick", "2002")
	check(q2 and q2.qt == true and q2.qtPrice == 1200 and q2.qtValue == "$1,200" and q2.qr == false and q2.qrWhy == "[AnimalList_Problem_NoBirthZoo]" and q2.trade == false, "0a: the quick line (flags, value text, numeric price)")
	local n2 = find("select_net", "2002")
	check(n2 and n2.before == "c0l0d0" and n2.after == "c0l0d0" and n2.busy == false, "0a: the network before and after the select (" .. tostring(n2 and n2.before) .. ")")
	check(find("start") and find("start").mode == "check", "0a: start logs the mode")

	-- a select that shows a request (the database busy while it waits): marked busy, with the type
	tLog = {}
	checkRun({ { 2011, { quick = tMarket.quick, limits = tMarket.limits, onSelect = function()
		after(0.05, function() tNative.bDbBusy = true end)
		after(0.2, function() tNative.bDbBusy = false end)
	end } } })
	check(runToEnd(30), "0a busy: finished")
	local n11 = find("select_net", "2011")
	check(n11 and n11.busy == true and n11.dbType == 42 and countMarks("lister_select_net_busy") == 1, "0a: a request during the select is seen (" .. tostring(n11 and n11.dbType) .. ")")
	-- the row's source text is logged by resolve
	tLog = {}
	checkRun({ { 2012, { source = "[AnimalExchange_Source_Description:Value=|Wild|]", quick = tMarket.quick, limits = tMarket.limits } } })
	check(runToEnd(30), "0a source: finished")
	check(find("resolve", "2012") and find("resolve", "2012").source == "[AnimalExchange_Source_Description:Value=|Wild|]", "0a: the row's source text logged")
	-- a server error during a run: its request type marked
	tLog = {}
	checkRun({ { 2013, { quick = tMarket.quick, limits = tMarket.limits, onSelect = function() after(0.1, function() serverError(5, 28) end) end } } })
	check(runToEnd(30), "0a error: finished")
	check(countMarks("lister_server_error_type_28") == 1 and find("server_error") and find("server_error").req == 28, "0a: the request type of an error during the run")

	-- Stop in the middle of a check: at once, the rest stays to do, nothing selected after
	checkRun({ { 2021, tMarket }, { 2022, tQuickOnly }, { 2023, tMarket } })
	check(tickUntil(function() local st = lastState(); return st and st.index == 1 and st.step == "select" end, 30), "check stop: reached the second select")
	fire("PZ2QoL_ListerStop")
	local sStop = lastState()
	check(sStop.phase == "stopped" and sStop.results[1].status == "checked" and sStop.results[2].status == "pending" and sStop.results[3].status == "pending", "check stop: the rest stays to do")
	seconds(1)
	check(#tNative.tSelection == 0 and #tAuctions == 0 and Lister.tRun == nil, "check stop: nothing selected after, nothing sent")

	-- by Lua's own reads alone (no page): still recorded, from Lua
	checkRun({ { 2031, tQuickOnly } }, { bOn = false })
	check(runToEnd(30), "check lua: finished")
	sc = lastState()
	check(sc.results[1].status == "checked" and sc.results[1].verdict.src == "lua" and sc.results[1].verdict.quickTrade == true and sc.results[1].verdict.quickTradePrice == 1200, "check: Lua's reads as the fallback")

	-- a check needs no online Franchise (it sends nothing); a listing still does
	reset()
	oStorage:TransitionIn()
	tNative.nHubType = 1
	addAnimal(2041, tMarket)
	start(checkJob({ { 2041 } }))
	check(Lister.tRun ~= nil and Lister.tRun.sMode == "check", "check: runs offline")
	fire("PZ2QoL_ListerStop")
	start(job(1000, { line(2041, "500", "max") }))
	check(Lister.tRun == nil and lastState().refused == true, "check: a listing offline is still refused")
	-- a second start while a check runs is refused
	tNative.nHubType = 2
	start(checkJob({ { 2041 } }))
	local nRun = Lister.tRun and Lister.tRun.nId
	start(job(1000, { line(2041, "500", "max") }))
	check(Lister.tRun ~= nil and Lister.tRun.nId == nRun and Lister.tRun.sMode == "check", "check: a second start is refused while it runs")
	fire("PZ2QoL_ListerStop")

	-- belt and braces: a check that somehow reaches the send step sends nothing
	checkRun({ { 2051, tMarket } })
	check(tickUntil(function() return Lister.tRun ~= nil and Lister.tRun.sStep == "selected" end, 30), "send guard: selected")
	Lister.tRun.sStep = "send"
	tick(2)
	check(#tAuctions == 0 and countMarks("lister_check_send_blocked") == 1, "send guard: nothing sent")
	runToEnd(30)

	-- a listing run with a v2 page records the verdicts too, and lists as before
	s = pageRun({ page = { fnText = pageTextV2 } }, { { 2061, tQuickOnly }, { 2062, tMarket } }, "list v2")
	check(#tAuctions == 1 and tAuctions[1].guid == 2062 and s.mode == "list", "list v2: only the market animal listed")
	check(s.results[1].kind == "untradeable" and s.results[1].verdict.quickTrade == true and s.results[2].status == "listed" and s.results[2].verdict.trade == true, "list v2: verdicts recorded")
	fnPageFrame = nil

	-- Phase 0b: the game's quick handlers, wrapped to log only
	check(StorageMode.OnQuickTradeAnimals ~= fnGameQuickTrade and StorageMode.OnReleaseAnimalsToWild ~= fnGameRelease, "0b: both handlers wrapped")
	reset()
	oStorage:TransitionIn()
	addAnimal(2101, { species = "Lion", name = "Kito" })
	addAnimal(2102, { species = "Lion", name = "Nala" })
	tLog = {}
	tNative.tListReads = {}
	local tIDs = { "animal_1" }
	local nProbeAt = nClock
	local tR = table.pack(oStorage:OnQuickTradeAnimals(tIDs))
	local cq = calls("GameQuickTrade")
	check(#cq == 1 and cq[1].tArgs.n == 2 and cq[1].tArgs[1] == oStorage and rawequal(cq[1].tArgs[2], tIDs), "0b: the game's handler got exactly self and the same table")
	check(tR.n == 3 and tR[1] == "qt" and tR[2] == nil and tR[3] == 3, "0b: its results passed back")
	check(#tIDs == 1 and tIDs[1] == "animal_1", "0b: the table unchanged")
	check(#calls("Auction") + #calls("Select") + #calls("Clear") + #calls("QuickTrade") + #calls("Release") == 0, "0b: the wrapper sends nothing itself")
	local tc = find("probe_call")
	check(tc and tc.kind == "quicktrade" and tc.type == "table" and tc.len == 1 and tc.count == 1 and tc.kmin == 1 and tc.kmax == 1 and tc.nargs == 2, "0b: the _tIDs shape logged")
	local ti = find("probe_id")
	check(ti and ti.vtype == "string" and ti.v == "animal_1" and ti.guid == "2101" and ti.key == "animal_1" and ti.via == "key", "0b: each value, its type and the animal it names")
	check(countMarks("lister_probe_quicktrade") == 1 and find("probe_after") ~= nil, "0b: marked, and the network right after")
	seconds(2)
	serverError(5, 31)
	local te = find("probe_server_error")
	check(te and te.code == 5 and te.req == 31 and te.ms >= 1900 and countMarks("lister_server_error_type_31") == 1, "0b: a server error in the next 10 s logged with its request type")
	-- the sale: the row leaves the storage list
	reshuffle({ 2102 })
	seconds(1)
	local tg = find("probe_gone")
	check(tg and tg.guid == "2101" and tg.ms >= 2000 and tg.ms <= 3500, "0b: when the row left the list (" .. tostring(tg and tg.ms) .. " ms)")
	check(find("probe_end") and find("probe_end").gone == 1 and Lister.tProbe == nil, "0b: the watch ends when every row is gone")
	-- reading the list while the game applies the quick trade crashed a 3.2.0
	-- player's game (Nexus, 2026-10-20): no probe read in the second after it
	local nEarlyProbe = 0
	for _, r in ipairs(tNative.tListReads) do
		if r > nProbeAt and r < nProbeAt + 1.0 then nEarlyProbe = nEarlyProbe + 1 end
	end
	check(nEarlyProbe == 0 and #tNative.tListReads >= 2, "0b: the list is not read in the second after the handler (" .. nEarlyProbe .. " of " .. #tNative.tListReads .. ")")
	-- nor while the game says it is loading the list (network.loadingItems):
	-- the watch waits, then reads again once the list has loaded
	reset()
	oStorage:TransitionIn()
	addAnimal(2103, { species = "Lion", name = "Zuri" })
	tNative.bLoading = true
	oStorage:OnQuickTradeAnimals({ "animal_1" })
	local nLoadingFrom = nClock
	seconds(3)
	local nLoadingReads = 0
	for _, r in ipairs(tNative.tListReads or {}) do if r > nLoadingFrom then nLoadingReads = nLoadingReads + 1 end end
	tNative.bLoading = false
	check(nLoadingReads == 0, "0b: the list is not read while it loads (" .. nLoadingReads .. ")")
	local nLoadedAt = nClock
	seconds(1)
	local nLoadedReads = 0
	for _, r in ipairs(tNative.tListReads or {}) do if r > nLoadedAt then nLoadedReads = nLoadedReads + 1 end end
	check(nLoadedReads > 0 and Lister.tProbe ~= nil, "0b: the watch reads again once the list has loaded (" .. nLoadedReads .. ")")
	Lister.tProbe = nil
	seconds(9)
	local nErr = count("probe_server_error")
	serverError(5, 31)
	check(count("probe_server_error") == nErr, "0b: errors after 10 s are not the probe's")
	-- odd ids and extra arguments: the game's handler still gets exactly them
	local tOdd = { [0] = 12345.0, "x", n = 2 }
	tR = table.pack(oStorage:OnReleaseAnimalsToWild(tOdd, "extra"))
	local cr = calls("GameRelease")
	check(#cr == 1 and cr[1].tArgs.n == 3 and rawequal(cr[1].tArgs[2], tOdd) and cr[1].tArgs[3] == "extra" and tR.n == 1 and tR[1] == "rel", "0b: release: the same arguments and result")
	tc = nil
	for _, x in ipairs(tLog) do if x.ev == "probe_call" and x.t.kind == "release" then tc = x.t end end
	check(tc and tc.kmin == 0 and tc.kmax == 1 and tc.count == 3, "0b: release: a 0-based or odd table's keys logged")
	oStorage:OnReleaseAnimalsToWild(nil)
	check(#calls("GameRelease") == 2, "0b: no ids: the game's handler still runs")
	-- the probe itself failing never keeps the game's handler from running
	local fnProbe = Lister._ProbeQuick
	Lister._ProbeQuick = function() error("probe broke") end
	oStorage:OnQuickTradeAnimals({ "animal_1" })
	Lister._ProbeQuick = fnProbe
	check(#calls("GameQuickTrade") == 2 and countMarks("lister_probe_fail") == 1, "0b: a failing probe: the handler still runs")
	-- the game's handler raising: the caller sees it, as in vanilla
	StorageModeThrow = true
	local bOkGame = pcall(oStorage.OnQuickTradeAnimals, oStorage, { "animal_1" })
	StorageModeThrow = nil
	check(not bOkGame, "0b: the game's own error is not swallowed")
	-- no handler to wrap (another build): nothing breaks
	local tBare = { TransitionIn = function() end, TransitionOut = function() end, Advance = function() end }
	local bOkBare = pcall(Lister._PatchStorageMode, Lister, tBare)
	check(bOkBare and tBare.OnQuickTradeAnimals == nil, "0b: a hub mode without the handlers is left alone")
	Core.bTrace = nil
	Core.Log = nil
	-- a release build has no log: no probe, the game's handler alone
	tNative.tListReads = {}
	local nGameQt = #calls("GameQuickTrade")
	local nProbes = Lister.nProbes
	oStorage:OnQuickTradeAnimals({ "animal_1" })
	seconds(3)
	check(#calls("GameQuickTrade") == nGameQt + 1 and Lister.nProbes == nProbes and Lister.tProbe == nil and #tNative.tListReads == 0, "0b: release build: no probe and no list read, the handler still runs (" .. (#calls("GameQuickTrade") - nGameQt) .. " " .. tostring(Lister.nProbes - nProbes) .. " " .. tostring(Lister.tProbe) .. " " .. #tNative.tListReads .. ")")
	oStorage:TransitionOut()
	check(#calls("QuickTrade") == 0 and #calls("Release") == 0, "the engine never called the quick natives")
end

-----------------------------------------------------------------------
-- 21. Quick trade / quick release from the desk (Phase 2,
-- docs/PLAN-desk-quick-release.md 4.3): page-report-only sends of exactly
-- { [1] = key }, the allowed flag, _IsSelected (page only) and _Holds in
-- the send tick, _Busy and the data settle, the storage list deciding,
-- the stops (two missing reports, timeout, ambiguity, reload, mod error),
-- Stop after the current animal, the frozen job
-----------------------------------------------------------------------
do
	local function pct(s)
		return (string.gsub(tostring(s or ""), "[^%w%-_%.!~%*'%(%)]", function(c) return string.format("%%%02X", string.byte(c)) end))
	end
	local function lim(t)
		local l = defaultLimits()
		for k, v in pairs(t or {}) do l[k] = v end
		return l
	end
	-- the page, v2 with its page id (listerlua.js PAGE)
	local function pageTextQ()
		local A, L = tNative.tActions, tNative.tLimits
		local function f(v) return v == true and "1" or v == false and "0" or "-" end
		local function n(v) return type(v) == "number" and tostring(v) or "-" end
		local tN = {}
		for _, sName in ipairs({ "tradePriceMin", "tradePriceMax", "tradePriceDefault", "tradeDurationMin", "tradeDurationMax", "tradeDurationDefault" }) do tN[#tN + 1] = n(L[sName]) end
		local tSel = tPage.fnSel and tPage.fnSel() or tNative.tSelection
		return table.concat({ "v2", tPage.sKey, table.concat(tSel, ","), f(A.tradeAllowed), table.concat(tN, ","), pct(A.tradeDisallowedReason),
			f(A.quickTradeAllowed), pct(A.quickTradeDisallowedReason), pct(A.quickTradeValue), f(A.quickReleaseAllowed), pct(A.quickReleaseDisallowedReason),
			pct(A.quickReleaseValue), f(A.rehomeAllowed), n(L.quickTradePrice) .. "," .. n(L.quickReleasePrice), f(tNative.bConnecting) .. "," .. f(tNative.bLoading),
			"-", pct(""), tPage.sPageId or "PG1" }, "|")
	end
	local NBZ = "[AnimalExchange_Conditions_Concatenate:first=[AnimalList_SelectionCannotTrade]:second=[AnimalList_Problem_NoBirthZoo]]"
	local function quick(t)
		local o = { tradeAllowed = false, reason = NBZ, limits = lim({ quickTradePrice = 1200, quickReleasePrice = 85 }),
			quick = { quickTradeAllowed = true, quickTradeValue = "[COST:Value={1200}]", quickReleaseAllowed = true, quickReleaseValue = "[INT_VALUE:Value={85}]", rehomeAllowed = false } }
		for k, v in pairs(t or {}) do
			if k == "q" then for kk, vv in pairs(v) do o.quick[kk] = vv end else o[k] = v end
		end
		return o
	end
	local nQ = 0
	local function quickRun(tSpec, sMode, tOpt)
		tOpt = tOpt or {}
		reset()
		oStorage:TransitionIn()
		for k, v in pairs(tOpt.native or {}) do tNative[k] = v end
		fnPageFrame = fnPageFrameSaved
		pageReset(tOpt.page or { fnText = pageTextQ })
		-- every animal with a species and its own name (as in game): its look is known
		for _, a in ipairs(tSpec) do
			local tA = a[2] or {}
			tA.species = tA.species or "Lion"
			tA.name = tA.name or ("Q" .. tostring(a[1]))
			addAnimal(a[1], tA)
		end
		local tLines = {}
		for _, a in ipairs(tSpec) do tLines[#tLines + 1] = (a.token or gs(a[1])) .. " " .. (keyOf(a[1]) or "-") .. " - default" end
		nQ = nQ + 1
		local sR = "R" .. (tOpt.pageId or "PG1") .. "_" .. nQ
		local nF = #oView.tSent
		fire("PZ2QoL_ListerStart", sR, "v1 " .. (tOpt.pace or 1000) .. " " .. sMode .. "\n" .. table.concat(tLines, "\n"))
		return sR, nF
	end
	local tLog = {}
	Core.bTrace = true
	Core.Log = function(_, sArea, sEvent, t) tLog[#tLog + 1] = { area = sArea, ev = sEvent, t = t or {} } end
	local function find(sEv, sGuid)
		for _, x in ipairs(tLog) do
			if x.ev == sEv and (sGuid == nil or x.t.guid == sGuid) then return x.t end
		end
	end
	local function sends(sName)
		local t = {}
		for _, c in ipairs(calls(sName)) do t[#t + 1] = c end
		return t
	end

	-- A. two animals quick-traded: one key each, exactly the handler's shape, the list decides
	tLog = {}
	quickRun({ { 3001, quick() }, { 3002, quick({ limits = lim({ quickTradePrice = 1250, quickReleasePrice = 88 }), q = { quickTradeValue = "[COST:Value={1250}]" } }) } }, "quicktrade")
	check(runToEnd(60), "quick: run finished")
	local s = lastState()
	local q = sends("QuickTrade")
	check(#q == 2 and #calls("Release") == 0 and #tAuctions == 0, "quick: two quick trades, nothing else (" .. #q .. ")")
	check(q[1] and q[1].tArgs.n == 1 and type(q[1].tArgs[1]) == "table" and #q[1].tArgs[1] == 1 and q[1].tArgs[1][1] == "animal_1", "quick: { [1] = key }, one key per call")
	local nKeys = 0
	for _ in pairs(q[1] and q[1].tArgs[1] or {}) do nKeys = nKeys + 1 end
	check(nKeys == 1, "quick: the table holds the key only")
	check(s.mode == "quicktrade" and s.phase == "done" and s.message == "Quick-traded 2 of 2." and s.results[1].status == "traded" and s.results[2].status == "traded", "quick: done (" .. tostring(s.message) .. ")")
	check(s.results[1].price == 1200 and s.results[1].verdict.quickTrade == true, "quick: the price and verdict with the result")
	local g1 = find("quick_gone", "3001")
	check(g1 and g1.ms >= 1000 and g1.ms <= 1600, "quick: quick_gone ms logged, gone read twice (" .. tostring(g1 and g1.ms) .. ")")
	check(q[2] and q[2].t - q[1].t >= 1.0, "quick: a pause of at least 1 s between the two")
	check(countMarks("lister_quick_send") == 2 and countMarks("lister_quick_gone") == 2, "quick: marked")

	-- B. release: its own native and flag
	quickRun({ { 3011, quick() } }, "release")
	check(runToEnd(30), "release: finished")
	s = lastState()
	check(#calls("Release") == 1 and #calls("QuickTrade") == 0 and s.results[1].status == "released" and s.results[1].price == 85 and s.message == "Released 1 of 1.", "release: sent and confirmed")
	-- release not allowed (CashSeeded): skipped with the reason, the next goes
	quickRun({ { 3012, quick({ q = { quickReleaseAllowed = false, quickReleaseDisallowedReason = "[AnimalList_Problem_CashSeeded]" } }) }, { 3013, quick() } }, "release")
	check(runToEnd(30), "release not allowed: finished")
	s = lastState()
	check(#calls("Release") == 1 and s.results[1].kind == "notallowed" and s.results[1].detail == "[AnimalList_Problem_CashSeeded]" and s.results[2].status == "released" and s.phase == "done", "release: not allowed skipped, the run goes on")
	-- rehome offered: never quick-traded
	quickRun({ { 3014, quick({ q = { rehomeAllowed = true } }) } }, "quicktrade")
	check(runToEnd(30), "rehome: finished")
	check(#calls("QuickTrade") == 0 and lastState().results[1].kind == "rehome", "rehome: skipped")

	-- C. Lua's own reads only (no page report): nothing sent; two in a row stop the run
	quickRun({ { 3021, quick() }, { 3022, quick() }, { 3023, quick() } }, "quicktrade", { page = { bOn = false } })
	check(runToEnd(60), "no page: finished")
	s = lastState()
	check(#calls("QuickTrade") == 0, "no page: nothing sent on Lua's reads")
	check(s.phase == "stopped" and s.results[1].kind == "nopage" and s.results[2].kind == "nopage" and s.results[3].status == "pending" and string.find(s.message, "no fresh report", 1, true), "no page: stopped after two (" .. tostring(s.message) .. ")")
	-- stale reports (the page goes quiet after the select): no send either
	quickRun({ { 3024, quick() } }, "quicktrade", { page = { fnText = pageTextQ, nMax = 3 } })
	check(runToEnd(60), "stale: finished")
	check(#calls("QuickTrade") == 0 and lastState().results[1].kind == "nopage", "stale reports: not sent")
	-- a v1 page (no quick fields): never sent
	quickRun({ { 3025, quick() } }, "quicktrade", { page = {} })
	check(runToEnd(60), "v1 page: finished")
	check(#calls("QuickTrade") == 0, "v1 page: not sent")

	-- D. the send tick: the selection changed (page) -> not sent, the run STOPS (review 2026-10-18)
	quickRun({ { 3031, quick({ onSelect = function()
		after(0.4, function() tNative.bDbBusy = true end)
		after(2.5, function() tPage.fnSel = function() return { "animal_2" } end end)
		after(3.5, function() tNative.bDbBusy = false end)
	end }) }, { 3032, quick() } }, "quicktrade")
	check(runToEnd(60), "sel changed: finished")
	s = lastState()
	q = sends("QuickTrade")
	check(#q == 0 and s.results[1].kind == "changed" and s.phase == "stopped" and s.results[2].status == "pending" and string.find(s.message, "selection changed", 1, true), "_IsSelected false: not sent, the run stopped (" .. tostring(s.results[1].kind) .. ", " .. tostring(s.message) .. ")")
	-- the key moved to another animal -> _Holds false, not sent
	quickRun({ { 3041, quick({ onSelect = function()
		after(0.4, function() tNative.bDbBusy = true end)
		after(2.5, function() reshuffle({ 3042, 3041 }) end)
		after(3.5, function() tNative.bDbBusy = false end)
	end }) }, { 3042, quick({ q = { quickTradeAllowed = false } }) } }, "quicktrade")
	check(runToEnd(60), "holds: finished")
	check(#calls("QuickTrade") == 0 and lastState().results[1].kind == "changed" and lastState().phase == "stopped" and lastState().results[2].status == "pending", "_Holds false: not sent, the run stopped (" .. tostring(lastState().results[1].kind) .. ")")
	-- busy for good: wait, then stop (only "not allowed now" skips)
	quickRun({ { 3051, quick({ onSelect = function() after(0.4, function() tNative.bDbBusy = true end) after(12, function() tNative.bDbBusy = false end) end }) }, { 3052, quick() } }, "quicktrade")
	check(runToEnd(90), "busy: finished")
	s = lastState()
	check(#calls("QuickTrade") == 0 and s.results[1].kind == "busy" and s.phase == "stopped" and s.results[2].status == "pending", "_Busy: waited, then the run stopped")
	-- the data changes under the send: settled again, then sent
	quickRun({ { 3061, quick({ onSelect = function()
		after(0.4, function() tNative.bDbBusy = true end)
		after(1.5, function() tNative.tActions.quickTradeValue = "[COST:Value={1300}]"; tNative.tLimits.quickTradePrice = 1300 end)
		after(2.5, function() tNative.bDbBusy = false end)
	end }) } }, "quicktrade")
	check(runToEnd(60), "settle: finished")
	s = lastState()
	check(#calls("QuickTrade") == 1 and countMarks("lister_data_changed") >= 1 and s.results[1].status == "traded" and s.results[1].price == 1300, "dataPrint changed: settled again, then sent at the new price")

	-- the send needs a report that arrived after the send step began: a page
	-- that goes quiet right then (a reload mid-step) gets nothing sent
	quickRun({ { 3065, quick() } }, "quicktrade")
	check(tickUntil(function() return Lister.tRun ~= nil and Lister.tRun.sStep == "send" end, 30), "mid-step: reached the send step")
	tPage.bOn = false
	check(runToEnd(30), "mid-step: finished")
	check(#calls("QuickTrade") == 0 and lastState().results[1].kind == "nopage", "mid-step: no report after the step began, nothing sent")

	-- E. still there after 10 s: not confirmed, the run stops, nothing more sent
	quickRun({ { 3071, quick({ quickOutcome = "stay" }) }, { 3072, quick() } }, "quicktrade")
	check(runToEnd(60), "timeout: finished")
	s = lastState()
	q = sends("QuickTrade")
	check(#q == 1 and s.phase == "stopped" and s.results[1].status == "unconfirmed" and s.results[1].detail == "Not confirmed: check storage." and s.results[2].status == "pending", "timeout: stopped, not confirmed")
	local tTo = find("quick_timeout")
	check(tTo and tTo.ms >= 10000 and tTo.ms < 10600, "timeout: after 10 s (" .. tostring(tTo and tTo.ms) .. ")")
	-- a database error during the wait shortens it; the list still decides
	tLog = {}
	quickRun({ { 3081, quick({ quickOutcome = function() after(0.1, function() serverError(5, 31) end) end }) } }, "quicktrade")
	check(runToEnd(60), "error stay: finished")
	tTo = find("quick_timeout")
	check(lastState().results[1].status == "unconfirmed" and tTo and tTo.ms >= 3000 and tTo.ms < 3700, "a stray error: the wait shortened to 3 s (" .. tostring(tTo and tTo.ms) .. ")")
	quickRun({ { 3082, quick({ quickDelay = 1.0, onSelect = function() end, quickOutcome = nil }) } }, "quicktrade")
	tickUntil(function() return Lister.tRun ~= nil and Lister.tRun.sStep == "gone" end, 30)
	serverError(255, 77)
	check(runToEnd(30), "error gone: finished")
	check(lastState().results[1].status == "traded", "a stray error, then gone: done (the list decides)")

	-- F. a fingerprint-token animal: gone by its look; an ambiguous look stops the run
	local function fpRun(fnOutcome)
		reset()
		oStorage:TransitionIn()
		fnPageFrame = fnPageFrameSaved
		pageReset({ fnText = pageTextQ })
		local tA = quick({ aidFn = function() return nil end, species = "Lion", name = "Fp", gender = 1, quickOutcome = fnOutcome })
		addAnimal(3091, tA)
		addAnimal(3092, { species = "Lion", name = "Other", gender = 0 })
		fire("PZ2QoL_ListerResolve", "rqfp", "animal_1,animal_2")
		local tIds = sent("PZ2QoL_ListerIds")
		local sTok = decode(tIds[#tIds].tArgs[2]).ids.animal_1
		nQ = nQ + 1
		fire("PZ2QoL_ListerStart", "RPG1_" .. nQ, "v1 1000 quicktrade\n" .. tostring(sTok) .. " animal_1 - default")
		return sTok
	end
	local sTok = fpRun(nil)
	check(sTok and string.match(sTok, "^fp%d+$"), "fp: a fingerprint token (" .. tostring(sTok) .. ")")
	check(runToEnd(30), "fp: finished")
	check(#calls("QuickTrade") == 1 and lastState().results[1].status == "traded", "fp: confirmed by its look leaving")
	fpRun(function(g) addAnimal(3093, { species = "Lion", name = "Fp", gender = 1 }) end)
	check(runToEnd(30), "fp ambiguous: finished")
	s = lastState()
	check(s.phase == "stopped" and s.results[1].status == "unconfirmed" and s.results[1].kind == "ambiguous", "fp: two rows with its look: stopped")

	-- G. one run at a time; the frozen job never grows
	quickRun({ { 3101, quick({ quickDelay = 2 }) }, { 3102, quick() } }, "quicktrade")
	local nRunId = Lister.tRun.nId
	tick(5)
	fire("PZ2QoL_ListerStart", "RPG1_x", "v1 1000 quicktrade\n3103 animal_1 - default\n3104 animal_2 - default\n3105 animal_3 - default")
	check(Lister.tRun and Lister.tRun.nId == nRunId and #Lister.tRun.tAnimals == 2 and #Lister.tRun.tResults == 2, "frozen: a second start is refused, the job never grows")
	fire("PZ2QoL_ListerStart", "RPG1_y", "v1 1000 list\n3101 animal_1 500 max")
	check(Lister.tRun and Lister.tRun.nId == nRunId, "frozen: nor a listing")
	-- Stop while the first waits to leave storage: after it
	tickUntil(function() return Lister.tRun ~= nil and Lister.tRun.sStep == "gone" end, 30)
	fire("PZ2QoL_ListerStop")
	check(Lister.tRun ~= nil, "stop: waits for the animal sent")
	check(runToEnd(30), "stop: ended")
	s = lastState()
	check(s.phase == "stopped" and s.message == "Stopped by you." and s.results[1].status == "traded" and s.results[2].status == "pending" and #calls("QuickTrade") == 1, "stop: after the current animal")

	-- H. a page reload stops the run: Hello from another page, or a report from one
	quickRun({ { 3111, quick({ onSelect = function() after(0.4, function() tNative.bDbBusy = true end) after(5, function() tNative.bDbBusy = false end) end }) }, { 3112, quick() } }, "quicktrade")
	tick(30)
	fire("PZ2QoL_ListerHello", "LPG2_1")
	s = lastState()
	check(Lister.tRun == nil and s.phase == "stopped" and s.message == "Stopped: page reloaded." and countMarks("lister_quick_reloaded") == 1, "reload: stopped by the new page's hello")
	seconds(6)
	check(#calls("QuickTrade") == 0, "reload: nothing sent after")
	local nStates = #sent("PZ2QoL_ListerState")
	fire("PZ2QoL_ListerHello", "LPG2_2")
	check(#sent("PZ2QoL_ListerState") == nStates, "reload: told once")
	quickRun({ { 3113, quick() } }, "quicktrade")
	tPage.sPageId = "PG3"
	check(runToEnd(30), "reload by report: finished")
	check(lastState().message == "Stopped: page reloaded." and #calls("QuickTrade") == 0, "reload: a report from another page stops it")
	-- the same page's hello (the desk asks every 10 s) changes nothing
	quickRun({ { 3114, quick() } }, "quicktrade")
	tick(3)
	fire("PZ2QoL_ListerHello", "LPG1_9")
	check(runToEnd(30), "same page hello: finished")
	check(lastState().results[1].status == "traded", "same page hello: carries on")

	-- I. a mod error in the send (the game's call raising): not confirmed, the run stops
	quickRun({ { 3121, quick({ quickError = true }) }, { 3122, quick() } }, "quicktrade")
	check(runToEnd(30), "error: finished")
	s = lastState()
	check(s.phase == "stopped" and s.results[1].status == "unconfirmed" and s.results[1].kind == "error" and s.results[2].status == "pending", "a mod error stops a quick run")

	-- L. in game (Y: 2026-10-18): "ambiguous" 250 ms after a quick trade that
	-- worked, while the list was rebuilt; transient readings are waited out
	tLog = {}
	quickRun({ { 3201, quick({ quickOutcome = function(g)
		-- at once: the GUID is gone but a row with its look is there (the rebuild)
		local tNew = {}
		for _, x in ipairs(tOrder) do if x ~= g then tNew[#tNew + 1] = x end end
		tOrder = tNew
		addAnimal(3209, { species = "Lion", name = "Q3201" })
		-- 300 ms later the rebuild ends: one row fewer
		after(0.3, function()
			local tKeep = {}
			for _, x in ipairs(tOrder) do if x ~= 3209 then tKeep[#tKeep + 1] = x end end
			tOrder = tKeep
		end)
	end }) }, { 3202, quick({ limits = lim({ quickTradePrice = 999 }), q = { quickTradeValue = "[COST:Value={999}]" } }) } }, "quicktrade")
	check(runToEnd(60), "transient: finished")
	s = lastState()
	check(s.phase == "done" and s.results[1].status == "traded" and s.results[2].status == "traded", "ambiguous for 300 ms, then gone: counted gone, the run went on")
	local tTr = find("quick_transient", "3201")
	-- the first look waits out the rebuild (nQuickFirstLook): nothing transient read
	check(tTr == nil, "the rebuild is not read (" .. tostring(tTr and tTr.state) .. ")")
	check(countMarks("lister_quick_ambiguous") == 0, "not stopped as ambiguous")
	-- the pattern seen in game on all 3 quick trades (Y: 2026-10-18, trace runs
	-- 2, 4, 5): at the first look (250 ms) the old row is still in the list but
	-- its key no longer gives the GUID (id type 0); about 1 s later the list is
	-- rebuilt with one row fewer and the keys renumbered
	tLog = {}
	tMarks = {}
	quickRun({ { 3221, quick() }, { 3222, quick({ limits = lim({ quickTradePrice = 1300 }), q = { quickTradeValue = "[COST:Value={1300}]" } }) },
		{ 3223, quick({ limits = lim({ quickTradePrice = 1400 }), q = { quickTradeValue = "[COST:Value={1400}]" } }) } }, "quicktrade")
	for _, g in ipairs({ 3221, 3222, 3223 }) do
		tAnimals[g].quickOutcome = function(gg)
			tAnimals[gg].aidFn = function() return 4711, 0 end
			after(1.0, function()
				local tNew = {}
				for _, x in ipairs(tOrder) do if x ~= gg then tNew[#tNew + 1] = x end end
				tOrder = tNew
			end)
		end
	end
	check(runToEnd(60), "game pattern: finished")
	s = lastState()
	check(s.phase == "done" and s.results[1].status == "traded" and s.results[2].status == "traded" and s.results[3].status == "traded", "the game's pattern: all three counted gone (" .. tostring(s.message) .. ")")
	check(#calls("QuickTrade") == 3 and countMarks("lister_quick_ambiguous") == 0 and countMarks("lister_quick_unconfirmed") == 0, "the game's pattern: no stop")
	-- reading the list during that rebuild crashed the game (Y: 2026-10-18 20:20,
	-- dump 3f4d438e): no read in the first second after a send
	local nEarly = 0
	for _, c in ipairs(calls("QuickTrade")) do
		for _, r in ipairs(tNative.tListReads or {}) do
			if r > c.t and r < c.t + 1.0 then nEarly = nEarly + 1 end
		end
	end
	check(nEarly == 0, "the game's pattern: the list is not read in the second after a send (" .. nEarly .. ")")
	local tG3 = find("quick_gone", "3221")
	check(tG3 and tG3.ms >= 1000 and tG3.ms <= 1600, "the game's pattern: gone once the list was rebuilt, read twice (" .. tostring(tG3 and tG3.ms) .. ")")
	-- ... the same for Quick release
	quickRun({ { 3231, quick() } }, "release")
	tAnimals[3231].quickOutcome = function(gg)
		tAnimals[gg].aidFn = function() return 4711, 0 end
		after(1.0, function() tOrder = {} end)
	end
	check(runToEnd(30), "game pattern release: finished")
	check(lastState().results[1].status == "released", "the game's pattern: a release counted gone too")
	-- ... but a row that keeps showing with no id until the deadline: stopped, still in storage
	quickRun({ { 3241, quick() } }, "quicktrade")
	tAnimals[3241].quickOutcome = function(gg) tAnimals[gg].aidFn = function() return 4711, 0 end end
	check(runToEnd(30), "leaving forever: finished")
	s = lastState()
	check(s.results[1].status == "unconfirmed" and string.find(s.message, "still in storage", 1, true), "leaving until the deadline: not confirmed, stopped")

	-- a single "gone" reading is not enough: gone, then back (a rebuild), then still there -> not confirmed
	quickRun({ { 3211, quick({ quickOutcome = function(g)
		local tSaved = tOrder
		after(0.3, function()
			local tNew = {}
			for _, x in ipairs(tOrder) do if x ~= g then tNew[#tNew + 1] = x end end
			tOrder = tNew
		end)
		after(0.55, function() tOrder = tSaved end)
	end }) } }, "quicktrade")
	tickUntil(function() return Lister.tRun ~= nil and Lister.tRun.sStep == "gone" end, 30)
	-- poll exactly once while it is out: the next look sees it back
	check(runToEnd(30), "flicker: finished")
	check(lastState().results[1].status == "unconfirmed", "gone once, then back: not confirmed (" .. tostring(lastState().results[1].status) .. ")")

	-- K. review 2026-10-18
	-- (1) the animal gone or ambiguous when its turn comes: the run stops, nothing sent
	quickRun({ { 3141, quick() }, { 3142, quick() } }, "quicktrade")
	reshuffle({ 3142 })
	check(runToEnd(30), "gone at resolve: finished")
	s = lastState()
	check(#calls("QuickTrade") == 0 and s.phase == "stopped" and s.results[1].kind == "gone" and s.results[2].status == "pending", "a frozen animal gone from storage: the run stops (" .. tostring(s.results[1].kind) .. ")")
	-- (2) a GUID animal whose look is unknown: an absent GUID alone is never "gone"
	quickRun({ { 3151, quick() } }, "quicktrade")
	tickUntil(function() return Lister.tRun ~= nil and Lister.tRun.sStep == "gone" end, 30)
	Lister.tRun.tCur.sFp = nil
	check(runToEnd(30), "no look: finished")
	s = lastState()
	check(s.results[1].status == "unconfirmed" and s.phase == "stopped", "no fingerprint: not confirmed by the id alone, the run stops")
	-- (2) one row gone but another arrived at once (the count is not one fewer): not confirmed
	quickRun({ { 3161, quick({ quickOutcome = function(g)
		after(0.33, function()
			local tNew = {}
			for _, x in ipairs(tOrder) do if x ~= g then tNew[#tNew + 1] = x end end
			tOrder = tNew
			addAnimal(3169, { species = "Lion", name = "Newcomer" })
		end)
	end }) } }, "quicktrade")
	check(runToEnd(30), "count: finished")
	s = lastState()
	check(s.results[1].status == "unconfirmed" and s.phase == "stopped", "gone needs exactly one row fewer: otherwise unconfirmed, stopped")
	-- (3) the same data as before the select (a native that keeps it on Clear): never sent, the run stops
	tLog = {}
	quickRun({ { 3171, quick() }, { 3172, quick() } }, "quicktrade")
	check(runToEnd(60), "same data: finished")
	s = lastState()
	check(#calls("QuickTrade") == 1 and s.results[1].status == "traded" and s.results[2].kind == "unselectable" and s.phase == "stopped", "data equal to the animal before: not sent, stopped (" .. tostring(s.results[2].detail) .. ")")
	local tFl = find("quick_flags", "3171")
	check(tFl and tFl.clearedEmpty == true and type(tFl.ms) == "number", "the time the flags took is logged")
	-- ... a native that empties the data on Clear: equal values are fine
	quickRun({ { 3181, quick() }, { 3182, quick() } }, "quicktrade", { native = { bClearResets = true } })
	check(runToEnd(60), "reset on clear: finished")
	check(#calls("QuickTrade") == 2 and lastState().results[2].status == "traded", "data emptied by the clear: the same values go")
	-- (4) a quick job without a page id in its request is refused
	reset()
	oStorage:TransitionIn()
	addAnimal(3191, quick({ species = "Lion", name = "Np" }))
	fire("PZ2QoL_ListerStart", "req_nopage", "v1 1000 quicktrade\n3191 animal_1 - default")
	check(Lister.tRun == nil and lastState().refused == true and string.find(lastState().message, "which page", 1, true), "no page id: refused")
	fire("PZ2QoL_ListerStart", "plain", "v1 1000 release\n3191 animal_1 - default")
	check(Lister.tRun == nil and lastState().refused == true, "no page id (release): refused")

	-- J. refused: offline, no native
	reset()
	oStorage:TransitionIn()
	tNative.nHubType = 1
	addAnimal(3131, quick())
	fire("PZ2QoL_ListerStart", "RPG1_off", "v1 1000 quicktrade\n3131 animal_1 - default")
	check(Lister.tRun == nil and lastState().refused == true and string.find(lastState().message, "online Franchise", 1, true), "quick: offline refused")
	tNative.nHubType = 2
	local fnSaved = planetHub.StorageUIReleaseAnimalsToWild
	planetHub.StorageUIReleaseAnimalsToWild = nil
	fire("PZ2QoL_ListerStart", "RPG1_nonative", "v1 1000 release\n3131 animal_1 - default")
	check(Lister.tRun == nil and string.find(lastState().message, "StorageUIReleaseAnimalsToWild", 1, true), "release: refused without the native")
	planetHub.StorageUIReleaseAnimalsToWild = fnSaved
	fnPageFrame = nil
	Core.bTrace = nil
	Core.Log = nil
	oStorage:TransitionOut()
end

-----------------------------------------------------------------------
-- 22. "When the server refuses a listing: Leave it / Quick trade it / Quick
-- release it" (developer, 2026-10-18): a listing run's refused animals are
-- quick-traded / released in the same run, with every quick guard; only a
-- server refusal, never a timeout or a skip; CashSeeded is never released;
-- refusedmax caps it (Quick release before its first confirmed run)
-----------------------------------------------------------------------
do
	local function pct(s)
		return (string.gsub(tostring(s or ""), "[^%w%-_%.!~%*'%(%)]", function(c) return string.format("%%%02X", string.byte(c)) end))
	end
	local function pageTextR()
		local A, L = tNative.tActions, tNative.tLimits
		local function f(v) return v == true and "1" or v == false and "0" or "-" end
		local function n(v) return type(v) == "number" and tostring(v) or "-" end
		local tN = {}
		for _, sName in ipairs({ "tradePriceMin", "tradePriceMax", "tradePriceDefault", "tradeDurationMin", "tradeDurationMax", "tradeDurationDefault" }) do tN[#tN + 1] = n(L[sName]) end
		return table.concat({ "v2", tPage.sKey, table.concat(tNative.tSelection, ","), f(A.tradeAllowed), table.concat(tN, ","), pct(A.tradeDisallowedReason),
			f(A.quickTradeAllowed), pct(A.quickTradeDisallowedReason), pct(A.quickTradeValue), f(A.quickReleaseAllowed), pct(A.quickReleaseDisallowedReason),
			pct(A.quickReleaseValue), f(A.rehomeAllowed), n(L.quickTradePrice) .. "," .. n(L.quickReleasePrice), f(tNative.bConnecting) .. "," .. f(tNative.bLoading),
			"-", pct(""), "PG1" }, "|")
	end
	-- a tradeable animal with quick actions allowed (each its own values)
	local function tiger(g, t)
		local nP = 1000 + (g % 100) * 10
		local l = defaultLimits()
		l.quickTradePrice, l.quickReleasePrice = nP, 50 + g % 100
		local o = { species = "Tiger", name = "T" .. g, limits = l,
			quick = { quickTradeAllowed = true, quickTradeValue = "[COST:Value={" .. nP .. "}]", quickReleaseAllowed = true, quickReleaseValue = "[INT_VALUE:Value={" .. (50 + g % 100) .. "}]", rehomeAllowed = false } }
		for k, v in pairs(t or {}) do
			if k == "q" then for kk, vv in pairs(v) do o.quick[kk] = vv end else o[k] = v end
		end
		return o
	end
	local REFUSE = outcome({ { "err", 0.2, 255, 42 } }) -- Unknown on the listing request: refused after the grace
	local nR = 0
	local function refusedRun(tSpec, sOpts)
		reset()
		oStorage:TransitionIn()
		fnPageFrame = fnPageFrameSaved
		pageReset({ fnText = pageTextR })
		for _, a in ipairs(tSpec) do addAnimal(a[1], a[2]) end
		local tLines = {}
		for _, a in ipairs(tSpec) do tLines[#tLines + 1] = line(a[1], "500", "max") end
		nR = nR + 1
		fire("PZ2QoL_ListerStart", "RPG1_" .. (900 + nR), "v1 1000 list " .. sOpts .. "\n" .. table.concat(tLines, "\n"))
	end
	local tLog = {}
	Core.bTrace = true
	Core.Log = function(_, sArea, sEvent, t) tLog[#tLog + 1] = { area = sArea, ev = sEvent, t = t or {} } end
	local function find(sEv, sGuid)
		for _, x in ipairs(tLog) do
			if x.ev == sEv and (sGuid == nil or x.t.guid == sGuid) then return x.t end
		end
	end
	local tJ, _, sM, tO = Lister.ParseJob("v1 1000 list onrefused=release refusedmax=1\n11 animal_1 500 max")
	check(tJ and sM == "list" and tO.sOnRefused == "release" and tO.nRefusedMax == 1, "job: the refused options")
	tJ, sM = Lister.ParseJob("v1 1000 list onrefused=sell\n11 animal_1 500 max")
	check(tJ == nil and string.find(sM, "Unknown job option", 1, true), "job: an unknown option refused")
	tJ, sM = Lister.ParseJob("v1 1000 check onrefused=quicktrade\n11 animal_1 - default")
	check(tJ == nil, "job: onrefused only for a listing")

	-- refused -> quick trade: right after the refusal, the same animal; the others list as usual
	refusedRun({ { 4001, tiger(4001, { outcome = REFUSE }) }, { 4002, tiger(4002) } }, "onrefused=quicktrade")
	check(runToEnd(90), "refused -> trade: finished")
	local s = lastState()
	local tQ = calls("QuickTrade")
	check(#tAuctions == 2 and #tQ == 1 and tQ[1].tArgs[1][1] == "animal_1" and #calls("Release") == 0, "refused -> trade: one quick trade of the refused one (" .. #tQ .. ")")
	check(s.results[1].status == "traded" and s.results[1].afterRefused == true and s.results[1].price == 1010 and s.results[2].status == "listed", "refused -> trade: traded after refusal, the other listed")
	check(s.phase == "done" and s.message == "Listed 1 of 2 · Quick-traded 1 after refusal." and s.onRefused == "quicktrade", "refused -> trade: summary (" .. tostring(s.message) .. ")")
	check(find("refused_then_quick", "4001") ~= nil and find("quick_gone", "4001") ~= nil and countMarks("lister_refused_then_quick") == 1, "refused -> trade: logged")
	local tSent = calls("QuickTrade")[1].t
	local tAuc1 = tAuctions[1].t
	check(tSent - tAuc1 >= 1.0, "refused -> trade: the pace before the quick action")

	-- refused -> release; one CashSeeded (never released, stays refused), the run goes on
	refusedRun({ { 4011, tiger(4011, { outcome = REFUSE, q = { quickReleaseAllowed = false, quickReleaseDisallowedReason = "[AnimalList_Problem_CashSeeded]" } }) },
		{ 4012, tiger(4012, { outcome = REFUSE }) } }, "onrefused=release")
	check(runToEnd(90), "refused -> release: finished")
	s = lastState()
	local tRel = calls("Release")
	check(#tRel == 1 and tRel[1].tArgs[1][1] == "animal_2" and #calls("QuickTrade") == 0, "refused -> release: only the one not bought for cash (" .. #tRel .. ")")
	check(s.results[1].status == "refused" and string.find(s.results[1].detail, "CashSeeded", 1, true) and s.results[2].status == "released" and s.results[2].afterRefused == true, "refused -> release: CashSeeded stays refused, the other released")
	check(s.phase == "done" and s.message == "Listed 0 of 2 · Released 1 after refusal.", "refused -> release: summary (" .. tostring(s.message) .. ")")

	-- a release flagged allowed but with the CashSeeded reason: still never released
	refusedRun({ { 4015, tiger(4015, { outcome = REFUSE, q = { quickReleaseDisallowedReason = "[AnimalList_Problem_CashSeeded]" } }) } }, "onrefused=release")
	check(runToEnd(60), "cash seeded flag: finished")
	check(#calls("Release") == 0 and lastState().results[1].status == "refused", "CashSeeded in the reason: never released")

	-- refusedmax=1 (Quick release before its first confirmed run): one, the rest stay refused
	refusedRun({ { 4021, tiger(4021, { outcome = REFUSE }) }, { 4022, tiger(4022, { outcome = REFUSE }) } }, "onrefused=release refusedmax=1")
	check(runToEnd(90), "refusedmax: finished")
	s = lastState()
	check(#calls("Release") == 1 and s.results[1].status == "released" and s.results[2].status == "refused" and s.results[2].afterRefused == false, "refusedmax=1: one released, the next stays refused")

	-- the game won't list it but allows the quick action (NoBirthZoo, Y: 2026-10-19):
	-- the same fallback, nothing listed for it; the others list as usual
	local NBZ = "[AnimalExchange_Conditions_Concatenate:first=[AnimalList_SelectionCannotTrade]:second=[AnimalList_Problem_NoBirthZoo]]"
	refusedRun({ { 4081, tiger(4081, { tradeAllowed = false, reason = NBZ, q = { quickReleaseAllowed = false, quickReleaseDisallowedReason = "[AnimalList_Problem_CashSeeded]" } }) },
		{ 4082, tiger(4082) } }, "onrefused=quicktrade")
	check(runToEnd(90), "not listable -> trade: finished")
	s = lastState()
	tQ = calls("QuickTrade")
	check(#tAuctions == 1 and #tQ == 1 and tQ[1].tArgs[1][1] == "animal_1", "not listable -> trade: quick-traded, not listed (" .. #tQ .. ")")
	check(s.results[1].status == "traded" and s.results[1].afterRefused == true and s.results[2].status == "listed", "not listable -> trade: traded, the other listed")
	check(find("refused_then_quick", "4081") ~= nil and string.find(find("refused_then_quick", "4081").detail, "NoBirthZoo", 1, true), "not listable -> trade: logged with the reason")
	-- release chosen but not allowed (CashSeeded): skipped as before, no quick action
	refusedRun({ { 4083, tiger(4083, { tradeAllowed = false, reason = NBZ, q = { quickReleaseAllowed = false, quickReleaseDisallowedReason = "[AnimalList_Problem_CashSeeded]" } }) } }, "onrefused=release")
	check(runToEnd(60), "not listable, release not allowed: finished")
	check(#calls("Release") == 0 and lastState().results[1].status == "skipped" and lastState().results[1].kind == "untradeable", "not listable, release not allowed: skipped")

	-- not a refusal: an untradeable skip the game won't quick-trade either, a timeout (no answer), DidNotGetResponse -> no quick action
	refusedRun({ { 4031, tiger(4031, { tradeAllowed = false, reason = "[AnimalList_Problem_Infected]", q = { quickTradeAllowed = false, quickTradeDisallowedReason = "[AnimalList_Problem_Infected]" } }) },
		{ 4032, tiger(4032, { outcome = never() }) }, { 4033, tiger(4033, { outcome = outcome({ { "err", 0.5, 2, 42 } }) }) } }, "onrefused=quicktrade")
	check(runToEnd(200), "not refused: finished")
	s = lastState()
	check(#calls("QuickTrade") == 0 and s.results[1].kind == "untradeable" and s.results[2].status == "timeout" and s.results[3].status == "timeout", "no quick action after any failure but a refusal")
	check(countMarks("lister_refused_then_quick") == 0, "not refused: nothing marked")

	-- Leave it (no option): a refusal stays a refusal
	refusedRun({ { 4041, tiger(4041, { outcome = REFUSE }) } }, "")
	check(runToEnd(60), "leave: finished")
	check(#calls("QuickTrade") == 0 and #calls("Release") == 0 and lastState().results[1].status == "refused", "Leave it: no quick action")

	-- the quick part stops the run on anything unexpected (still there after 10 s)
	refusedRun({ { 4051, tiger(4051, { outcome = REFUSE, quickOutcome = "stay" }) }, { 4052, tiger(4052) } }, "onrefused=quicktrade")
	check(runToEnd(90), "stay: finished")
	s = lastState()
	check(s.phase == "stopped" and s.results[1].status == "unconfirmed" and s.results[2].status == "pending" and #tAuctions == 1, "refused -> trade, still in storage: the run stops")
	-- the game won't quick-trade it now: it stays refused, the run goes on
	refusedRun({ { 4061, tiger(4061, { outcome = REFUSE, q = { quickTradeAllowed = false, quickTradeDisallowedReason = "[AnimalList_Problem_Infertile_Sell]" } }) }, { 4062, tiger(4062) } }, "onrefused=quicktrade")
	check(runToEnd(90), "not allowed: finished")
	s = lastState()
	check(s.phase == "done" and s.results[1].status == "refused" and string.find(s.results[1].detail, "Not quick-traded", 1, true) and s.results[2].status == "listed" and #calls("QuickTrade") == 0, "refused, quick trade not allowed: stays refused, the run goes on")
	-- refused without a page id in the request: not started
	reset()
	oStorage:TransitionIn()
	addAnimal(4071, tiger(4071))
	fire("PZ2QoL_ListerStart", "plainreq", "v1 1000 list onrefused=quicktrade\n4071 animal_1 500 max")
	check(Lister.tRun == nil and lastState().refused == true, "onrefused without a page id: refused")
	fnPageFrame = nil
	Core.bTrace = nil
	Core.Log = nil
	oStorage:TransitionOut()
end

-----------------------------------------------------------------------
-- 23. Taking listings off the market (mode "unlist", the desk's My
-- listings, docs/DESIGN-reprice.md): the game's Cancel acts on the
-- selection (StorageUICancelAnimalAuction(), no arguments); page reports
-- only, the row's timer decides, skip-and-carry-on, Stop, the caps
-----------------------------------------------------------------------
do
	local function pct(s)
		return (string.gsub(tostring(s or ""), "[^%w%-_%.!~%*'%(%)]", function(c) return string.format("%%%02X", string.byte(c)) end))
	end
	local function pageTextU()
		local A, L = tNative.tActions, tNative.tLimits
		local function f(v) return v == true and "1" or v == false and "0" or "-" end
		local function n(v) return type(v) == "number" and tostring(v) or "-" end
		local tN = {}
		for _, sName in ipairs({ "tradePriceMin", "tradePriceMax", "tradePriceDefault", "tradeDurationMin", "tradeDurationMax", "tradeDurationDefault" }) do tN[#tN + 1] = n(L[sName]) end
		local tSel = tPage.fnSel and tPage.fnSel() or tNative.tSelection
		return table.concat({ "v2", tPage.sKey, table.concat(tSel, ","), f(A.tradeAllowed), table.concat(tN, ","), pct(A.tradeDisallowedReason),
			f(A.quickTradeAllowed), pct(A.quickTradeDisallowedReason), pct(A.quickTradeValue), f(A.quickReleaseAllowed), pct(A.quickReleaseDisallowedReason),
			pct(A.quickReleaseValue), f(A.rehomeAllowed), n(L.quickTradePrice) .. "," .. n(L.quickReleasePrice), f(tNative.bConnecting) .. "," .. f(tNative.bLoading),
			"-", pct(""), tPage.sPageId or "PG1" }, "|")
	end
	-- the native's Cancel: takes the selected animal off ~0.4 s later
	local nCancelDelay = 0.4
	planetHub.StorageUICancelAnimalAuction = function(...)
		local sKey = tNative.tSelection[1]
		local g = sKey and guidAt(sKey)
		record("Cancel", select("#", ...), sKey, g)
		local a = g and tAnimals[g]
		if a == nil then return end
		if a.cancelOutcome == "stay" then return end
		if type(a.cancelOutcome) == "function" then return a.cancelOutcome(g) end
		after(nCancelDelay, function() a.timer = -1 end)
	end
	local nU = 0
	local function unlistRun(tSpec, tOpt)
		tOpt = tOpt or {}
		reset()
		oStorage:TransitionIn()
		for k, v in pairs(tOpt.native or {}) do tNative[k] = v end
		fnPageFrame = fnPageFrameSaved
		pageReset(tOpt.page or { fnText = pageTextU })
		for _, a in ipairs(tSpec) do
			local tA = a[2] or {}
			tA.species = tA.species or "Lion"
			tA.name = tA.name or ("U" .. tostring(a[1]))
			tA.timer = tA.timer or 5 * 3600
			-- a listed animal: the game won't trade it again (its data still comes)
			tA.tradeAllowed = false
			addAnimal(a[1], tA)
			tAnimals[a[1]].auctionPrice = tA.auctionPrice or 900
			tAnimals[a[1]].cancelOutcome = tA.cancelOutcome
		end
		local tLines = {}
		for _, a in ipairs(tSpec) do tLines[#tLines + 1] = gs(a[1]) .. " " .. (keyOf(a[1]) or "-") .. " - max" end
		nU = nU + 1
		local sR = tOpt.req or ("RPG1_" .. (700 + nU))
		local nF = #oView.tSent
		fire("PZ2QoL_ListerStart", sR, "v1 " .. (tOpt.pace or 1000) .. " unlist\n" .. table.concat(tLines, "\n"))
		return sR, nF
	end

	-- caps say whether it can
	reset()
	oStorage:TransitionIn()
	addAnimal(4500)
	fire("PZ2QoL_ListerHello", "hu1")
	local tC = sent("PZ2QoL_ListerCaps")
	check(tC[#tC] and decode(tC[#tC].tArgs[2]).unlist == true, "unlist: caps say so")
	local fnCancel = planetHub.StorageUICancelAnimalAuction
	planetHub.StorageUICancelAnimalAuction = nil
	fire("PZ2QoL_ListerHello", "hu2")
	tC = sent("PZ2QoL_ListerCaps")
	check(decode(tC[#tC].tArgs[2]).unlist == false and decode(tC[#tC].tArgs[2]).ok == true, "unlist: no native, caps false (listing still ok)")
	-- and a run is refused without it
	fire("PZ2QoL_ListerStart", "RPG1_901", "v1 1000 unlist\n4500 animal_1 - max")
	check(Lister.tRun == nil and lastState().refused == true and string.find(lastState().message, "StorageUICancelAnimalAuction", 1, true), "unlist: no native, refused")
	planetHub.StorageUICancelAnimalAuction = fnCancel
	-- refused without a page id, and offline
	fire("PZ2QoL_ListerStart", "plain", "v1 1000 unlist\n4500 animal_1 - max")
	check(Lister.tRun == nil and lastState().refused == true, "unlist: no page id, refused")
	tNative.nHubType = 1
	fire("PZ2QoL_ListerStart", "RPG1_902", "v1 1000 unlist\n4500 animal_1 - max")
	check(Lister.tRun == nil and lastState().refused == true and string.find(lastState().message, "online Franchise", 1, true), "unlist: offline, refused")
	tNative.nHubType = 2

	-- A. three listed animals taken off, one Cancel each (no arguments), the
	-- selection exactly that animal at the call, a pause between them
	unlistRun({ { 4501, { auctionPrice = 1200 } }, { 4502 }, { 4503 } })
	check(runToEnd(90), "unlist: finished")
	local s = lastState()
	local tCancel = calls("Cancel")
	check(#tCancel == 3 and #tAuctions == 0 and #calls("QuickTrade") == 0, "unlist: three Cancels, nothing listed or traded (" .. #tCancel .. ")")
	check(tCancel[1] and tCancel[1].tArgs[1] == 0 and tCancel[1].tArgs[3] == 4501 and tCancel[2].tArgs[3] == 4502 and tCancel[3].tArgs[3] == 4503, "unlist: no arguments, each with its own animal selected")
	check(s.mode == "unlist" and s.phase == "done" and s.message == "Taken off the market 3 of 3." and s.results[1].status == "unlisted" and s.results[3].status == "unlisted", "unlist: done (" .. tostring(s.message) .. ")")
	check(s.results[1].price == 1200, "unlist: the listed price with the result")
	check(tAnimals[4501].timer <= 0 and tAnimals[4503].timer <= 0, "unlist: off the market")
	check(tCancel[2].t - tCancel[1].t >= 1.0 + nCancelDelay, "unlist: the pace between two")
	check(countMarks("lister_unlist_start") == 1 and countMarks("lister_unlist_send") == 3 and countMarks("lister_unlisted") == 3, "unlist: marked")

	-- B. one already off (sold or expired): skipped, the next one goes
	unlistRun({ { 4511, { timer = -1 } }, { 4512 } })
	check(runToEnd(60), "unlist not listed: finished")
	s = lastState()
	check(s.results[1].status == "skipped" and s.results[1].kind == "notlisted" and s.results[2].status == "unlisted" and #calls("Cancel") == 1, "unlist: a not listed one skipped (" .. tostring(s.results[1].kind) .. ")")

	-- C. no page report: never sent, skipped (Lua's own reads never count)
	unlistRun({ { 4521 }, { 4522 } }, { page = { bOn = false } })
	check(runToEnd(60), "unlist no page: finished")
	s = lastState()
	check(#calls("Cancel") == 0 and s.results[1].kind == "unselectable" and s.results[2].kind == "unselectable" and s.phase == "done", "unlist: no page, nothing sent, carries on")

	-- D. another animal selected at the send: not sent
	unlistRun({ { 4531, { onSelect = function()
		after(0.4, function() tNative.bDbBusy = true end)
		after(1.6, function() tPage.fnSel = function() return { "animal_2" } end end)
		after(2.4, function() tNative.bDbBusy = false end)
	end } }, { 4532 } })
	check(runToEnd(60), "unlist other: finished")
	s = lastState()
	check(s.results[1].status == "skipped" and s.results[1].kind == "changed" and #calls("Cancel") == 1 and calls("Cancel")[1].tArgs[3] == 4532 and s.results[2].status == "unlisted", "unlist: another one selected, not sent, the next goes (" .. tostring(s.results[1].kind) .. ")")

	-- E. the native does nothing: timeout after 30 s, the next one still goes
	unlistRun({ { 4541, { cancelOutcome = "stay" } }, { 4542 } })
	check(runToEnd(120), "unlist stays: finished")
	s = lastState()
	check(s.results[1].status == "timeout" and string.find(s.results[1].detail, "Still on the market", 1, true) and s.results[2].status == "unlisted", "unlist: timeout, the run goes on (" .. tostring(s.results[1].detail) .. ")")
	check(countMarks("lister_unlist_timeout") == 1, "unlist: timeout marked")

	-- F. a server error after the call: the wait is shortened, the row decides
	unlistRun({ { 4551, { cancelOutcome = function() after(0.2, function() serverError(5, 31) end) end } } })
	local nT0 = nClock
	check(runToEnd(60), "unlist error: finished")
	s = lastState()
	check(s.results[1].status == "timeout" and string.find(s.results[1].detail, "NotAllowed", 1, true) and nClock - nT0 < 10, "unlist: an error shortens the wait (" .. tostring(s.results[1].detail) .. ", " .. tostring(nClock - nT0) .. " s)")
	-- ... but an error with the row off the market is still unlisted
	unlistRun({ { 4552, { cancelOutcome = function(g) after(0.2, function() serverError(255, 42) end) after(0.5, function() tAnimals[g].timer = -1 end) end } } })
	check(runToEnd(60), "unlist error but off: finished")
	check(lastState().results[1].status == "unlisted", "unlist: off despite an error: unlisted")

	-- G. it sold just as it was taken off: left storage, skipped gone
	unlistRun({ { 4561, { cancelOutcome = function(g)
		after(0.3, function()
			local tNew = {}
			for _, x in ipairs(tOrder) do if x ~= g then tNew[#tNew + 1] = x end end
			reshuffle(tNew)
		end)
	end } } })
	check(runToEnd(60), "unlist sold: finished")
	s = lastState()
	check(s.results[1].status == "skipped" and s.results[1].kind == "gone", "unlist: sold meanwhile: gone (" .. tostring(s.results[1].status) .. ")")

	-- H. Stop while waiting for it to come off: stopped, may still come off;
	-- the rest stay to do
	unlistRun({ { 4571, { cancelOutcome = "stay" } }, { 4572 } })
	tickUntil(function() return #calls("Cancel") == 1 end, 30)
	seconds(2)
	fire("PZ2QoL_ListerStop")
	s = lastState()
	check(Lister.tRun == nil and s.phase == "stopped" and s.results[1].status == "stopped" and s.results[2].status == "pending" and #calls("Cancel") == 1, "unlist: Stop ends it, the rest stay")

	-- I. the key moves to another listed animal after the select: never that one
	unlistRun({ { 4581, { onSelect = function() after(0.35, function() reshuffle({ 4582, 4581 }) end) end } }, { 4582, { noSelect = true } } })
	check(runToEnd(60), "unlist reshuffle: finished")
	check(tAnimals[4582].timer > 0, "unlist + reshuffle: the other animal stays listed")

	-- J. a listing job never cancels anything; an unlist job never lists
	check(#tAuctions == 0, "unlist: never listed anything")

	-- K. My listings' Quick trade: a quick job never acts on a listed animal (the
	-- game's UI offers quick actions only off the market): it stops, nothing
	-- sent; after the take-off the same animal goes through the quick job
	unlistRun({ { 4591, { quick = { quickTradeAllowed = true, quickTradeValue = "[COST:Value={700}]", quickReleaseAllowed = true, rehomeAllowed = false } } } })
	fire("PZ2QoL_ListerStop")
	tickUntil(function() return Lister.tRun == nil end, 5)
	tAnimals[4591].timer = 5 * 3600
	local nQ0 = #calls("QuickTrade")
	fire("PZ2QoL_ListerStart", "RPG1_951", "v1 1000 quicktrade\n4591 " .. keyOf(4591) .. " - default")
	check(runToEnd(30), "quick on listed: finished")
	local sQ = lastState()
	check(#calls("QuickTrade") == nQ0 and sQ.phase == "stopped" and sQ.results[1].kind == "listed", "quick on a listed animal: stopped, nothing sent (" .. tostring(sQ.results[1].kind) .. ")")
	fire("PZ2QoL_ListerStart", "RPG1_952", "v1 1000 unlist\n4591 " .. keyOf(4591) .. " - max")
	check(runToEnd(30) and lastState().results[1].status == "unlisted", "take-off before the quick trade")
	fire("PZ2QoL_ListerStart", "RPG1_953", "v1 1000 quicktrade\n4591 " .. keyOf(4591) .. " - default")
	check(runToEnd(30), "quick after take-off: finished")
	sQ = lastState()
	check(#calls("QuickTrade") == nQ0 + 1 and sQ.results[1].status == "traded", "quick after the take-off: traded (" .. tostring(sQ.results[1].status) .. " " .. tostring(sQ.results[1].kind) .. " " .. tostring(sQ.results[1].detail) .. ")")
	fnPageFrame = nil
	oStorage:TransitionOut()
end

local tKnown = {}
local f = io.open(sModDir .. "../../../tools/trace/checkpoints.txt", "r")
check(f ~= nil, "checkpoints.txt found")
if f then
	for l in f:lines() do tKnown[(string.gsub(l, "%s+$", ""))] = true end
	f:close()
end
local fSrc = assert(io.open(sModDir .. "pz2qol.lister.lua", "r"))
local sSrc = fSrc:read("a")
fSrc:close()
local tUsed = {}
for sName in string.gmatch(sSrc, 'mark%("([%w_]+)"%)') do tUsed[sName] = true end
for sName in string.gmatch(sSrc, '"(lister_[%w_]+)"') do tUsed[sName] = true end
for _, sWhy in ipairs({ "db", "requests", "connecting", "loading", "peek" }) do tUsed["lister_busy_" .. sWhy] = true end
for _, sWhy in ipairs({ "selection", "allowed", "limits" }) do tUsed["lister_unsel_" .. sWhy] = true end
for sName in pairs(tUsed) do
	-- prefixes of names built at run time end with "_"
	if string.sub(sName, -1) ~= "_" then
		check(tKnown[sName], "checkpoints.txt has " .. sName)
	end
end
check(tKnown["init_ok_pz2qol.lister"] and tKnown["init_fail_pz2qol.lister"], "checkpoints.txt has the init names")
check(#calls("CreateContext") == 0, "still no DataStore context created")

print(string.format("%d passed, %d failed", nPassed, nFailed))
if nFailed > 0 then os.exit(1) end
