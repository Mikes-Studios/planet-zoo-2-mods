-----------------------------------------------------------------------
--  PZ2QoL.TradeJump  (trade shortcuts: Species board / Kin planner ->
--  the hub's Animal Storage or Market, for one species)
--
--  One click in the park page opens the hub the way the game's own buttons
--  do (decompiled 1.0.5):
--    - the trade centre's "Open storage" (components.ui.facilityinfopopup
--      _OpenAnimalStorage) and the exhibit panel's market/storage buttons:
--      IBackgroundWorldDataManager:SetInitialHubScreen(HUB_ANIMAL_MARKET,
--      ANIMAL_MARKET_SCREEN_STORAGE | _MARKET), then
--      MainHUD:OnWorldTransition_OpenHUB() (windows.mainhud.lua);
--    - the hub's Zoopedia button: SetAnimalMarketSpeciesFilter({"Lion"}),
--      which the Market mode applies on TransitionIn
--      (MarketUISetSpeciesFilterFromNames, startscreen.globe.
--      animalmarkethubmode.lua) and then clears.
--  Animal Storage has no pending species filter in the game, so for
--  Storage the species is kept here and handed to the hub page, which
--  filters the list itself (a mod chip, bars.js):
--    JS -> Lua  PZ2QoL_TradeOpen(req, kind, species, extra) -> PZ2QoL_TradeOpenResult(req, ok, detail)
--               extra (Market, from a needs notice): "sex=f;dim=48", the sex
--               wanted and the gene score to dim listings below, handed to
--               the hub page like the Storage species
--    JS -> Lua  PZ2QoL_TradeCounts(req, csv) -> PZ2QoL_TradeCountsResult(req, json)
--    JS -> Lua  PZ2QoL_TradeHello()            (hub page, on load / storage shown)
--    Lua -> JS  PZ2QoL_TradeFilter(seq, kind, species, extra)   until
--    JS -> Lua  PZ2QoL_TradeAck(seq)
--  Counts: api.planetHub.GetAdultsOfSpeciesInStorageSplitByGender(sSpecies)
--  -> { [1] = male GUIDs, [2] = female GUIDs } (adults only; the game calls
--  it from the park's Compare Mates in Franchise), less the ones listed on
--  the market.
--  Nothing here talks to Frontier's servers beyond what opening the hub
--  with the game's own button does. Fail soft: every call in pcall.
-----------------------------------------------------------------------
local global   = _G
local api      = global.api
local pcall    = global.pcall
local tostring = global.tostring
local tonumber = global.tonumber
local type     = global.type
local pairs    = global.pairs
local string   = global.string
local Handover  = global.require("PZ2QoL.Handover")
local ParkReads = global.require("PZ2QoL.ParkReads")

local TradeJump = module(...)

TradeJump.nPendingSeconds = 600 -- a storage filter older than this is dropped
TradeJump.nMaxSpecies = 40
TradeJump.tPending = nil        -- { nSeq, sKind, sSpecies, sExtra, nTime }
TradeJump.nSeq = 0
TradeJump.tViews = global.setmetatable({}, { __mode = "k" })

local function trace(sMsg)
	pcall(function() api.debug.Trace("[PZ2QoL] trade: " .. sMsg) end)
end

local function mark(sName)
	local Core = TradeJump.Core or global.package.loaded["pz2qol.core"]
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

local function kin()
	return global.package.loaded["pz2qol.kin"]
end

-- "[Animal_Lion]" / "Animal_Lion" / "Lion" -> "Lion"; nil when it is not a
-- plain species id.
local function cleanSpecies(s)
	if type(s) ~= "string" then
		return nil
	end
	s = string.gsub(s, "^%[", "")
	s = string.gsub(s, "%]$", "")
	s = string.gsub(s, "^Animal_", "")
	if #s < 1 or #s > 64 or string.find(s, "[^%w_]") then
		return nil
	end
	return s
end
TradeJump.CleanSpecies = cleanSpecies

local function bwdm()
	return api.game.GetEnvironment():RequireInterface("Interfaces.IBackgroundWorldDataManager")
end

local function mainHUD()
	return api.world.GetScript(api.world.GetActive()):GetHUD()
end

-- FrontEndUI's hub screen numbers (ui.controllers.frontendui.lua 1.0.5).
local function consts()
	local nHub, nMarket, nStorage = 2, 0, 1
	pcall(function()
		local FrontEndUI = global.require("UI.Controllers.FrontEndUI")
		if type(FrontEndUI) == "table" then
			nHub = tonumber(FrontEndUI.HUB_ANIMAL_MARKET) or nHub
			nMarket = tonumber(FrontEndUI.ANIMAL_MARKET_SCREEN_MARKET) or nMarket
			nStorage = tonumber(FrontEndUI.ANIMAL_MARKET_SCREEN_STORAGE) or nStorage
		end
	end)
	return nHub, nMarket, nStorage
end

-- Stored adults not listed on the market (ParkReads.StoredForSale): a listed
-- animal is the market's, never one to bring back or count on.
local function countUnlisted(animals, t)
	if type(t) ~= "table" then
		return 0
	end
	local n = 0
	for _, guid in pairs(t) do
		local bOk, tData = pcall(animals.GetMarketAnimalCompareMatesData, animals, guid, 2)
		if not ParkReads.StoredForSale(bOk and tData or nil, guid) then
			n = n + 1
		end
	end
	return n
end

-----------------------------------------------------------------------
-- Open the hub on Market or Animal Storage (one click, one transition)
-----------------------------------------------------------------------
TradeJump.Open = function(self, oUI, sReq, sKind, sSpecies, sExtra)
	local function answer(bOk, sDetail)
		mark(bOk and ("trade_open_" .. tostring(sKind)) or ("trade_open_fail_" .. tostring(sDetail)))
		pcall(oUI.TriggerEventAtNextAdvance, oUI, "PZ2QoL_TradeOpenResult", sReq, bOk == true, sDetail or "")
	end
	if sKind ~= "market" and sKind ~= "storage" then
		return answer(false, "badkind")
	end
	local sp = ""
	if sSpecies ~= nil and sSpecies ~= "" then
		sp = cleanSpecies(sSpecies)
		if sp == nil then
			return answer(false, "badspecies")
		end
	end
	local bOk, sDetail = self:_OpenHub(sKind, sp, function()
		local sEx = string.gsub(tostring(sExtra or ""), "[^%w=;]", "")
		if (sKind == "storage" and sp ~= "") or (sKind == "market" and sEx ~= "") then
			Handover.Put(self, { sKind = sKind, sSpecies = sp, sExtra = sEx }, now())
		end
	end)
	answer(bOk, sDetail)
end

-- The game's own hub opening on "market" or "storage" (sp: a clean species
-- or ""). fnBefore runs once every check passed, just before the screen is
-- set. -> true, "" or false, detail (nopark, nobuilding, nohub, nohud).
-- Also used by PZ2QoL.StorageFetch.
TradeJump._OpenHub = function(self, sKind, sp, fnBefore)
	local Kin = kin()
	local tAPIs = Kin and Kin:_ParkWorld() or nil
	if tAPIs == nil then
		return false, "nopark"
	end
	-- the game's own taskbar button is greyed out without a trade centre
	local bOkB, bHas = pcall(function() return tAPIs.facilities:ParkHasBuildingForAnimalStorage() end)
	if bOkB and bHas == false then
		return false, "nobuilding"
	end
	local bOkW, b = pcall(bwdm)
	if not bOkW or b == nil then
		return false, "nohub"
	end
	local nHub, nMarket, nStorage = consts()
	if fnBefore ~= nil then
		pcall(fnBefore)
	end
	if sKind == "market" and sp ~= nil and sp ~= "" then
		pcall(b.SetAnimalMarketSpeciesFilter, b, { sp })
	end
	local bOkS = pcall(b.SetInitialHubScreen, b, nHub, sKind == "market" and nMarket or nStorage)
	if not bOkS then
		return false, "nohub"
	end
	local bOkH, sErr = pcall(function()
		local oHUD = mainHUD()
		if oHUD == nil or type(oHUD.OnWorldTransition_OpenHUB) ~= "function" then
			global.error("no MainHUD")
		end
		oHUD:OnWorldTransition_OpenHUB()
	end)
	if not bOkH then
		trace("open failed: " .. tostring(sErr))
		-- the page falls back to the game's own Market & Storage button
		-- (HUD_OpenHubAnimalMarket), which sets the screen again; a market
		-- species filter stays for that
		pcall(b.SetInitialHubScreen, b, nil)
		return false, "nohud"
	end
	trace("opening the hub on " .. sKind .. ((sp ~= nil and sp ~= "") and (" for " .. sp) or ""))
	return true, ""
