-----------------------------------------------------------------------
--  PZ2QoL.Core
--
--  Boots the mod once per Lua state. Installs a require hook so game
--  modules are patched the moment they are first loaded (ACSE style),
--  then hands off to the feature modules.
-----------------------------------------------------------------------
local global   = _G
local api      = global.api
local pcall    = global.pcall
local string   = global.string
local tostring = global.tostring
local type     = global.type
local ipairs   = global.ipairs

local Core = module(...)

Core.sVersion = "3.2.1"
Core.bBooted = false
Core.bPatching = false

-- lower-cased module name -> list of patch functions(tModule)
Core.tPatches = {}
Core.tPatched = {}

local function trace(sMsg)
	pcall(function() api.debug.Trace("[PZ2QoL] " .. sMsg) end)
end
Core.Trace = trace

-- Debug checkpoints. Only active in a debug build, which ships
-- dbg\cp_<name>.dll files; loading one appends its name to dbg\trace.log.
-- In a normal build loadlib finds nothing and this is a no-op.
Core.sTraceDir = ".\\Win64\\ovldata\\PZ2QoL\\dbg\\"
Core.bTrace = false
Core.tTraced = {}
Core.Checkpoint = function(self, sName)
	if not self.bTrace or self.tTraced[sName] then
		return
	end
	self.tTraced[sName] = true
	pcall(function() global.package.loadlib(self.sTraceDir .. "cp_" .. sName .. ".dll", "*") end)
end

