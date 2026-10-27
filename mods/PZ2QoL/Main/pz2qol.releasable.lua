-----------------------------------------------------------------------
--  PZ2QoL.Releasable
--
--  Typing "releasable" (or "release") in the species search of zoo
--  management's Animals tab lists only animals that can go to the wild,
--  so a habitat's or the whole zoo's can be selected at once and sent to
--  the trade centre for release groups.
--
--  Eligible: the game's own release check (exhibit animals too, in every
--  mode), plus juveniles held back only by their age (finalising a release
--  group matures them).
-----------------------------------------------------------------------
local global   = _G
local pairs    = global.pairs
local ipairs   = global.ipairs
local pcall    = global.pcall
local type     = global.type
local tonumber = global.tonumber
local tostring = global.tostring
local string   = global.string
local table    = global.table

local Releasable = module(...)

local c_tKeywords = { releasable = true, release = true }
local c_sExhibitPrefix = "exhibit_"
-- the Animals tab's row ids carry this many characters before the game id
local c_nIDPrefixLength = 7

local function isKeyword(sSearch)
	if type(sSearch) ~= "string" then
		return false
	end
	local sTrimmed = string.match(sSearch, "^%s*(.-)%s*$")
	return c_tKeywords[string.lower(sTrimmed)] == true
end

Releasable.Init = function(self, Core)
	self.Core = Core
	Core:AddModulePatch("Editors.Park.AnimalDatabaseTab", function(tModule) self:_PatchTab(tModule) end)
end

Releasable._ReleasePreventers = function(self)
	return global.require("Editors.Animal.RelocateAnimalsPopup").g_tReleasePreventers
end

Releasable._OnlyAgeHoldsBack = function(self, tPreventers)
	if type(tPreventers) ~= "table" or not tPreventers.bJuvenile then
		return false
	end
	for _, sPreventer in ipairs(self:_ReleasePreventers()) do
		if sPreventer ~= "bJuvenile" and tPreventers[sPreventer] then
			return false
		end
	end
	return true
end

-- row ids as the Animals tab builds them (AnimalDatabaseTab.GetAnimalRelocationStats)
Releasable._IsEligible = function(self, oTab, sRowID)
	if string.sub(sRowID, 1, #c_sExhibitPrefix) ~= c_sExhibitPrefix then
		local nAnimalID = tonumber(string.sub(sRowID, c_nIDPrefixLength + 1))
		local animalsAPI = oTab.animalsAPI
		if not nAnimalID or not animalsAPI:HasAnimalBrain(nAnimalID) then
			return false
		end
		return animalsAPI:CanReleaseAnimal(nAnimalID)
			or self:_OnlyAgeHoldsBack(animalsAPI:GetRelocatePreventers(nAnimalID))
	end
	local sAnimalGUID = string.sub(sRowID, #c_sExhibitPrefix + c_nIDPrefixLength + 1)
	local exhibitsAPI = oTab.exhibitsAPI
	if not exhibitsAPI:AnimalDataExists(sAnimalGUID) then
		return false
	end
	return exhibitsAPI:CanReleaseAnimalUID(sAnimalGUID)
		or self:_OnlyAgeHoldsBack(exhibitsAPI:GetRelocatePreventersUID(sAnimalGUID))
end

-- the keyword is not a species: drop the species match the search made for it
Releasable._DropSpeciesMatch = function(self, oTab, fnAfterFilterApplied)
	if type(oTab.tAnimalFilterState) == "table" and oTab.tAnimalFilterState.species ~= nil then
		oTab.tAnimalFilterState.species = nil
		fnAfterFilterApplied(oTab)
	end
end

Releasable._HideIneligible = function(self, oTab)
	for _, tAnimal in pairs(oTab.tAnimalSort) do
		if tAnimal.visible then
			local bOk, bEligible = pcall(self._IsEligible, self, oTab, tAnimal.id)
			tAnimal.visible = bOk and bEligible == true
		end
	end
end

-- Tested on 1.0.5 (build 1023906).
Releasable._PatchTab = function(self, Tab)
	local fnFilterAnimals = Tab.FilterAnimals
	local fnAfterFilterApplied = Tab.AfterFilterApplied
	if type(fnFilterAnimals) ~= "function" or type(fnAfterFilterApplied) ~= "function" then
		self.Core:Mark("releasable_patch_missing")
		return
	end
	Tab.FilterAnimals = function(oTab, ...)
		local bKeyword = isKeyword(oTab.sAnimalSearch)
		if bKeyword then
			local bOk, sErr = pcall(self._DropSpeciesMatch, self, oTab, fnAfterFilterApplied)
			if not bOk then
				self.Core.Trace("releasable search failed: " .. tostring(sErr))
				self.Core:Mark("releasable_failed")
			end
		end
		local tResults = table.pack(fnFilterAnimals(oTab, ...))
		if bKeyword then
			local bOk, sErr = pcall(self._HideIneligible, self, oTab)
			if not bOk then
				self.Core.Trace("releasable filter failed: " .. tostring(sErr))
				self.Core:Mark("releasable_failed")
			end
		end
		return table.unpack(tResults, 1, tResults.n)
	end
	self.Core:Mark("releasable_patched")
end