end

-----------------------------------------------------------------------
-- Adults of these species in Animal Storage (live, from the park)
-----------------------------------------------------------------------
TradeJump.Counts = function(self, oUI, sReq, sCsv)
	local Kin = kin()
	local tOut = { ok = false, mode = "unknown", bySpecies = {} }
	local tAPIs = Kin and Kin:_ParkWorld() or nil
	if tAPIs ~= nil then
		tOut.mode = Kin:_GameMode(tAPIs)
		-- the trade centre's room (Bring to the trade centre)
		pcall(function() tOut.tc = Kin:_TradeCentre(tAPIs) ~= nil end)
		tOut.tcMax, tOut.tcNow = ParkReads.TradeCentreRoom(tAPIs.park)
		local fn = nil
		pcall(function() fn = api.planetHub.GetAdultsOfSpeciesInStorageSplitByGender end)
		if type(fn) == "function" then
			tOut.ok = true
			local nDone, nErr = 0, 0
			local tSeen = {}
			for sRaw in string.gmatch(tostring(sCsv or ""), "[^,]+") do
				if nDone >= self.nMaxSpecies then
					break
				end
				local sp = cleanSpecies(sRaw)
				if sp ~= nil and not tSeen[sp] then
					tSeen[sp] = true
					nDone = nDone + 1
					local bOk, t = pcall(fn, sp)
					if bOk and type(t) == "table" then
						tOut.bySpecies[sp] = { m = countUnlisted(tAPIs.animals, t[1]), f = countUnlisted(tAPIs.animals, t[2]) }
					else
						nErr = nErr + 1
					end
				end
			end
			mark(nErr > 0 and "trade_counts_err" or "trade_counts_ok")
		else
			mark("trade_counts_none")
		end
	else
		tOut.error = "nopark"
	end
	local sJson = "null"
	if Kin and Kin.Encode then
		local bOk, s = pcall(Kin.Encode, tOut)
		if bOk then
			sJson = s
		end
	end
	pcall(oUI.TriggerEventAtNextAdvance, oUI, "PZ2QoL_TradeCountsResult", sReq, sJson)
