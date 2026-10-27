-----------------------------------------------------------------------
--  PZ2QoL.Education
--
--  The zoo's Guest Education rating counts, per species in the zoo, the
--  education topics its props show (boards, speakers, stations) against the
--  game's fully-educated count (GetFullyEducatedTopicCount, the Education
--  Species tab's x/5). This module reports what each species short of that
--  count still lacks and fills the gaps from the props it can spare, as the props' own
--  info panels set them (EducationUIUtils.HandleEvent):
--    SetEducationSourceSpecies(prop, species), then
--    SetEducationSourceContentTypeIndex(prop, topic) with a topic the
--    prop offers and research has unlocked.
--  A spare prop shows no topic, or one another prop shows already. A prop
--  that fits none of the missing topics gets its own setting back.
--
--  JS -> Lua  PZ2QoL_EduReport(req) -> PZ2QoL_EduReportResult(req, json)
--             PZ2QoL_EduFill(req)   -> PZ2QoL_EduFillResult(req, json)
--  Tested on 1.0.7 (build 26164034).
-----------------------------------------------------------------------
local global   = _G
local pairs    = global.pairs
local ipairs   = global.ipairs
local next     = global.next
local pcall    = global.pcall
local type     = global.type
local tostring = global.tostring
local table    = global.table
local Handover = global.require("PZ2QoL.Handover")

local Education = module(...)

-- method call t:Name(...) -> its first result, nil when it fails or is missing
local function call(t, sName, ...)
	if t == nil or type(t[sName]) ~= "function" then
		return nil
	end
	local tRes = table.pack(pcall(t[sName], t, ...))
	return tRes[1] and tRes[2] or nil
end

Education._World = function(self)
	local tAPIs = global.require("PZ2QoL.Kin"):_ParkWorld()
	if tAPIs == nil or tAPIs.education == nil then
		return nil
	end
	return tAPIs
end

