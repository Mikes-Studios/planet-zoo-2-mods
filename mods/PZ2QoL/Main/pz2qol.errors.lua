-----------------------------------------------------------------------
--  PZ2QoL.Errors
--
--  Makes silent failures visible:
--   * franchise server errors (MsgType_DatabaseErrorMessage). The game
--     only reacts to "server unreachable"; everything else is dropped
--     unless the current hub mode handles it, which leaves spinners.
--   * Lua errors swallowed by coroutine.resume
--   * api.debug.Error calls (and failed Asserts, log only)
--
--  Entries are kept in a ring buffer and pushed to the FrontEnd UI
--  ("PZ2QoL_Error" event). If the mod UI is not active, server errors
--  fall back to the game's own dialog.
-----------------------------------------------------------------------
local global   = _G
local api      = global.api
local pcall    = global.pcall
local tostring = global.tostring
local type     = global.type
local ipairs   = global.ipairs
local string   = global.string
local pairs    = global.pairs
local table    = global.table

local Errors = module(...)

Errors.nMaxEntries = 100
Errors.tEntries = {}
Errors.tPending = {}       -- not yet delivered to the UI
Errors.tLastShown = {}     -- dedupe key -> time
Errors.nDedupeSeconds = 5
Errors.tServerErrorListeners = {} -- fn(nError, sName or nil, nRequestType)

local tDatabaseErrorNames = {
	"DatabaseError_Ok", "DatabaseError_Unknown", "DatabaseError_DidNotGetResponse",
	"DatabaseError_CouldNotParseResponse", "DatabaseError_InternalServerError",
	"DatabaseError_MaintainanceMode", "DatabaseError_NotAllowed", "DatabaseError_NotAuthorised",
	"DatabaseError_NotEnoughCC", "DatabaseError_NotImplemented", "DatabaseError_PlayerBanned",
	"DatabaseError_ProfanityFilter", "DatabaseError_UnprocessableContent",
}
local tRequestTypeNames = {
	"RequestType_CloseZooDryRun", "RequestType_CommunityChallengeLeaderboard",
	"RequestType_CommunityChallengeLocalisationString", "RequestType_CommunityChallengeProgress",
	"RequestType_CommunityChallengeSchedule", "RequestType_Count",
}
-- Friendly explanations for the codes a player can act on.
local tDatabaseErrorHints = {
	DatabaseError_NotEnoughCC = "Not enough Conservation Credits for this action.",
	DatabaseError_NotAllowed = "The server refused this action (it may no longer be available, e.g. the listing was already taken).",
	DatabaseError_NotAuthorised = "Your Frontier session is not authorised. Try signing in again.",
	DatabaseError_DidNotGetResponse = "No response from the Frontier server (timeout or connection problem).",
	DatabaseError_InternalServerError = "The Frontier server hit an internal error. Try again later.",
	DatabaseError_MaintainanceMode = "The Frontier servers are in maintenance.",
	DatabaseError_CouldNotParseResponse = "The server sent a response the game could not read.",
	DatabaseError_UnprocessableContent = "The server rejected the data sent (invalid content).",
	DatabaseError_ProfanityFilter = "The name was rejected by the profanity filter.",
	DatabaseError_PlayerBanned = "This account is banned from online features.",
}

local function now()
	local bOk, n = pcall(function()
		return api.time.PerformanceTimeToMilliseconds(api.time.GetPerformanceTimer()) / 1000
	end)
	return bOk and n or 0
end

