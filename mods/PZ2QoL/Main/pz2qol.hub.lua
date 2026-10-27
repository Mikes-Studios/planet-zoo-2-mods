-----------------------------------------------------------------------
--  PZ2QoL.Hub
--
--  Gets the mod's UI code into the start-screen hub (FrontEnd view):
--   1. loads the mod's UI overlay (Win64/ovldata/PZ2QoL/UI/PZ2QoLUI.ovl)
--      the same way the game loads Content0's UI overlays;
--   2. opens a hidden probe page from the overlay. Only when the probe
--      reports ready do we know the overlay really serves files;
--   3. when the hub creates its FrontEnd view, points it at
--      PZ2QoLFrontend.html (the game's own Frontend.js plus our module).
--  If any step fails the vanilla page is used, so the hub always works.
-----------------------------------------------------------------------
local global   = _G
local api      = global.api
local pcall    = global.pcall
local tostring = global.tostring
local type     = global.type
local string   = global.string
local coroutine = global.coroutine
local table    = global.table

local Hub = module(...)

Hub.sOverlayName = "PZ2QoLUI"
Hub.sOverlayPath = "PZ2QoL/UI/PZ2QoLUI"
Hub.sVanillaFrontEnd = "coui://UIGameface/Frontend.html"
Hub.sModFrontEnd = "coui://UIGameface/PZ2QoLFrontend.html"
Hub.sProbeAddress = "coui://UIGameface/PZ2QoL/probe.html"
Hub.sVanillaHUD = "coui://UIGameface/HUD.html"
Hub.sModHUD = "coui://UIGameface/PZ2QoLHUD.html"

Hub.sOverlayState = "not loaded" -- "loading" | "mapped" | "failed"
Hub.bProbeOk = false
Hub.oFrontEndUI = nil
Hub.bFrontEndIsModded = false

local function trace(sMsg)
	pcall(function() api.debug.Trace("[PZ2QoL] " .. sMsg) end)
end

local ipairs = global.ipairs

local function cp(sName)
	local Core = global.package.loaded["pz2qol.core"]
	if Core then
		Core:Checkpoint(sName)
	end
end

-- repeating breadcrumb (debug builds): the exit-to-menu path, logged on
-- every pass (the crash on exit to main menu, 2026-10-17)
local function mk(sName)
	local Core = global.package.loaded["pz2qol.core"]
	if Core then
		pcall(Core.Mark, Core, sName)
	end
end

-- Lua 5.3: coroutine.running() returns (thread, isMain); never nil.
Hub._CanYield = function(self)
	local co, bMain = coroutine.running()
	return co ~= nil and not bMain
end

-- Called at boot. Boot runs inside require(), which cannot yield, so this
-- only starts the load; WaitUntilReady does the waiting.
Hub._LoadOverlay = function(self)
	cp("overlay_load_begin")
	local bOk, sErr = pcall(function()
		api.ui2.LoadOverlay(self.sOverlayName, self.sOverlayPath)
	end)
	if not bOk then
		self.sOverlayState = "failed"
		trace("LoadOverlay failed: " .. tostring(sErr))
		return
	end
	self.sOverlayState = "loading"
	cp("overlay_load_called")
	self:_TryMap()
end

-- Called from the database's AddContentToCall, which the game runs on its
-- startup coroutine (Database.Main yields in the same loop). Bounded, so
-- a broken overlay costs at most a few seconds once.
Hub.WaitUntilReady = function(self)
	if self.bWaited or not self:_CanYield() then
		return
	end
	self.bWaited = true
	cp("wait_enter")
	local nFrames = 0
	while self.sOverlayState == "loading" and nFrames < 300 do
		if self:_TryMap() then
			break
		end
		nFrames = nFrames + 1
		if nFrames == 1 then cp("wait_map_yield1") end
		coroutine.yield()
		if nFrames == 1 then cp("wait_map_resumed1") end
	end
	cp("wait_map_done")
	nFrames = 0
	while self.sOverlayState == "mapped" and not self.bProbeOk and nFrames < 180 do
		nFrames = nFrames + 1
		if nFrames == 1 then cp("wait_probe_yield1") end
		coroutine.yield()
		if nFrames == 1 then cp("wait_probe_resumed1") end
	end
	cp(self.bProbeOk and "wait_exit_probe_ok" or "wait_exit_probe_not_ok")
	-- Destroy the probe here, on the startup coroutine. Never from a UI
	-- callback: DestroyView inside a view callback deadlocks the UI engine
	-- (froze the game right after the FrontEnd became ready).
	if self.bProbeOk then
		self:_ShutdownProbe()
		cp("probe_shutdown")
	end
	trace("overlay " .. self.sOverlayState .. ", probe " .. tostring(self.bProbeOk))
end

Hub._TryMap = function(self)
	if self.sOverlayState ~= "loading" then
		return self.sOverlayState == "mapped"
	end
	local bOk, bLoaded = pcall(api.ui2.IsOverlayLoaded, self.sOverlayName)
	if not bOk or not bLoaded then
		return false
	end
	cp("overlay_loaded")
	local bMapped, sErr = pcall(api.ui2.MapResources, self.sOverlayName)
	if not bMapped then
		self.sOverlayState = "failed"
		trace("MapResources failed: " .. tostring(sErr))
		return false
	end
	self.sOverlayState = "mapped"
	cp("overlay_mapped")
	trace("overlay mapped")
	self:_StartProbe()
	return true
end

-- A hidden 16x16 view that loads probe.html from the overlay. Its JS
-- fires "OnReady", which ViewWrapper turns into the ready callback.
Hub._StartProbe = function(self)
	cp("probe_begin")
	local bOk, sErr = pcall(function()
		local ViewWrapper = global.require("UI2.ViewWrapper")
		local oProbe = ViewWrapper:new()
		oProbe:Init({
			sViewName = "PZ2QoLProbe",
			sViewAddress = self.sProbeAddress,
			bRenderToScreen = false,
			bRenderToFullScreen = false,
			nViewWidth = 16,
			nViewHeight = 16,
			fnOnReadyCallback = function()
				cp("probe_ready")
				self.bProbeOk = true
				trace("probe page ready: overlay serves UI files")
			end,
		})
		self.oProbe = oProbe
	end)
	cp(bOk and "probe_created" or "probe_create_failed")
	if not bOk then
		trace("probe failed to start: " .. tostring(sErr))
	end
end

Hub._ShutdownProbe = function(self)
	if self.oProbe ~= nil then
		pcall(function() self.oProbe:Shutdown() end)
		self.oProbe = nil
	end
end

-- Every modded view that is loaded and ready (HUD first).
Hub.GetModUIs = function(self)
	local tViews = {}
	for _, t in ipairs({ { self.oHUDUI, self.bHUDIsModded }, { self.oFrontEndUI, self.bFrontEndIsModded } }) do
		local oUI, bModded = t[1], t[2]
		if oUI ~= nil and bModded and oUI.view ~= nil then
			local bOk, bReady = pcall(oUI.IsReady, oUI)
			if bOk and bReady then
				tViews[#tViews + 1] = oUI
			end
		end
	end
	return tViews
end

-- Returns the FrontEnd UI wrapper when our page is loaded and ready.
Hub.GetModUI = function(self)
	-- the in-park HUD first (that's where the player is), then the hub
	for _, t in ipairs({ { self.oHUDUI, self.bHUDIsModded }, { self.oFrontEndUI, self.bFrontEndIsModded } }) do
		local oUI, bModded = t[1], t[2]
		if oUI ~= nil and bModded and oUI.view ~= nil then
			local bOk, bReady = pcall(oUI.IsReady, oUI)
			if bOk and bReady then
				return oUI
			end
		end
	end
	return nil
end

Hub._PatchFrontEndUI = function(self, FrontEndUI)
	local ViewWrapper = global.require("UI2.ViewWrapper")
	local fnInit = FrontEndUI.Init or ViewWrapper.Init
	FrontEndUI.Init = function(oUI, tInitSettings)
		mk("x_fe_init")
		local bModded = false
		if type(tInitSettings) == "table" and tInitSettings.sViewAddress == self.sVanillaFrontEnd then
			cp("fe_init_begin")
			self:_TryMap()
			if self.sOverlayState == "mapped" and self.bProbeOk then
				tInitSettings.sViewAddress = self.sModFrontEnd
				bModded = true
				local fnReady = tInitSettings.fnOnReadyCallback
				tInitSettings.fnOnReadyCallback = function(...)
					cp("fe_mod_ready")
					mk("x_fe_ready")
					self:_OnModFrontEndReady(oUI)
					mk("x_fe_ready_done")
					if fnReady then
						return fnReady(...)
					end
				end
			else
				cp("fe_vanilla")
				trace("using vanilla FrontEnd (overlay " .. self.sOverlayState .. ", probe " .. tostring(self.bProbeOk) .. ")")
			end
			self.oFrontEndUI = oUI
			self.bFrontEndIsModded = bModded
			if bModded then cp("fe_redirected") end
		end
		local tResult = table.pack(fnInit(oUI, tInitSettings))
		mk("x_fe_init_done")
		if bModded then
			cp("fe_init_done")
		end
		return table.unpack(tResult, 1, tResult.n)
	end
	local fnShutdown = FrontEndUI.Shutdown or ViewWrapper.Shutdown
	FrontEndUI.Shutdown = function(oUI, ...)
		mk("x_fe_shutdown")
		if self.oFrontEndUI == oUI then
			self.oFrontEndUI = nil
			self.bFrontEndIsModded = false
		end
		return fnShutdown(oUI, ...)
	end
end

-- On exit the game unmaps and unloads its own UI overlays
-- (GameScript.OnPrepareToShutdown). Ours must go the same way, or the UI
-- system shuts down with an overlay still mapped (fatal 0xFDEAD crash).
Hub.UnloadOverlay = function(self)
	if self.sOverlayState ~= "mapped" and self.sOverlayState ~= "loading" then
		return
	end
	cp("overlay_unload_begin")
	pcall(api.ui2.UnmapResources, self.sOverlayName)
	if self:_CanYield() then
		local nFrames = 0
		while nFrames < 300 do
			local bOk, bDone = pcall(api.ui2.AreResourcesUnmapped, self.sOverlayName)
			if not bOk or bDone then
				break
			end
			nFrames = nFrames + 1
			coroutine.yield()
		end
	end
	pcall(api.ui2.UnloadOverlay, self.sOverlayName)
	self.sOverlayState = "unloaded"
	cp("overlay_unloaded")
end

Hub._PatchGameScript = function(self, GameScript)
	local fnPrepare = GameScript.OnPrepareToShutdown
	if type(fnPrepare) ~= "function" then
		return
	end
	GameScript.OnPrepareToShutdown = function(oGame, ...)
		local bOk, sErr = pcall(self.UnloadOverlay, self)
		if not bOk then
			trace("overlay unload failed: " .. tostring(sErr))
		end
		return fnPrepare(oGame, ...)
	end
end

-- The in-park HUD view (zoo management lives there): same safe redirect to
-- PZ2QoLHUD.html (the game's HUDApp.js plus our module) as the hub view.
-- Debug builds: the page reports its progress and actions (breadcrumbs).
-- Register only once the view is ready for bindings (from its ready
-- callback); registering right after Init is silently dropped.
Hub.tTraceListened = global.setmetatable({}, { __mode = "k" })
Hub._AddTraceListener = function(self, oUI)
	local Core = global.package.loaded["pz2qol.core"]
	if not (Core and Core.bTrace) or self.tTraceListened[oUI] then
		return
	end
	self.tTraceListened[oUI] = true
	local bOk = pcall(function()
		-- callbacks get (callbackArgument, eventArgs...)
		oUI:AddEventListener("PZ2QoL_Trace", 1, function(a, b)
			local sName = type(a) == "string" and a or b
			Core:Mark("js_" .. string.gsub(tostring(sName), "[^%w_]", "_"))
		end, self)
		-- the page's detailed log (debuglog.js): lines separated by "\n",
		-- each written as it is (Core:LogText)
		oUI:AddEventListener("PZ2QoL_Log", 1, function(a, b)
			local sText = type(a) == "string" and a or b
			if type(sText) ~= "string" then
				return
			end
			local n = 0
			for sLine in string.gmatch(sText, "[^\n]+") do
				n = n + 1
				if n > 200 then
					Core:LogText("js log: more than 200 lines in one batch, rest dropped")
					break
				end
				Core:LogText(sLine)
			end
		end, self)
		-- the page asks whether the log is on (it may have missed the
		-- PZ2QoL_LogState sent when the view became ready)
		oUI:AddEventListener("PZ2QoL_LogHello", 0, function()
			pcall(oUI.TriggerEventAtNextAdvance, oUI, "PZ2QoL_LogState", Core.bLogOff and "off" or "on")
		end, self)
	end)
	cp(bOk and "trace_listener_ok" or "trace_listener_failed")
end

Hub._PatchHUDUI = function(self, HUDUI)
	local ViewWrapper = global.require("UI2.ViewWrapper")
	local fnInit = HUDUI.Init or ViewWrapper.Init
	HUDUI.Init = function(oUI, tInitSettings)
		mk("x_hud_init")
		local bModded = false
		if type(tInitSettings) == "table" and tInitSettings.sViewAddress == self.sVanillaHUD then
			cp("hud_init_begin")
			self:_TryMap()
			if self.sOverlayState == "mapped" and self.bProbeOk then
				tInitSettings.sViewAddress = self.sModHUD
				bModded = true
				local fnReady = tInitSettings.fnOnReadyCallback
				tInitSettings.fnOnReadyCallback = function(...)
					cp("hud_mod_ready")
					self:_OnModFrontEndReady(oUI)
					if fnReady then
						return fnReady(...)
					end
				end
			else
				cp("hud_vanilla")
			end
			self.oHUDUI = oUI
			self.bHUDIsModded = bModded
		end
		return fnInit(oUI, tInitSettings)
	end
	local fnShutdown = HUDUI.Shutdown or ViewWrapper.Shutdown
	HUDUI.Shutdown = function(oUI, ...)
		mk("x_hud_shutdown")
		if self.oHUDUI == oUI then
			self.oHUDUI = nil
			self.bHUDIsModded = false
		end
		local tResult = table.pack(fnShutdown(oUI, ...))
		mk("x_hud_shutdown_done")
		return table.unpack(tResult, 1, tResult.n)
	end
end

-- The page's greeting, and whether its detailed log is on (debug builds only).
Hub._Greet = function(self, oUI)
	local Core = self.Core
	pcall(function()
		oUI:TriggerEventAtNextAdvance("PZ2QoL_Hello", Core.sVersion)
		oUI:TriggerEventAtNextAdvance("PZ2QoL_LogState", (Core.bTrace and not Core.bLogOff) and "on" or "off")
		if Core.bTrace then
			Core:Log("lua", "view_ready", { view = oUI == self.oFrontEndUI and "hub" or "hud", version = Core.sVersion })
		end
	end)
end

-- Runs inside the view's ready callback: keep it to non-blocking calls
-- (no view creation/destruction here).
Hub._OnModFrontEndReady = function(self, oUI)
	self:_AddTraceListener(oUI)
	-- every feature's listeners, in Core's order (pz2qol.core.lua tFeatures)
	local bHub = oUI == self.oFrontEndUI
	local bGreeted = false
	for _, tFeature in ipairs(self.Core.tAttach) do
		if tFeature.bAfterHello and not bGreeted then
			bGreeted = true
			self:_Greet(oUI)
		end
		if tFeature.sView == nil or bHub then
			pcall(tFeature.oModule.Attach, tFeature.oModule, oUI)
		end
	end
	if not bGreeted then
		self:_Greet(oUI)
	end
	-- once per session: remove what the 2026-10-16 persistence probe left
	-- in the player save (PZ2QoL.Probe and a 12 KB PZ2QoL.Big)
	if self.Core.PlayerStore then
		pcall(self.Core.PlayerStore.Cleanup, self.Core.PlayerStore)
	end
	-- the errors kept while no mod page was up (the banner)
	local Errors = global.package.loaded["pz2qol.errors"]
	if Errors and Errors.Flush then
		pcall(Errors.Flush, Errors)
	end
end

-- Used by Errors when the mod UI is not active.
Hub.ShowFallbackDialog = function(self, tEntry)
	local oHUD = self.oStartScreenHUD
	if oHUD == nil or oHUD.RunPrompt == nil then
		return
	end
	local function literal(s)
		s = string.gsub(tostring(s), "[|%[%]{}]", " ")
		return "[STRING_LITERAL:Value=|" .. s .. "|]"
	end
	pcall(function()
		oHUD:RunPrompt({
			header = literal(tEntry.sTitle),
			label = literal(tEntry.sDetail),
			headerIcon = "img/icons/IconWarning.svg",
			bannerModifiers = "colorBackground warning",
			items = { { id = "ok", label = "[MainMenu_ServerError_Ok]", inputName = "UI_Select" } },
		})
	end)
end

Hub._PatchStartScreenHUD = function(self, StartScreenHUD)
	local fnActivate = StartScreenHUD.Activate
	if type(fnActivate) == "function" then
		StartScreenHUD.Activate = function(oHUD, ...)
			cp("hud_activate")
			mk("x_ssh_activate")
			self.oStartScreenHUD = oHUD
			-- no park APIs from here on (the park may be unloading)
			local Kin = global.package.loaded["pz2qol.kin"]
			if Kin and Kin.SetStartScreen then
				pcall(Kin.SetStartScreen, Kin, true)
			end
			local tResult = table.pack(fnActivate(oHUD, ...))
			mk("x_ssh_activate_done")
			return table.unpack(tResult, 1, tResult.n)
		end
	end
	local fnDeactivate = StartScreenHUD.Deactivate
	if type(fnDeactivate) == "function" then
		StartScreenHUD.Deactivate = function(oHUD, ...)
			mk("x_ssh_deactivate")
			if self.oStartScreenHUD == oHUD then
				self.oStartScreenHUD = nil
			end
			local Kin = global.package.loaded["pz2qol.kin"]
			if Kin and Kin.SetStartScreen then
				pcall(Kin.SetStartScreen, Kin, false)
			end
			return fnDeactivate(oHUD, ...)
		end
	end
end

-- Debug builds: breadcrumbs for the game's exit to main menu (Franchise:
-- save the zoo, then activate the hub world). Originals called unchanged.
Hub._PatchSaveAgent = function(self, SaveAgent)
	local Core = global.package.loaded["pz2qol.core"]
	if not (Core and Core.bTrace) then
		return
	end
	local function wrap(sMethod, sBegin, sEnd)
		local fn = SaveAgent[sMethod]
		if type(fn) ~= "function" then
			return
		end
		SaveAgent[sMethod] = function(...)
			mk(sBegin)
			local tResult = table.pack(fn(...))
			mk(sEnd)
			return table.unpack(tResult, 1, tResult.n)
		end
	end
	wrap("SaveFranchiseZooNowWithoutMessage", "x_exit_save", "x_exit_save_done")
	wrap("_ReturnToStartScreenNow", "x_return", "x_return_done")
	wrap("WaitForEditorsToClose", "x_wait_editors", "x_wait_editors_done")
end

Hub.Init = function(self, Core)
	self.Core = Core
	Core:AddModulePatch("Windows.SaveAgent", function(t) self:_PatchSaveAgent(t) end)
	Core:AddModulePatch("UI.Controllers.FrontEndUI", function(t) self:_PatchFrontEndUI(t) end)
	Core:AddModulePatch("UI.Controllers.HUDUI", function(t) self:_PatchHUDUI(t) end)
	Core:AddModulePatch("Game.GameScript", function(t) self:_PatchGameScript(t) end)
	Core:AddModulePatch("StartScreen.Shared.StartScreenHUD", function(t) self:_PatchStartScreenHUD(t) end)
	self:_LoadOverlay()
end