-- Register fnPatch(tModule) to run once when sModuleName is loaded
-- (immediately if it already is).
-- Like Checkpoint, but logs every call (breadcrumbs for crash hunting).
-- The first call loads the DLL (DllMain logs it); later calls use its
-- exported "mark" function.
Core.tMarks = {}
-- Spells a short number into the trace (chr_0..chr_9, chr_minus, chr_dot,
-- then chr_end), for values that have no checkpoint name of their own.
Core.MarkNumber = function(self, sPrefix, n)
	if not self.bTrace then
		return
	end
	self:Mark(sPrefix)
	local s = tostring(n)
	for i = 1, global.math.min(#s, 12) do
		local c = string.sub(s, i, i)
		if c == "-" then
			self:Mark("chr_minus")
		elseif c == "." then
			self:Mark("chr_dot")
		elseif string.find(c, "%d") then
			self:Mark("chr_" .. c)
		end
	end
	self:Mark("chr_end")
end

Core.Mark = function(self, sName)
	if not self.bTrace then
		return
	end
	local fn = self.tMarks[sName]
	if fn == nil then
		local bOk, f = pcall(global.package.loadlib, self.sTraceDir .. "cp_" .. sName .. ".dll", "mark")
		self.tMarks[sName] = (bOk and type(f) == "function") and f or false
		return
	end
	if fn then
		pcall(fn)
	end
end

-----------------------------------------------------------------------
-- Detailed log (debug builds).
-- One free-text line per event in dbg\trace.log:
--   <time> tid=<n> LOG lua#<seq> <area> <event> k=v k=v ...
-- The game exports no Lua C API, so the line is spelled one byte at a time
-- through dbg\lg_<hex>.dll "mark" functions (lg_clr first, lg_end writes
-- it; PZ2ModdingKit\trace\pz2_trace.c). Release builds have no dbg\, so this
-- is a no-op; anything missing turns it off for the session. Never raises.
-----------------------------------------------------------------------
Core.nLogMax = 900            -- characters per line (the DLL keeps 4000)
Core.nLogValueMax = 160       -- characters per value
Core.nLogSeq = 0
Core.tLogFns = {}             -- byte or "clr"/"end" -> mark function or false
Core.bLogOff = false          -- the lg_* files are missing: stop trying
Core.bLogOk = false

-- keys never written (no account, session or personal data in the log)
local function sensitiveKey(sKey)
	local s = string.lower(sKey)
	return string.find(s, "token", 1, true) or string.find(s, "password", 1, true) or string.find(s, "account", 1, true)
		or string.find(s, "steam", 1, true) or string.find(s, "session", 1, true) or string.find(s, "email", 1, true)
		or string.find(s, "user", 1, true) or string.find(s, "auth", 1, true)
end

local function logNumber(n)
	if n ~= n or n == global.math.huge or n == -global.math.huge then
		return "nan"
	end
	if global.math.type(n) == "integer" then
		return string.format("%d", n)
	end
	if n == global.math.floor(n) and global.math.abs(n) < 2 ^ 53 then
		return string.format("%d", n)
	end
	return string.format("%.4g", n)
end

local logValue
logValue = function(v, nDepth)
	local t = type(v)
	local s
	if t == "string" then
		s = v
	elseif t == "number" then
		return logNumber(v)
	elseif t == "boolean" then
		return v and "true" or "false"
	elseif v == nil then
		return "nil"
	elseif t == "table" and (nDepth or 0) < 1 then
		local tParts, n = {}, 0
		if #v > 0 then
			for i = 1, #v do
				n = n + 1
				if n > 12 then
					tParts[#tParts + 1] = "..."
					break
				end
				tParts[#tParts + 1] = logValue(v[i], 1)
			end
		else
			local tKeys = {}
			for k in global.pairs(v) do
				tKeys[#tKeys + 1] = tostring(k)
			end
			global.table.sort(tKeys)
			for _, k in ipairs(tKeys) do
				n = n + 1
				if n > 12 then
					tParts[#tParts + 1] = "..."
					break
				end
				if not sensitiveKey(k) then
					tParts[#tParts + 1] = k .. ":" .. logValue(v[k], 1)
				end
			end
		end
		s = "[" .. global.table.concat(tParts, ",") .. "]"
		t = "list"
	elseif t == "table" then
		return "[...]"
	else
		s = tostring(v)
	end
	s = string.gsub(s, "[%c]", " ")
	if #s > Core.nLogValueMax then
		s = string.sub(s, 1, Core.nLogValueMax) .. "~"
	end
	if t == "string" and (s == "" or string.find(s, "[%s=\"]")) then
		s = '"' .. string.gsub(s, '"', "'") .. '"'
	end
	return s
end

-- These lead each line (an animal's run and GUID first), the rest sorted.
local tLogLead = { "run", "i", "guid", "key", "step" }

-- " k=v k=v" for a table (nil values left out), " <text>" for anything else.
Core.FormatLogData = function(tData)
	if tData == nil then
		return ""
	end
	if type(tData) ~= "table" then
		return " " .. logValue(tData)
	end
	local tOut, tDone = {}, {}
	for _, k in ipairs(tLogLead) do
		if tData[k] ~= nil then
			tOut[#tOut + 1] = k .. "=" .. logValue(tData[k])
			tDone[k] = true
		end
	end
	local tKeys = {}
	for k in global.pairs(tData) do
		if type(k) == "string" and not tDone[k] then
			tKeys[#tKeys + 1] = k
		end
	end
	global.table.sort(tKeys)
	for _, k in ipairs(tKeys) do
		if sensitiveKey(k) then
			tOut[#tOut + 1] = k .. "=[redacted]"
		else
			tOut[#tOut + 1] = k .. "=" .. logValue(tData[k])
		end
	end
	if #tOut == 0 then
		return ""
	end
	return " " .. global.table.concat(tOut, " ")
end

Core._LogFn = function(self, vByte)
	local fn = self.tLogFns[vByte]
	if fn == nil then
		local sName = type(vByte) == "number" and string.format("lg_%02x", vByte) or ("lg_" .. tostring(vByte))
		local bOk, f = pcall(global.package.loadlib, self.sTraceDir .. sName .. ".dll", "mark")
		fn = (bOk and type(f) == "function") and f or false
		self.tLogFns[vByte] = fn
	end
	return fn
end

-- Writes one line as it is (printable ASCII; anything else becomes '?').
Core.LogText = function(self, sText)
	if not self.bTrace or self.bLogOff or type(sText) ~= "string" or sText == "" then
		return
	end
	local bOk = pcall(function()
		local fnEnd = self:_LogFn("end")
		local fnClr = self:_LogFn("clr")
		if not fnEnd or not fnClr then
			self.bLogOff = true
			self:Checkpoint("log_channel_missing")
			return
		end
		local s = sText
		if #s > self.nLogMax then
			s = string.sub(s, 1, self.nLogMax) .. "~"
		end
		local tFns = self.tLogFns
		fnClr()
		for i = 1, #s do
			local b = string.byte(s, i)
			if b < 32 or b > 126 then
				b = 63
			end
			local fn = tFns[b]
			if fn == nil then
				fn = self:_LogFn(b)
			end
			if fn then
				fn()
			end
		end
		fnEnd()
		if not self.bLogOk then
			self.bLogOk = true
			self:Checkpoint("log_channel_ok")
		end
	end)
	if not bOk then
		self.bLogOff = true
	end
end

-- Core:Log("lister", "send", { run = 3, guid = "123", price = 1200 })
Core.Log = function(self, sArea, sEvent, tData)
	if not self.bTrace or self.bLogOff then
		return
	end
	pcall(function()
		self.nLogSeq = self.nLogSeq + 1
		self:LogText("lua#" .. self.nLogSeq .. " " .. tostring(sArea) .. " " .. tostring(sEvent) .. Core.FormatLogData(tData))
	end)
end

Core.AddModulePatch = function(self, sModuleName, fnPatch)
	local sKey = string.lower(sModuleName)
	local tList = self.tPatches[sKey]
	if not tList then
		tList = {}
		self.tPatches[sKey] = tList
	end
	tList[#tList + 1] = fnPatch
	local tLoaded = global.package and global.package.loaded and global.package.loaded[sKey]
	if type(tLoaded) == "table" then
		self:_ApplyPatches(sKey, tLoaded)
	end
end

Core._ApplyPatches = function(self, sKey, tModule)
	local tList = self.tPatches[sKey]
	if not tList or type(tModule) ~= "table" then
		return
	end
	self.tPatched[sKey] = self.tPatched[sKey] or {}
	for i, fnPatch in ipairs(tList) do
		if not self.tPatched[sKey][i] then
			self.tPatched[sKey][i] = true
			local bOk, sErr = pcall(fnPatch, tModule)
			if not bOk then
				trace("patch for " .. sKey .. " failed: " .. tostring(sErr))
				local Errors = global.package.loaded["pz2qol.errors"]
				if Errors then
					Errors:Report("mod", "Patch for " .. sKey .. " failed", tostring(sErr))
				end
			end
		end
	end
end

Core._InstallRequireHook = function(self)
	local fnRequire = global.require
	local fnTryRequire = global.tryrequire
	local function after(sName, tModule)
		if type(sName) == "string" and type(tModule) == "table" then
			local sKey = string.lower(sName)
			if self.tPatches[sKey] then
				self:_ApplyPatches(sKey, tModule)
			end
		end
		return tModule
	end
	global.require = function(sName, ...)
		return after(sName, fnRequire(sName, ...))
	end
	if fnTryRequire then
		global.tryrequire = function(sName, ...)
			return after(sName, fnTryRequire(sName, ...))
		end
	end
end

-- Park managers are loaded by Environment._LoadManagerModule with a copy of
-- require the Environment module took before the mod booted, so the require
-- hook never sees them. The environment also builds its per-frame call lists
-- from each manager's methods when it creates the manager, so a patch must be
-- in place by then: apply ours right as the module is loaded.
Core._PatchEnvironment = function(self, Environment)
	local fnLoad = Environment._LoadManagerModule
	if type(fnLoad) ~= "function" then
		trace("Environment has no _LoadManagerModule; manager patches only via require")
		return
	end
	Environment._LoadManagerModule = function(oEnv, sName, ...)
		local tModule = fnLoad(oEnv, sName, ...)
		if type(sName) == "string" and type(tModule) == "table" then
			local sKey = string.lower(sName)
			if self.tPatches[sKey] then
				self:_ApplyPatches(sKey, tModule)
				self:Checkpoint("manager_patched_" .. sKey)
			end
		end
		return tModule
	end
end

-- Apply pending patches to every module that is already loaded, whichever
-- require loaded it.
Core.ApplyLoadedPatches = function(self)
	local tLoaded = global.package and global.package.loaded
	if type(tLoaded) ~= "table" then
		return
	end
	for sKey in global.pairs(self.tPatches) do
		if type(tLoaded[sKey]) == "table" then
			self:_ApplyPatches(sKey, tLoaded[sKey])
		end
	end
end

-- ModeHelper (engine Lua, loaded before the mod) requires every mode of a
-- world in SetModes with its own copy of require, so mode modules can miss
-- the require hook. Sweep the loaded modules right after, before any mode
-- instance exists.
Core._PatchModeHelper = function(self, ModeHelper)
	local fnSetModes = ModeHelper.SetModes
	if type(fnSetModes) ~= "function" then
		trace("ModeHelper has no SetModes; mode patches only via require")
		return
	end
	ModeHelper.SetModes = function(oHelper, tModes, ...)
		if type(tModes) == "table" then
			-- require them first (no-op when loaded), so they are patched
			-- before SetModes hands out the first mode
			for _, sModule in global.pairs(tModes) do
				if type(sModule) == "string" then
					pcall(global.require, sModule)
				end
			end
		end
		pcall(self.ApplyLoadedPatches, self)
		self:Mark("x_setmodes")
		local tResult = global.table.pack(fnSetModes(oHelper, tModes, ...))
		self:Mark("x_setmodes_done")
		return global.table.unpack(tResult, 1, tResult.n)
	end
end

-- Every feature, in boot order. Hub attaches the ones with an Attach to each
-- mod view in this order: sView "hub" to the hub's view only, and the
-- page's greeting (PZ2QoL_Hello) goes out before the first bAfterHello one.
local tFeatures = {
	{ "PZ2QoL.Errors" },
	{ "PZ2QoL.Hub" },
	{ "PZ2QoL.MarketPeek", sView = "hub" },
	{ "PZ2QoL.Lister", sView = "hub" },
	{ "PZ2QoL.PlayerStore" },
	{ "PZ2QoL.Kin" },
	{ "PZ2QoL.Guards" },
	{ "PZ2QoL.SaveTrace" },
	{ "PZ2QoL.BoxTrace" },
	-- it sends its state as it attaches: after the greeting
	{ "PZ2QoL.Autosave", bAfterHello = true },
	{ "PZ2QoL.BoxRelease" },
	{ "PZ2QoL.Education" },
	-- typing "releasable" in the Animals tab's species search
	{ "PZ2QoL.Releasable" },
	{ "PZ2QoL.StorageSend" },
	{ "PZ2QoL.TradeJump" },
	{ "PZ2QoL.StorageFetch" },
	-- the script profiler is a developer tool: debug builds only
	{ "PZ2QoL.Profiler", bDebugOnly = true },
}
Core.tAttach = {} -- { oModule, sView, bAfterHello } of the features that booted, in order

-- The require hook and the game's two private-require patches, once.
Core.InstallPatching = function(self)
	if self.bPatching then
		return
	end
	self.bPatching = true
	self:_InstallRequireHook()
	self:Checkpoint("require_hook")
	self:AddModulePatch("Environment.Environment", function(t) self:_PatchEnvironment(t) end)
	self:AddModulePatch("GameHelpers.ModeHelper", function(t) self:_PatchModeHelper(t) end)
end

Core.Boot = function(self)
	if self.bBooted then
		return
	end
	self.bBooted = true
	pcall(function()
		self.bTrace = global.package.loadlib(self.sTraceDir .. "cp_boot.dll", "*") ~= nil
	end)
	self:InstallPatching()
	for _, tFeature in ipairs(tFeatures) do
		local sFeature = tFeature[1]
		if not tFeature.bDebugOnly or self.bTrace then
			local bOk, sErr = pcall(function()
				local oModule = global.require(sFeature)
				oModule:Init(self)
				if type(oModule.Attach) == "function" then
					self.tAttach[#self.tAttach + 1] = { oModule = oModule, sView = tFeature.sView, bAfterHello = tFeature.bAfterHello }
				end
			end)
			self:Checkpoint(bOk and ("init_ok_" .. string.lower(sFeature)) or ("init_fail_" .. string.lower(sFeature)))
			if not bOk then
				trace("feature " .. sFeature .. " failed to init: " .. tostring(sErr))
			end
		end
	end
	self:Checkpoint("booted")
	trace("booted v" .. self.sVersion)
end