local function enumName(tApi, tNames, nValue)
	if tApi == nil or nValue == nil then
		return nil
	end
	for _, sName in ipairs(tNames) do
		local bOk, v = pcall(function() return tApi[sName] end)
		if bOk and v ~= nil and v == nValue then
			return (string.gsub(sName, "^[^_]*_", ""))
		end
	end
	-- not one of the names above: any of the API's own constants with that
	-- prefix (the franchise API lists more request types than are named here)
	local sPrefix = tNames[1] and string.match(tNames[1], "^[^_]*_")
	if sPrefix == nil then
		return nil
	end
	local sFound = nil
	pcall(function()
		for k, v in pairs(tApi) do
			if type(k) == "string" and v == nValue and string.sub(k, 1, #sPrefix) == sPrefix then
				sFound = string.sub(k, #sPrefix + 1)
				return
			end
		end
	end)
	return sFound
end

local function franchiseApi()
	local MarketPeek = global.package.loaded["pz2qol.marketpeek"]
	if MarketPeek and MarketPeek.GetFranchise then
		local bOk, t = pcall(MarketPeek.GetFranchise, MarketPeek)
		if bOk and t ~= nil then
			return t
		end
	end
	local bOk, t = pcall(function() return api.world.GetWorldAPIs().franchise end)
	return bOk and t or nil
end

-- sSource: "server" | "lua" | "debug" | "mod" | "assert"
-- bShow: false = log only
Errors.Report = function(self, sSource, sTitle, sDetail, bShow)
	local tEntry = {
		sSource = tostring(sSource),
		sTitle = tostring(sTitle),
		sDetail = sDetail ~= nil and tostring(sDetail) or "",
		nTime = now(),
		bShow = bShow ~= false,
	}
	local tEntries = self.tEntries
	tEntries[#tEntries + 1] = tEntry
	if self.Core then
		self.Core:Mark("report_" .. tEntry.sSource)
		-- the detailed log (debug builds): what was reported, and whether shown
		pcall(self.Core.Log, self.Core, "lua", "report", { src = tEntry.sSource, title = tEntry.sTitle, detail = tEntry.sDetail, show = tEntry.bShow })
	end
	if #tEntries > self.nMaxEntries then
		table.remove(tEntries, 1)
	end
	pcall(function() api.debug.Trace("[PZ2QoL] " .. tEntry.sSource .. ": " .. tEntry.sTitle .. " | " .. tEntry.sDetail) end)
	if not tEntry.bShow then
		return
	end
	local sKey = tEntry.sSource .. tEntry.sTitle .. tEntry.sDetail
	local nLast = self.tLastShown[sKey]
	if nLast ~= nil and tEntry.nTime - nLast < self.nDedupeSeconds then
		return
	end
	self.tLastShown[sKey] = tEntry.nTime
	self.tPending[#self.tPending + 1] = tEntry
	self:Flush()
end

-- Deliver pending entries to the mod UI, or to the fallback. The view
-- GetModUI picks shows the entry; every other ready mod view gets a silent
-- copy, because features there (the storage lister on the hub page) must
-- hear about server errors even when the HUD shows them.
Errors.Flush = function(self)
	local Hub = global.package.loaded["pz2qol.hub"]
	local oUI = Hub and Hub:GetModUI()
	if oUI ~= nil then
		local tPending = self.tPending
		self.tPending = {}
		local tOthers = Hub.GetModUIs and Hub:GetModUIs() or {}
		for _, tEntry in ipairs(tPending) do
			pcall(function()
				oUI:TriggerEventAtNextAdvance("PZ2QoL_Error", tEntry.sSource, tEntry.sTitle, tEntry.sDetail, false)
			end)
			for _, oOther in ipairs(tOthers) do
				if oOther ~= oUI then
					pcall(function()
						oOther:TriggerEventAtNextAdvance("PZ2QoL_Error", tEntry.sSource, tEntry.sTitle, tEntry.sDetail, true)
					end)
				end
			end
		end
		return
	end
	-- No mod UI: only server errors are important enough for a dialog.
	if Hub and Hub.ShowFallbackDialog then
		local tKeep = {}
		for _, tEntry in ipairs(self.tPending) do
			if tEntry.sSource == "server" then
				Hub:ShowFallbackDialog(tEntry)
			else
				tKeep[#tKeep + 1] = tEntry
			end
		end
		-- keep non-server entries until a UI appears, bounded
		while #tKeep > 20 do
			table.remove(tKeep, 1)
		end
		self.tPending = tKeep
	end
end

Errors.OnDatabaseErrorMessages = function(self, tMessages)
	if type(tMessages) ~= "table" then
		return
	end
	local tFranchise = franchiseApi()
	for _, tMsg in ipairs(tMessages) do
		if type(tMsg) == "table" then
			local sName = enumName(tFranchise, tDatabaseErrorNames, tMsg.nError)
			local sError = sName or ("code " .. tostring(tMsg.nError))
			local sRequest = enumName(tFranchise, tRequestTypeNames, tMsg.nRequestType) or ("request #" .. tostring(tMsg.nRequestType))
			local sHint = tDatabaseErrorHints["DatabaseError_" .. sError] or ""
			if tFranchise == nil then
				-- no API to read the names from: the bare number says nothing
				sError = "unknown"
				sHint = "The game's online API was not available, so the mod cannot tell which error the server sent. If something did not happen, try it again."
			end
			if sError ~= "Ok" then
				-- the detailed log (debug builds): code, name and request
				if self.Core then
					pcall(self.Core.Log, self.Core, "server", "error", { code = tMsg.nError, name = sName or "?", req = tMsg.nRequestType,
						reqName = sRequest, listeners = #self.tServerErrorListeners })
				end
				-- first, so a failing report can't hide it (the market desk
				-- engine waits for its listing's answer)
				for _, fnListener in ipairs(self.tServerErrorListeners) do
					pcall(fnListener, tMsg.nError, sName, tMsg.nRequestType)
				end
				if self.Core then
					if sName ~= nil then
						self.Core:Mark("srv_" .. sName)
						-- the raw numbers too, to learn which name each code is
						self.Core:MarkNumber("srv_code", tMsg.nError)
						self.Core:MarkNumber("srv_request", tMsg.nRequestType)
					else
						-- no name: spell out the raw code and request type
						self.Core:MarkNumber("srv_unknown_code", tMsg.nError)
						self.Core:MarkNumber("srv_request", tMsg.nRequestType)
					end
				end
				self:Report("server", "Server error: " .. sError, sHint .. (sHint ~= "" and " " or "") .. "(" .. sRequest .. ")")
			end
		end
	end
end

-- fn(nError, sName, nRequestType) for every franchise server error that is
-- not Ok; sName is the DatabaseError_* name without its prefix
-- ("DidNotGetResponse"), or nil when no name matches the code.
Errors.AddServerErrorListener = function(self, fn)
	if type(fn) == "function" then
		self.tServerErrorListeners[#self.tServerErrorListeners + 1] = fn
	end
end

Errors._InstallDatabaseErrorReceiver = function(self)
	local fnReceiver = function(tMessages)
		pcall(self.OnDatabaseErrorMessages, self, tMessages)
	end
	self.fnDatabaseErrorReceiver = fnReceiver
	api.messaging.RegisterGlobalReceiver(api.messaging.MsgType_DatabaseErrorMessage, fnReceiver)
end

Errors._InstallCoroutineHook = function(self)
	local coroutine = global.coroutine
	local fnResume = coroutine.resume
	coroutine.resume = function(co, ...)
		local tResults = table.pack(fnResume(co, ...))
		if not tResults[1] then
			local sErr = tostring(tResults[2])
			if not string.find(sErr, "cannot resume dead coroutine", 1, true) then
				pcall(self.Report, self, "lua", "Script error", sErr)
			end
		end
		return table.unpack(tResults, 1, tResults.n)
	end
end

Errors._InstallDebugHooks = function(self)
	local tDebug = api.debug
	local fnError = tDebug.Error
	if type(fnError) == "function" then
		tDebug.Error = function(sMsg, ...)
			pcall(self.Report, self, "debug", "Game reported an error", sMsg)
			return fnError(sMsg, ...)
		end
	end
	local fnAssert = tDebug.Assert
	if type(fnAssert) == "function" then
		tDebug.Assert = function(bCond, sMsg, ...)
			if not bCond then
				pcall(self.Report, self, "assert", "Assertion failed", sMsg, false)
			end
			return fnAssert(bCond, sMsg, ...)
		end
	end
end

Errors.GetEntries = function(self)
	return self.tEntries
end

Errors.Init = function(self, Core)
	self.Core = Core
	for _, sStep in ipairs({ "_InstallDatabaseErrorReceiver", "_InstallCoroutineHook", "_InstallDebugHooks" }) do
		local bOk, sErr = pcall(self[sStep], self)
		if not bOk then
			Core.Trace("Errors." .. sStep .. " failed: " .. tostring(sErr))
		end
	end
end