-- -> { need, species = [{ id, placed, missing = [{ i, name }], locked }], spare }, spare props, placed topics
Education._Read = function(self, tAPIs)
	local edu = tAPIs.education
	local helpers = tAPIs.animalsDataHelpers
	local tTypes = call(edu, "GetEducationTypeUIData") or {}
	local tSpeciesTopics = call(edu, "GetSpeciesToTopicsUIData") or {}
	local tSources = call(edu, "GetEducationSourceUIData") or {}
	local tInZoo = helpers and call(helpers, "GetAllSpeciesInZoo", helpers.AnimalListType_Habitat) or {}
	local nAudioGuide = edu.EducationSourceType_AudioGuide
	local tPlaced, tSpare = {}, {}
	for nEntity, t in pairs(tSources) do
		if type(t) == "table" and t.nType ~= nAudioGuide then
			if t.bUnset or t.nContent == nil or tPlaced[t.nContent] ~= nil then
				tSpare[#tSpare + 1] = nEntity
			else
				tPlaced[t.nContent] = nEntity
			end
		end
	end
	table.sort(tSpare)
	local tOut = { need = call(edu, "GetFullyEducatedTopicCount"), species = {}, spare = #tSpare }
	for sSpecies in pairs(tInZoo) do
		local tRow = { id = sSpecies, placed = 0, missing = {}, locked = 0 }
		for nIndex, bUnlocked in pairs(tSpeciesTopics[sSpecies] or {}) do
			if tPlaced[nIndex] ~= nil then
				tRow.placed = tRow.placed + 1
			elseif bUnlocked then
				local tType = tTypes[nIndex]
				tRow.missing[#tRow.missing + 1] = { i = nIndex, name = type(tType) == "table" and tType.sLocString or tostring(nIndex) }
			else
				tRow.locked = tRow.locked + 1
			end
		end
		tOut.species[#tOut.species + 1] = tRow
	end
	return tOut, tSpare, tPlaced
end

-- A missing topic (tMissing: index -> true) the prop offers for the species it is set to -> index or nil
Education._TopicFor = function(self, edu, nEntity, tMissing)
	for _, t in ipairs(call(edu, "GetContentTypesForEducationSourceUI", nEntity, false) or {}) do
		if type(t) == "table" and t.bUnlocked and t.nIndex ~= nil and tMissing[t.nIndex] then
			return t.nIndex
		end
	end
	return nil
end

-- Each spare prop takes a missing topic of a species short of the count it
-- can show; one that fits none gets its own setting back.
-- -> { assigned = [{ prop, species, topic }], report }
Education._Fill = function(self, tAPIs)
	local edu = tAPIs.education
	local tReport, tSpare = self:_Read(tAPIs)
	local tMissing, tShort = {}, {}
	for _, tRow in ipairs(tReport.species) do
		local tSet = {}
		tShort[tRow.id] = tReport.need and (tReport.need - tRow.placed) or #tRow.missing
		if tShort[tRow.id] > 0 then
			for _, t in ipairs(tRow.missing) do
				tSet[t.i] = true
			end
		end
		tMissing[tRow.id] = tSet
	end
	local tAssigned = {}
	for _, nEntity in ipairs(tSpare) do
		local tWas = call(edu, "GetEducationSourceData", nEntity) or {}
		local bDone = false
		for _, tOption in ipairs(call(edu, "GetSpeciesForEducationSourceUI", nEntity) or {}) do
			local sSpecies = type(tOption) == "table" and tOption.sSpecies or nil
			local tSet = sSpecies and tMissing[sSpecies]
			if tSet and next(tSet) ~= nil then
				call(edu, "SetEducationSourceSpecies", nEntity, sSpecies)
				local nTopic = self:_TopicFor(edu, nEntity, tSet)
				if nTopic ~= nil then
					call(edu, "SetEducationSourceContentTypeIndex", nEntity, nTopic)
					-- a topic counts for every species it is relevant to
					for sOther, tOther in pairs(tMissing) do
						if tOther[nTopic] then
							tOther[nTopic] = nil
							tShort[sOther] = tShort[sOther] - 1
							if tShort[sOther] <= 0 then
								tMissing[sOther] = {}
							end
						end
					end
					tAssigned[#tAssigned + 1] = { prop = tostring(nEntity), species = sSpecies, topic = nTopic }
					bDone = true
					break
				end
			end
		end
		if not bDone and tWas.sSpecies ~= nil then
			call(edu, "SetEducationSourceSpecies", nEntity, tWas.sSpecies)
			if tWas.nContentTypeIndex ~= nil and not tWas.bContentTypeUnset then
				call(edu, "SetEducationSourceContentTypeIndex", nEntity, tWas.nContentTypeIndex)
			end
		end
	end
	return { assigned = tAssigned, report = (self:_Read(tAPIs)) }
end

Education._Answer = function(self, oUI, sEvent, sReq, fnBuild)
	local Kin = global.require("PZ2QoL.Kin")
	local tAPIs = self:_World()
	local tOut = tAPIs and fnBuild(tAPIs) or { error = "no park" }
	pcall(oUI.TriggerEventAtNextAdvance, oUI, sEvent, sReq, Kin.Encode(tOut))
end

Education.Attach = function(self, oUI)
	if oUI == nil then
		return
	end
	Handover.Listen(oUI, self, function(sMsg) self.Core.Trace("education: " .. sMsg) end, {
		{ "PZ2QoL_EduReport", 1, function(sReq)
			self:_Answer(oUI, "PZ2QoL_EduReportResult", sReq, function(t) return (self:_Read(t)) end)
		end },
		{ "PZ2QoL_EduFill", 1, function(sReq)
			self:_Answer(oUI, "PZ2QoL_EduFillResult", sReq, function(t)
				local tOut = self:_Fill(t)
				self.Core:Log("education", "filled", { props = #tOut.assigned })
				return tOut
			end)
		end },
	})
end

Education.Init = function(self, Core)
	self.Core = Core
end