end

-----------------------------------------------------------------------
-- The storage filter, handed to the hub page until it confirms
-----------------------------------------------------------------------
TradeJump.Hello = function(self, oUI)
	local t, bExpired = Handover.Pending(self, now())
	if bExpired then
		mark("trade_filter_expired")
	end
	if t == nil then
		return
	end
	pcall(oUI.TriggerEventAtNextAdvance, oUI, "PZ2QoL_TradeFilter", t.nSeq, t.sKind, t.sSpecies, t.sExtra)
	mark("trade_filter_sent")
end

TradeJump.Ack = function(self, nSeq)
	if Handover.Ack(self, nSeq) then
		mark("trade_filter_acked")
	end
end

-----------------------------------------------------------------------
-- Wiring
-----------------------------------------------------------------------
TradeJump.Attach = function(self, oUI)
	if oUI == nil or self.tViews[oUI] then
		return
	end
	self.tViews[oUI] = true
	local bOk, sErr = Handover.Listen(oUI, self, trace, {
		{ "PZ2QoL_TradeOpen", 4, function(sReq, sKind, sSpecies, sExtra) self:Open(oUI, sReq, sKind, sSpecies, sExtra) end },
		{ "PZ2QoL_TradeCounts", 2, function(sReq, sCsv) self:Counts(oUI, sReq, sCsv) end },
		{ "PZ2QoL_TradeHello", 0, function() self:Hello(oUI) end },
		{ "PZ2QoL_TradeAck", 1, function(nSeq) self:Ack(nSeq) end },
	})
	if not bOk then
		trace("listeners failed: " .. tostring(sErr))
	end
	mark(bOk and "trade_attached" or "trade_attach_failed")
end

TradeJump.Init = function(self, Core)
	self.Core = Core
	Core.TradeJump = self
end
