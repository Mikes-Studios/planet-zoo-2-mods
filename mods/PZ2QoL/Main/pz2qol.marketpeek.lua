-----------------------------------------------------------------------
--  PZ2QoL.MarketPeek
--
--  "Check market prices" from Animal Storage without leaving it.
--
--  The hub's market data comes from the native AnimalMarketUIDatastoreManager
--  (api.planetHub.MarketUI*). It fills ['hubAnimalsData','animalMarketData']
--  for whatever MarketUISetDisplayType says (None / Market / TradeHistory).
--  Storage leaves it at None. While storage is open we:
--   1. remember the market's sort/filter settings;
--   2. set display Market, filter to one species and CC, request page one
--      (the same request the Market tab makes when you filter it);
--   3. wait until the request is answered, tell the page "ready" so it
--      can record the listings into the price book;
--   4. if the page asks for the next page (PZ2QoL_MarketPeekPage n, 0-based,
--      what the Market's own paginator sends), MarketUISetPage(n) and wait
--      again; one page at a time, at most nMaxPages;
--   5. go back to page 0, restore the settings and display None.
--  The visible screen never changes: the page's Market tab stays hidden.
--  Only ever started by a click in the page; one request at a time.
-----------------------------------------------------------------------
local global   = _G
local api      = global.api
local pcall    = global.pcall
local tostring = global.tostring
local type     = global.type

local MarketPeek = module(...)

MarketPeek.nRequestTimeout = 20 -- seconds for the server to answer
MarketPeek.nReleaseTimeout = 8  -- seconds for the page to read the list
MarketPeek.nSettleFrames = 10   -- frames after the answer before "ready"
MarketPeek.nCooldown = 3        -- seconds between two requests
MarketPeek.nMaxPages = 20       -- the Market's own paginator shows at most 20

MarketPeek.oStorageMode = nil -- the active AnimalStorageHubMode, if any
MarketPeek.tPeek = nil        -- the request in progress
MarketPeek.nLastStart = nil
MarketPeek.tViews = global.setmetatable({}, { __mode = "k" })

local function trace(sMsg)
	pcall(function() api.debug.Trace("[PZ2QoL] " .. sMsg) end)
end

local function mark(sName)
	local Core = global.package.loaded["pz2qol.core"]
	if Core then
		Core:Mark(sName)
	end
end

-- the detailed log (debug builds; Core:Log, a no-op otherwise)
local function log(sEvent, tData)
	local Core = global.package.loaded["pz2qol.core"]
	if Core and Core.Log then
		pcall(Core.Log, Core, "peek", sEvent, tData)
	end
end

local function now()
	local bOk, n = pcall(function()
		return api.time.PerformanceTimeToMilliseconds(api.time.GetPerformanceTimer()) / 1000
	end)
	return bOk and n or 0
end

-- Tells the page how the request is going.
MarketPeek._Send = function(self, sState, sDetail)
	-- the hub page (FrontEnd view) asked, so it gets the answer
	local Hub = global.package.loaded["pz2qol.hub"]
	local oUI = Hub and Hub.bFrontEndIsModded and Hub.oFrontEndUI or nil
	log("state", { state = sState, detail = sDetail, page = self.tPeek and self.tPeek.nPage or nil, noview = oUI == nil or nil })
	if oUI ~= nil then
		pcall(oUI.TriggerEventAtNextAdvance, oUI, "PZ2QoL_MarketPeekState", sState, sDetail or "")
	end
end

-- The native calls this needs; nil if the game build does not have them.
MarketPeek._Hub = function(self)
	local hub = api.planetHub
	if type(hub) ~= "table" then
		return nil
	end
	for _, sName in global.ipairs({ "MarketUISetDisplayType", "MarketUIResetFiltersToDefault", "MarketUISetSpeciesFilter",
		"MarketUIApplyFilters", "MarketUIRequestData" }) do
		if type(hub[sName]) ~= "function" then
			return nil, sName
		end
	end
	if hub.AnimalMarketDisplay_Market == nil or hub.AnimalMarketDisplay_None == nil then
		return nil, "AnimalMarketDisplay_Market"
	end
	return hub
end

MarketPeek.Start = function(self, speciesUID)
	log("start", { uid = speciesUID, storage = self.oStorageMode ~= nil, running = self.tPeek ~= nil })
	if self.tPeek ~= nil then
		return self:_Send("busy", "A market check is already running.")
	end
	if self.oStorageMode == nil then
		return self:_Send("failed", "Animal Storage is not open on the game side.")
	end
	-- one server action at a time: never during a listing run
	local Lister = global.package.loaded["pz2qol.lister"]
	if type(Lister) == "table" and Lister.tRun ~= nil then
		return self:_Send("busy", "A listing run is going; check prices when it is done.")
	end
	if speciesUID == nil then
		return self:_Send("failed", "No species id was sent.")
	end
	local t = now()
	if self.nLastStart ~= nil and t - self.nLastStart < self.nCooldown then
		return self:_Send("busy", "Wait a moment between market checks.")
	end
	local hub, sMissing = self:_Hub()
	if hub == nil then
		return self:_Send("failed", "This game version has no api.planetHub." .. tostring(sMissing) .. ".")
	end
	self.nLastStart = t
	local tPeek = { nStarted = t, nFrames = 0, nQuiet = 0, sState = "requested" }
	pcall(function() tPeek.tSaved = hub.MarketUIGetSortFilterSettings() end)
	local bOk, sErr = pcall(function()
		hub.MarketUISetDisplayType(hub.AnimalMarketDisplay_Market)
		hub.MarketUIResetFiltersToDefault()
		if hub.MarketUIClearFilterText then hub.MarketUIClearFilterText() end
		if hub.MarketUIClearSourceFilter then hub.MarketUIClearSourceFilter() end
		hub.MarketUISetSpeciesFilter({ speciesUID })
		-- Conservation Credits only (the market's own "Credits" filter sends 0)
		if hub.MarketUISetFilterValue and hub.MarketFilterType_Currency ~= nil then
			hub.MarketUISetFilterValue(hub.MarketFilterType_Currency, 0)
		end
		hub.MarketUIApplyFilters()
		hub.MarketUIRequestData()
	end)
	self.tPeek = tPeek
	mark("peek_start")
	log("requested", { uid = speciesUID, ok = bOk, err = not bOk and tostring(sErr) or nil, saved = tPeek.tSaved ~= nil })
	if not bOk then
		self:_Finish("failed", "The game refused the market request: " .. tostring(sErr))
		return
	end
	self:_Send("loading")
end

-- The page has recorded the current page and wants page nPage (0-based).
MarketPeek.Page = function(self, nPage)
	local tPeek = self.tPeek
	if tPeek == nil then
		return self:_Send("failed", "No market check is running.")
	end
	if tPeek.sState ~= "ready" then
		return self:_Send("busy", "The previous page is still loading.")
	end
	-- one server action at a time: a listing run may be waiting for its confirm
	local Lister = global.package.loaded["pz2qol.lister"]
	if type(Lister) == "table" and Lister.tRun ~= nil then
		return self:_Send("busy", "a listing run is going; check prices again when it is done")
	end
	nPage = global.tonumber(nPage)
	if nPage == nil or nPage < 1 or nPage >= self.nMaxPages or nPage ~= global.math.floor(nPage) then
		return self:_Send("failed", "Bad market page " .. tostring(nPage) .. ".")
	end
	local hub = api.planetHub
	if type(hub) ~= "table" or type(hub.MarketUISetPage) ~= "function" then
		return self:_Send("nopaging", "This game version has no api.planetHub.MarketUISetPage.")
	end
	tPeek.sState = "requested"
	tPeek.nStarted = now()
	tPeek.nFrames = 0
	tPeek.nQuiet = 0
	tPeek.nPage = nPage
	local bOk, sErr = pcall(hub.MarketUISetPage, nPage)
	mark("peek_page")
	log("page", { page = nPage, ok = bOk, err = not bOk and tostring(sErr) or nil })
	if not bOk then
		self:_Finish("failed", "The game refused market page " .. tostring(nPage) .. ": " .. tostring(sErr))
		return
	end
	self:_Send("loading", tostring(nPage))
end

-- Called every frame while Animal Storage is open (its Advance).
MarketPeek.Tick = function(self)
	local tPeek = self.tPeek
	if tPeek == nil then
		return
	end
	tPeek.nFrames = tPeek.nFrames + 1
	local nAge = now() - tPeek.nStarted
	if tPeek.sState == "requested" then
		local bPending = nil
		local hub = api.planetHub
		if hub and type(hub.MarketUIHasPendingDataRequests) == "function" then
			local bOk, b = pcall(hub.MarketUIHasPendingDataRequests)
			if bOk then bPending = b end
		end
		if bPending == nil then
			-- no way to ask: give the server a fixed few seconds
			bPending = nAge < 3
		end
		if bPending or tPeek.nFrames < 3 then
			tPeek.nQuiet = 0
		else
			tPeek.nQuiet = tPeek.nQuiet + 1
		end
		if tPeek.nQuiet >= self.nSettleFrames then
			tPeek.sState = "ready"
			tPeek.nReady = now()
			mark("peek_ready")
			log("ready", { page = tPeek.nPage or 0, secs = nAge, frames = tPeek.nFrames, pendingKnown = hub ~= nil and type(hub.MarketUIHasPendingDataRequests) == "function" })
			self:_Send("ready")
		elseif nAge > self.nRequestTimeout then
			self:_Finish("failed", "The market did not answer within " .. self.nRequestTimeout .. " s.")
		end
	elseif tPeek.sState == "ready" then
		if now() - tPeek.nReady > self.nReleaseTimeout then
			self:_Finish("done", "timeout")
		end
	end
end

-- The page has read the list (or gave up): put the market back.
MarketPeek.Release = function(self)
	if self.tPeek ~= nil then
		self:_Finish("done", "ok")
	end
end

MarketPeek._Finish = function(self, sState, sDetail)
	local tPeek = self.tPeek
	self.tPeek = nil
	if tPeek == nil then
		return
	end
	local hub = api.planetHub
	if tPeek.nPage ~= nil and tPeek.nPage > 0 then
		-- the Market tab should open on its first page again
		pcall(function() hub.MarketUISetPage(0) end)
	end
	pcall(function()
		if tPeek.tSaved ~= nil and hub.MarketUISetSortFilterSettings then
			hub.MarketUISetSortFilterSettings(tPeek.tSaved)
		else
			hub.MarketUIResetFiltersToDefault()
		end
	end)
	pcall(function() hub.MarketUISetDisplayType(hub.AnimalMarketDisplay_None) end)
	mark("peek_end")
	log("release", { state = sState, detail = sDetail, lastPage = tPeek.nPage or 0, restored = tPeek.tSaved ~= nil })
	if sState ~= "done" then
		trace("market check: " .. tostring(sDetail))
	end
	self:_Send(sState, sDetail)
end

-- The franchise API of the open Animal Storage (nil when it is closed).
MarketPeek.GetFranchise = function(self)
	local oMode = self.oStorageMode
	local tAPIs = oMode and oMode.tWorldAPIs
	return tAPIs and tAPIs.franchise or nil
end

-- JS -> Lua events on the hub page. Registered from the view's ready
-- callback (registering earlier is silently dropped).
MarketPeek.Attach = function(self, oUI)
	if oUI == nil or self.tViews[oUI] then
		return
	end
	self.tViews[oUI] = true
	local bOk, sErr = pcall(function()
		-- callbacks get (callbackArgument, eventArgs...)
		oUI:AddEventListener("PZ2QoL_MarketPeek", 1, function(_, speciesUID)
			local bRan, sRunErr = pcall(self.Start, self, speciesUID)
			if not bRan then
				if self.tPeek ~= nil then
					self:_Finish("failed", tostring(sRunErr))
				else
					self:_Send("failed", tostring(sRunErr))
				end
			end
		end, self)
		oUI:AddEventListener("PZ2QoL_MarketPeekPage", 1, function(_, nPage)
			local bRan, sRunErr = pcall(self.Page, self, nPage)
			if not bRan and self.tPeek ~= nil then
				self:_Finish("failed", tostring(sRunErr))
			end
		end, self)
		oUI:AddEventListener("PZ2QoL_MarketPeekRelease", 0, function()
			pcall(self.Release, self)
		end, self)
	end)
	if not bOk then
		trace("market check listener failed: " .. tostring(sErr))
	end
end

MarketPeek._PatchStorageMode = function(self, StorageMode)
	local fnIn = StorageMode.TransitionIn
	local fnOut = StorageMode.TransitionOut
	local fnAdvance = StorageMode.Advance
	if type(fnIn) ~= "function" or type(fnOut) ~= "function" or type(fnAdvance) ~= "function" then
		trace("AnimalStorageHubMode has changed; background market check off")
		return
	end
	StorageMode.TransitionIn = function(oMode, ...)
		self.oStorageMode = oMode
		return fnIn(oMode, ...)
	end
	StorageMode.TransitionOut = function(oMode, ...)
		-- put the market back before anything else leaves storage
		if self.tPeek ~= nil then
			pcall(self._Finish, self, "failed", "Animal Storage was closed during the market check.")
		end
		if self.oStorageMode == oMode then
			self.oStorageMode = nil
		end
		return fnOut(oMode, ...)
	end
	StorageMode.Advance = function(oMode, ...)
		if self.tPeek ~= nil then
			local bOk, sErr = pcall(self.Tick, self)
			if not bOk then
				pcall(self._Finish, self, "failed", tostring(sErr))
			end
		end
		return fnAdvance(oMode, ...)
	end
end

MarketPeek.Init = function(self, Core)
	Core:AddModulePatch("StartScreen.Globe.AnimalStorageHubMode", function(t) self:_PatchStorageMode(t) end)
end
