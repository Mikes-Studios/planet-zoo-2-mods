-----------------------------------------------------------------------
--  PZ2QoL.PlayerStore
--
--  The mod's device-local data (habitat assignments) in the game's player
--  save (Saves\player, the MainPlayer tData table, saved whole by the game:
--  GetData/SetData, api.save.RequestSaveMainPlayer; proven in game,
--  Franchise included, 2026-10-16). Developer-approved: the mod's OWN
--  "PZ2QoL" entry only, short ASCII strings, a size cap, pcall around every
--  call, nothing else in that save is touched.
--
--  Layout:
--    tData.PZ2QoL.Assign[<zoo key>] = { S = "<seq>", N = "<parts>",
--                                       P1 = "<= 4000 chars", P2 = ... }
--    tData.PZ2QoL.Prefs = { S = "<seq>", N = "<parts>", P1 = ... }
--  The zoo key is short ASCII (Kin._ZooKey). S orders the zoos by last
--  write: past the total cap the oldest other zoos are dropped.
--  Prefs holds the player-wide settings (one set across zoos, the UI's
--  prefs.js), capped on its own at 4000 characters: a separate area, so
--  the zoos' cap and trim never touch it.
--  Writes stay in memory (the game's own player table) and the save is
--  requested a few seconds after the last change; the game also saves the
--  player when a park closes.
-----------------------------------------------------------------------
local global   = _G
local api      = global.api
local pcall    = global.pcall
local tostring = global.tostring
local tonumber = global.tonumber
local type     = global.type
local pairs    = global.pairs
local string   = global.string
local table    = global.table
local math     = global.math

local PlayerStore = module(...)

PlayerStore.sRoot = "PZ2QoL"
PlayerStore.sArea = "Assign"
PlayerStore.nChunk = 4000        -- characters per stored string
PlayerStore.nCap = 65536         -- characters over all zoos
PlayerStore.sPrefsArea = "Prefs"
PlayerStore.nPrefsCap = 4000     -- characters of the player-wide settings
PlayerStore.nSaveDelay = 4       -- seconds after the last change
PlayerStore.nSaveMaxDelay = 30   -- seconds after the first unsaved change
PlayerStore.nDirtySince = nil
PlayerStore.nDirtyLast = nil
PlayerStore.bCleaned = false

local function trace(sMsg)
	pcall(function() api.debug.Trace("[PZ2QoL] playerstore: " .. sMsg) end)
end

PlayerStore._Mark = function(self, sName)
	local Core = self.Core or global.package.loaded["pz2qol.core"]
	if Core and Core.Mark then
		pcall(Core.Mark, Core, sName)
	end
end

-- the game's main player (nil until the profile is loaded: key 0)
PlayerStore._Player = function(self)
	local bOk, tPlayer = pcall(function()
		local GDB = global.package.loaded["database.gamedatabase"] or global.require("Database.GameDatabase")
		local nKey = GDB.GetPlayerKey(api.player.GetGameOwner())
		if nKey == nil or nKey == 0 then
			return nil
		end
		return GDB.GetPlayer(nKey)
	end)
	if bOk and type(tPlayer) == "table" and type(tPlayer.GetData) == "function" and type(tPlayer.SetData) == "function" then
		return tPlayer
	end
	return nil
end

PlayerStore.Available = function(self)
	return self:_Player() ~= nil
end

local function get(tPlayer, ...)
	local bOk, v = pcall(tPlayer.GetData, tPlayer, ...)
	if bOk then
		return v
	end
	return nil
end

local function set(tPlayer, v, ...)
	return (pcall(tPlayer.SetData, tPlayer, v, ...))
end

-- short ASCII key: letters, digits, '_' and '-'
local function validKey(s)
	return type(s) == "string" and #s > 0 and #s <= 120 and not string.find(s, "[^%w_%-]")
end
PlayerStore.ValidKey = validKey

-- a JSON object as printable ASCII
local function validText(s)
	return type(s) == "string" and string.sub(s, 1, 1) == "{" and not string.find(s, "[^\32-\126\t\r\n]")
end

local function entryText(t)
	if type(t) ~= "table" then
		return nil
	end
	local n = tonumber(t.N)
	if n == nil or n < 1 or n > 1000 then
		return nil
	end
	local tParts = {}
	for i = 1, n do
		local s = t["P" .. i]
		if type(s) ~= "string" then
			return nil
		end
		tParts[i] = s
	end
	local sText = table.concat(tParts)
	if not validText(sText) then
		return nil
	end
	return sText
end

local function entrySize(sKey, t)
	local n = #sKey + 16
	for _, v in pairs(t) do
		if type(v) == "string" then
			n = n + #v
		end
	end
	return n
end

-- the zoos' table as kept, or {} (anything else under the key is dropped)
PlayerStore._Area = function(self, tPlayer)
	local tRoot = get(tPlayer, self.sRoot)
	if tRoot ~= nil and type(tRoot) ~= "table" then
		set(tPlayer, {}, self.sRoot)
		return {}
	end
	local t = get(tPlayer, self.sRoot, self.sArea)
	return type(t) == "table" and t or {}
end

-- Once per session: the persistence probe of the 2026-10-16 debug builds
-- left tData.PZ2QoL.Probe and a 12 KB tData.PZ2QoL.Big. Removes them.
PlayerStore.Cleanup = function(self)
	if self.bCleaned then
		return
	end
	local tPlayer = self:_Player()
	if tPlayer == nil then
		return
	end
	self.bCleaned = true
	local tRoot = get(tPlayer, self.sRoot)
	if type(tRoot) ~= "table" then
		return
	end
	if tRoot.Probe ~= nil or tRoot.Big ~= nil then
		set(tPlayer, nil, self.sRoot, "Probe")
		set(tPlayer, nil, self.sRoot, "Big")
		self:_Mark("assign_store_cleaned")
		self:_RequestSave()
	end
end

-- this zoo's text, "" when nothing is kept; nil + "noplayer" without a player
PlayerStore.Read = function(self, sZoo)
	if not validKey(sZoo) then
		return nil, "badkey"
	end
	local tPlayer = self:_Player()
	if tPlayer == nil then
		return nil, "noplayer"
	end
	self:Cleanup()
	local tEntry = self:_Area(tPlayer)[sZoo]
	if tEntry == nil then
		return ""
	end
	local sText = entryText(tEntry)
	if sText == nil then
		trace("unreadable entry for " .. sZoo)
		return ""
	end
	return sText
end

-- Replaces this zoo's text ("" or "{}" removes it). Returns true, or
-- false + why: badkey | bad | toobig | noplayer | failed.
PlayerStore.Write = function(self, sZoo, sText, nNow)
	if not validKey(sZoo) then
		return false, "badkey"
	end
	if type(sText) ~= "string" then
		return false, "bad"
	end
	local bRemove = sText == "" or sText == "{}"
	if not bRemove and not validText(sText) then
		return false, "bad"
	end
	if #sText + #sZoo + 16 > self.nCap then
		return false, "toobig"
	end
	local tPlayer = self:_Player()
	if tPlayer == nil then
		return false, "noplayer"
	end
	self:Cleanup()
	local tOld = self:_Area(tPlayer)
	local tNew = {}
	local nSeq = 0
	local nTotal = 0
	local tOthers = {}
	for sKey, tEntry in pairs(tOld) do
		if type(sKey) == "string" and validKey(sKey) and type(tEntry) == "table" and sKey ~= sZoo then
			local n = tonumber(tEntry.S) or 0
			nSeq = math.max(nSeq, n)
			if entryText(tEntry) ~= nil then
				tNew[sKey] = tEntry
				local nSize = entrySize(sKey, tEntry)
				nTotal = nTotal + nSize
				tOthers[#tOthers + 1] = { sKey = sKey, nSeq = n, nSize = nSize }
			end
		elseif sKey == sZoo and type(tEntry) == "table" then
			nSeq = math.max(nSeq, tonumber(tEntry.S) or 0)
		end
	end
	if not bRemove then
		local tEntry = { S = tostring(math.floor(nSeq + 1)) }
		local nParts = math.max(1, math.ceil(#sText / self.nChunk))
		tEntry.N = tostring(nParts)
		for i = 1, nParts do
			tEntry["P" .. i] = string.sub(sText, (i - 1) * self.nChunk + 1, i * self.nChunk)
		end
		tNew[sZoo] = tEntry
		nTotal = nTotal + entrySize(sZoo, tEntry)
		-- over the cap: the zoos written longest ago go first
		table.sort(tOthers, function(a, b) return a.nSeq < b.nSeq end)
		local i = 1
		while nTotal > self.nCap and tOthers[i] ~= nil do
			tNew[tOthers[i].sKey] = nil
			nTotal = nTotal - tOthers[i].nSize
			i = i + 1
		end
		if i > 1 then
			self:_Mark("assign_store_trimmed")
		end
	end
	if not set(tPlayer, tNew, self.sRoot, self.sArea) then
		return false, "failed"
	end
	self:_Mark("assign_store_written")
	self:_Changed(nNow)
	return true
end

-- the player-wide settings' text, "" when nothing is kept; nil +
-- "noplayer" without a player
PlayerStore.ReadPrefs = function(self)
	local tPlayer = self:_Player()
	if tPlayer == nil then
		return nil, "noplayer"
	end
	self:Cleanup()
	local tRoot = get(tPlayer, self.sRoot)
	if type(tRoot) ~= "table" or tRoot[self.sPrefsArea] == nil then
		return ""
	end
	local sText = entryText(tRoot[self.sPrefsArea])
	if sText == nil then
		trace("unreadable prefs")
		return ""
	end
	return sText
end

-- Replaces the player-wide settings ("" or "{}" removes them). Returns
-- true, or false + why: bad | toobig | noplayer | failed.
PlayerStore.WritePrefs = function(self, sText, nNow)
	local bOk, sWhy = self:_WritePrefs(sText, nNow)
	self:_Mark(bOk and "prefs_written" or "prefs_refused")
	if not bOk then
		trace("prefs refused: " .. tostring(sWhy))
	end
	return bOk, sWhy
end

PlayerStore._WritePrefs = function(self, sText, nNow)
	if type(sText) ~= "string" then
		return false, "bad"
	end
	local bRemove = sText == "" or sText == "{}"
	if not bRemove and not validText(sText) then
		return false, "bad"
	end
	if #sText > self.nPrefsCap then
		return false, "toobig"
	end
	local tPlayer = self:_Player()
	if tPlayer == nil then
		return false, "noplayer"
	end
	self:Cleanup()
	local tRoot = get(tPlayer, self.sRoot)
	if tRoot ~= nil and type(tRoot) ~= "table" then
		-- something else under the mod's key: replaced, never anything outside it
		if not set(tPlayer, {}, self.sRoot) then
			return false, "failed"
		end
		tRoot = {}
	end
	local tOld = type(tRoot) == "table" and tRoot[self.sPrefsArea] or nil
	if bRemove then
		if tOld == nil then
			return true
		end
		if not set(tPlayer, nil, self.sRoot, self.sPrefsArea) then
			return false, "failed"
		end
		self:_Changed(nNow)
		return true
	end
	local nSeq = type(tOld) == "table" and tonumber(tOld.S) or 0
	local tEntry = { S = tostring(math.floor(nSeq + 1)) }
	local nParts = math.max(1, math.ceil(#sText / self.nChunk))
	tEntry.N = tostring(nParts)
	for i = 1, nParts do
		tEntry["P" .. i] = string.sub(sText, (i - 1) * self.nChunk + 1, i * self.nChunk)
	end
	if not set(tPlayer, tEntry, self.sRoot, self.sPrefsArea) then
		return false, "failed"
	end
	self:_Changed(nNow)
	return true
end

PlayerStore._Changed = function(self, nNow)
	nNow = nNow or 0
	self.nDirtySince = self.nDirtySince or nNow
	self.nDirtyLast = nNow
end

PlayerStore._RequestSave = function(self)
	self.nDirtySince = nil
	self.nDirtyLast = nil
	local bOk, sErr = pcall(function() api.save.RequestSaveMainPlayer() end)
	if bOk then
		self:_Mark("assign_store_saved")
	else
		trace("save request failed: " .. tostring(sErr))
		self:_Mark("assign_store_save_failed")
	end
	return bOk
end

-- from every world's tick (the park's and the hub's): asks the game to
-- save the player a few seconds after the last change (never on every click)
PlayerStore.Tick = function(self, nNow)
	if self.nDirtyLast == nil then
		return
	end
	if nNow - self.nDirtyLast >= self.nSaveDelay or nNow - self.nDirtySince >= self.nSaveMaxDelay or nNow < self.nDirtyLast then
		self:_RequestSave()
	end
end

-- Hub-only changes (Market desk, lister pace) have no park tick to save them;
-- every world advances through World.AdvanceWhileRunning (tested on 1.0.5 build 1023906).
PlayerStore._PatchWorld = function(self, World)
	local fnAdvance = World.AdvanceWhileRunning
	if type(fnAdvance) ~= "function" then
		self:_Mark("assign_store_no_world_tick")
		return
	end
	World.AdvanceWhileRunning = function(...)
		local bOk = pcall(function()
			self:Tick(api.time.PerformanceTimeToMilliseconds(api.time.GetPerformanceTimer()) / 1000)
		end)
		if not bOk then
			self:_Mark("assign_store_world_tick_failed")
		end
		return fnAdvance(...)
	end
end

PlayerStore.Init = function(self, Core)
	self.Core = Core
	-- found by Kin and Hub through Core (package.loaded keys proved unreliable)
	Core.PlayerStore = self
	Core:AddModulePatch("World.World", function(t) self:_PatchWorld(t) end)
end
