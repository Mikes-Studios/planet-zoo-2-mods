-----------------------------------------------------------------------
--  PZ2QoL.ParkReads
--
--  Reads of the running park that several features make the same way.
--  Callers pass the park's own APIs (Kin:_ParkWorld()); every call is in
--  pcall, so a missing or failing one reads as no answer.
-----------------------------------------------------------------------
local global = _G
local pcall  = global.pcall
local type   = global.type

local ParkReads = module(...)

local function read(o, sName, ...)
	local bOk, v = pcall(function(...) return o[sName](o, ...) end, ...)
	if bOk then
		return v
	end
	return nil
end

-- The trade centre for habitat animals: nMax, nNow, bFull, or nil when the
-- park gives no numbers (park: the park API).
ParkReads.TradeCentreRoom = function(park)
	if park == nil then
		return nil
	end
	local nMax, nNow = read(park, "GetTradeCentreMaxCapacity"), read(park, "GetNumberOfAnimalsInTradeCentre")
	if type(nMax) ~= "number" or type(nNow) ~= "number" then
		return nil
	end
	return nMax, nNow, nNow >= nMax
end

ParkReads.HasTransportJob = function(animals, e)
	local tTransport = read(animals, "GetAnimalTransportData", e)
	return type(tTransport) == "table" and tTransport.bHasTransportJob == true
end

-- A keeper, the box or the game is moving it: the game's info panel keeps
-- its Move button off then (and PZ2QoL.Kin's Move refuses).
ParkReads.IsBeingMoved = function(animals, e)
	return read(animals, "IsBoxAnimating", e) == true or read(animals, "IsAnimalInBoxAndBoxAnimating", e) == true
		or read(animals, "IsBoxingClaimed", e) == true or ParkReads.HasTransportJob(animals, e)
end

-- A stored animal on the market (tData: GetMarketAnimalCompareMatesData's
-- answer, guid: the game's): bForSale stays false for the player's own
-- listings, so the ones PZ2QoL.Lister saw listed this session count too.
ParkReads.StoredForSale = function(tData, guid)
	if type(tData) == "table" and tData.bForSale == true then
		return true
	end
	local bOk, Lister = pcall(global.require, "PZ2QoL.Lister")
	return bOk and type(Lister) == "table" and type(Lister.IsListedGuid) == "function" and Lister:IsListedGuid(guid)
end
