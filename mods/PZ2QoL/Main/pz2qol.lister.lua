-----------------------------------------------------------------------
--  PZ2QoL.Lister  (the Market desk's listing engine)
--
--  Lists storage animals on the Franchise market one at a time, sending
--  exactly what the game's own Trade -> Confirm sends: that event,
--  AnimalStorage_AddToMarket(key, price, hours), is a one-line pass-through
--  to api.planetHub.StorageUIStartAnimalAuction(key, price, hours)
--  (animalstoragehubmode.lua, 1.0.5). Storage row keys (animal_<n>) are
--  positions the native reassigns on rebuilds, so the engine works on
--  GUIDs (StorageGetIDAndAIDType(key) -> guid, 2) and checks key -> GUID
--  in the same Lua tick as the call: a rebuilt list can never make it list
--  another animal.
--
--  Per animal, a per-frame state machine in AnimalStorageHubMode.Advance:
--    server    wait until the game has no server request running (10 s)
--    resolve   the animal's current key; skip gone/listed/moving/pregnant/elderly/juvenile
--    select    select it natively (local) and wait for the game's data (5 s)
--    selected  settle 0.3 s, then tradeAllowed, price and hours
--    send      not busy, key -> GUID and selection again, then the game's call
--    confirm   the row's auctionTimerSeconds > 0, or a request-42 server error
--    pause     the player's pace after every animal that reached the server
--  Only ever started by the player's click (PZ2QoL_ListerStart). A step
--  that fails skips that animal and the run carries on; only the player's
--  Stop (or leaving Animal Storage) ends a run early.
--  The selection and its data (tradeAllowed, limits) are read by the page
--  while the engine selects (PZ2QoL_ListerWatch -> PZ2QoL_ListerSeen): in
--  game, Lua's own DataStore reads never saw the selection (Y: 2026-10-17).
--  Lua's reads stay the fallback when the page does not report.
--  Each selected animal's verdict (trade, quick trade, quick release,
--  rehome) goes to the page with its result; a job in mode "check" (the
--  desk's Check storage) stops there and never sends
--  (docs/PLAN-desk-quick-release.md).
--  A job in mode "unlist" (the desk's My listings, docs/DESIGN-reprice.md)
--  takes listed animals off the market: select it, then the game's own
--  Cancel (AnimalStorage_Cancel("Trade") -> StorageUICancelAnimalAuction(),
--  no arguments, acts on the selection); its row's auctionTimerSeconds
--  dropping to <= 0 confirms it.
--  Protocol: docs/DESIGN-market-desk.md. Offline: the DataStore shapes read
--  here come from the decompiled game and its UI code; the trace marks
--  lister_* are there to prove them in game.
-----------------------------------------------------------------------
local global   = _G
local api      = global.api
local pcall    = global.pcall
local tostring = global.tostring
local tonumber = global.tonumber
local type     = global.type
local pairs    = global.pairs
local ipairs   = global.ipairs
local string   = global.string
local table    = global.table
local math     = global.math

local Lister = module(...)

Lister.nVersion = 1          -- protocol version (the job's "v1")
Lister.nListingRequest = 42  -- request type of a listing (seen in game)
Lister.nGuidType = 2         -- StorageGetIDAndAIDType's type for most storage animals
Lister.tTypeMarked = {}       -- other id types seen (traced once each)
-- Stored animals seen listed this game session: the game's bForSale (what
-- Kin's storage reads and the storage counts get) stays false for the
-- player's own listings. guid token -> true, row key -> guid token.
Lister.tListedGuids = {}
Lister.tListedKeys = {}
Lister.nServerTimeout = 10   -- s to wait for the game's other server requests
Lister.nRequestsGrace = 2    -- s RequestsInProgress alone is waited on (it may count background polls; guess)
Lister.nSelectTimeout = 5    -- s to wait for the selection's data
Lister.nSettle = 0.6         -- s after the selection's data appears (the native may write it in parts)
Lister.nClearWait = 1        -- s to wait for the cleared selection to show empty
Lister.nResettles = 3        -- times the data may change under a send before the animal is skipped
Lister.nSameSettle = 1.5     -- s to wait when the data still equals what was there before selecting
Lister.nQuiet = 3            -- s the server must stay idle after a timed-out listing (late errors)
Lister.nConfirmTimeout = 30  -- s to wait for the listing to show
Lister.nConfirmPoll = 0.25   -- s between two looks at the row
Lister.nLateConfirm = 8      -- s more after DidNotGetResponse
Lister.nRejectGrace = 3      -- s more after Unknown or an unnamed code
Lister.nStateInterval = 1    -- s between state updates while waiting
Lister.nPageFresh = 0.6      -- s a page report of the selection counts (the page reads every ~0.1 s)
Lister.nWatchResend = 1      -- s without a report before the watch is asked for again
Lister.nPaceMin = 1000       -- ms: the pause after every server request
Lister.nPaceMax = 10000
Lister.nPaceDefault = 3000
Lister.nOffsetLimit = 0.5   -- the page's OFFSET_LIMIT (lister.js): the most a price offset moves a price
Lister.nCheckPaceMin = 150   -- ms: a check run's pause between selects (nothing is sent)
Lister.nCheckClearAgain = 0.5 -- s after a check run ends: the selection is cleared once more
Lister.nCheckClearAt = nil
-- Quick trade / Quick release from the desk (docs/PLAN-desk-quick-release.md
-- 4.3, Phase 2). Proven on Y: 2026-10-18 (Phase 0b): the game's handlers
-- get (self, { [1] = "animal_<n>" }) and pass that table straight to the
-- native; no request or database error shows; the row leaves the storage
-- list ~0.31-0.34 s later. The engine sends exactly that shape, one key per
-- call, and the storage list decides each result. A quick run STOPS on
-- anything unexpected (permanent: an exception to skip-and-carry-on); only
-- a "not allowed now" (or a passing busy / changed selection) skips.
-- The game's listing problems that never pass (AnimalList_Problem_<key>):
-- a Frontier zoo's animal never goes on the market (NoBirthZoo, Y:
-- 2026-10-19), but Quick trade takes it.
Lister.tLastingProblems = { NoBirthZoo = true }

Lister._LastingProblem = function(self, tKeys)
	for _, sKey in ipairs(tKeys) do
		if self.tLastingProblems[sKey] then
			return true
		end
	end
	return false
end

Lister.tQuickModes = {
	quicktrade = { sNative = "StorageUIQuickTradeAnimals", sFlag = "bTrade", sWhy = "sTradeReason", sDone = "traded", sVerb = "Quick-traded", sSending = "Quick trading it." },
	release = { sNative = "StorageUIReleaseAnimalsToWild", sFlag = "bRelease", sWhy = "sReleaseReason", sDone = "released", sVerb = "Released", sSending = "Releasing it to the wild." },
}
Lister.nQuickTimeout = 10    -- s: max(10, 3 x the slowest list update Phase 0b saw, 0.343 s)
-- s after a quick send before the storage list is first read: reading it
-- while the game rebuilds it crashed the game natively (access violation in
-- GetDataStoreContextAsTable, Y: 2026-10-18 20:20, dump 3f4d438e: the third
-- quick trade of a run, at the 250 ms look; the row leaves at ~0.33 s)
Lister.nQuickFirstLook = 1
Lister.nQuickErrWait = 3     -- s: a database error during the wait shortens it to this
Lister.nQuickMissStop = 2    -- animals in a row without a fresh page report that stop a quick run
Lister.nMaxKeys = 5000       -- per Resolve
-- Taking a listing off the market (mode "unlist", docs/DESIGN-reprice.md):
-- the game's Cancel button sends AnimalStorage_Cancel("Trade"), whose
-- handler calls StorageUICancelAnimalAuction() with no arguments: it acts
-- on the selection (animalstoragehubmode.lua OnCancel, 1.0.5, offline).
-- Its request type and answer are unknown: the row decides (its timer <= 0,
-- read twice in a row), a server error only shortens the wait.
Lister.sCancelNative = "StorageUICancelAnimalAuction"
Lister.nUnlistTimeout = 30   -- s for the row to show it off the market
Lister.nUnlistFirstLook = 1  -- s after the call before the list is read (as after a quick send)
Lister.nUnlistErrWait = 5    -- s: a database error during the wait shortens it to this
-- s: the engine's last selected animal still counts as "the data before the
-- select" at the next run's first animal (a take-off, then a quick trade)
Lister.nLastSelFresh = 60
Lister.tLastSel = nil

Lister.oStorageMode = nil    -- the active AnimalStorageHubMode, if any
Lister.tRun = nil            -- the run in progress
Lister.tLast = nil           -- the last run that ended
Lister.nRuns = 0
Lister.nPaceMs = Lister.nPaceDefault
Lister.nLastServer = nil     -- when the last listing's outcome came (the pace runs from there)
Lister.tViews = global.setmetatable({}, { __mode = "k" })

local function trace(sMsg)
	pcall(function() api.debug.Trace("[PZ2QoL] lister: " .. sMsg) end)
end

local function mark(sName)
	local Core = global.package.loaded["pz2qol.core"]
	if Core then
		pcall(Core.Mark, Core, sName)
	end
end

local function now()
	local bOk, n = pcall(function()
		return api.time.PerformanceTimeToMilliseconds(api.time.GetPerformanceTimer()) / 1000
	end)
	return bOk and n or 0
end

-- The detailed log (debug builds; Core:Log, a no-op otherwise). Every
-- per-animal line carries run, i (1-based position in the run) and guid, so
-- one animal can be followed end to end (reference/debugging.md).
local function log(sEvent, tData)
	local Core = global.package.loaded["pz2qol.core"]
	if Core and Core.Log and Core.bTrace then
		pcall(Core.Log, Core, "lister", sEvent, tData)
	end
end

-- a debug build (the trace DLL loaded): only then is there a log to write
local function tracing()
	local Core = global.package.loaded["pz2qol.core"]
	return Core ~= nil and Core.bTrace == true
end

-- seconds to two decimals (log values)
local function secs(n)
	if type(n) ~= "number" then
		return nil
	end
	return math.floor(n * 100 + 0.5) / 100
end

-- run / i / guid of the animal being worked on, plus tExtra
local function runFields(tRun, tExtra)
	local t = tExtra or {}
	if tRun ~= nil then
		t.run = tRun.nId
		t.i = tRun.nIndex
		if tRun.tCur ~= nil then
			t.guid = tRun.tCur.sGuid
		end
	end
	return t
end

-- tonumber(nil) raises in Lua 5.3
local function toNumber(v)
	local n = nil
	if type(v) == "number" then
		n = v
	elseif type(v) == "string" then
		n = tonumber(v)
	end
	if n == nil or n ~= n or n == math.huge or n == -math.huge then
		return nil
	end
	return n
end

local function toInteger(n)
	n = math.floor(n)
	return math.tointeger(n) or n
end

-----------------------------------------------------------------------
-- JSON (a copy of Kin's small encoder, plus an explicit null)
-----------------------------------------------------------------------
local ARRAY = {}
local function array(t)
	return global.setmetatable(t or {}, ARRAY)
end
local NULL = global.setmetatable({}, {})

local tEscapes = { ['"'] = '\\"', ["\\"] = "\\\\", ["\b"] = "\\b", ["\f"] = "\\f", ["\n"] = "\\n", ["\r"] = "\\r", ["\t"] = "\\t" }

local function encodeString(s)
	s = tostring(s)
	if not string.find(s, '[%c"\\\128-\255]') then
		return '"' .. s .. '"'
	end
	local tOut = {}
	local bOk = pcall(function()
		for _, c in global.utf8.codes(s) do
			if c < 32 then
				tOut[#tOut + 1] = string.format("\\u%04x", c)
			elseif c < 128 then
				local ch = string.char(c)
				tOut[#tOut + 1] = tEscapes[ch] or ch
			elseif c < 0x10000 then
				tOut[#tOut + 1] = string.format("\\u%04x", c)
			else
				c = c - 0x10000
				tOut[#tOut + 1] = string.format("\\u%04x\\u%04x", 0xD800 + (c >> 10), 0xDC00 + (c & 0x3FF))
			end
		end
	end)
	if not bOk then
		-- not valid UTF-8: keep printable ASCII only
		tOut = {}
		for i = 1, #s do
			local b = string.byte(s, i)
			local ch = string.char(b)
			if b < 32 or b > 126 then
				tOut[#tOut + 1] = "?"
			else
				tOut[#tOut + 1] = tEscapes[ch] or ch
			end
		end
	end
	return '"' .. table.concat(tOut) .. '"'
end

local encode
encode = function(v, tOut)
	local t = type(v)
	if v == nil or v == NULL then
		tOut[#tOut + 1] = "null"
	elseif t == "boolean" then
		tOut[#tOut + 1] = v and "true" or "false"
	elseif t == "number" then
		if v ~= v or v == math.huge or v == -math.huge then
			tOut[#tOut + 1] = "null"
		elseif math.type(v) == "integer" then
			tOut[#tOut + 1] = string.format("%d", v)
		else
			tOut[#tOut + 1] = string.format("%.6g", v)
		end
	elseif t == "string" then
		tOut[#tOut + 1] = encodeString(v)
	elseif t == "table" then
		if global.getmetatable(v) == ARRAY or (#v > 0 and v[1] ~= nil) then
			tOut[#tOut + 1] = "["
			for i = 1, #v do
				if i > 1 then tOut[#tOut + 1] = "," end
				encode(v[i], tOut)
			end
			tOut[#tOut + 1] = "]"
		else
			tOut[#tOut + 1] = "{"
			local bFirst = true
			for k, x in pairs(v) do
				if not bFirst then tOut[#tOut + 1] = "," end
				bFirst = false
				tOut[#tOut + 1] = encodeString(k)
				tOut[#tOut + 1] = ":"
				encode(x, tOut)
			end
			tOut[#tOut + 1] = "}"
		end
	else
		tOut[#tOut + 1] = "null"
	end
end

local function toJson(v)
	local tOut = {}
	encode(v, tOut)
	return table.concat(tOut)
end
Lister.Encode = toJson

-- Ids as strings, the same way as Kin: an integer-valued float (77.0)
-- prints like the integer (77), so GUIDs from different calls match.
local function idString(n)
	if type(n) == "number" and math.type(n) == "float" and n == math.floor(n) and math.abs(n) < 2 ^ 63 then
		return string.format("%d", n)
	end
	return tostring(n)
end

-----------------------------------------------------------------------
-- The game's calls and data
-----------------------------------------------------------------------
local function hubFn(sName)
	local hub = api.planetHub
	if type(hub) ~= "table" then
		return nil
	end
	local fn = hub[sName]
	return type(fn) == "function" and fn or nil
end

local function ui2Fn(sName)
	local ui2 = api.ui2
	if type(ui2) ~= "table" then
		return nil
	end
	local fn = ui2[sName]
	return type(fn) == "function" and fn or nil
end

-- The calls the engine cannot run without.
local tNeeded = {
	{ "planetHub", "StorageGetIDAndAIDType" }, { "planetHub", "StorageUIStartAnimalAuction" },
	{ "planetHub", "StorageUISelectItem" }, { "planetHub", "StorageUIClearSelectedItems" },
	{ "ui2", "GetNoCreateDataStoreContext" }, { "ui2", "GetDataStoreElement" }, { "ui2", "GetDataStoreContextAsTable" },
}

-- A DataStore context only if the game made it: the mod never creates one.
-- The (root, child, ...) form is what MainHUD uses; if a build refuses it,
-- the root by name (the hub page always has hubAnimalsData and
-- animalTradeListingData) and each child without creating it, the form
-- GenealogyPopup uses.
local function context(sRoot, ...)
	local fnNoCreate = ui2Fn("GetNoCreateDataStoreContext")
	if fnNoCreate == nil then
		return nil
	end
	local bOk, c = pcall(fnNoCreate, sRoot, ...)
	if bOk and c ~= nil then
		return c
	end
	-- refused, or no context by that path form: the root by name (the
	-- native makes these two on the hub page), then each child without
	-- creating it
	local fnGet = ui2Fn("GetDataStoreContext")
	if fnGet == nil then
		return nil
	end
	bOk, c = pcall(fnGet, sRoot)
	if not bOk or c == nil then
		return nil
	end
	for _, sChild in ipairs({ ... }) do
		bOk, c = pcall(fnNoCreate, c, sChild)
		if not bOk or c == nil then
			return nil
		end
	end
	return c
end

-- Only by the full path, never the root fallback (for what is only logged)
local function existingContext(...)
	local fnNoCreate = ui2Fn("GetNoCreateDataStoreContext")
	if fnNoCreate == nil then
		return nil
	end
	local bOk, c = pcall(fnNoCreate, ...)
	return bOk and c or nil
end

local function element(ctx, sName)
	local fn = ui2Fn("GetDataStoreElement")
	if ctx == nil or fn == nil then
		return nil
	end
	local bOk, v = pcall(fn, ctx, sName)
	if bOk then
		return v
	end
	return nil
end

local function asTable(ctx)
	local fn = ui2Fn("GetDataStoreContextAsTable")
	if ctx == nil or fn == nil then
		return nil
	end
	local bOk, t = pcall(fn, ctx)
	if bOk and type(t) == "table" then
		return t
	end
	return nil
end

-- The id StorageUISelectItem takes for a storage row: the row's own `id`
-- field (what a click on the row sends with ItemSelected), else the row key.
-- In game the two differ (Y: 2026-10-17, lister_id_differs): selecting by
-- the row key selected another animal (lister_page_sel_other), as the old
-- page lister's select-by-id never did. StorageGetIDAndAIDType, the listing
-- call and selectedAnimalIDs take the row key (by id the GUID lookup found
-- nothing in game: "Nothing to list").
local function nativeId(sKey)
	if sKey == nil then
		return nil
	end
	local fn = ui2Fn("GetDataStoreElement")
	local fnCtx = ui2Fn("GetNoCreateDataStoreContext")
	if fn ~= nil and fnCtx ~= nil then
		local bOk, ctx = pcall(fnCtx, "hubAnimalsData", "animalStorageData", "list", sKey)
		if bOk and ctx ~= nil then
			local bOk2, v = pcall(fn, ctx, "id")
			if bOk2 and (type(v) == "string" or type(v) == "number") then
				local s = idString(v)
				if s ~= "" then
					if s ~= sKey and not Lister.bIdMarked then
						Lister.bIdMarked = true
						mark("lister_id_differs")
					end
					return s
				end
			end
		end
	end
	return sKey
end

-- The animal behind a storage row key, as a stable token: its GUID as an
-- exact decimal string (type 2, most animals), else "t<type>_<id>" for the
-- other id types StorageGetIDAndAIDType gives (CompareMatesUIUtils: 4
-- exhibit animal GUID, 5 exhibit listing UID, 6 exchange id, ...). In game
-- only type 2 was accepted and some animals could never be identified
-- ("Nothing to list", js_lister_nothing_noid, Y: 2026-10-17). The token is
-- only the run's identity anchor: listing still goes by the row key.
--
-- Shapes accepted (2026-10-18: in game only 4 of 63 rows gave a plain
-- decimal, so the others were never listable; what they gave is logged by
-- Resolve as resolve_fail lines):
--   integer != 0                    -> decimal
--   whole float, |n| < nExactFloat  -> decimal (exact)
--   whole float, larger             -> "%.0f" decimal, LOSSY: two animals may
--                                      round to the same float, so a lossy
--                                      token counts only while no other row
--                                      of the list gives it (Resolve and the
--                                      engine check that the same way)
--   string of [%w-_:] (<= 64)       -> the string itself
--   anything else (nil, 0, "", a fraction, userdata, table: maybe a fresh
--   object per call) -> no id.
-- The token only has to be stable and unique in the session.
Lister.nExactFloat = 2 ^ 24  -- game floats may be 32-bit (reference/debugging.md): larger whole floats may be rounded

-- (bOk, nID, nType) of StorageGetIDAndAIDType(key) -> sToken or nil, bLossy, sWhy (why not)
local function idToken(bOk, nID, nType)
	if not bOk then
		return nil, false, "error"
	end
	local s
	local bLossy = false
	local sType = type(nID)
	if sType == "number" then
		if math.type(nID) == "integer" then
			if nID == 0 then
				return nil, false, "zero"
			end
			s = string.format("%d", nID)
		else
			if nID ~= nID or nID == math.huge or nID == -math.huge then
				return nil, false, "nonfinite"
			end
			if nID ~= math.floor(nID) then
				return nil, false, "fraction"
			end
			if nID == 0 then
				return nil, false, "zero"
			end
			if math.abs(nID) < Lister.nExactFloat then
				s = string.format("%d", nID)
			else
				s, bLossy = string.format("%.0f", nID), true
			end
		end
	elseif sType == "string" then
		s = string.match(nID, "^%s*(.-)%s*$")
		if s == "" then
			return nil, false, "empty"
		end
		if s == "0" or string.match(s, "^[-0]+$") then
			return nil, false, "zero"
		end
		if #s > 64 or not string.match(s, "^[%w%-_:]+$") then
			return nil, false, "badstring"
		end
	elseif nID == nil then
		return nil, false, "nil"
	else
		-- userdata, table, boolean, function: maybe a fresh object per call
		return nil, false, sType
	end
	if nType == Lister.nGuidType then
		return s, bLossy
	end
	local n = toNumber(nType)
	if n == nil then
		-- no type: kept apart from the typed ones
		return "tx_" .. s, bLossy
	end
	n = math.floor(n)
	if not Lister.tTypeMarked[n] then
		Lister.tTypeMarked[n] = true
		mark(n >= 0 and n <= 7 and ("lister_idtype_" .. string.format("%d", n)) or "lister_idtype_other")
	end
	return "t" .. string.format("%d", n) .. "_" .. s, bLossy
end
Lister.IdToken = idToken

-- pcall(StorageGetIDAndAIDType, key): bOk, nID, nType (bOk false: no call)
local function probe(sKey)
	local fn = hubFn("StorageGetIDAndAIDType")
	if fn == nil or sKey == nil then
		return false, nil, nil
	end
	return pcall(fn, sKey)
end

-- sToken or nil, bLossy, sWhy
local function guidOf(sKey)
	if sKey == nil or hubFn("StorageGetIDAndAIDType") == nil then
		return nil, false, "nocall"
	end
	return idToken(probe(sKey))
end

local function noteListing(sKey, sGuid)
	if sGuid ~= nil then
		Lister.tListedGuids[sGuid] = true
		if sKey ~= nil then
			Lister.tListedKeys[sKey] = sGuid
		end
	end
end

-- A storage guid (as the game gives it) seen listed this session.
Lister.IsListedGuid = function(self, guid)
	local sGuid = idToken(true, guid, self.nGuidType)
	return sGuid ~= nil and self.tListedGuids[sGuid] == true
end

-- What one failed lookup looked like, for the log: plain values only
-- (a userdata or table is described, never kept).
local function failShape(bOk, nID, nType, bRow)
	local sId
	if bOk then
		local bS, s = pcall(tostring, nID)
		sId = bS and string.sub(tostring(s), 1, 40) or "?"
	else
		sId = string.sub(tostring(nID), 1, 80) -- the error text
	end
	local tShape = {
		ok = bOk == true, idType = type(nID), numType = type(nID) == "number" and math.type(nID) or nil,
		id = sId, nType = (type(nType) == "number" or type(nType) == "string") and nType or type(nType), row = bRow == true,
	}
	local sKeyOf = table.concat({ tostring(tShape.ok), tShape.idType, tostring(tShape.numType), type(nType), tostring(tShape.row) }, "/")
	return tShape, sKeyOf
end

-- A storage row's own content, for animals the game gives no usable id
-- (the old page lister's findTarget idea: an unambiguous fingerprint).
-- Only what an animal keeps: species, name, sex, maturity, the genetics
-- medal, appeal, colour morph, the four genes. Never the row id or key
-- (positions), the timer, tags or the selection. nil without species and name.
local tFpFields = { "species", "name", "gender", "maturity", "ratings", "appeal", "colormorphLabel" }
local tFpGenes = { "size", "longevity", "fertility", "immunity" }
local function fpValue(v)
	if type(v) == "number" then
		if math.type(v) == "integer" or v == math.floor(v) and math.abs(v) < 2 ^ 53 then
			return string.format("%d", v)
		end
		return string.format("%.4f", v)
	elseif type(v) == "string" or type(v) == "boolean" then
		return tostring(v)
	end
	return ""
end
local function fpOf(tRow)
	if type(tRow) ~= "table" then
		return nil
	end
	local tOut = {}
	for i, s in ipairs(tFpFields) do
		tOut[i] = fpValue(tRow[s])
	end
	if tOut[1] == "" or tOut[2] == "" then
		return nil
	end
	local tG = tRow.genetics
	for _, s in ipairs(tFpGenes) do
		local v = type(tG) == "table" and tG[s] or nil
		if type(v) == "table" then
			v = v.value
		end
		tOut[#tOut + 1] = fpValue(v)
	end
	return table.concat(tOut, "\31")
end
Lister.Fingerprint = fpOf

-- species|name|sex: what an id token's row must still show (an id that is
-- really a position would otherwise follow the position, not the animal)
local function coreOf(tRow)
	if type(tRow) ~= "table" then
		return nil
	end
	return fpValue(tRow.species) .. "\31" .. fpValue(tRow.name) .. "\31" .. fpValue(tRow.gender)
end

-- Fingerprint tokens: "fp<n>", one per distinct fingerprint, this session.
Lister.tFpToken = {}  -- fingerprint -> token
Lister.tFpOf = {}     -- token -> fingerprint
Lister.nFpTokens = 0
Lister.tCore = {}     -- id token -> coreOf(row) when Resolve saw it
local function isFpToken(s)
	return type(s) == "string" and string.match(s, "^fp%d+$") ~= nil
end
local function fpToken(sFp)
	local s = Lister.tFpToken[sFp]
	if s == nil then
		Lister.nFpTokens = Lister.nFpTokens + 1
		s = "fp" .. string.format("%d", Lister.nFpTokens)
		Lister.tFpToken[sFp] = s
		Lister.tFpOf[s] = sFp
	end
	return s
end

-- A list entry's row key: the table key, or the row's id if the list came
-- back as an array (guess: the game's tables are keyed by child name).
local function rowKey(k, tRow)
	if type(k) == "string" then
		return k
	end
	if type(tRow) == "table" and type(tRow.id) == "string" then
		return tRow.id
	end
	return nil
end

local tRowFields = { "auctionTimerSeconds", "isMoving", "isPregnant", "isShoal", "maturity", "name", "species", "gender", "selected" }

-- One row's fields: from the list table if there is one, else from the
-- row's own context (cheap; used while confirming).
local function rowOf(sKey, tList)
	if tList ~= nil then
		local tRow = tList[sKey]
		if type(tRow) == "table" then
			return tRow
		end
		for k, t in pairs(tList) do
			if type(t) == "table" and rowKey(k, t) == sKey then
				return t
			end
		end
		return nil
	end
	local ctx = context("hubAnimalsData", "animalStorageData", "list", sKey)
	if ctx == nil then
		return nil
	end
	local tRow, bAny = {}, false
	for _, s in ipairs(tRowFields) do
		tRow[s] = element(ctx, s)
		bAny = bAny or tRow[s] ~= nil
	end
	return bAny and tRow or nil
end

-- The game's own "on the market" test (MarketAnimalListItem.isOnMarket).
local function isListed(tRow)
	local n = tRow and toNumber(tRow.auctionTimerSeconds)
	return n ~= nil and n > 0
end

-- The storage list on screen: its listed rows are noted, and a noted row
-- shown unlisted again (expired or withdrawn) is dropped.
Lister._NoteListings = function(self, tList)
	for k, tRow in pairs(tList) do
		local sKey = type(tRow) == "table" and rowKey(k, tRow) or nil
		if sKey ~= nil then
			local sKnown = self.tListedKeys[sKey]
			if isListed(tRow) then
				if sKnown == nil then
					noteListing(sKey, (guidOf(sKey)))
				end
			elseif sKnown ~= nil then
				self.tListedGuids[sKnown] = nil
				self.tListedKeys[sKey] = nil
			end
		end
	end
end

local function onlySelected(tSel, sKey)
	return tSel ~= nil and #tSel == 1 and tSel[1] == sKey
end

-- Every row of the list, identified the same way Resolve and the engine's
-- send both use: key -> { sToken, sVia ("id" | "lossy" | "fp"), bLossy,
-- sWhy (no token: why), nType, bOk, nID (only while building: never kept),
-- sFp, tRow }. A token two rows give is no id for either (a lossy float
-- collision, or an id that is not per animal); rows left without one get a
-- fingerprint token if exactly one row of the list has that fingerprint.
local function identify(tList)
	local tInfo, tTokenN, tFpN = {}, {}, {}
	if tList == nil then
		return tInfo
	end
	for k, tRow in pairs(tList) do
		local sKey = type(tRow) == "table" and rowKey(k, tRow) or nil
		if sKey ~= nil then
			local bOk, nID, nType = probe(sKey)
			local sToken, bLossy, sWhy = idToken(bOk, nID, nType)
			local sFp = fpOf(tRow)
			tInfo[sKey] = { sToken = sToken, bLossy = bLossy == true, sWhy = sWhy, nType = nType, bOk = bOk, nID = nID, sFp = sFp, tRow = tRow }
			if sToken ~= nil then
				tTokenN[sToken] = (tTokenN[sToken] or 0) + 1
			end
			if sFp ~= nil then
				tFpN[sFp] = (tFpN[sFp] or 0) + 1
			end
		end
	end
	for _, t in pairs(tInfo) do
		if t.sToken ~= nil and tTokenN[t.sToken] > 1 then
			t.sWhy = t.bLossy and "collision" or "duplicate"
			t.sDupToken = t.sToken
			t.sToken = nil
		end
		if t.sToken ~= nil then
			t.sVia = t.bLossy and "lossy" or "id"
		elseif t.sFp == nil then
			t.sWhy = (t.sWhy or "none") .. "+nofp"
		elseif tFpN[t.sFp] > 1 then
			t.sWhy = (t.sWhy or "none") .. "+ambiguous"
		else
			t.sToken, t.sVia = fpToken(t.sFp), "fp"
		end
	end
	return tInfo
end

-- The keys whose row has this fingerprint now: the only one, and how many.
local function fpMatches(tList, sFp)
	local sOnly, n = nil, 0
	for k, tRow in pairs(tList) do
		local sKey = type(tRow) == "table" and rowKey(k, tRow) or nil
		if sKey ~= nil and fpOf(tRow) == sFp then
			n = n + 1
			sOnly = sKey
		end
	end
	return n == 1 and sOnly or nil, n
end

Lister._List = function(self)
	return asTable(context("hubAnimalsData", "animalStorageData", "list"))
end

-- The storage selection as a list of row keys, or nil when it can't be read.
Lister._Selection = function(self)
	local v = element(context("hubAnimalsData", "animalStorageData"), "selectedAnimalIDs")
	if type(v) ~= "table" then
		v = asTable(context("hubAnimalsData", "animalStorageData", "selectedAnimalIDs"))
	end
	if type(v) ~= "table" then
		return nil
	end
	local tOut = {}
	for _, x in pairs(v) do
		if type(x) == "string" or type(x) == "number" then
			tOut[#tOut + 1] = idString(x)
		end
	end
	return tOut
end

-- Whether this row is the selection: true / false, or nil when the game's
-- data can't tell. The row's own `selected` flag (what draws its highlight)
-- comes first: in game selectedAnimalIDs read from Lua stayed empty while the
-- animal was selected on screen (Y: trace 2026-10-17, every animal skipped
-- "unselectable"). selectedAnimalIDs is the fallback, and also says when
-- another animal is selected too.
Lister._SelState = function(self, sKey, bMark)
	local tSel = self:_Selection()
	local bOther = false
	if tSel ~= nil then
		for _, s in ipairs(tSel) do
			if s ~= sKey then
				bOther = true
			end
		end
	end
	local bFlag = element(context("hubAnimalsData", "animalStorageData", "list", sKey), "selected")
	if type(bFlag) == "boolean" then
		-- once the flag says selected: did the array say so too?
		if bMark and bFlag and not self.bFlagMarked then
			self.bFlagMarked = true
			mark(tSel ~= nil and #tSel > 0 and "lister_sel_array_ok" or "lister_sel_array_empty")
		end
		if bFlag and bOther then
			-- the array names another animal too: a multi-selection
			mark("lister_sel_other")
			return false
		end
		return bFlag
	end
	if tSel == nil then
		return nil
	end
	if #tSel == 0 then
		return nil
	end
	return onlySelected(tSel, sKey)
end

-- The native's limits for the selected animal.
Lister._Limits = function(self)
	local ctx = context("animalTradeListingData")
	return {
		nPriceMin = toNumber(element(ctx, "tradePriceMin")),
		nPriceMax = toNumber(element(ctx, "tradePriceMax")),
		nPriceDefault = toNumber(element(ctx, "tradePriceDefault")),
		nHoursMin = toNumber(element(ctx, "tradeDurationMin")),
		nHoursMax = toNumber(element(ctx, "tradeDurationMax")),
		nHoursDefault = toNumber(element(ctx, "tradeDurationDefault")),
	}
end

-----------------------------------------------------------------------
-- Page-assisted reads: while the engine selects, the page (listerlua.js)
-- reads the selection, tradeAllowed and the limits from its DataStore and
-- reports them. The format is plain text (the mod's Lua has no JSON
-- decoder; listercore.js encodeSeen, docs/PLAN-desk-quick-release.md 3.3),
-- every text field percent-encoded (encodeURIComponent), so no field holds
-- a raw "|":
--   v2|<key>|<selected keys, comma-separated, or ?>|<allowed 1/0/->|
--   <priceMin,priceMax,priceDefault,hoursMin,hoursMax,hoursDefault, - for
--   none>|<reason%>|<quickTrade 1/0/->|<its reason%>|<its value text%>|
--   <quickRelease 1/0/->|<its reason%>|<its value text%>|<rehome 1/0/->|
--   <quickTradePrice,quickReleasePrice>|<connectingAction,loadingItems 1/0/->|
--   <filters.isReleaseable 1/0/->|<the row's source text%>|<the page's id>
-- The page id (listerlua.js PAGE) may be empty.
-----------------------------------------------------------------------
local function flagOf(s)
	if s == "1" then
		return true
	elseif s == "0" then
		return false
	end
	return nil
end

-- "%7C" -> "|" (what encodeURIComponent wrote; bytes, so UTF-8 survives)
local function unpct(s)
	if type(s) ~= "string" or s == "" then
		return ""
	end
	return (string.gsub(s, "%%(%x%x)", function(sHex) return string.char(tonumber(sHex, 16)) end))
end
Lister.Unpct = unpct

local function numbersOf(s)
	local tN = {}
	for x in string.gmatch((s or "") .. ",", "([^,]*),") do
		tN[#tN + 1] = toNumber(x)
	end
	return tN
end

local function selOf(sSel)
	if sSel == "?" then
		return nil
	end
	local tSel = {}
	for x in string.gmatch(sSel, "[^,]+") do
		tSel[#tSel + 1] = x
	end
	return tSel
end

local function limitsOf(sLimits)
	local tN = numbersOf(sLimits)
	return { nPriceMin = tN[1], nPriceMax = tN[2], nPriceDefault = tN[3], nHoursMin = tN[4], nHoursMax = tN[5], nHoursDefault = tN[6] }
end

local function parseSeen(s)
	if type(s) ~= "string" or string.sub(s, 1, 3) ~= "v2|" then
		return nil
	end
	local t = {}
	for x in string.gmatch(string.sub(s, 4) .. "|", "([^|]*)|") do
		t[#t + 1] = x
	end
	if #t < 16 or t[1] == "" then
		return nil
	end
	local tP, tNet = numbersOf(t[13]), {}
	for x in string.gmatch(t[14] .. ",", "([^,]*),") do
		tNet[#tNet + 1] = flagOf(x)
	end
	return {
		nV = 2, sKey = t[1], tSel = selOf(t[2]), bAllowed = flagOf(t[3]), sReason = unpct(t[5]), tLimits = limitsOf(t[4]),
		tQuick = {
			bTrade = flagOf(t[6]), sTradeReason = unpct(t[7]), sTradeValue = unpct(t[8]),
			bRelease = flagOf(t[9]), sReleaseReason = unpct(t[10]), sReleaseValue = unpct(t[11]),
			bRehome = flagOf(t[12]), nTradePrice = tP[1], nReleasePrice = tP[2],
		},
		tNet = { bConn = tNet[1], bLoading = tNet[2] }, bReleaseable = flagOf(t[15]), sSource = unpct(t[16]),
		sPage = (t[17] ~= nil and t[17] ~= "") and t[17] or nil,
	}
end
Lister.ParseSeen = parseSeen

-- The freshest page report for this key under the current watch (read
-- after the select or clear it watches), or nil: none, stale, another
-- key, or a page that could not read the selection.
Lister._PageReport = function(self, tRun, sKey)
	local r = tRun and tRun.tSeen
	if r == nil or r.sReq ~= tRun.sWatchReq or r.sKey ~= sKey or r.tSel == nil then
		return nil
	end
	if now() - r.nAt > self.nPageFresh then
		return nil
	end
	-- a quick run trusts only the page that started it (v2 carries its id)
	if tRun.sPage ~= nil and r.sPage ~= tRun.sPage then
		return nil
	end
	return r
end

-- Whether sKey is the only selection: the page's report when there is a
-- fresh one ("page"), else Lua's own reads ("lua"; true / false / nil).
-- A quick run takes the page's answer only: never Lua's reads (they never
-- saw the selection in game), so no fresh report means nil.
Lister._IsSelected = function(self, tRun, sKey, bMark)
	local r = self:_PageReport(tRun, sKey)
	if r ~= nil then
		return onlySelected(r.tSel, sKey), "page"
	end
	if tRun ~= nil and self:_Q(tRun) ~= nil then
		return nil, "none"
	end
	return self:_SelState(sKey, bMark), "lua"
end

-- The quick action of the run, or of the current animal (a listing the
-- server refused, quick-traded / released in the same run): tQ, sMode.
Lister._Q = function(self, tRun)
	if tRun == nil then
		return nil
	end
	local tCur = tRun.tCur
	local sMode = (tCur ~= nil and tCur.sQuick) or tRun.sMode
	return self.tQuickModes[sMode], sMode
end

-- "R<page>_<n>" / "L<page>_<n>" (listerlua.js request ids) -> the page's id
local function pageOf(sReq)
	return type(sReq) == "string" and string.match(sReq, "^%a(%w+)_%d+$") or nil
end
Lister.PageOf = pageOf

-- Asks the page to report what it sees for sKey (a new request id: older
-- reports never count for it), or to stop (sKey nil).
Lister._Watch = function(self, tRun, sKey)
	if sKey == nil then
		if tRun.sWatchReq ~= nil then
			tRun.sWatchReq = nil
			self:_Send(tRun.oUI, "PZ2QoL_ListerWatch", "", "")
		end
		return
	end
	tRun.nWatchSeq = (tRun.nWatchSeq or 0) + 1
	tRun.sWatchReq = "w" .. tostring(tRun.nId) .. "_" .. tRun.nWatchSeq
	tRun.sWatchKey = sKey
	tRun.nWatchSent = now()
	log("watch", runFields(tRun, { key = sKey, req = tRun.sWatchReq }))
	self:_Send(tRun.oUI, "PZ2QoL_ListerWatch", tRun.sWatchReq, sKey)
end

-- PZ2QoL_ListerSeen: the page's report, kept with its arrival time.
Lister.OnSeen = function(self, sReq, sText)
	local tRun = self.tRun
	if tRun == nil or tRun.sWatchReq == nil or tostring(sReq or "") ~= tRun.sWatchReq then
		return
	end
	local r = parseSeen(sText)
	if r == nil then
		if not tRun.bSeenBadMarked then
			tRun.bSeenBadMarked = true
			mark("lister_page_bad")
		end
		return
	end
	r.sReq = tRun.sWatchReq
	r.nAt = now()
	-- a report from another page than the one that started a quick run: the
	-- page reloaded; the run stops (it never restarts or grows)
	if tRun.sPage ~= nil and r.sPage ~= nil and r.sPage ~= tRun.sPage then
		return self:_PageReloaded(tRun, "report")
	end
	-- the page's view, each time it changes (it reports every ~0.1 s)
	if tRun.sSeenLogged ~= r.sReq .. "|" .. tostring(sText) then
		tRun.sSeenLogged = r.sReq .. "|" .. tostring(sText)
		log("seen", runFields(tRun, { req = r.sReq, text = sText }))
	end
	tRun.tSeen = r
	if not tRun.bPageSeen then
		tRun.bPageSeen = true
		mark("lister_page_seen")
	end
end

-- Once per run, when the page first shows the selection and its data
-- complete: what Lua's own reads showed at that moment (to settle why they
-- failed in game).
Lister._Diag = function(self, tRun, sKey)
	if tRun.bDiagDone then
		return
	end
	tRun.bDiagDone = true
	local bFlag = element(context("hubAnimalsData", "animalStorageData", "list", sKey), "selected")
	mark(bFlag == true and "lister_diag_flag_true" or bFlag == false and "lister_diag_flag_false" or "lister_diag_flag_nil")
	local tSel = self:_Selection()
	if tSel == nil then
		mark("lister_diag_arr_nil")
	elseif #tSel == 0 then
		mark("lister_diag_arr_empty")
	elseif onlySelected(tSel, sKey) then
		mark("lister_diag_arr_key")
	else
		mark("lister_diag_arr_other")
	end
	local bAllowed = element(context("hubAnimalsData", "animalStorageData", "actions"), "tradeAllowed")
	mark(type(bAllowed) == "boolean" and "lister_diag_allowed_bool" or "lister_diag_allowed_nil")
	local l = self:_Limits()
	mark((l.nPriceMin ~= nil and l.nPriceMax ~= nil) and "lister_diag_limits_ok" or "lister_diag_limits_none")
end

Lister._Franchise = function(self)
	local oMode = self.oStorageMode
	local bOk, t = pcall(function() return oMode.tWorldAPIs.franchise end)
	return bOk and t or nil
end

-- true / false, or nil when the hub type can't be read.
Lister._Online = function(self)
	local franchise = self:_Franchise()
	if franchise == nil then
		return nil
	end
	local bOk, n, nOnline = pcall(function()
		return franchise:GetPlanetHubType(), franchise.PlanetHubType_FranchiseOnline
	end)
	if not bOk or n == nil or nOnline == nil then
		return nil
	end
	return n == nOnline
end

-- Whether the game is waiting on a server request (and which signal said so).
Lister._Busy = function(self)
	local franchise = self:_Franchise()
	if franchise ~= nil then
		local bOk, bBusy = pcall(function() return franchise:IsDatabaseOperationInProgress() end)
		if bOk and bBusy == true then
			return true, "db"
		end
		local bOk2, v = pcall(function()
			if type(franchise.RequestsInProgress) ~= "function" then
				return nil
			end
			return franchise:RequestsInProgress()
		end)
		if bOk2 and (v == true or (type(v) == "number" and v > 0) or (type(v) == "table" and global.next(v) ~= nil)) then
			return true, "requests"
		end
	end
	-- the storage screen's own spinner (the vanilla guard against a second request)
	local ctx = context("hubAnimalsData", "network")
	if ctx ~= nil then
		if element(ctx, "connectingAction") == true then
			return true, "connecting"
		end
		if element(ctx, "loadingItems") == true then
			return true, "loading"
		end
	end
	-- the mod's own market check, until it puts the market back (its page reads ask for more pages)
	local MarketPeek = global.package.loaded["pz2qol.marketpeek"]
	if type(MarketPeek) == "table" and MarketPeek.tPeek ~= nil then
		return true, "peek"
	end
	return false
end

-- The network signals as Lua reads them, for the log (Phase 0a: does a
-- select send a request? docs/PLAN-desk-quick-release.md 2):
-- { conn, loading, db, dbType }.
Lister._Net = function(self)
	local t = {}
	local ctx = context("hubAnimalsData", "network")
	if ctx ~= nil then
		t.conn = element(ctx, "connectingAction")
		t.loading = element(ctx, "loadingItems")
	end
	local franchise = self:_Franchise()
	if franchise ~= nil then
		local bOk, bBusy, nType = pcall(function() return franchise:IsDatabaseOperationInProgress() end)
		if bOk then
			t.db, t.dbType = bBusy, nType
		end
	end
	return t
end

-- "c1l0d1:42": connecting, loading, database busy (and its request type); "-" unread
local function netText(t)
	local function b(v)
		return v == true and "1" or v == false and "0" or "-"
	end
	t = t or {}
	local s = "c" .. b(t.conn) .. "l" .. b(t.loading) .. "d" .. b(t.db)
	if t.db == true and t.dbType ~= nil then
		s = s .. ":" .. tostring(t.dbType)
	end
	return s
end

local function netBusy(t)
	return t ~= nil and (t.conn == true or t.db == true)
end

Lister._Missing = function(self)
	local tOut = array()
	for _, t in ipairs(tNeeded) do
		local fn = t[1] == "ui2" and ui2Fn(t[2]) or hubFn(t[2])
		if fn == nil then
			tOut[#tOut + 1] = "api." .. t[1] .. "." .. t[2]
		end
	end
	return tOut
end

-----------------------------------------------------------------------
-- Job, price and hours
-----------------------------------------------------------------------
-- What a job may ask for (the header's third word; none = list).
-- "check" selects each animal and records what the game allows (market,
-- quick trade, quick release, rehome); it never sends anything.
-- "quicktrade" / "release" (Phase 2, docs/PLAN-desk-quick-release.md 4.3):
-- the desk's Quick trade / Quick release, one animal at a time (_QuickSend).
Lister.tJobModes = { list = true, check = true, quicktrade = true, release = true, unlist = true }

-- "v1 <paceMs>[ <mode>]\n<guid> <key> <price> <hours>\n..." -> tAnimals,
-- nPaceMs, sMode (or nil, sError). A GUID listed twice is listed once.
local function parseJob(sJob)
	if type(sJob) ~= "string" then
		return nil, "No job was sent."
	end
	local tAnimals, tSeen = {}, {}
	local nPace = nil
	local sMode = "list"
	local tOpts = {}
	local nLine = 0
	for sLine in string.gmatch(sJob .. "\n", "([^\n]*)\n") do
		sLine = string.match(sLine, "^%s*(.-)%s*$")
		if sLine ~= "" then
			nLine = nLine + 1
			if nLine == 1 then
				local sPace, sWord, sOpts = string.match(sLine, "^v1%s+(%d+)%s*(%a*)%s*(.-)$")
				if sPace == nil then
					return nil, "Unknown job format (expected v1)."
				end
				-- options after the mode: onrefused=quicktrade|release,
				-- refusedmax=<n> (a listing run only; see Lister._Refused) and
				-- offset=<percent> (the player's price offset, priceFor)
				for sOpt in string.gmatch(sOpts or "", "%S+") do
					local sK, sV = string.match(sOpt, "^(%a+)=(%-?%w+)$")
					if sK == "onrefused" and (sV == "quicktrade" or sV == "release") and (sWord == "" or sWord == "list") then
						tOpts.sOnRefused = sV
					elseif sK == "refusedmax" and tonumber(sV) ~= nil and (sWord == "" or sWord == "list") then
						tOpts.nRefusedMax = math.max(0, math.floor(tonumber(sV)))
					elseif sK == "offset" and tonumber(sV) ~= nil then
						tOpts.nOffset = math.max(-Lister.nOffsetLimit, math.min(Lister.nOffsetLimit, tonumber(sV) / 100))
					else
						return nil, "Unknown job option (" .. sOpt .. ")."
					end
				end
				if sWord ~= "" then
					if not Lister.tJobModes[sWord] then
						return nil, "Unknown job mode (" .. sWord .. ")."
					end
					sMode = sWord
				end
				nPace = tonumber(sPace)
			else
				local sGuid, sKey, sPrice, sHours = string.match(sLine, "^(%S+)%s+(%S+)%s+(%S+)%s+(%S+)$")
				local nPrice = sPrice ~= "-" and toNumber(sPrice) or nil
				local vHours = (sHours == "max" or sHours == "default") and sHours or toNumber(sHours)
				-- GUIDs as guidOf prints them: decimal, or another plain token
				if sGuid == nil or not string.match(sGuid, "^[%w_%.:%-]+$") or (sPrice ~= "-" and nPrice == nil) or vHours == nil then
					return nil, "Bad job line " .. nLine .. "."
				end
				if not tSeen[sGuid] then
					tSeen[sGuid] = true
					tAnimals[#tAnimals + 1] = { sGuid = sGuid, sHint = sKey ~= "-" and sKey or nil, nPrice = nPrice, vHours = vHours }
				end
			end
		end
	end
	if nPace == nil then
		return nil, "Unknown job format (expected v1)."
	end
	if #tAnimals == 0 then
		return nil, sMode == "check" and "No animals to check." or sMode == "unlist" and "No listings to take off." or "No animals to list."
	end
	return tAnimals, nPace, sMode, tOpts
end
Lister.ParseJob = parseJob

-- The page's nicePrice (pricing.js): steps of 5 under 500, 10 under 5000, 50 above.
local function nicePrice(nPrice)
	local nStep = nPrice < 500 and 5 or (nPrice < 5000 and 10 or 50)
	return math.max(nStep, math.floor(nPrice / nStep + 0.5) * nStep)
end

-- nPrice (integer, inside the game's limits), sCapped, bUsedDefault; nPrice
-- nil when there is no usable price. nJob is the page's recommendation
-- before the player's offset (nil: the game's default price, rounded by
-- nicePrice); it is capped to the game's limits first, then nOffset (none
-- too) applies, rounded and capped again, as the storage panel prices a
-- single animal (pricing.js recommendPrice; tests/price_table.txt holds
-- both to it).
local function priceFor(nJob, tLimits, nOffset)
	local nPrice, bDefault = nJob, false
	if nPrice == nil then
		nPrice, bDefault = tLimits.nPriceDefault, true
	end
	if nPrice == nil or not (nPrice > 0) then
		return nil, nil, bDefault
	end
	local nMin = tLimits.nPriceMin ~= nil and math.ceil(tLimits.nPriceMin) or nil
	local nMax = tLimits.nPriceMax ~= nil and math.floor(tLimits.nPriceMax) or nil
	local sCapped = nil
	local function cap(nWanted)
		if nMin ~= nil and nWanted < nMin then
			nWanted, sCapped = nMin, "min"
		end
		if nMax ~= nil and nWanted > nMax then
			nWanted, sCapped = nMax, "max"
		end
		return nWanted
	end
	-- the page's price is already its base (rounded, then capped): rounding it again could move a capped one
	nPrice = cap(bDefault and nicePrice(nPrice) or nPrice)
	local sBaseCapped = sCapped
	sCapped = nil
	nPrice = cap(nicePrice(nPrice * (1 + (nOffset or 0))))
	-- a capped price the offset leaves at the limit still counts as capped
	if sCapped == nil and (nPrice == nMin or nPrice == nMax) then
		sCapped = sBaseCapped
	end
	if nPrice < 1 then
		return nil, nil, bDefault
	end
	return toInteger(nPrice), sCapped, bDefault
end
Lister.PriceFor = priceFor

-- Whole hours inside the game's limits: "max" -> the longest, "default" ->
-- the game's default, a number -> clamped.
local function hoursFor(vJob, tLimits)
	local nMin, nMax, nDefault = tLimits.nHoursMin, tLimits.nHoursMax, tLimits.nHoursDefault
	local n
	if vJob == "max" then
		n = nMax or nDefault or nMin or 1
	elseif vJob == "default" then
		n = nDefault or nMax or nMin or 1
	else
		n = vJob
		if nMin ~= nil and n < nMin then n = nMin end
		if nMax ~= nil and n > nMax then n = nMax end
	end
	n = math.floor(n)
	if n < 1 then
		n = 1
	end
	return toInteger(n)
end

Lister._ClampPace = function(self, v)
	local n = toNumber(v)
	if n == nil then
		return self.nPaceMs
	end
	if n < self.nPaceMin then n = self.nPaceMin end
	if n > self.nPaceMax then n = self.nPaceMax end
	return toInteger(n)
end

-- A check run's pause between two selects (it sends nothing; the page
-- picks 150 ms, or the desk's pace if a select turns out to send a request)
Lister._ClampCheckPace = function(self, v)
	local n = toNumber(v) or self.nCheckPaceMin
	if n < self.nCheckPaceMin then n = self.nCheckPaceMin end
	if n > self.nPaceMax then n = self.nPaceMax end
	return toInteger(n)
end

-----------------------------------------------------------------------
-- Talking to the page
-----------------------------------------------------------------------
Lister._Send = function(self, oUI, sEvent, ...)
	if oUI == nil then
		local Hub = global.package.loaded["pz2qol.hub"]
		oUI = Hub and Hub.bFrontEndIsModded and Hub.oFrontEndUI or nil
	end
	if oUI == nil then
		return false
	end
	return (pcall(oUI.TriggerEventAtNextAdvance, oUI, sEvent, ...))
end

Lister._State = function(self, tRun, sMessage)
	local t = now()
	local nWaited = 0
	if tRun.sPhase == "running" then
		local nFrom = tRun.sStep == "pause" and tRun.nPauseStart or tRun.nStepStart
		if nFrom ~= nil and t > nFrom then
			nWaited = toInteger(t - nFrom)
		end
	end
	local tResults = array()
	for i, r in ipairs(tRun.tResults) do
		-- the game's verdict once it was selected: sent once and kept by the page (a state goes every second)
		local vVerdict = NULL
		if r.verdict ~= nil and not r.bVerdictSent then
			vVerdict = r.verdict
		end
		tResults[i] = {
			guid = r.guid, status = r.status, kind = r.kind or NULL, price = r.price or NULL,
			hours = r.hours or NULL, capped = r.capped or NULL, usedDefault = r.usedDefault == true,
			detail = r.detail or "",
			verdict = vVerdict,
			-- quick-traded / released after the server refused its listing
			afterRefused = r.listRefused ~= nil,
		}
	end
	return {
		run = tRun.nId, req = tRun.sReq, phase = tRun.sPhase, total = #tRun.tResults, mode = tRun.sMode or "list", onRefused = tRun.sOnRefused or NULL,
		index = tRun.nIndex - 1, step = tRun.sPhase == "running" and tRun.sStep or "",
		waited = nWaited, paceMs = tRun.nPaceMs or self.nPaceMs, message = sMessage or tRun.sMessage or "",
		results = tResults,
	}
end

-- a page that (re)loads has none of the verdicts sent so far: the next state carries them all
Lister._ResendVerdicts = function(self, tRun)
	for _, r in ipairs(tRun.tResults) do
		r.bVerdictSent = nil
	end
end

Lister._Emit = function(self, tRun, sMessage, oUI)
	tRun.bDirty = false
	tRun.nLastEmit = now()
	if self:_Send(oUI or tRun.oUI, "PZ2QoL_ListerState", toJson(self:_State(tRun, sMessage))) then
		for _, r in ipairs(tRun.tResults) do
			if r.verdict ~= nil then
				r.bVerdictSent = true
			end
		end
	end
end

-- A Start that does not start: its own state, run 0, refused.
Lister._Refuse = function(self, oUI, sReq, sMessage, sPhase)
	mark("lister_start_refused")
	trace("start refused: " .. tostring(sMessage))
	log("start_refused", { req = sReq, msg = sMessage, phase = sPhase })
	self:_Send(oUI, "PZ2QoL_ListerState", toJson({
		run = 0, req = sReq, phase = sPhase or "done", refused = true, total = 0, index = 0, step = "",
		waited = 0, paceMs = self.nPaceMs, message = sMessage, results = array(),
	}))
end

-----------------------------------------------------------------------
-- The run
-----------------------------------------------------------------------
local tResultMarks = { listed = "lister_listed", refused = "lister_refused", timeout = "lister_timeout", skipped = "lister_skip", checked = "lister_checked",
	traded = "lister_quick_traded", released = "lister_quick_released", unconfirmed = "lister_quick_unconfirmed", unlisted = "lister_unlisted" }

local tSkipText = {
	gone = "No longer in storage (sold, moved or filtered out).",
	listed = "Already on the market.",
	moving = "Being moved.",
	elderly = "Elderly: the market won't take it.",
	pregnant = "Pregnant: the market won't take it until she gives birth.",
	juvenile = "A juvenile: the market won't take it.",
	shoal = "Shoals are traded as a group in the game's own Market; the mod lists single animals.",
	unselectable = "The game did not select it in time.",
	changed = "The storage list changed just before listing; not listed.",
	busy = "The game was still busy with another server request; not listed.",
	noprice = "No price (and the game has no default for it).",
	untradeable = "The game does not allow trading it.",
	ambiguous = "The game gave no id for it and another animal in storage looks the same; not listed.",
	notallowed = "The game does not allow it now.",
	nopage = "No fresh report from the page for it; nothing was sent.",
	rehome = "The game offers only Rehome for it.",
	notlisted = "Not on the market (any more): sold, expired or already taken off.",
}

-- The steps the page watches the selection in.
local tWatchSteps = { clear = true, select = true, selected = true, send = true }

Lister._SetStep = function(self, tRun, sStep, sMessage)
	log("step", runFields(tRun, { step = sStep, from = tRun.sStep, msg = sMessage,
		secs = tRun.nStepStart ~= nil and secs(now() - tRun.nStepStart) or nil }))
	if not tWatchSteps[sStep] then
		self:_Watch(tRun, nil)
	end
	tRun.sStep = sStep
	tRun.nStepStart = now()
	tRun.sMessage = sMessage or ""
	tRun.bDirty = true
	if tRun.tCur ~= nil then
		tRun.tCur.sBusyMarked = nil
	end
end

Lister._Begin = function(self, tRun)
	local tJob = tRun.tAnimals[tRun.nIndex]
	tRun.tCur = { sGuid = tJob.sGuid, sHint = tJob.sHint, nPrice = tJob.nPrice, vHours = tJob.vHours }
	tRun.tResults[tRun.nIndex].status = "working"
	log("animal", runFields(tRun, { n = #tRun.tAnimals, hint = tJob.sHint, jobPrice = tJob.nPrice or "-", jobHours = tJob.vHours }))
	self:_SetStep(tRun, "server")
end

Lister._Summary = function(self, tRun)
	local tQ = self:_Q(tRun)
	if tQ ~= nil then
		local nDone = 0
		for _, r in ipairs(tRun.tResults) do
			if r.status == tQ.sDone then
				nDone = nDone + 1
			end
		end
		return tQ.sVerb .. " " .. nDone .. " of " .. #tRun.tResults .. "."
	end
	if tRun.sMode == "unlist" then
		local nOff = 0
		for _, r in ipairs(tRun.tResults) do
			if r.status == "unlisted" then
				nOff = nOff + 1
			end
		end
		return "Taken off the market " .. nOff .. " of " .. #tRun.tResults .. "."
	end
	local bCheck = tRun.sMode == "check"
	local nDone, nAfter = 0, 0
	for _, r in ipairs(tRun.tResults) do
		if r.status == (bCheck and "checked" or "listed") then
			nDone = nDone + 1
		elseif r.listRefused ~= nil and (r.status == "traded" or r.status == "released") then
			nAfter = nAfter + 1
		end
	end
	local s = (bCheck and "Checked " or "Listed ") .. nDone .. " of " .. #tRun.tResults
	if nAfter > 0 then
		s = s .. " · " .. (tRun.sOnRefused == "release" and "Released " or "Quick-traded ") .. nAfter .. " after refusal"
	end
	return s .. "."
end

Lister._Next = function(self, tRun)
	if tRun.nIndex > #tRun.tAnimals then
		return self:_End(tRun, "done", self:_Summary(tRun))
	end
	self:_Begin(tRun)
end

-- The current animal's outcome; then its pause, or straight on.
Lister._Result = function(self, tRun, sStatus, sKind, sDetail)
	local tCur = tRun.tCur
	local tRes = tRun.tResults[tRun.nIndex]
	tRes.status = sStatus
	tRes.kind = sKind
	tRes.detail = sDetail or ""
	log("result", runFields(tRun, { status = sStatus, kind = sKind, detail = sDetail, key = tCur and tCur.sKey,
		price = tRes.price, hours = tRes.hours, capped = tRes.capped, usedDefault = tRes.usedDefault,
		sent = tCur ~= nil and tCur.bSent == true,
		afterSend = tCur ~= nil and tCur.nSentAt ~= nil and secs(now() - tCur.nSentAt) or nil,
		err = tCur ~= nil and tCur.tError ~= nil and (tCur.tError.sName or ("code " .. tostring(tCur.tError.nError))) or nil }))
	tRun.tCur = nil
	tRun.nIndex = tRun.nIndex + 1
	tRun.bDirty = true
	mark(tResultMarks[sStatus] or "lister_skip")
	if sStatus == "listed" and tCur ~= nil then
		noteListing(tCur.sKey, tCur.sGuid)
	end
	-- a listing that timed out may still be answered (late errors): the
	-- next one waits for a quiet server first
	if tCur ~= nil and tCur.bSent and sStatus == "timeout" then
		tRun.bNeedQuiet = true
	end
	-- two animals in a row without a fresh page report stop the run; one with its report ends the streak
	if tCur ~= nil and not tCur.bMissed then
		tRun.nMiss = nil
	end
	if tRun.nMiss ~= nil and tRun.nMiss >= self.nQuickMissStop then
		mark("lister_quick_stop_nopage")
		return self:_End(tRun, "stopped", "Stopped: no fresh report from the page for " .. tRun.nMiss .. " animals in a row; nothing more was sent.")
	end
	-- the player's Stop during a quick animal: after it
	if tRun.bStopAfter then
		return self:_End(tRun, "stopped", "Stopped by you.")
	end
	if tCur ~= nil and tCur.bSent then
		-- it reached the server: the player's pause before anything else is sent
		self.nLastServer = now()
		if tRun.nIndex <= #tRun.tAnimals then
			tRun.nPauseStart = self.nLastServer
			return self:_SetStep(tRun, "pause", tRun.sMode == "unlist" and "Pausing before the next one." or "Pausing between listings.")
		end
	elseif tCur ~= nil and tRun.sMode == "check" and tCur.nSelectedAt ~= nil and tRun.nIndex <= #tRun.tAnimals then
		-- a check sends nothing: its own short pause between two selects
		tRun.nPauseStart = now()
		return self:_SetStep(tRun, "pause", "Pausing between checks.")
	end
	self:_Next(tRun)
end

-- What a quick run skips and carries on after: only "the game doesn't
-- allow it now" (and a missing page report, which stops the run on the
-- second in a row). Everything else, a changed selection or key, an
-- ambiguous or gone animal, a busy game, stops it (safety review 2026-10-18).
local tQuickSkips = { notallowed = true, rehome = true, nopage = true }

Lister._Skip = function(self, tRun, sKind, sDetail)
	-- why, in the trace (lister_skip alone said nothing)
	mark(tSkipText[sKind] ~= nil and ("lister_skip_" .. tostring(sKind)) or "lister_skip_other")
	local tCur = tRun.tCur
	if self:_Q(tRun) ~= nil and not tQuickSkips[sKind] then
		local sWhy = sDetail or tSkipText[sKind] or tostring(sKind)
		mark("lister_quick_stop_unexpected")
		-- after a refusal the result reads as the refusal, so it carries the why
		local bAfterRefusal = tCur ~= nil and tCur.bAfterRefusal
		return self:_StopRun(tRun, "skipped", sKind, bAfterRefusal and sWhy or sDetail, "Stopped: " .. sWhy .. " Nothing more was sent.")
	end
	if tCur ~= nil and tCur.bAfterRefusal then
		-- a listing the server refused that the game won't quick-trade now:
		-- it stays refused, and the run goes on
		local tRes = tRun.tResults[tRun.nIndex]
		return self:_Result(tRun, "refused", "refused", tostring(tRes.listRefused or "Refused by the server.")
			.. " Not " .. (tCur.sQuick == "release" and "released" or "quick-traded") .. ": " .. tostring(sDetail or tSkipText[sKind] or sKind))
	end
	-- the page words each kind itself (RESULT_WORDS): only the game's reason or a custom text adds to it
	return self:_Result(tRun, "skipped", sKind, sDetail)
end

-- A listing the server refused (developer, 2026-10-18: the same tigers fail
-- in vanilla too, but can be quick-traded), when the player chose "Quick
-- trade it" / "Quick release it" for the run: the listing's result is kept,
-- and the same animal is quick-traded / released right after, with every
-- quick guard (a fresh page report, its flag allowed now, _Holds, waiting
-- for it to leave storage, a stop on anything unexpected). Only kind
-- "refused" (a server refusal), never a timeout or any other failure.
Lister._Refused = function(self, tRun, sDetail)
	local tCur = tRun.tCur
	local sQ = tRun.sOnRefused
	if sQ == nil or tCur == nil or (tRun.nRefusedMax ~= nil and (tRun.nRefusedTried or 0) >= tRun.nRefusedMax) then
		return self:_Result(tRun, "refused", "refused", sDetail)
	end
	local tRes = tRun.tResults[tRun.nIndex]
	tRes.listRefused = sDetail
	tRun.nRefusedTried = (tRun.nRefusedTried or 0) + 1
	mark("lister_refused_then_quick")
	log("refused_then_quick", runFields(tRun, { key = tCur.sKey, mode = sQ, detail = sDetail, n = tRun.nRefusedTried }))
	-- the listing reached the server: the player's pause first
	self.nLastServer = now()
	tRun.tCur = { sGuid = tCur.sGuid, sHint = tCur.sKey, sQuick = sQ, bAfterRefusal = true }
	tRun.nPauseStart = now()
	return self:_SetStep(tRun, "pause", sQ == "release" and "Refused: releasing it after a pause." or "Refused: quick trading it after a pause.")
end

-- A quick run stops at once (anything unexpected): this animal's result,
-- then the run's end. sStatus "unconfirmed" when it was sent.
Lister._StopRun = function(self, tRun, sStatus, sKind, sDetail, sMessage)
	local tCur = tRun.tCur
	local tRes = tRun.tResults[tRun.nIndex]
	if tCur ~= nil and tRes ~= nil and tCur.bAfterRefusal and not tCur.bSent then
		-- the listing was refused and nothing more was sent for it
		sStatus, sKind = "refused", "refused"
		sDetail = tostring(tRes.listRefused or "Refused by the server.") .. " Quick action not sent: " .. tostring(sDetail or "")
	end
	if tCur ~= nil and tRes ~= nil then
		tRes.status, tRes.kind, tRes.detail = sStatus, sKind, sDetail or ""
		log("result", runFields(tRun, { status = sStatus, kind = sKind, detail = sDetail, key = tCur.sKey, sent = tCur.bSent == true,
			afterSend = tCur.nSentAt ~= nil and secs(now() - tCur.nSentAt) or nil }))
		mark(tResultMarks[sStatus] or "lister_skip")
		if tCur.bSent then
			self.nLastServer = now()
		end
		tRun.tCur = nil
		tRun.nIndex = tRun.nIndex + 1
	end
	mark("lister_quick_stop")
	return self:_End(tRun, "stopped", sMessage)
end

-- The page that started a quick run reloaded: nothing more is sent.
Lister._PageReloaded = function(self, tRun, sHow)
	mark("lister_quick_reloaded")
	log("quick_reloaded", runFields(tRun, { how = sHow, step = tRun.sStep, sent = tRun.tCur ~= nil and tRun.tCur.bSent == true }))
	tRun.bReloaded = true
	return self:_End(tRun, "stopped", "Stopped: page reloaded.")
end

-- the cheap flag, asked before the list is read: reading it while the game rebuilds it crashed the game (nQuickFirstLook)
Lister._Loading = function(self)
	return element(context("hubAnimalsData", "network"), "loadingItems") == true
end

-- Where a sent quick animal is now: "gone" (its GUID absent and exactly one
-- row fewer), "there", or a state to wait out (the list is being rebuilt):
-- "leaving" (the id is gone, its row still shown), "ambiguous" (more rows
-- with its look than at the send), "unreadable" (loading, or another count).
-- _QuickGone waits until gone reads twice in a row, or stops at the deadline.
Lister._QuickState = function(self, tCur)
	if self:_Loading() then
		return "unreadable"
	end
	local tList = self:_List()
	if tList == nil then
		return "unreadable"
	end
	local nRows = 0
	for _, tRow in pairs(tList) do
		if type(tRow) == "table" then
			nRows = nRows + 1
		end
	end
	if tCur.nRowsAtSend ~= nil and nRows < tCur.nRowsAtSend - 1 then
		return "unreadable"
	end
	-- gone means exactly one row fewer than at the send (else: look again;
	-- still so at the deadline, the run stops unconfirmed)
	local bOneFewer = tCur.nRowsAtSend ~= nil and nRows == tCur.nRowsAtSend - 1
	if isFpToken(tCur.sGuid) then
		local _, n = fpMatches(tList, self.tFpOf[tCur.sGuid] or "")
		if n == 0 then
			return bOneFewer and "gone" or "unreadable"
		end
		return n == 1 and "there" or "ambiguous"
	end
	for k, tRow in pairs(tList) do
		local sKey = type(tRow) == "table" and rowKey(k, tRow) or nil
		if sKey ~= nil and guidOf(sKey) == tCur.sGuid then
			return "there"
		end
	end
	-- the id is gone: its look must be gone too (one row fewer), else a row
	-- may only have lost its id for a moment; no look known: never gone by
	-- the id alone
	if tCur.sFp == nil then
		return "unreadable"
	end
	local _, n = fpMatches(tList, tCur.sFp)
	if n > (tCur.nFpAtSend or 1) then
		return "ambiguous"
	end
	if n == (tCur.nFpAtSend or 1) then
		-- the native no longer gives the id but the old row is still shown:
		-- the list is about to be rebuilt (proven in game, Y: 2026-10-18: at the
		-- first look, 250 ms after each of 3 quick trades that worked, the row
		-- was still there and its key gave id type 0; ~1 s later one row fewer)
		return "leaving"
	end
	return bOneFewer and "gone" or "unreadable"
end

Lister._End = function(self, tRun, sPhase, sMessage)
	local tCur = tRun.tCur
	local tQ = self:_Q(tRun)
	if tCur ~= nil and tCur.bSent and tQ ~= nil then
		-- a quick animal sent: one last look at the list
		local tRes = tRun.tResults[tRun.nIndex]
		-- not while the game may still be rebuilding the list (nQuickFirstLook)
		local bOk, sState = false, nil
		if now() - (tCur.nSentAt or 0) >= self.nQuickFirstLook then
			bOk, sState = pcall(self._QuickState, self, tCur)
		end
		-- gone counts read twice in a row, as in _QuickGone: this look and the one before
		if bOk and sState == "gone" and (tCur.nGoneSeen or 0) >= 1 then
			tRes.status, tRes.kind, tRes.detail = tQ.sDone, nil, ""
			mark(tResultMarks[tQ.sDone])
		else
			tRes.status, tRes.kind = "unconfirmed", "unconfirmed"
			tRes.detail = (sPhase == "closed" and "Animal Storage was closed" or "Stopped") .. " before it was confirmed: check storage."
		end
		tRun.nIndex = tRun.nIndex + 1
		self.nLastServer = now()
		tRun.tCur = nil
		tCur = nil
	end
	if tCur ~= nil and tCur.bSent and tRun.sMode == "unlist" then
		-- taking it off was asked: one last look at its row
		local tRes = tRun.tResults[tRun.nIndex]
		local bOk, bListed = false, true
		if now() - (tCur.nSentAt or 0) >= self.nUnlistFirstLook then
			bOk, bListed = pcall(self._IsListed, self, tCur)
		end
		if bOk and bListed == false and self:_Find(tCur, self:_List()) ~= nil then
			tRes.status, tRes.kind, tRes.detail = "unlisted", nil, ""
			mark("lister_unlisted")
		else
			tRes.status, tRes.kind = "stopped", "stopped"
			tRes.detail = (sPhase == "closed" and "Animal Storage was closed" or "Stopped") .. " while waiting; it may still come off the market."
		end
		tRun.nIndex = tRun.nIndex + 1
		self.nLastServer = now()
		tRun.tCur = nil
		tCur = nil
	end
	if tCur ~= nil then
		local tRes = tRun.tResults[tRun.nIndex]
		if tCur.bSent then
			-- it reached the server: one last look, else it may still appear
			local bOk, bListed = false, false
			if not self:_Loading() then
				bOk, bListed = pcall(self._IsListed, self, tCur)
			end
			if bOk and bListed then
				tRes.status, tRes.kind, tRes.detail = "listed", nil, ""
				mark("lister_listed")
				noteListing(tCur.sKey, tCur.sGuid)
			else
				tRes.status, tRes.kind = "stopped", "stopped"
				tRes.detail = (sPhase == "closed" and "Animal Storage was closed" or "Stopped")
					.. " while waiting for the server; it may still appear on the market."
			end
			tRun.nIndex = tRun.nIndex + 1
			self.nLastServer = now()
		else
			if tCur.bAfterRefusal then
				-- its listing was refused; the quick action never went
				tRes.status, tRes.kind, tRes.detail = "refused", "refused", tostring(tRes.listRefused or "Refused by the server.")
				tRun.nIndex = tRun.nIndex + 1
			else
				-- nothing was sent for it: it stays to do
				tRes.status, tRes.kind, tRes.detail = "pending", nil, ""
				tRes.price, tRes.hours, tRes.capped, tRes.usedDefault = nil, nil, nil, nil
			end
		end
		tRun.tCur = nil
	end
	self:_Watch(tRun, nil)
	if tRun.sMode == "check" then
		-- a check leaves nothing selected (local call, as the run's own clears)
		local fnClear = hubFn("StorageUIClearSelectedItems")
		local bCleared = fnClear ~= nil and pcall(fnClear)
		mark(bCleared and "lister_check_cleared" or "lister_check_clear_fail")
		-- once more a moment later: a select just made may still land after a Stop
		self.nCheckClearAt = now() + self.nCheckClearAgain
	end
	tRun.sPhase = sPhase
	tRun.sStep = ""
	tRun.sMessage = sMessage or ""
	if self.tRun == tRun then
		self.tRun = nil
	end
	self.tLast = tRun
	mark(sPhase == "closed" and "lister_closed" or "lister_run_end")
	local tCount = {}
	for _, r in ipairs(tRun.tResults) do
		local sK = r.status == "skipped" and ("skip_" .. tostring(r.kind)) or tostring(r.status)
		tCount[sK] = (tCount[sK] or 0) + 1
	end
	log("end", { run = tRun.nId, phase = sPhase, msg = sMessage, total = #tRun.tResults, counts = tCount })
	trace("run " .. tostring(tRun.nId) .. " " .. sPhase .. ": " .. tostring(sMessage))
	self:_Emit(tRun)
	-- the desk closed during the run: the game's storage filters come back now
	if self.bDeskRestoreLater and self.tRun == nil then
		pcall(self._DeskRestore, self, "run ended")
	end
end

Lister._MarkBusy = function(self, tRun, sWhy)
	local tCur = tRun.tCur
	if tCur ~= nil and tCur.sBusyMarked ~= tRun.sStep then
		tCur.sBusyMarked = tRun.sStep
		mark("lister_busy_" .. tostring(sWhy))
		log("busy", runFields(tRun, { step = tRun.sStep, why = sWhy, quiet = tRun.bNeedQuiet == true }))
	end
end

-- RequestsInProgress alone may stay on for background polls (the old page lister only asked IsDatabaseOperationInProgress)
Lister._BusyNow = function(self, tRun, t, sTimeoutDetail)
	local bBusy, sWhy = self:_Busy()
	if bBusy and sWhy == "requests" and (tRun.bRequestsIgnored or t - tRun.nStepStart > self.nRequestsGrace) then
		if not tRun.bRequestsIgnored then
			tRun.bRequestsIgnored = true
			mark("lister_busy_requests_ignored")
			log("busy_requests_ignored", runFields(tRun, { step = tRun.sStep }))
		end
		bBusy = false
	end
	if not bBusy then
		return false
	end
	tRun.nIdleSince = nil
	self:_MarkBusy(tRun, sWhy)
	if t - tRun.nStepStart > self.nServerTimeout then
		self:_Skip(tRun, "busy", sTimeoutDetail)
		return true
	end
	tRun.sMessage = "Waiting for the game's other server requests."
	return true
end

-- Whether row sKey holds the animal behind sToken right now: true, or
-- false and why ("id", "core", "ambiguous", "gone", "other", "unreadable",
-- "unknown"). The send asks this in the same tick as the game's call, by
-- the same rules Resolve gave the token by:
--   an id token: the key still gives it; the row still shows the species,
--     name and sex Resolve saw with it; a lossy one: no other row gives it.
--   a fingerprint token: exactly one row of the list has the fingerprint,
--     and it is this one.
Lister._Holds = function(self, sToken, sKey, tList)
	if sKey == nil or sToken == nil then
		return false, "gone"
	end
	if isFpToken(sToken) then
		local sFp = self.tFpOf[sToken]
		if sFp == nil then
			return false, "unknown"
		end
		tList = tList or self:_List()
		if tList == nil then
			return false, "unreadable"
		end
		local sOnly, n = fpMatches(tList, sFp)
		if n > 1 then
			return false, "ambiguous"
		end
		if sOnly ~= sKey then
			return false, n == 0 and "gone" or "other"
		end
		return true
	end
	local s, bLossy = guidOf(sKey)
	if s ~= sToken then
		return false, "id"
	end
	local sCore = self.tCore[sToken]
	if sCore ~= nil then
		local tRow = (tList ~= nil and rowOf(sKey, tList)) or rowOf(sKey, nil)
		if tRow == nil or coreOf(tRow) ~= sCore then
			return false, "core"
		end
	end
	if bLossy then
		tList = tList or self:_List()
		if tList == nil then
			return false, "unreadable"
		end
		for k, tRow in pairs(tList) do
			local sOther = type(tRow) == "table" and rowKey(k, tRow) or nil
			if sOther ~= nil and sOther ~= sKey and guidOf(sOther) == sToken then
				return false, "ambiguous"
			end
		end
	end
	return true
end

-- The animal's key now: the last key it had, the page's hint, then the
-- list. nil and why ("ambiguous": rows that can't be told apart) if none.
Lister._Find = function(self, tCur, tList)
	local sGuid = tCur.sGuid
	if tCur.sKey ~= nil and self:_Holds(sGuid, tCur.sKey, tList) then
		return tCur.sKey
	end
	if tCur.sHint ~= nil and tCur.sHint ~= tCur.sKey and self:_Holds(sGuid, tCur.sHint, tList) then
		return tCur.sHint
	end
	if tList == nil then
		return nil
	end
	if isFpToken(sGuid) then
		local sFp = self.tFpOf[sGuid]
		if sFp == nil then
			return nil, "unknown"
		end
		local sOnly, n = fpMatches(tList, sFp)
		if n > 1 then
			return nil, "ambiguous"
		end
		return sOnly
	end
	local sWhy = nil
	for k, tRow in pairs(tList) do
		local sKey = type(tRow) == "table" and rowKey(k, tRow) or nil
		if sKey ~= nil and sKey ~= tCur.sKey and sKey ~= tCur.sHint and guidOf(sKey) == sGuid then
			local bHolds, sNot = self:_Holds(sGuid, sKey, tList)
			if bHolds then
				return sKey
			end
			sWhy = sNot == "ambiguous" and "ambiguous" or sWhy
		end
	end
	return nil, sWhy
end

Lister._IsListed = function(self, tCur)
	if tCur.sKey ~= nil and self:_Holds(tCur.sGuid, tCur.sKey, nil) then
		return isListed(rowOf(tCur.sKey, nil) or rowOf(tCur.sKey, self:_List()))
	end
	-- the list was rebuilt: find the animal again
	local tList = self:_List()
	local sKey = self:_Find(tCur, tList)
	if sKey == nil then
		return false
	end
	tCur.sKey = sKey
	return isListed(rowOf(sKey, tList))
end

-- The game's data for the selection: nil and what is missing until it is
-- there (selection = {key} when readable, tradeAllowed written, and the
-- limits when allowed).
-- sSrc in the result says whose reads it is: "page" (a fresh page report,
-- the authority when there is one) or "lua" (Lua's own reads, the fallback).
local function limitsMissing(tLimits)
	return tLimits.nPriceMin == nil or tLimits.nPriceMax == nil or (tLimits.nHoursMax == nil and tLimits.nHoursDefault == nil)
end

Lister._SelectionData = function(self, tCur, tRun)
	if tRun ~= nil and tRun.sMode == "unlist" then
		-- taking it off: only the selection counts (a fresh page report: Lua's
		-- own reads never saw the selection in game); the trade data of a
		-- listed animal is not needed
		local r = self:_PageReport(tRun, tCur.sKey)
		if r == nil then
			return nil, "page"
		end
		if not onlySelected(r.tSel, tCur.sKey) then
			return nil, "selection"
		end
		return { bAllowed = r.bAllowed, sReason = r.sReason, tLimits = r.tLimits or {}, sSrc = "page", nV = r.nV, tQuick = r.tQuick, tPage = r }
	end
	local tQ = self:_Q(tRun)
	if tQ ~= nil then
		-- a quick run: a fresh page report only (v2, with its own flag)
		local r = self:_PageReport(tRun, tCur.sKey)
		if r == nil then
			return nil, "page"
		end
		if not onlySelected(r.tSel, tCur.sKey) then
			return nil, "selection"
		end
		if r.tQuick == nil or type(r.tQuick[tQ.sFlag]) ~= "boolean" then
			return nil, "allowed"
		end
		return { bAllowed = r.bAllowed, sReason = r.sReason, tLimits = r.tLimits, sSrc = "page", nV = r.nV, tQuick = r.tQuick, tPage = r }
	end
	local r = self:_PageReport(tRun, tCur.sKey)
	if r ~= nil then
		if not onlySelected(r.tSel, tCur.sKey) then
			return nil, "selection"
		end
		if type(r.bAllowed) ~= "boolean" then
			return nil, "allowed"
		end
		if r.bAllowed and limitsMissing(r.tLimits) then
			return nil, "limits"
		end
		self:_Diag(tRun, tCur.sKey)
		return { bAllowed = r.bAllowed, sReason = r.sReason, tLimits = r.tLimits, sSrc = "page", nV = r.nV, tQuick = r.tQuick, tPage = r }
	end
	local bSel = self:_SelState(tCur.sKey, true)
	if bSel == nil then
		if not tCur.bSelUnknown then
			tCur.bSelUnknown = true
			mark("lister_sel_unknown")
		end
	elseif not bSel then
		return nil, "selection"
	end
	local ctx = context("hubAnimalsData", "animalStorageData", "actions")
	local bAllowed = element(ctx, "tradeAllowed")
	if type(bAllowed) ~= "boolean" then
		return nil, "allowed"
	end
	local tLimits = self:_Limits()
	if bAllowed and limitsMissing(tLimits) then
		return nil, "limits"
	end
	return { bAllowed = bAllowed, sReason = element(ctx, "tradeDisallowedReason"), tLimits = tLimits, sSrc = "lua", tQuick = self:_LuaQuick(ctx) }
end

-- The selection's quick actions as Lua reads them (the fallback; the page's
-- v2 report is the authority): the same fields as parseSeen's tQuick.
Lister._LuaQuick = function(self, ctx)
	ctx = ctx or context("hubAnimalsData", "animalStorageData", "actions")
	local ctxL = context("animalTradeListingData")
	local function b(v)
		return type(v) == "boolean" and v or nil
	end
	local function s(v)
		return (type(v) == "string" or type(v) == "number") and tostring(v) or ""
	end
	return {
		bTrade = b(element(ctx, "quickTradeAllowed")), sTradeReason = s(element(ctx, "quickTradeDisallowedReason")), sTradeValue = s(element(ctx, "quickTradeValue")),
		bRelease = b(element(ctx, "quickReleaseAllowed")), sReleaseReason = s(element(ctx, "quickReleaseDisallowedReason")), sReleaseValue = s(element(ctx, "quickReleaseValue")),
		bRehome = b(element(ctx, "rehomeAllowed")),
		nTradePrice = toNumber(element(ctxL, "quickTradePrice")), nReleasePrice = toNumber(element(ctxL, "quickReleasePrice")),
	}
end

-- The selection's data as one string, to see whether it changed under us.
-- The quick flags count too (booleans: stable); with bValues (a check run)
-- also the quick value texts, so the next animal's data is told from the
-- last one's sooner.
local function dataPrint(tData, bValues)
	local l = tData.tLimits
	local q = tData.tQuick or {}
	local t = { tostring(tData.bAllowed), tostring(l.nPriceMin), tostring(l.nPriceMax), tostring(l.nPriceDefault),
		tostring(l.nHoursMin), tostring(l.nHoursMax), tostring(l.nHoursDefault), tostring(q.bTrade), tostring(q.bRelease), tostring(q.bRehome) }
	if bValues then
		t[#t + 1] = tostring(q.sTradeValue)
		t[#t + 1] = tostring(q.sReleaseValue)
	end
	return table.concat(t, "|")
end

-- The same for whatever the game shows now, selection or not, and whose
-- reads it is (the fresh page report for this key, else Lua's own).
Lister._RawPrint = function(self, tRun, sKey)
	local bValues = tRun.sMode ~= "list" or self:_Q(tRun) ~= nil
	-- third value: no quick flags showed (the native's data was empty)
	local function empty(q)
		return q == nil or (q.bTrade == nil and q.bRelease == nil)
	end
	local r = self:_PageReport(tRun, sKey)
	if r ~= nil then
		return dataPrint(r, bValues), "page", empty(r.tQuick)
	end
	local ctx = context("hubAnimalsData", "animalStorageData", "actions")
	local bAllowed = element(ctx, "tradeAllowed")
	local tQuick = self:_LuaQuick(ctx)
	return dataPrint({ bAllowed = bAllowed, tLimits = self:_Limits(), tQuick = tQuick }, bValues), "lua", empty(tQuick)
end

-- The game's reason as its problem tokens only ("[AnimalList_Problem_X]..."),
-- else the text cut short: what the page needs (reasonText) in a small state.
local function compactReason(s)
	if type(s) ~= "string" or s == "" then
		return ""
	end
	local tOut = {}
	for sKey in string.gmatch(s, "AnimalList_Problem_([%w_]+)") do
		tOut[#tOut + 1] = "[AnimalList_Problem_" .. sKey .. "]"
	end
	if #tOut > 0 then
		return table.concat(tOut)
	end
	return string.sub(s, 1, 200)
end
Lister.CompactReason = compactReason

local function boolOrNull(v)
	if type(v) == "boolean" then
		return v
	end
	return NULL
end

-- What the game allows for the selected animal (docs/PLAN-desk-quick-release.md
-- 3.1): the page turns it into the animal's category (listercore.js categoryOf).
local function verdictOf(tData)
	local q = tData.tQuick or {}
	return {
		trade = tData.bAllowed == true, quickTrade = boolOrNull(q.bTrade), quickRelease = boolOrNull(q.bRelease), rehome = boolOrNull(q.bRehome),
		tradeWhy = tData.bAllowed == true and "" or compactReason(tData.sReason),
		quickTradeWhy = q.bTrade == false and compactReason(q.sTradeReason) or "",
		quickReleaseWhy = q.bRelease == false and compactReason(q.sReleaseReason) or "",
		quickTradeValue = string.sub(q.sTradeValue or "", 1, 80), quickReleaseValue = string.sub(q.sReleaseValue or "", 1, 80),
		quickTradePrice = q.nTradePrice or NULL, quickReleasePrice = q.nReleasePrice or NULL,
		src = tData.sSrc, v = tData.nV or 0,
	}
end
Lister.VerdictOf = verdictOf

-- Phase 0a's per-animal line: the quick fields next to the numeric prices,
-- the row's source text and the isReleaseable filter (the page's v2 report;
-- Lua's reads for comparison), and a mark per category.
Lister._LogQuick = function(self, tRun, tData)
	local q = tData.tQuick or {}
	local r = tData.tPage
	local tCur = tRun.tCur
	log("quick", runFields(tRun, {
		src = tData.sSrc, v = tData.nV, trade = tData.bAllowed,
		qt = q.bTrade, qtValue = q.sTradeValue, qtPrice = q.nTradePrice, qtWhy = q.bTrade == false and compactReason(q.sTradeReason) or nil,
		qr = q.bRelease, qrValue = q.sReleaseValue, qrPrice = q.nReleasePrice, qrWhy = q.bRelease == false and compactReason(q.sReleaseReason) or nil,
		rehome = q.bRehome, tradeWhy = tData.bAllowed == false and compactReason(tData.sReason) or nil,
		source = r and r.sSource or nil, releaseable = r and r.bReleaseable, luaSource = tCur and tCur.sSource or nil,
		luaReleaseable = tRun.vReleaseable,
	}))
	if q.bTrade ~= nil and not tRun.bQuickMarked then
		tRun.bQuickMarked = true
		mark(tData.sSrc == "page" and "lister_quick_seen_page" or "lister_quick_seen_lua")
	end
	local sCat = tData.bAllowed == true and "market" or q.bRehome == true and "rehome"
		or (q.bTrade == true or q.bRelease == true) and "quick" or (q.bTrade == nil and q.bRelease == nil) and "unknown" or "blocked"
	mark("lister_cat_" .. sCat)
	if q.bTrade == true and tData.bAllowed == false then
		mark("lister_quick_only_trade")
	end
end

local tUnselectableText = {
	selection = "The game did not select it in time.",
	allowed = "The game did not say whether it can be traded in time.",
	limits = "The game did not give its price limits in time.",
}

-- Skips unselectable, saying (and marking) which of the game's data never
-- came, and what the page last saw for it (none, the key, another, empty).
Lister._Unselectable = function(self, tRun, sWhy)
	mark("lister_unsel_" .. tostring(sWhy))
	local r = tRun.tSeen
	local tCur = tRun.tCur
	log("unselectable", runFields(tRun, { why = sWhy, key = tCur and tCur.sKey, pageReq = r and r.sReq, watchReq = tRun.sWatchReq,
		pageSel = r and (r.tSel and table.concat(r.tSel, ",") or "?") or "none", pageAge = r and r.nAt and secs(now() - r.nAt) or nil }))
	if r == nil or r.sReq ~= tRun.sWatchReq then
		mark("lister_page_none")
	elseif r.tSel == nil then
		mark("lister_page_sel_unread")
	elseif tCur ~= nil and onlySelected(r.tSel, tCur.sKey) then
		mark("lister_page_sel_key")
	elseif #r.tSel == 0 then
		mark("lister_page_sel_empty")
	else
		mark("lister_page_sel_other")
	end
	pcall(self._NetLog, self, tRun, tCur)
	if self:_Q(tRun) ~= nil and (sWhy == "page" or r == nil or r.sReq ~= tRun.sWatchReq) then
		-- no fresh page report: never sent without one; two in a row stop the run
		return self:_QuickNoPage(tRun)
	end
	return self:_Skip(tRun, "unselectable", tUnselectableText[sWhy])
end

Lister._QuickNoPage = function(self, tRun)
	tRun.nMiss = (tRun.nMiss or 0) + 1
	tRun.tCur.bMissed = true
	mark("lister_quick_nopage")
	log("quick_nopage", runFields(tRun, { n = tRun.nMiss, step = tRun.sStep }))
	return self:_Skip(tRun, "nopage")
end

-- Phase 0a (docs/PLAN-desk-quick-release.md 2): while the select waits for
-- its data, whether the game showed a server request (Lua's reads and the
-- page's v2 report of connectingAction).
Lister._NetWatch = function(self, tRun, tCur)
	if tCur == nil or tCur.bNetLogged then
		return
	end
	local tNet = self:_Net()
	if tCur.sNetFirst == nil then
		tCur.sNetFirst = netText(tNet)
	end
	if netBusy(tNet) then
		tCur.bNetBusy = true
		if tNet.db == true and tNet.dbType ~= nil then
			tCur.vNetType = tNet.dbType
		end
	end
	local r = tRun.tSeen
	if r ~= nil and r.sReq == tRun.sWatchReq and r.tNet ~= nil and r.tNet.bConn == true then
		tCur.bPageConn = true
	end
end

-- once per animal, when its select ends (data there, or timed out)
Lister._NetLog = function(self, tRun, tCur)
	if tCur == nil or tCur.bNetLogged or tCur.nSelectedAt == nil then
		return
	end
	tCur.bNetLogged = true
	local bBusy = tCur.bNetBusy == true or tCur.bPageConn == true
	mark(bBusy and "lister_select_net_busy" or "lister_select_net_quiet")
	log("select_net", runFields(tRun, { key = tCur.sKey, before = tCur.sNetBefore, after = tCur.sNetAfter, first = tCur.sNetFirst,
		busy = bBusy, luaBusy = tCur.bNetBusy == true, pageConn = tCur.bPageConn == true, dbType = tCur.vNetType,
		secs = secs(now() - tCur.nSelectedAt) }))
end

-- One animal's step on this frame. Errors are caught by Tick.
Lister._Step = function(self, tRun, t)
	local tCur = tRun.tCur
	if tRun.sStep == "pause" then
		-- within an animal (a refused listing, before its quick action)
		if t - (tRun.nPauseStart or 0) >= (tRun.nPaceMs or self.nPaceMs) / 1000 then
			self:_SetStep(tRun, "server")
		end
		return
	end
	if tRun.sStep == "server" then
		if self:_BusyNow(tRun, t) then
			return
		end
		if tRun.bNeedQuiet then
			tRun.nIdleSince = tRun.nIdleSince or t
			if t - tRun.nIdleSince < self.nQuiet then
				tRun.sMessage = "Letting the server settle after a timeout."
				return
			end
			tRun.bNeedQuiet = false
			mark("lister_quiet")
			log("quiet", runFields(tRun, { secs = self.nQuiet }))
		end
		self:_SetStep(tRun, "resolve")
	end
	if tRun.sStep == "resolve" then
		local tList = self:_List()
		if tList == nil and not tCur.bListMarked then
			tCur.bListMarked = true
			mark("lister_list_unreadable")
		end
		local sKey, sNotWhy = self:_Find(tCur, tList)
		local nRows = nil
		if tList ~= nil then
			nRows = 0
			for _ in pairs(tList) do
				nRows = nRows + 1
			end
		end
		if sKey == nil then
			log("resolve_none", runFields(tRun, { hint = tCur.sHint, rows = nRows or "unreadable", why = sNotWhy }))
			if sNotWhy == "ambiguous" then
				return self:_Skip(tRun, "ambiguous")
			end
			return self:_Skip(tRun, "gone", tList == nil and "Not found (the storage list could not be read)." or nil)
		end
		local tRow = rowOf(sKey, tList)
		log("resolve", runFields(tRun, { key = sKey, via = sKey == tCur.sHint and "hint" or "list", hint = tCur.sHint, rows = nRows,
			row = tRow ~= nil, timer = tRow and tRow.auctionTimerSeconds, moving = tRow and tRow.isMoving,
			maturity = tRow and tRow.maturity, pregnant = tRow and tRow.isPregnant, species = tRow and tRow.species, gender = tRow and tRow.gender,
			-- Phase 0a: does the row's source text tell the quick-only animals apart?
			source = tRow and tRow.source }))
		tCur.sSource = tRow and type(tRow.source) == "string" and tRow.source or nil
		if tRun.sMode == "unlist" then
			-- only a listing still on the market is taken off
			if tRow == nil or not isListed(tRow) then
				return self:_Skip(tRun, "notlisted")
			end
			tCur.nListedPrice = toNumber(tRow.auctionPrice)
		elseif tRow ~= nil then
			if isListed(tRow) then
				return self:_Skip(tRun, "listed")
			end
			if tRow.isMoving == true then
				return self:_Skip(tRun, "moving")
			end
		end
		-- the market's own rules (shoal, pregnant, elderly, juvenile) are for
		-- listing; a quick action goes by the game's own flag for it
		if tRow ~= nil and self:_Q(tRun) == nil and tRun.sMode ~= "unlist" then
			if tRow.isShoal == true then
				return self:_Skip(tRun, "shoal")
			end
			-- never listed: the game's own sell flow blocks pregnant animals
			-- (RelocateAnimalsPopup g_tSellPreventers bPregnant); storage rows
			-- carry isPregnant (AnimalMarketAndStorageSchema.js)
			if tRow.isPregnant == true then
				return self:_Skip(tRun, "pregnant")
			end
			-- EAnimalMaturity: 0 infant, 3 elderly, 6 elderly and infertile; the
			-- market refuses every elderly animal, and the refusal can take the
			-- game down (pz2-modding animals-and-breeding.md, Trading near elderly)
			local nMaturity = toNumber(tRow.maturity)
			if nMaturity == 3 or nMaturity == 6 then
				return self:_Skip(tRun, "elderly")
			end
			if nMaturity == 0 then
				return self:_Skip(tRun, "juvenile")
			end
		end
		tCur.sKey = sKey
		-- clear first and see it clear, so the previous animal's data
		-- can't pass for this one's (local calls, no server request)
		api.planetHub.StorageUIClearSelectedItems()
		tCur.nClearedAt = t
		self:_SetStep(tRun, "clear", "Selecting it.")
		-- the page reports what it sees from here on
		self:_Watch(tRun, sKey)
		return
	end
	if tRun.sStep == "clear" then
		local bStill
		local r = self:_PageReport(tRun, tCur.sKey)
		if r ~= nil then
			bStill = #r.tSel > 0
		elseif tRun.bPageSeen then
			-- the page reports in this run: wait for its view of the clear
			bStill = true
		else
			local tSel = self:_Selection()
			-- the array, or (where it reads empty) this row's own flag
			bStill = (tSel ~= nil and #tSel > 0) or self:_SelState(tCur.sKey) == true
		end
		if bStill and t - tCur.nClearedAt < self.nClearWait then
			return
		end
		-- the list may have been rebuilt meanwhile
		if not self:_Holds(tCur.sGuid, tCur.sKey, nil) then
			local sKey, sNotWhy = self:_Find(tCur, self:_List())
			if sKey == nil then
				return self:_Skip(tRun, sNotWhy == "ambiguous" and "ambiguous" or "gone")
			end
			tCur.sKey = sKey
		end
		-- what the game shows before this animal's data arrives (it may
		-- not reset on Clear): equal data after selecting may still be stale
		tCur.sClearedPrint, tCur.sClearedSrc, tCur.bClearedEmpty = self:_RawPrint(tRun, tCur.sKey)
		-- whose data that is: the animal selected last
		tCur.sPrevGuid = tRun.sLastSelGuid
		-- or, at a run's first animal, the engine's last select of the run
		-- just before (My listings: the take-off, then the quick trade of the
		-- same animal, whose data then shows unchanged), if it was moments ago
		if tCur.sPrevGuid == nil and self.tLastSel ~= nil and t - self.tLastSel.nAt <= self.nLastSelFresh then
			tCur.sPrevGuid = self.tLastSel.sGuid
		end
		-- Phase 0a: the network signals just before and after the select (does a select send a request?)
		tCur.sNetBefore = netText(self:_Net())
		log("select", runFields(tRun, { key = tCur.sKey, id = nativeId(tCur.sKey), stillSelected = bStill == true,
			clearSecs = secs(t - tCur.nClearedAt), before = tCur.sClearedPrint, beforeSrc = tCur.sClearedSrc, net = tCur.sNetBefore }))
		-- exactly this animal, the way a click on its row selects it
		-- by the row's id, as a click on the row does (see nativeId)
		api.planetHub.StorageUISelectItem(nativeId(tCur.sKey))
		tCur.nSelectedAt = t
		local tNetAfter = self:_Net()
		tCur.sNetAfter = netText(tNetAfter)
		tCur.bNetBusy = netBusy(tNetAfter)
		self:_SetStep(tRun, "select", "Selecting it.")
		-- a new watch: only what the page reads after the select counts
		self:_Watch(tRun, tCur.sKey)
		return
	end
	if tRun.sStep == "select" then
		self:_NetWatch(tRun, tCur)
		local tData, sWhy = self:_SelectionData(tCur, tRun)
		if tData == nil and tCur.sWaitWhy ~= sWhy then
			-- what it is still waiting for, each time that changes
			tCur.sWaitWhy = sWhy
			log("wait_data", runFields(tRun, { why = sWhy, secs = secs(t - tCur.nSelectedAt) }))
		end
		if tData == nil then
			if t - tCur.nSelectedAt > self.nSelectTimeout then
				return self:_Unselectable(tRun, sWhy)
			end
			return
		end
		-- the data may follow the selection a frame later: settle first
		self:_NetLog(tRun, tCur)
		self:_SetStep(tRun, "selected", "Reading the game's limits.")
		return
	end
	if tRun.sStep == "selected" then
		if t - tRun.nStepStart < self.nSettle then
			return
		end
		local tData, sWhy = self:_SelectionData(tCur, tRun)
		if tData == nil then
			if t - tCur.nSelectedAt > self.nSelectTimeout then
				return self:_Unselectable(tRun, sWhy)
			end
			return self:_SetStep(tRun, "select", "Selecting it.")
		end
		if tRun.sMode == "unlist" then
			-- the selection is this animal (a fresh page report), settled: its
			-- row must still be on the market
			tRun.sLastSelGuid = tCur.sGuid
			self.tLastSel = { sGuid = tCur.sGuid, nAt = t }
			local tRow = rowOf(tCur.sKey, nil) or rowOf(tCur.sKey, self:_List())
			if tRow == nil or not isListed(tRow) then
				return self:_Skip(tRun, "notlisted")
			end
			return self:_SetStep(tRun, "send", "Taking it off the market.")
		end
		-- (read from another source than the note: can't tell, so as if unchanged)
		local bCheck = tRun.sMode == "check"
		local tQ = self:_Q(tRun)
		local bValues = tRun.sMode ~= "list" or tQ ~= nil
		local bSame = tData.sSrc ~= tCur.sClearedSrc or dataPrint(tData, bValues) == tCur.sClearedPrint
		-- a quick run never takes data equal to what showed before the select:
		-- what showed after the clear must have been empty, or this differ
		-- (else it waits until the select times out, which stops the run)
		-- (the data before the select may be this same animal's: the quick
		-- action right after its listing was refused)
		if tQ ~= nil and bSame and not tCur.bClearedEmpty and tCur.sPrevGuid ~= tCur.sGuid then
			if not tCur.bSameMarked then
				tCur.bSameMarked = true
				mark("lister_data_same")
				log("data_same", runFields(tRun, { data = dataPrint(tData, bValues), src = tData.sSrc, beforeSrc = tCur.sClearedSrc, quick = true }))
			end
			if t - tCur.nSelectedAt > self.nSelectTimeout then
				return self:_Skip(tRun, "unselectable", "The game's data did not change from the animal before; not sent.")
			end
			return
		end
		if tQ ~= nil and not tCur.bFlagsLogged then
			tCur.bFlagsLogged = true
			log("quick_flags", runFields(tRun, { ms = toInteger((t - tCur.nSelectedAt) * 1000), clearedEmpty = tCur.bClearedEmpty == true, same = bSame }))
		end
		if bSame and t - tCur.nSelectedAt < self.nSameSettle then
			-- unchanged since before selecting: maybe this animal's data is
			-- the same, maybe it has not arrived; wait a little longer
			if not tCur.bSameMarked then
				tCur.bSameMarked = true
				mark("lister_data_same")
				log("data_same", runFields(tRun, { data = dataPrint(tData, bValues), src = tData.sSrc, beforeSrc = tCur.sClearedSrc }))
			end
			return
		end
		-- what the game allows for it (market, quick trade, quick release,
		-- rehome), for the desk's categories; logged for Phase 0a
		local tResult = tRun.tResults[tRun.nIndex]
		tResult.verdict, tResult.bVerdictSent = verdictOf(tData), nil
		tRun.sLastSelGuid = tCur.sGuid
		self.tLastSel = { sGuid = tCur.sGuid, nAt = t }
		pcall(self._LogQuick, self, tRun, tData)
		if bCheck then
			-- a check run never sends: recorded, then the next one
			return self:_Result(tRun, "checked", nil, "")
		end
		if tQ ~= nil then
			-- 4.3 steps 4-5: a fresh page report (only those reach here) and
			-- the action's own flag allowed now, else skip with the reason
			local q = tData.tQuick
			local _, sQm = self:_Q(tRun)
			if q.bRehome == true then
				mark("lister_quick_notallowed")
				return self:_Skip(tRun, "rehome")
			end
			-- a release never takes an animal bought for cash (the game's own rule)
			if sQm == "release" and type(q.sReleaseReason) == "string" and string.find(q.sReleaseReason, "CashSeeded", 1, true) then
				mark("lister_quick_notallowed")
				return self:_Skip(tRun, "notallowed", "[AnimalList_Problem_CashSeeded]")
			end
			if q[tQ.sFlag] ~= true then
				mark("lister_quick_notallowed")
				local sGameWhy = q[tQ.sWhy]
				return self:_Skip(tRun, "notallowed", (type(sGameWhy) == "string" and sGameWhy ~= "") and compactReason(sGameWhy) or nil)
			end
			local tRes = tRun.tResults[tRun.nIndex]
			if sQm == "quicktrade" then
				tRes.price = q.nTradePrice
			else
				tRes.price = q.nReleasePrice
			end
			tCur.sDataPrint = dataPrint(tData, true)
			tCur.sDataSrc = "page"
			return self:_SetStep(tRun, "send", tQ.sSending)
		end
		if not tData.bAllowed then
			local sReason = tData.sReason
			-- the game's problem tokens, one mark each (the full text is cut in the log)
			local tKeys = {}
			if type(sReason) == "string" then
				for sKey in string.gmatch(sReason, "AnimalList_Problem_([%w_]+)") do
					tKeys[#tKeys + 1] = sKey
					mark("lister_untradeable_" .. sKey)
				end
			end
			log("untradeable", runFields(tRun, { src = tData.sSrc, problems = table.concat(tKeys, ","), reason = sReason }))
			-- the "If refused" quick action only for a reason that never
			-- passes; any other may (an infection, a transport), and a quick
			-- action is permanent
			local tFb = tRun.sOnRefused ~= nil and self.tQuickModes[tRun.sOnRefused] or nil
			if tFb ~= nil and self:_LastingProblem(tKeys) and type(tData.tQuick) == "table" and tData.tQuick[tFb.sFlag] == true then
				return self:_Refused(tRun, "Not listed: " .. compactReason(sReason))
			end
			return self:_Skip(tRun, "untradeable", (type(sReason) == "string" and sReason ~= "") and sReason or nil)
		end
		local tRes = tRun.tResults[tRun.nIndex]
		local nPrice, sCapped, bDefault = priceFor(tCur.nPrice, tData.tLimits, tRun.nOffset)
		local tL = tData.tLimits
		log("price", runFields(tRun, { src = tData.sSrc, jobPrice = tCur.nPrice or "-", price = nPrice or "none", capped = sCapped,
			usedDefault = bDefault, pmin = tL.nPriceMin, pmax = tL.nPriceMax, pdef = tL.nPriceDefault, hmin = tL.nHoursMin,
			hmax = tL.nHoursMax, hdef = tL.nHoursDefault, jobHours = tCur.vHours, hours = hoursFor(tCur.vHours, tL),
			selSecs = secs(t - tCur.nSelectedAt) }))
		tRes.usedDefault = bDefault
		if nPrice == nil then
			return self:_Skip(tRun, "noprice")
		end
		tCur.nSendPrice = nPrice
		tCur.sDataPrint = dataPrint(tData)
		tCur.sDataSrc = tData.sSrc
		tCur.nSendHours = hoursFor(tCur.vHours, tData.tLimits)
		tRes.price, tRes.hours, tRes.capped = nPrice, tCur.nSendHours, sCapped
		self:_SetStep(tRun, "send", "Listing at " .. nPrice .. " CC for " .. tCur.nSendHours .. " h.")
	end
	if tRun.sStep == "send" then
		if self:_Q(tRun) ~= nil then
			return self:_QuickSend(tRun, tCur, t)
		end
		if tRun.sMode == "unlist" then
			return self:_UnlistSend(tRun, tCur, t)
		end
		if tRun.sMode ~= "list" then
			-- only a listing run sends (a check never gets here; belt and braces)
			mark("lister_check_send_blocked")
			return self:_Result(tRun, "skipped", "error", "Mod error: a check run reached the send step; nothing was sent.")
		end
		if self:_BusyNow(tRun, t) then
			return
		end
		-- in the same tick as the call: the key must still be this animal,
		-- and the only selection
		-- (a fingerprint token: still exactly one such row, and this one)
		local bHolds, sNotWhy = self:_Holds(tCur.sGuid, tCur.sKey, nil)
		if not bHolds then
			log("changed", runFields(tRun, { why = "key", detail = sNotWhy, key = tCur.sKey, keyGuid = guidOf(tCur.sKey) or "none" }))
			return self:_Skip(tRun, sNotWhy == "ambiguous" and "ambiguous" or "changed")
		end
		-- (by the freshest page report when there is one, else Lua's reads)
		local bSelNow, sSelSrc = self:_IsSelected(tRun, tCur.sKey)
		if bSelNow == false then
			log("changed", runFields(tRun, { why = "selection", key = tCur.sKey, src = sSelSrc }))
			return self:_Skip(tRun, "changed")
		end
		-- the game's data must still be what the price came from (it may
		-- arrive in parts), read the same way: otherwise settle and work it
		-- out again
		local tNow = self:_SelectionData(tCur, tRun)
		if tNow == nil or tNow.sSrc ~= tCur.sDataSrc or dataPrint(tNow) ~= tCur.sDataPrint then
			tCur.nResettled = (tCur.nResettled or 0) + 1
			mark("lister_data_changed")
			log("data_changed", runFields(tRun, { n = tCur.nResettled, was = tCur.sDataPrint, wasSrc = tCur.sDataSrc,
				now = tNow and dataPrint(tNow) or "none", nowSrc = tNow and tNow.sSrc or nil }))
			if tCur.nResettled > self.nResettles then
				return self:_Skip(tRun, "unselectable", "The game's data for it kept changing.")
			end
			return self:_SetStep(tRun, "selected", "Reading the game's limits again.")
		end
		-- counts as sent even if the call raises: the pause still follows
		tCur.bSent = true
		tCur.nSentAt = t
		tCur.nLastPoll = t
		mark("lister_send")
		log("send", runFields(tRun, { key = tCur.sKey, price = tCur.nSendPrice, hours = tCur.nSendHours, src = tCur.sDataSrc, data = tCur.sDataPrint }))
		api.planetHub.StorageUIStartAnimalAuction(tCur.sKey, tCur.nSendPrice, tCur.nSendHours)
		self:_SetStep(tRun, "confirm", "Waiting for the server to confirm.")
		return
	end
	if tRun.sStep == "gone" then
		return self:_QuickGone(tRun, tCur, t)
	end
	if tRun.sStep == "unconfirm" then
		return self:_UnlistConfirm(tRun, tCur, t)
	end
	if tRun.sStep == "confirm" then
		if t - tCur.nLastPoll < self.nConfirmPoll then
			return
		end
		tCur.nLastPoll = t
		if not self:_Loading() and self:_IsListed(tCur) then
			return self:_Result(tRun, "listed", nil, "")
		end
		local tErr = tCur.tError
		if tErr ~= nil then
			local sErr = tErr.sName or ("code " .. tostring(tErr.nError))
			if tErr.sName == "DidNotGetResponse" then
				-- the game's request timed out: the listing may still arrive
				if t - tErr.nTime > self.nLateConfirm then
					return self:_Result(tRun, "timeout", "timeout", "The server timed out (" .. sErr .. "); it may still appear on the market.")
				end
			elseif tErr.sName == nil or tErr.sName == "Unknown" then
				-- unspecific: it may have gone through after all
				if t - tErr.nTime > self.nRejectGrace then
					return self:_Refused(tRun, "Refused by the server (" .. sErr .. ").")
				end
			else
				return self:_Refused(tRun, "Refused by the server (" .. sErr .. ").")
			end
		elseif t - tCur.nSentAt > self.nConfirmTimeout then
			return self:_Result(tRun, "timeout", "timeout", "No confirmation after " .. self.nConfirmTimeout .. " s; it may still appear on the market.")
		end
	end
end

-- 4.3 step 6-7, in one tick: idle, a page report fresher than this step,
-- the selection (the page's answer only), the key (_Holds), the data
-- unchanged; then exactly what the game's handler passes on: { [1] = key }.
Lister._QuickSend = function(self, tRun, tCur, t)
	local tQ = self:_Q(tRun)
	if self:_BusyNow(tRun, t, "The game stayed busy with another server request; not sent.") then
		return
	end
	-- a report that arrived after this step began: after a reload or a
	-- stale page nothing is sent, even mid-step
	local r = self:_PageReport(tRun, tCur.sKey)
	if r == nil or not (r.nAt > tRun.nStepStart) then
		if t - tRun.nStepStart > self.nSelectTimeout then
			return self:_QuickNoPage(tRun)
		end
		return
	end
	local bSel = self:_IsSelected(tRun, tCur.sKey)
	if bSel ~= true then
		log("changed", runFields(tRun, { why = "selection", key = tCur.sKey, src = "page" }))
		mark("lister_quick_changed")
		return self:_Skip(tRun, "changed", "The selection changed just before sending; not sent.")
	end
	local tList = self:_List()
	local bHolds, sNotWhy = self:_Holds(tCur.sGuid, tCur.sKey, tList)
	if not bHolds then
		log("changed", runFields(tRun, { why = "key", detail = sNotWhy, key = tCur.sKey }))
		mark("lister_quick_changed")
		return self:_Skip(tRun, sNotWhy == "ambiguous" and "ambiguous" or "changed", "The storage list changed just before sending; not sent.")
	end
	local tNow = self:_SelectionData(tCur, tRun)
	if tNow == nil or dataPrint(tNow, true) ~= tCur.sDataPrint then
		tCur.nResettled = (tCur.nResettled or 0) + 1
		mark("lister_data_changed")
		log("data_changed", runFields(tRun, { n = tCur.nResettled, was = tCur.sDataPrint, now = tNow and dataPrint(tNow, true) or "none" }))
		if tCur.nResettled > self.nResettles then
			return self:_Skip(tRun, "unselectable", "The game's data for it kept changing; not sent.")
		end
		return self:_SetStep(tRun, "selected", "Reading the game's data again.")
	end
	local fn = hubFn(tQ.sNative)
	if fn == nil then
		return self:_StopRun(tRun, "skipped", "error", "This game version has no api.planetHub." .. tQ.sNative .. ".", "Stopped: the game's call is missing.")
	end
	-- what identifies the row after the call: its look and the list's size
	local tRow = tList and rowOf(tCur.sKey, tList) or nil
	tCur.sFp = tRow and fpOf(tRow) or nil
	if tCur.sFp ~= nil then
		local _, n = fpMatches(tList, tCur.sFp)
		tCur.nFpAtSend = n
	end
	local nRows = 0
	for _, x in pairs(tList or {}) do
		if type(x) == "table" then
			nRows = nRows + 1
		end
	end
	tCur.nRowsAtSend = nRows
	-- counts as sent even if the call raises (then the list still decides)
	tCur.bSent = true
	tCur.nSentAt = t
	tCur.nLastPoll = t
	tCur.nDeadline = t + self.nQuickTimeout
	mark("lister_quick_send")
	log("send_quick", runFields(tRun, { key = tCur.sKey, mode = tRun.sMode, native = tQ.sNative, price = tRun.tResults[tRun.nIndex].price,
		rows = nRows, fp = tCur.nFpAtSend, data = tCur.sDataPrint }))
	fn({ tCur.sKey })
	return self:_SetStep(tRun, "gone", "Waiting for it to leave storage.")
end

-- 4.3 step 8: the storage list decides. Gone: done. Still there at the
-- deadline (10 s, shortened by a database error): not confirmed, and the
-- run stops. Ambiguous: the run stops.
Lister._QuickGone = function(self, tRun, tCur, t)
	local tQ = self:_Q(tRun)
	if t - tCur.nSentAt < self.nQuickFirstLook and t < tCur.nDeadline then
		return
	end
	if t - tCur.nLastPoll < self.nConfirmPoll and t < tCur.nDeadline then
		return
	end
	tCur.nLastPoll = t
	local sState = self:_QuickState(tCur)
	local nMs = toInteger((t - tCur.nSentAt) * 1000)
	-- While the game rebuilds the list (in game, Y: 2026-10-18, "ambiguous"
	-- 250 ms after a quick trade that worked) every reading but "there" can
	-- be transient: decide gone only when it reads gone twice in a row, and
	-- stop only if it is still not gone at the deadline.
	if sState == "gone" then
		tCur.nGoneSeen = (tCur.nGoneSeen or 0) + 1
		if tCur.nGoneSeen >= 2 then
			mark("lister_quick_gone")
			log("quick_gone", runFields(tRun, { ms = nMs, key = tCur.sKey, mode = tRun.sMode, transient = tCur.sTransient,
				err = tCur.tError ~= nil and (tCur.tError.sName or tCur.tError.nError) or nil }))
			return self:_Result(tRun, tQ.sDone, nil, "")
		end
		return
	end
	tCur.nGoneSeen = 0
	if sState ~= "there" and tCur.sTransient == nil then
		-- logged once: what the list showed while it was changing
		tCur.sTransient = sState
		mark("lister_quick_transient")
		log("quick_transient", runFields(tRun, { ms = nMs, key = tCur.sKey, state = sState }))
	end
	if t >= tCur.nDeadline then
		if sState == "ambiguous" then
			mark("lister_quick_ambiguous")
			log("quick_ambiguous", runFields(tRun, { ms = nMs, key = tCur.sKey }))
			return self:_StopRun(tRun, "unconfirmed", "ambiguous", "Not confirmed: another animal in storage looks the same; check storage.",
				"Stopped: an animal could not be told apart " .. secs(t - tCur.nSentAt) .. " s after sending; check storage.")
		end
		mark("lister_quick_timeout")
		log("quick_timeout", runFields(tRun, { ms = nMs, key = tCur.sKey, state = sState }))
		return self:_StopRun(tRun, "unconfirmed", "unconfirmed", "Not confirmed: check storage.",
			(sState == "there" or sState == "leaving") and ("Stopped: an animal was still in storage " .. secs(t - tCur.nSentAt) .. " s after sending; check storage.")
				or ("Stopped: the storage list did not settle " .. secs(t - tCur.nSentAt) .. " s after sending; check storage."))
	end
end

-- Taking a listing off the market, in one tick: idle, a page report fresher
-- than this step showing exactly this animal selected, the key (_Holds), the
-- row still listed; then the game's own Cancel (it acts on the selection).
Lister._UnlistSend = function(self, tRun, tCur, t)
	local bBusy, sWhy = self:_Busy()
	if bBusy and sWhy == "requests" and (tRun.bRequestsIgnored or t - tRun.nStepStart > self.nRequestsGrace) then
		if not tRun.bRequestsIgnored then
			tRun.bRequestsIgnored = true
			mark("lister_busy_requests_ignored")
		end
		bBusy = false
	end
	if bBusy then
		self:_MarkBusy(tRun, sWhy)
		if t - tRun.nStepStart > self.nServerTimeout then
			return self:_Skip(tRun, "busy", "The game stayed busy with another server request; not taken off.")
		end
		tRun.sMessage = "Waiting for the game's other server requests."
		return
	end
	local r = self:_PageReport(tRun, tCur.sKey)
	if r == nil or not (r.nAt > tRun.nStepStart) then
		if t - tRun.nStepStart > self.nSelectTimeout then
			return self:_Skip(tRun, "nopage", "No fresh report from the page for it; it was not taken off.")
		end
		return
	end
	if not onlySelected(r.tSel, tCur.sKey) then
		log("changed", runFields(tRun, { why = "selection", key = tCur.sKey, src = "page" }))
		return self:_Skip(tRun, "changed", "The selection changed just before sending; not taken off.")
	end
	local tList = self:_List()
	local bHolds, sNotWhy = self:_Holds(tCur.sGuid, tCur.sKey, tList)
	if not bHolds then
		log("changed", runFields(tRun, { why = "key", detail = sNotWhy, key = tCur.sKey }))
		return self:_Skip(tRun, sNotWhy == "ambiguous" and "ambiguous" or "changed", "The storage list changed just before sending; not taken off.")
	end
	local tRow = tList and rowOf(tCur.sKey, tList) or rowOf(tCur.sKey, nil)
	if tRow == nil or not isListed(tRow) then
		return self:_Skip(tRun, "notlisted")
	end
	local fn = hubFn(self.sCancelNative)
	if fn == nil then
		return self:_Skip(tRun, "error", "This game version has no api.planetHub." .. self.sCancelNative .. ".")
	end
	local tRes = tRun.tResults[tRun.nIndex]
	tRes.price = toNumber(tRow.auctionPrice) or tCur.nListedPrice
	-- counts as sent even if the call raises (then the row still decides)
	tCur.bSent = true
	tCur.nSentAt = t
	tCur.nLastPoll = t
	tCur.nDeadline = t + self.nUnlistTimeout
	mark("lister_unlist_send")
	log("send_unlist", runFields(tRun, { key = tCur.sKey, price = tRes.price, timer = tRow.auctionTimerSeconds }))
	fn()
	return self:_SetStep(tRun, "unconfirm", "Waiting for it to come off the market.")
end

-- Off the market when its row (found again by its id) shows no timer, read
-- twice in a row. Gone from storage: it sold meanwhile. Still listed at the
-- deadline: timeout (it may still come off).
Lister._UnlistConfirm = function(self, tRun, tCur, t)
	if t - tCur.nSentAt < self.nUnlistFirstLook and t < tCur.nDeadline then
		return
	end
	if t - tCur.nLastPoll < self.nConfirmPoll and t < tCur.nDeadline then
		return
	end
	tCur.nLastPoll = t
	local ctx = context("hubAnimalsData", "network")
	local bLoading = ctx ~= nil and element(ctx, "loadingItems") == true
	local tList = (not bLoading) and self:_List() or nil
	if tList ~= nil then
		local sKey, sWhy = self:_Find(tCur, tList)
		if sKey ~= nil then
			tCur.sKey = sKey
			tCur.nGoneSeen = 0
			if not isListed(rowOf(sKey, tList)) then
				tCur.nOffSeen = (tCur.nOffSeen or 0) + 1
				if tCur.nOffSeen >= 2 then
					log("unlisted", runFields(tRun, { ms = toInteger((t - tCur.nSentAt) * 1000), key = sKey,
						err = tCur.tError ~= nil and (tCur.tError.sName or tCur.tError.nError) or nil }))
					return self:_Result(tRun, "unlisted", nil, "")
				end
				return
			end
		elseif sWhy ~= "ambiguous" then
			tCur.nOffSeen = 0
			tCur.nGoneSeen = (tCur.nGoneSeen or 0) + 1
			if tCur.nGoneSeen >= 2 then
				mark("lister_unlist_gone")
				return self:_Result(tRun, "skipped", "gone", "It left storage just then (sold?); not on the market any more.")
			end
			return
		end
	end
	tCur.nOffSeen = 0
	if t >= tCur.nDeadline then
		mark("lister_unlist_timeout")
		local tE = tCur.tError
		local sErr = tE ~= nil and (" The server answered " .. tostring(tE.sName or ("code " .. tostring(tE.nError))) .. ".") or ""
		return self:_Result(tRun, "timeout", "timeout", "Still on the market " .. secs(t - tCur.nSentAt) .. " s after asking." .. sErr)
	end
end

-- Every frame while Animal Storage is open (its Advance).
Lister.Tick = function(self)
	local tRun = self.tRun
	if tRun == nil then
		return
	end
	local t = now()
	if tRun.tCur == nil then
		-- between animals: after the pause (the pace may change during it;
		-- a check run keeps its own)
		if tRun.sStep ~= "pause" or t - (tRun.nPauseStart or 0) >= (tRun.nPaceMs or self.nPaceMs) / 1000 then
			self:_Next(tRun)
		end
	end
	if self.tRun == tRun and tRun.tCur ~= nil then
		local bOk, sErr = pcall(self._Step, self, tRun, t)
		if not bOk and self.tRun == tRun and tRun.tCur ~= nil then
			-- a bug or a game change in this animal's step: skip it, carry on
			-- (a quick run stops: permanent actions never go on after the unexpected)
			mark("lister_error")
			trace("step " .. tostring(tRun.sStep) .. " failed: " .. tostring(sErr))
			log("error", runFields(tRun, { step = tRun.sStep, err = tostring(sErr) }))
			if self:_Q(tRun) ~= nil then
				self:_StopRun(tRun, tRun.tCur.bSent and "unconfirmed" or "skipped", "error", "Mod error: " .. tostring(sErr), "Stopped: a mod error; check storage.")
			else
				self:_Result(tRun, "skipped", "error", "Mod error: " .. tostring(sErr))
			end
		end
	end
	-- a page that reloaded, or missed the watch: ask again
	if self.tRun == tRun and tRun.sWatchReq ~= nil and t - (tRun.nWatchSent or 0) > self.nWatchResend then
		local r = tRun.tSeen
		if r == nil or r.sReq ~= tRun.sWatchReq or t - r.nAt > self.nWatchResend then
			tRun.nWatchSent = t
			self:_Send(tRun.oUI, "PZ2QoL_ListerWatch", tRun.sWatchReq, tRun.sWatchKey)
		end
	end
	if self.tRun == tRun and (tRun.bDirty or t - (tRun.nLastEmit or 0) >= self.nStateInterval) then
		self:_Emit(tRun)
	end
end

-- MsgType_DatabaseErrorMessage, through PZ2QoL.Errors: only a listing's
-- (request type 42) answer to the animal being confirmed counts.
Lister.OnServerError = function(self, nError, sName, nRequestType)
	local tRun = self.tRun
	local tCur = tRun and tRun.tCur
	-- a quick animal waiting to leave storage: an error only shortens the wait
	-- (the storage list still decides; Phase 0b saw no request type to match)
	if tRun ~= nil and tCur ~= nil and tCur.bSent and tRun.sStep == "unconfirm" then
		-- taking a listing off: its request type is unknown; an error only
		-- shortens the wait, the row decides
		tCur.tError = tCur.tError or { nError = nError, sName = sName, nTime = now() }
		tCur.nDeadline = math.min(tCur.nDeadline or now(), now() + self.nUnlistErrWait)
		mark("lister_unlist_server_error")
		log("unlist_server_error", runFields(tRun, { code = nError, name = sName or "?", req = nRequestType, afterSend = secs(now() - tCur.nSentAt) }))
	end
	if tRun ~= nil and tCur ~= nil and tCur.bSent and tRun.sStep == "gone" then
		tCur.tError = tCur.tError or { nError = nError, sName = sName, nTime = now() }
		tCur.nDeadline = math.min(tCur.nDeadline or now(), now() + self.nQuickErrWait)
		mark("lister_quick_server_error")
		log("quick_server_error", runFields(tRun, { code = nError, name = sName or "?", req = nRequestType, afterSend = secs(now() - tCur.nSentAt) }))
	end
	-- every request type that fails during a run (log only)
	if tRun ~= nil then
		local n = toNumber(nRequestType)
		mark((n ~= nil and n == math.floor(n) and n >= 0 and n <= 63) and ("lister_server_error_type_" .. string.format("%d", toInteger(n))) or "lister_server_error_type_other")
	end
	-- why an error does not count for the animal being confirmed (logged)
	local sIgnored = nil
	if tRun == nil then
		sIgnored = "norun"
	elseif tCur == nil then
		sIgnored = "between"
	elseif not tCur.bSent then
		sIgnored = "notsent"
	elseif tRun.sMode == "unlist" then
		sIgnored = "unlist"
	elseif tCur.tError ~= nil then
		sIgnored = "second"
	elseif toNumber(nRequestType) ~= self.nListingRequest then
		sIgnored = "otherrequest"
	elseif sName == "Ok" then
		sIgnored = "ok"
	end
	if tRun ~= nil then
		log("server_error", runFields(tRun, { code = nError, name = sName or "?", req = nRequestType, ignored = sIgnored or false,
			step = tRun.sStep, afterSend = tCur ~= nil and tCur.nSentAt ~= nil and secs(now() - tCur.nSentAt) or nil }))
	end
	if sIgnored ~= nil then
		return
	end
	tCur.tError = { nError = nError, sName = sName, nTime = now() }
	if sName == "DidNotGetResponse" then
		tRun.sMessage = "The server timed out; checking whether it was listed."
	else
		tRun.sMessage = "Server error (" .. tostring(sName or ("code " .. tostring(nError))) .. "); checking whether it went through."
	end
	tRun.bDirty = true
end

-----------------------------------------------------------------------
-- Page -> Lua
-----------------------------------------------------------------------
Lister.Hello = function(self, oUI, sReq)
	mark("lister_hello")
	local tMissing = self:_Missing()
	local bStorage = self.oStorageMode ~= nil
	local nRows = NULL
	if bStorage then
		local tList = self:_List()
		if tList == nil then
			tMissing[#tMissing + 1] = "storageList"
			mark("lister_list_unreadable")
		else
			nRows = 0
			for _, tRow in pairs(tList) do
				if type(tRow) == "table" then
					nRows = nRows + 1
				end
			end
			self:_NoteListings(tList)
		end
	end
	local bOnline = self:_Online()
	log("hello", { req = sReq, storage = bStorage, rows = nRows, online = bOnline, missing = tMissing, running = self.tRun ~= nil and self.tRun.nId or false })
	self:_Send(oUI, "PZ2QoL_ListerCaps", tostring(sReq or ""), toJson({
		ok = #tMissing == 0, missing = tMissing, storage = bStorage,
		online = bOnline == nil and NULL or bOnline, rows = nRows,
		running = self.tRun ~= nil, version = self.nVersion,
		-- job modes this engine runs (an older one refuses "check" as an unknown format)
		check = true,
		-- taking listings off the market (the desk's My listings)
		unlist = hubFn(self.sCancelNative) ~= nil,
	}))
	-- a page that asks for the first time (a load or a reload) gets every verdict again; hellos without a page id count as one page
	local sHelloPage = pageOf(sReq) or ""
	if sHelloPage ~= self.sHelloPage then
		self.sHelloPage = sHelloPage
		if self.tRun ~= nil then
			self:_ResendVerdicts(self.tRun)
		end
		if self.tLast ~= nil then
			self:_ResendVerdicts(self.tLast)
		end
	end
	-- a page that (re)loads during a quick run stops it; it never restarts
	local tRun = self.tRun
	if tRun ~= nil and tRun.sPage ~= nil and pageOf(sReq) ~= nil and pageOf(sReq) ~= tRun.sPage then
		tRun.oUI = oUI
		self:_PageReloaded(tRun, "hello")
	end
	-- a page that (re)loads during a run picks it up
	if self.tRun ~= nil then
		self.tRun.oUI = oUI
		self:_Emit(self.tRun)
	elseif self.tLast ~= nil and self.tLast.bReloaded and not self.tLast.bReloadShown then
		-- and is told why a quick run stopped
		self.tLast.bReloadShown = true
		self:_Emit(self.tLast, nil, oUI)
	end
end

-- Row keys (comma-separated) -> { ids: { key: token }, rows: { key: { name,
-- species, gender } }, via: { key: "id"|"lossy"|"fp" }, failed: [keys] }.
-- rows are read in the same tick as the tokens: the page keeps a token only
-- if the row is still the animal it saw. Tokens come from identify() over
-- the whole list (an id two rows give is no id; a fingerprint only if one
-- row has it), the same rules the engine's send checks again.
-- Logged only when the answer changes (the page asked every second in game):
-- resolve_keys (counts, the id types and ways of the ones found) and one
-- resolve_fail line per shape of what StorageGetIDAndAIDType returned for
-- the keys that failed (pcall ok, type, math.type, the value cut short,
-- the type it gave, whether the row was found).
Lister.Resolve = function(self, oUI, sReq, sKeys)
	local tIds, tRows, tVia, tFailed = {}, {}, {}, array()
	local bStorage = self.oStorageMode ~= nil
	local tList = bStorage and self:_List() or nil
	-- the whole list, identified as the engine's send will check it
	local tInfo = tList ~= nil and identify(tList) or nil
	local tTypes, tWays, tShapes, tShapeOrder = {}, {}, {}, {}
	local n = 0
	for sKey in string.gmatch(tostring(sKeys or ""), "[^,%s]+") do
		n = n + 1
		if n > self.nMaxKeys then
			break
		end
		-- keys only mean something while Animal Storage is open
		local sToken, sVia, tRow = nil, nil, nil
		local tI = tInfo and tInfo[sKey] or nil
		local bOk, nID, nType, sWhy
		if tI ~= nil then
			sToken, sVia, tRow = tI.sToken, tI.sVia, tI.tRow
			bOk, nID, nType, sWhy = tI.bOk, tI.nID, tI.nType, tI.sWhy
		elseif bStorage then
			-- not in the list (or the list unreadable): an exact id and the row's own context only
			bOk, nID, nType = probe(sKey)
			local bLossy
			sToken, bLossy, sWhy = idToken(bOk, nID, nType)
			tRow = rowOf(sKey, nil)
			if bLossy then
				sToken, sWhy = nil, "lossy-unchecked"
			end
			sVia = sToken and "id" or nil
			if tRow == nil then
				sWhy = sWhy or "norow"
			end
		end
		if sToken ~= nil and tRow ~= nil then
			tIds[sKey] = sToken
			tVia[sKey] = sVia
			tRows[sKey] = { name = tRow.name, species = tRow.species, gender = tRow.gender }
			if sVia ~= "fp" then
				self.tCore[sToken] = coreOf(tRow)
			end
			tWays[sVia] = (tWays[sVia] or 0) + 1
			if sVia ~= "fp" then
				local sT = tostring(nType)
				tTypes[sT] = (tTypes[sT] or 0) + 1
			end
		else
			tFailed[#tFailed + 1] = sKey
			tWays.none = (tWays.none or 0) + 1
			if bStorage then
				local tShape, sShapeKey = failShape(bOk, nID, nType, tRow ~= nil)
				sShapeKey = sShapeKey .. "/" .. tostring(sWhy)
				local s = tShapes[sShapeKey]
				if s == nil then
					tShape.why = sWhy
					tShape.key = sKey
					tShape.n = 0
					tShapes[sShapeKey] = tShape
					tShapeOrder[#tShapeOrder + 1] = sShapeKey
					s = tShape
				end
				s.n = s.n + 1
			end
		end
	end
	for sVia in pairs(tWays) do
		if sVia ~= "id" and not (self.tWayMarked or {})[sVia] then
			self.tWayMarked = self.tWayMarked or {}
			self.tWayMarked[sVia] = true
			mark("lister_id_" .. sVia)
		end
	end
	-- the log, only when the answer changed
	local tFailedShort = {}
	for i = 1, math.min(#tFailed, 12) do
		tFailedShort[i] = tFailed[i]
	end
	local tSig = { tostring(n), tostring(bStorage), table.concat(tFailed, ","), toJson(tTypes), toJson(tWays), table.concat(tShapeOrder, ";") }
	local sSig = table.concat(tSig, "|")
	if sSig ~= self.sResolveSig then
		self.sResolveSig = sSig
		log("resolve_keys", { req = sReq, n = n, storage = bStorage, failed = #tFailed, failedKeys = tFailedShort,
			types = tTypes, via = tWays, same = self.nResolveSame })
		self.nResolveSame = 0
		for _, sShapeKey in ipairs(tShapeOrder) do
			local s = tShapes[sShapeKey]
			log("resolve_fail", { key = s.key, n = s.n, ok = s.ok, idType = s.idType, numType = s.numType, id = s.id, nType = s.nType, row = s.row, why = s.why })
		end
	else
		self.nResolveSame = (self.nResolveSame or 0) + 1
	end
	self:_Send(oUI, "PZ2QoL_ListerIds", tostring(sReq or ""), toJson({ ids = tIds, rows = tRows, via = tVia, failed = tFailed }))
end

Lister.Start = function(self, oUI, sReq, sJob)
	sReq = tostring(sReq or "")
	if self.tRun ~= nil then
		self:_Refuse(oUI, sReq, "A listing run is already going; stop it first.")
		return self:_Emit(self.tRun, nil, oUI)
	end
	local tAnimals, vPace, sMode, tOpts = parseJob(sJob)
	if tAnimals == nil then
		return self:_Refuse(oUI, sReq, vPace)
	end
	local tMissing = self:_Missing()
	if #tMissing > 0 then
		return self:_Refuse(oUI, sReq, "This game version has no " .. table.concat(tMissing, ", ") .. ".")
	end
	if self.oStorageMode == nil then
		return self:_Refuse(oUI, sReq, "Animal Storage is not open.", "closed")
	end
	-- a check only selects (local calls): it sends nothing to the server
	local tQ = self.tQuickModes[sMode]
	if sMode ~= "check" and self:_Online() == false then
		return self:_Refuse(oUI, sReq, tQ ~= nil and "Quick trade and release from the desk need an online Franchise."
			or sMode == "unlist" and "Taking listings off the market needs an online Franchise." or "Listing on the market needs an online Franchise.")
	end
	if tQ ~= nil and hubFn(tQ.sNative) == nil then
		return self:_Refuse(oUI, sReq, "This game version has no api.planetHub." .. tQ.sNative .. ".")
	end
	if sMode == "unlist" then
		if hubFn(self.sCancelNative) == nil then
			return self:_Refuse(oUI, sReq, "This game version has no api.planetHub." .. self.sCancelNative .. ".")
		end
		-- tied to the page that sent it: only its reports of the selection count
		if pageOf(sReq) == nil then
			return self:_Refuse(oUI, sReq, "The request did not say which page sent it; nothing was started.")
		end
	end
	-- a quick run is tied to the page that sent it (a reload stops it): no page id, no run
	if tQ ~= nil and pageOf(sReq) == nil then
		return self:_Refuse(oUI, sReq, "The request did not say which page sent it; nothing was started.")
	end
	-- a listing that quick-trades / releases what the server refuses: the
	-- same requirements as a quick run (the native, the page that sent it)
	local sOnRefused = tOpts and tOpts.sOnRefused or nil
	if sOnRefused ~= nil then
		if hubFn(self.tQuickModes[sOnRefused].sNative) == nil then
			return self:_Refuse(oUI, sReq, "This game version has no api.planetHub." .. self.tQuickModes[sOnRefused].sNative .. ".")
		end
		if pageOf(sReq) == nil then
			return self:_Refuse(oUI, sReq, "The request did not say which page sent it; nothing was started.")
		end
	end
	local nRunPace = nil
	if sMode == "check" then
		nRunPace = self:_ClampCheckPace(vPace)
	elseif tQ ~= nil or sMode == "unlist" then
		-- the desk's pace, at least 1 s; the listing pace is left alone
		nRunPace = self:_ClampPace(vPace)
	else
		self.nPaceMs = self:_ClampPace(vPace)
	end
	self.nRuns = self.nRuns + 1
	local tRun = { nId = self.nRuns, sReq = sReq, oUI = oUI, sPhase = "running", tAnimals = tAnimals, tResults = {}, nIndex = 1, sMode = sMode, nPaceMs = nRunPace }
	-- Phase 0a: the native "releaseable only" filter, as Lua reads it
	tRun.vReleaseable = element(existingContext("hubAnimalsData", "animalStorageData", "filters"), "isReleaseable")
	for i, tJob in ipairs(tAnimals) do
		tRun.tResults[i] = { guid = tJob.sGuid, status = "pending" }
	end
	self.tRun = tRun
	mark("lister_run_start")
	if sMode == "check" then
		mark("lister_check_start")
	end
	if tQ ~= nil then
		-- the frozen job (the GUIDs the player confirmed) and the page that sent it
		tRun.sPage = pageOf(sReq)
		mark("lister_quick_start")
	end
	tRun.nOffset = tOpts and tOpts.nOffset or nil
	if sMode == "unlist" then
		tRun.sPage = pageOf(sReq)
		mark("lister_unlist_start")
	end
	if sOnRefused ~= nil then
		tRun.sOnRefused = sOnRefused
		tRun.nRefusedMax = tOpts.nRefusedMax
		tRun.sPage = pageOf(sReq)
		mark("lister_onrefused_start")
	end
	log("start", { run = tRun.nId, req = sReq, n = #tAnimals, mode = sMode, paceMs = tRun.nPaceMs or self.nPaceMs, online = self:_Online(), releaseable = tRun.vReleaseable })
	for i, tJob in ipairs(tAnimals) do
		log("job", { run = tRun.nId, i = i, guid = tJob.sGuid, hint = tJob.sHint, price = tJob.nPrice or "-", hours = tJob.vHours })
	end
	self.bFlagMarked = nil
	trace("run " .. tRun.nId .. ": " .. #tAnimals .. " animals")
	local t = now()
	if self.nLastServer ~= nil and t - self.nLastServer < (tRun.nPaceMs or self.nPaceMs) / 1000 then
		-- the last run's listing was moments ago: its pause first
		tRun.nPauseStart = self.nLastServer
		self:_SetStep(tRun, "pause", "Pausing between listings.")
	else
		self:_Begin(tRun)
	end
	self:_Emit(tRun)
end

-- The player's Stop: at once, unless a listing is waiting for the server
-- (then that animal is "stopped": it may still appear).
Lister.Stop = function(self)
	local tRun = self.tRun
	if tRun == nil then
		if self.tLast ~= nil then
			self:_Emit(self.tLast)
		end
		return
	end
	mark("lister_stop")
	log("stop", runFields(tRun, { step = tRun.sStep, sent = tRun.tCur ~= nil and tRun.tCur.bSent == true }))
	if self:_Q(tRun) ~= nil and tRun.tCur ~= nil and tRun.tCur.bSent then
		-- a quick animal already sent: its result first, then the stop
		tRun.bStopAfter = true
		tRun.sMessage = "Stopping after this animal."
		tRun.bDirty = true
		return
	end
	self:_End(tRun, "stopped", "Stopped by you.")
end

-- the desk's slider sets a running quick run's own pace (it started at the slider's), else the listing pace
Lister.SetPace = function(self, nMs)
	local tRun = self.tRun
	local nPace = self:_ClampPace(nMs)
	local bQuick = tRun ~= nil and self.tQuickModes[tRun.sMode] ~= nil
	if bQuick then
		tRun.nPaceMs = nPace
	else
		self.nPaceMs = nPace
	end
	log("pace", { asked = nMs, ms = nPace, run = tRun and tRun.nId or nil, quick = bQuick or nil })
	if self.tRun ~= nil then
		self:_Emit(self.tRun)
	end
end

-----------------------------------------------------------------------
-- The desk sees every animal (PZ2QoL_DeskFilters)
-----------------------------------------------------------------------
-- The storage list the page reads (and the engine resolves and selects
-- in) holds only the rows the game's own storage filters let through: the
-- native filters it (StorageUISetSpeciesFilter / ...ApplyFilters, then
-- StorageUIRequestData; animalstoragehubmode.lua 1.0.5). While the desk is
-- open it clears them the way the game's "Reset all filters" does
-- (OnResetAllFilters: ResetFiltersToDefault, ClearFilterText, RequestData)
-- after keeping the settings (StorageUIGetSortFilterSettings), and puts
-- them back on close the way TransitionIn loads them (SetSortFilterSettings,
-- RequestData). Local UI calls; nothing else changes. A run going on keeps
-- the full list until it ends; leaving Animal Storage restores them first,
-- so the game saves the player's own filters.
Lister.tDeskNeeded = { "StorageUIGetSortFilterSettings", "StorageUISetSortFilterSettings", "StorageUIResetFiltersToDefault", "StorageUIClearFilterText", "StorageUIRequestData" }
Lister.tDesk = nil            -- { tSaved, oMode } while the desk keeps the game's filters cleared
Lister.bDeskRestoreLater = false

Lister._DeskRestore = function(self, sWhy)
	local tDesk = self.tDesk
	self.tDesk = nil
	self.bDeskRestoreLater = false
	if tDesk == nil then
		return false
	end
	-- only in the same storage visit (a new one loads the saved settings itself)
	if self.oStorageMode == nil or self.oStorageMode ~= tDesk.oMode then
		return false
	end
	local bOk = pcall(hubFn("StorageUISetSortFilterSettings"), tDesk.tSaved)
	pcall(hubFn("StorageUIRequestData"))
	mark(bOk and "lister_desk_restore" or "lister_desk_restore_fail")
	trace("desk: storage filters restored (" .. tostring(sWhy) .. ")")
	log("desk_restore", { ok = bOk, why = sWhy })
	return bOk
end

Lister.DeskFilters = function(self, oUI, sReq, sAction)
	local tAns = { ok = false, cleared = self.tDesk ~= nil, detail = "" }
	if sAction == "clear" then
		if self.tDesk ~= nil then
			-- reopened before the old filters came back: keep them cleared
			self.bDeskRestoreLater = false
			tAns.ok, tAns.detail = true, "again"
			mark("lister_desk_clear_again")
		elseif self.oStorageMode == nil then
			tAns.detail = "nostorage"
		else
			for _, sName in ipairs(self.tDeskNeeded) do
				if hubFn(sName) == nil then
					tAns.detail = "missing " .. sName
				end
			end
			if tAns.detail == "" then
				local bOk, tSaved = pcall(hubFn("StorageUIGetSortFilterSettings"))
				if not bOk or tSaved == nil then
					-- nothing to put back: leave the player's filters alone
					tAns.detail = "nosettings"
					mark("lister_desk_clear_fail")
				else
					self.tDesk = { tSaved = tSaved, oMode = self.oStorageMode }
					local bReset = pcall(hubFn("StorageUIResetFiltersToDefault"))
					pcall(hubFn("StorageUIClearFilterText"))
					pcall(hubFn("StorageUIRequestData"))
					tAns.ok, tAns.cleared = bReset, true
					tAns.detail = bReset and "" or "reset failed"
					mark(bReset and "lister_desk_clear" or "lister_desk_clear_fail")
					trace("desk: storage filters cleared")
				end
			end
		end
	elseif sAction == "restore" then
		if self.tDesk == nil then
			tAns.ok, tAns.detail = true, "none"
		elseif self.tRun ~= nil then
			-- the run resolves its animals in the full list: after it
			self.bDeskRestoreLater = true
			tAns.ok, tAns.detail = true, "later"
			mark("lister_desk_restore_later")
		else
			tAns.ok = self:_DeskRestore("desk closed")
			tAns.cleared = false
		end
	else
		tAns.detail = "badaction"
	end
	log("desk_filters", { req = sReq, action = sAction, ok = tAns.ok, cleared = tAns.cleared, detail = tAns.detail, run = self.tRun and self.tRun.nId or nil })
	self:_Send(oUI, "PZ2QoL_DeskFiltersState", tostring(sReq or ""), toJson(tAns))
end

-----------------------------------------------------------------------
-- Wiring
-----------------------------------------------------------------------
-- JS -> Lua events on the hub page, registered from the view's ready
-- callback (registering earlier is silently dropped).
Lister.Attach = function(self, oUI)
	if oUI == nil or self.tViews[oUI] then
		return
	end
	self.tViews[oUI] = true
	local function guard(sName, fn)
		-- callbacks get (callbackArgument, eventArgs...)
		return function(_, ...)
			local bOk, sErr = pcall(fn, ...)
			if not bOk then
				trace(sName .. " failed: " .. tostring(sErr))
			end
		end
	end
	local bOk, sErr = pcall(function()
		oUI:AddEventListener("PZ2QoL_ListerHello", 1, guard("hello", function(sReq)
			self:Hello(oUI, sReq)
		end), self)
		oUI:AddEventListener("PZ2QoL_ListerResolve", 2, guard("resolve", function(sReq, sKeys)
			self:Resolve(oUI, sReq, sKeys)
		end), self)
		oUI:AddEventListener("PZ2QoL_ListerStart", 2, guard("start", function(sReq, sJob)
			local bRan, sRunErr = pcall(self.Start, self, oUI, sReq, sJob)
			if not bRan and self.tRun == nil then
				self:_Refuse(oUI, tostring(sReq or ""), "The listing engine failed: " .. tostring(sRunErr))
			end
		end), self)
		oUI:AddEventListener("PZ2QoL_ListerStop", 0, guard("stop", function()
			self:Stop()
		end), self)
		oUI:AddEventListener("PZ2QoL_ListerPace", 1, guard("pace", function(nMs)
			self:SetPace(nMs)
		end), self)
		oUI:AddEventListener("PZ2QoL_ListerSeen", 2, guard("seen", function(sReq, sText)
			self:OnSeen(sReq, sText)
		end), self)
		oUI:AddEventListener("PZ2QoL_DeskFilters", 2, guard("deskfilters", function(sReq, sAction)
			self:DeskFilters(oUI, sReq, tostring(sAction or ""))
		end), self)
	end)
	if not bOk then
		trace("listeners failed: " .. tostring(sErr))
	end
end

Lister._PatchStorageMode = function(self, StorageMode)
	local fnIn = StorageMode.TransitionIn
	local fnOut = StorageMode.TransitionOut
	local fnAdvance = StorageMode.Advance
	if type(fnIn) ~= "function" or type(fnOut) ~= "function" or type(fnAdvance) ~= "function" then
		trace("AnimalStorageHubMode has changed; the market desk engine is off")
		return
	end
	local function close(sMessage)
		local tRun = self.tRun
		if tRun ~= nil then
			local bOk, sErr = pcall(self._End, self, tRun, "closed", sMessage)
			if not bOk then
				self.tRun = nil
				trace("close failed: " .. tostring(sErr))
			end
		end
	end
	StorageMode.TransitionIn = function(oMode, ...)
		-- a run from a storage visit that never ended (no TransitionOut seen)
		close("Animal Storage was reopened.")
		log("storage_open", { deskKept = self.tDesk ~= nil })
		-- a new visit loads the player's saved filters itself
		self.tDesk = nil
		self.bDeskRestoreLater = false
		self.oStorageMode = oMode
		return fnIn(oMode, ...)
	end
	StorageMode.TransitionOut = function(oMode, ...)
		-- row keys mean nothing outside Animal Storage: the run ends here
		log("storage_close", { run = self.tRun and self.tRun.nId or nil, desk = self.tDesk ~= nil })
		close("Animal Storage was closed.")
		-- the desk's cleared filters go back before the game saves them
		if self.tDesk ~= nil then
			pcall(self._DeskRestore, self, "storage closed")
		end
		if self.oStorageMode == oMode then
			self.oStorageMode = nil
		end
		return fnOut(oMode, ...)
	end
	StorageMode.Advance = function(oMode, ...)
		if self.nCheckClearAt ~= nil and now() >= self.nCheckClearAt then
			self.nCheckClearAt = nil
			-- a check run's second clear, unless a new run selects by now
			if self.tRun == nil then
				pcall(hubFn("StorageUIClearSelectedItems"))
			end
		end
		if self.tRun ~= nil then
			local bOk, sErr = pcall(self.Tick, self)
			if not bOk then
				-- the engine itself failed (not one animal's step): end the
				-- run rather than fail on every frame
				trace("tick failed: " .. tostring(sErr))
				log("tick_failed", { err = tostring(sErr) })
				local tRun = self.tRun
				if tRun ~= nil then
					local bEnded = pcall(self._End, self, tRun, "done", "The listing engine failed: " .. tostring(sErr))
					if not bEnded then
						self.tRun = nil
					end
				end
			end
		end
		return fnAdvance(oMode, ...)
	end
end

Lister.Init = function(self, Core)
	self.Core = Core
	Core:AddModulePatch("StartScreen.Globe.AnimalStorageHubMode", function(t) self:_PatchStorageMode(t) end)
	local Errors = global.package.loaded["pz2qol.errors"]
	if type(Errors) == "table" and type(Errors.AddServerErrorListener) == "function" then
		Errors:AddServerErrorListener(function(nError, sName, nRequestType)
			self:OnServerError(nError, sName, nRequestType)
		end)
	else
		trace("no server error listener; refusals only time out")
	end
end
