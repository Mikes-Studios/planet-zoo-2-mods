-- Lua 5.3 check of PZ2QoL.Education over a stub education API (run: lua5.3 tests/education.lua from mods/PZ2QoL)
_G.api = {}
function module()
	_G.__m = {}
	return _G.__m
end
package.loaded["PZ2QoL.Handover"] = { Listen = function() return true end }
dofile("Main/pz2qol.education.lua")
local Education = _G.__m

local function check(sWhat, vGot, vWant)
	if vGot ~= vWant then error(sWhat .. ": got " .. tostring(vGot) .. ", want " .. tostring(vWant)) end
	print("ok " .. sWhat)
end

-- one species with topics 1-4 unlocked and 5 locked; prop 10 shows topic 1,
-- 11 shows topic 1 too (spare), 12 is unset; 13 and 14 show another species' topic 9 (14 spare, offering no rhino topic)
local tSources = {
	[10] = { nType = 1, nContent = 1 },
	[11] = { nType = 1, nContent = 1 },
	[12] = { nType = 1, bUnset = true },
	[13] = { nType = 1 },
	[14] = { nType = 1 },
}
local tSet = { [10] = { s = "Rhino", t = 1 }, [11] = { s = "Rhino", t = 1 }, [12] = {}, [13] = { s = "Other", t = 9 }, [14] = { s = "Other", t = 9 } }
local edu = {
	EducationSourceType_AudioGuide = 99,
	GetEducationTypeUIData = function() return { [1] = { sLocString = "[T1]" }, [2] = { sLocString = "[T2]" }, [3] = { sLocString = "[T3]" }, [4] = { sLocString = "[T4]" }, [5] = { sLocString = "[T5]" } } end,
	GetSpeciesToTopicsUIData = function() return { Rhino = { [1] = true, [2] = true, [3] = true, [4] = true, [5] = false } } end,
	GetEducationSourceUIData = function()
		local t = {}
		for e, v in pairs(tSources) do t[e] = { nType = v.nType, nContent = tSet[e].t, bUnset = tSet[e].t == nil } end
		return t
	end,
	GetFullyEducatedTopicCount = function() return 4 end,
	GetEducationSourceData = function(_, e) return { sSpecies = tSet[e].s, nContentTypeIndex = tSet[e].t, bContentTypeUnset = tSet[e].t == nil } end,
	GetSpeciesForEducationSourceUI = function(_, e) return (e == 13 or e == 14) and { { sSpecies = "Other" } } or { { sSpecies = "Rhino" } } end,
	SetEducationSourceSpecies = function(_, e, s) tSet[e].s = s tSet[e].t = nil end,
	GetContentTypesForEducationSourceUI = function(_, e)
		if tSet[e].s ~= "Rhino" then return { { nIndex = 9, bUnlocked = true } } end
		return { { nIndex = 1, bUnlocked = true }, { nIndex = 2, bUnlocked = true }, { nIndex = 3, bUnlocked = true }, { nIndex = 4, bUnlocked = true }, { nIndex = 5, bUnlocked = false } }
	end,
	SetEducationSourceContentTypeIndex = function(_, e, i) tSet[e].t = i end,
}
local helpers = { AnimalListType_Habitat = 1, GetAllSpeciesInZoo = function() return { Rhino = true } end }
local tAPIs = { education = edu, animalsDataHelpers = helpers }

local tReport = Education:_Read(tAPIs)
check("one topic placed", tReport.species[1].placed, 1)
check("three unlocked topics missing", #tReport.species[1].missing, 3)
check("one still needs research", tReport.species[1].locked, 1)
check("three spare props: a second on topic 1, an unset one, a second on topic 9", tReport.spare, 3)

local tOut = Education:_Fill(tAPIs)
check("two spare props take missing topics", #tOut.assigned, 2)
check("after the fill three topics are placed", tOut.report.species[1].placed, 3)
check("a prop that offers none keeps its own setting", tSet[14].s .. "/" .. tostring(tSet[14].t), "Other/9")
check("the prop on the covered topic keeps it", tSet[10].t, 1)

-- a species at the game's count takes no more topics
tSet = { [10] = { s = "Rhino", t = 1 }, [11] = { s = "Rhino", t = 1 }, [12] = {}, [13] = { s = "Other", t = 9 }, [14] = { s = "Other", t = 9 } }
edu.GetFullyEducatedTopicCount = function() return 2 end
local tCapped = Education:_Fill(tAPIs)
check("filling stops once the species has the count it needs", #tCapped.assigned, 1)
check("the report carries the game's count", tCapped.report.need, 2)
